import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ScanDraft, ScanItem, ScanReplacement } from '../types/scan'
import type { Sheet } from '../types/sheet'
import { createId, db, plain } from '../utils/db'
import { sortByYear } from '../utils/scale'

export type NewSheet = Omit<Sheet, 'id' | 'neighborCodes'> & {
  neighborCodes?: string[]
}
export type NewScanItem = ScanDraft

export const useSheetStore = defineStore('sheet', () => {
  const sheets = ref<Sheet[]>([])
  const allScans = ref<ScanItem[]>([])
  const currentSheet = ref<Sheet | null>(null)
  const loading = ref(false)
  const initialized = ref(false)
  let initialization: Promise<void> | null = null

  // 详情页默认只看各谱系的当前版本
  const currentScans = computed(() =>
    currentSheet.value
      ? allScans.value.filter(
          (scan) => scan.sheetId === currentSheet.value?.id && scan.isCurrent,
        )
      : [],
  )

  async function init(): Promise<void> {
    if (initialized.value) {
      return
    }
    if (!initialization) {
      loading.value = true
      initialization = Promise.all([db.sheets.toArray(), db.scans.toArray()])
        .then(([sheetRows, scanRows]) => {
          sheets.value = sortByYear(sheetRows).reverse()
          allScans.value = scanRows
          initialized.value = true
        })
        .finally(() => {
          loading.value = false
        })
    }
    await initialization
  }

  async function addSheet(input: NewSheet): Promise<Sheet> {
    await init()
    const sheet: Sheet = {
      ...input,
      id: createId('sheet'),
      neighborCodes: input.neighborCodes ?? [],
    }
    await db.sheets.add(plain(sheet))
    sheets.value = sortByYear([...sheets.value, sheet]).reverse()
    currentSheet.value = sheet
    return sheet
  }

  async function loadSheet(id: string): Promise<void> {
    await init()
    currentSheet.value = sheets.value.find((sheet) => sheet.id === id) ?? (await db.sheets.get(id)) ?? null
  }

  /**
   * 登记扫描件。
   * - 不传 replacement：作为全新谱系的首版入库。
   * - 传入 replacement：先列出同名当前件并经用户确认后，
   *   旧版本留档（isCurrent=false），新版本作为该谱系的新版本入库；
   *   若旧版本为主用件，主用标记自动转移到新版本。
   */
  async function addScan(input: NewScanItem, replacement?: ScanReplacement): Promise<ScanItem> {
    await init()
    const previous = replacement
      ? allScans.value.find((scan) => scan.id === replacement.previousId)
      : undefined
    if (replacement && (!previous || !previous.isCurrent || previous.sheetId !== input.sheetId)) {
      throw new Error('替换目标不存在或已不是当前版本，无法登记新版本。')
    }
    const reason = replacement?.reason.trim() ?? ''
    if (replacement && !reason) {
      throw new Error('替换扫描件时必须填写替换原因。')
    }

    const replacedAt = new Date().toISOString()
    const lineageId = previous?.lineageId ?? createId('lineage')
    const versionNo = previous ? previous.versionNo + 1 : 1
    // 承接主用件：主用标记自动转移，登记人无需也不能再手动关闭
    const isPrimary = previous?.isPrimary ? true : input.isPrimary
    const scan: ScanItem = {
      ...input,
      isPrimary,
      id: createId('scan'),
      lineageId,
      versionNo,
      isCurrent: true,
    }

    await db.transaction('rw', db.scans, async () => {
      if (previous && replacement) {
        await db.scans.update(previous.id, {
          isCurrent: false,
          isPrimary: false,
          replacedAt,
          replaceReason: reason,
        })
      }
      if (isPrimary) {
        // 只有当前版本可以持有主用标记，留档件不参与切换
        await db.scans
          .where('sheetId')
          .equals(scan.sheetId)
          .filter((item) => item.isCurrent)
          .modify({ isPrimary: false })
      }
      await db.scans.add(plain(scan))
    })

    allScans.value = allScans.value.map((item) => {
      if (item.sheetId !== scan.sheetId || !item.isCurrent) {
        return item
      }
      if (previous && item.id === previous.id) {
        return {
          ...item,
          isCurrent: false,
          isPrimary: false,
          replacedAt,
          replaceReason: reason,
        }
      }
      return isPrimary ? { ...item, isPrimary: false } : item
    })
    allScans.value = [...allScans.value, scan]
    return scan
  }

  /** 切换主用件；已留档的旧版本不能再被选为主用 */
  async function setPrimaryScan(scanId: string): Promise<void> {
    const target = allScans.value.find((scan) => scan.id === scanId)
    if (!target || !target.isCurrent) {
      return
    }
    await db.scans
      .where('sheetId')
      .equals(target.sheetId)
      .filter((scan) => scan.isCurrent)
      .modify({ isPrimary: false })
    await db.scans.update(scanId, { isPrimary: true })
    allScans.value = allScans.value.map((scan) => {
      if (scan.sheetId !== target.sheetId) {
        return scan
      }
      return { ...scan, isPrimary: scan.isCurrent && scan.id === scanId }
    })
  }

  function getSheetById(id: string): Sheet | undefined {
    return sheets.value.find((sheet) => sheet.id === id)
  }

  function getSheetByCode(code: string): Sheet | undefined {
    return sheets.value.find((sheet) => sheet.code === code)
  }

  /** 图幅下的全部扫描件（含留档旧版本），主用件优先 */
  function getAllScansForSheet(sheetId: string): ScanItem[] {
    return allScans.value
      .filter((scan) => scan.sheetId === sheetId)
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))
  }

  /** 图幅下各谱系的当前版本（默认视图、片目计数、主用件选择均用它） */
  function getScansForSheet(sheetId: string): ScanItem[] {
    return getAllScansForSheet(sheetId).filter((scan) => scan.isCurrent)
  }

  /** 登记时按文件名定位同名当前件；命中则需用户确认后按替换入库 */
  function findCurrentByFileName(sheetId: string, fileName: string): ScanItem | undefined {
    return allScans.value.find(
      (scan) => scan.sheetId === sheetId && scan.isCurrent && scan.fileName === fileName,
    )
  }

  /** 取某份扫描件的历次版本（含自身），按版本号从旧到新排列 */
  function getLineageScans(lineageId: string): ScanItem[] {
    return allScans.value
      .filter((scan) => scan.lineageId === lineageId)
      .sort((left, right) => left.versionNo - right.versionNo)
  }

  /** 图幅下已留档的旧版本件数，用于提示存在可展开的替换史 */
  function getArchivedCount(sheetId: string): number {
    return allScans.value.filter((scan) => scan.sheetId === sheetId && !scan.isCurrent).length
  }

  return {
    sheets,
    allScans,
    currentSheet,
    currentScans,
    loading,
    initialized,
    init,
    addSheet,
    loadSheet,
    addScan,
    setPrimaryScan,
    getSheetById,
    getSheetByCode,
    getAllScansForSheet,
    getScansForSheet,
    findCurrentByFileName,
    getLineageScans,
    getArchivedCount,
  }
})
