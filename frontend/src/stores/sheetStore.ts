import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ScanItem } from '../types/scan'
import type { Sheet } from '../types/sheet'
import { createId, db, plain } from '../utils/db'
import { sortByYear } from '../utils/scale'

export type NewSheet = Omit<Sheet, 'id' | 'neighborCodes'> & {
  neighborCodes?: string[]
}
/** 新谱系首版登记时，谱系字段由 store 补齐 */
export type NewScanItem = Omit<ScanItem, 'id' | 'lineageId' | 'version' | 'versionStatus'>
/** 同名替换登记：旧件留档所需信息 */
export interface ReplaceScanInput extends NewScanItem {
  previousScanId: string
  replaceReason: string
  replacedAt: string
}

export const useSheetStore = defineStore('sheet', () => {
  const sheets = ref<Sheet[]>([])
  const allScans = ref<ScanItem[]>([])
  const currentSheet = ref<Sheet | null>(null)
  const loading = ref(false)
  const initialized = ref(false)
  let initialization: Promise<void> | null = null

  /** 图幅详情默认只取当前版本，留档件不在此列 */
  const currentScans = computed(() =>
    currentSheet.value
      ? allScans.value.filter(
          (scan) => scan.sheetId === currentSheet.value?.id && scan.versionStatus === 'current',
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

  /** 登记全新扫描件：自成谱系的第 1 版 */
  async function addScan(input: NewScanItem): Promise<ScanItem> {
    await init()
    const scan: ScanItem = {
      ...input,
      id: createId('scan'),
      lineageId: '',
      version: 1,
      versionStatus: 'current',
    }
    scan.lineageId = scan.id
    if (scan.isPrimary) {
      await clearPrimaryForSheet(scan.sheetId)
    }
    await db.scans.add(plain(scan))
    allScans.value = [...allScans.value, scan]
    return scan
  }

  /**
   * 同名替换：确认当前件后再调用。旧件留档并记录替换日期与原因；
   * 新件承接谱系号与版本序号。若旧件为主用件且 inheritPrimary 为真，
   * 主用标记自动转移到新件，其余当前件的主用标记一并清除。
   */
  async function replaceScan(input: ReplaceScanInput): Promise<ScanItem> {
    await init()
    const previous = allScans.value.find((scan) => scan.id === input.previousScanId)
    if (!previous || previous.versionStatus !== 'current') {
      throw new Error('只能替换当前版本的扫描件')
    }
    if (previous.fileName !== input.fileName || previous.sheetId !== input.sheetId) {
      throw new Error('替换件必须与当前件同图幅、同名')
    }
    const reason = input.replaceReason.trim()
    if (!reason) {
      throw new Error('请填写替换原因')
    }

    const lineageMembers = allScans.value
      .filter((scan) => scan.lineageId === previous.lineageId)
      .map((scan) => scan.version)
    const nextVersion = (lineageMembers.length ? Math.max(...lineageMembers) : previous.version) + 1
    const now = input.replacedAt
    const scan: ScanItem = {
      ...input,
      replaceReason: reason,
      id: createId('scan'),
      lineageId: previous.lineageId,
      version: nextVersion,
      versionStatus: 'current',
      isPrimary: input.isPrimary && previous.isPrimary,
    }

    await db.transaction('rw', db.scans, async () => {
      await db.scans.update(previous.id, {
        versionStatus: 'archived',
        isPrimary: false,
        replacedAt: now,
        replaceReason: reason,
      })
      if (scan.isPrimary) {
        await db.scans
          .where('sheetId')
          .equals(scan.sheetId)
          .filter((item) => item.versionStatus === 'current')
          .modify({ isPrimary: false })
      }
      await db.scans.add(plain(scan))
    })

    allScans.value = allScans.value.map((item) => {
      if (item.id !== previous.id) {
        return item
      }
      return {
        ...item,
        versionStatus: 'archived',
        isPrimary: false,
        replacedAt: now,
        replaceReason: reason,
      }
    })
    if (scan.isPrimary) {
      allScans.value = allScans.value.map((item) =>
        item.sheetId === scan.sheetId && item.versionStatus === 'current'
          ? { ...item, isPrimary: item.id === scan.id }
          : item,
      )
    }
    allScans.value = [...allScans.value, scan]
    return scan
  }

  async function clearPrimaryForSheet(sheetId: string): Promise<void> {
    await db.scans
      .where('sheetId')
      .equals(sheetId)
      .filter((scan) => scan.versionStatus === 'current')
      .modify({ isPrimary: false })
    allScans.value = allScans.value.map((item) =>
      item.sheetId === sheetId && item.versionStatus === 'current' ? { ...item, isPrimary: false } : item,
    )
  }

  /** 主用件只能在当前版本之间切换，留档件不可再设为主用 */
  async function setPrimaryScan(scanId: string): Promise<void> {
    const target = allScans.value.find((scan) => scan.id === scanId)
    if (!target || target.versionStatus === 'archived' || target.isPrimary) {
      return
    }
    await db.transaction('rw', db.scans, async () => {
      await db.scans
        .where('sheetId')
        .equals(target.sheetId)
        .filter((scan) => scan.versionStatus === 'current')
        .modify({ isPrimary: false })
      await db.scans.update(scanId, { isPrimary: true })
    })
    allScans.value = allScans.value.map((scan) => {
      if (scan.sheetId !== target.sheetId || scan.versionStatus !== 'current') {
        return scan
      }
      return { ...scan, isPrimary: scan.id === scanId }
    })
  }

  function getSheetById(id: string): Sheet | undefined {
    return sheets.value.find((sheet) => sheet.id === id)
  }

  function getSheetByCode(code: string): Sheet | undefined {
    return sheets.value.find((sheet) => sheet.code === code)
  }

  /** 全量扫描件（含留档件），当前版本与主用件排在前面，供导出等场景使用 */
  function getScansForSheet(sheetId: string): ScanItem[] {
    return allScans.value
      .filter((scan) => scan.sheetId === sheetId)
      .sort((left, right) => {
        const statusGap = Number(left.versionStatus === 'current') - Number(right.versionStatus === 'current')
        if (statusGap !== 0) {
          return -statusGap
        }
        const primaryGap = Number(left.isPrimary) - Number(right.isPrimary)
        if (primaryGap !== 0) {
          return -primaryGap
        }
        if (left.lineageId !== right.lineageId) {
          return left.lineageId.localeCompare(right.lineageId)
        }
        return right.version - left.version
      })
  }

  /** 图幅下各谱系的当前版本，图幅列表计数用 */
  function getCurrentScansForSheet(sheetId: string): ScanItem[] {
    return getScansForSheet(sheetId).filter((scan) => scan.versionStatus === 'current')
  }

  /** 查找同图幅下同名的当前件；登记同名文件时用于提示替换 */
  function findCurrentScanByName(sheetId: string, fileName: string): ScanItem | undefined {
    const normalized = fileName.trim()
    return allScans.value.find(
      (scan) =>
        scan.sheetId === sheetId &&
        scan.versionStatus === 'current' &&
        scan.fileName === normalized,
    )
  }

  /** 某条扫描件所属谱系的全部版本，按版本号倒序 */
  function getLineageScans(scanId: string): ScanItem[] {
    const anchor = allScans.value.find((scan) => scan.id === scanId)
    if (!anchor) {
      return []
    }
    return allScans.value
      .filter((scan) => scan.lineageId === anchor.lineageId)
      .sort((left, right) => right.version - left.version)
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
    replaceScan,
    setPrimaryScan,
    getSheetById,
    getSheetByCode,
    getScansForSheet,
    getCurrentScansForSheet,
    findCurrentScanByName,
    getLineageScans,
  }
})
