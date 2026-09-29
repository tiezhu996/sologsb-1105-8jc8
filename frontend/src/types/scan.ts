export type ColorMode = '彩色' | '黑白' | '灰度'
export type ScanQuality = '清晰' | '偏淡' | '破损'
/** 当前件参与主用切换与拼合基准；留档件仅供追溯，不能再设为主用 */
export type ScanVersionStatus = 'current' | 'archived'

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
  /** 同一谱系（同图幅同文件名）共享的谱系号，等于首个版本的扫描件 id */
  lineageId: string
  /** 谱系内版本序号，从 1 起 */
  version: number
  versionStatus: ScanVersionStatus
  /** 留档时间，即被新版本替换的日期 */
  replacedAt?: string
  /** 替换原因，随新版本登记时填写 */
  replaceReason?: string
}

export const COLOR_MODES: ColorMode[] = ['彩色', '黑白', '灰度']
export const SCAN_QUALITIES: ScanQuality[] = ['清晰', '偏淡', '破损']
