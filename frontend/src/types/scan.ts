export type ColorMode = '彩色' | '黑白' | '灰度'
export type ScanQuality = '清晰' | '偏淡' | '破损'

export interface ScanItem {
  id: string
  sheetId: string
  fileName: string
  resolutionDpi: number
  colorMode: ColorMode
  pieces: number
  quality: ScanQuality
  storageNote: string
  importedAt: string
  isPrimary: boolean
  /** 版本谱系编号：同一份扫描件的历次版本共用一个 lineageId */
  lineageId: string
  /** 谱系内版本号，首版为 1，每替换一次递增 */
  versionNo: number
  /** 是否为该谱系的当前版本；被替换后转为 false 并留档 */
  isCurrent: boolean
  /** 被新版本替换的日期；首版与当前版本为空 */
  replacedAt?: string
  /** 替换原因，登记新版本时填写，随旧版本一并留档 */
  replaceReason?: string
}

/** 登记扫描件时由调用方提供的字段；谱系信息由 store 统一维护 */
export type ScanDraft = Omit<
  ScanItem,
  'id' | 'lineageId' | 'versionNo' | 'isCurrent' | 'replacedAt' | 'replaceReason'
>

/** 同名替换时需要的上下文 */
export interface ScanReplacement {
  /** 被替换的当前版本扫描件 id */
  previousId: string
  /** 替换原因，需随旧版本留档 */
  reason: string
}

export const COLOR_MODES: ColorMode[] = ['彩色', '黑白', '灰度']
export const SCAN_QUALITIES: ScanQuality[] = ['清晰', '偏淡', '破损']
