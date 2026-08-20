/**
 * src/shared/ipc.ts — IPC 通道名与类型定义（唯一事实来源）
 *
 * 由 ui-engineer 统一定义（队长协作规范 #4）：
 * - 通道名常量：electron/main.ts 注册 handler、electron/preload.ts 暴露方法均引用此处，
 *   保证渲染进程 / 主进程对通道名的理解完全一致。
 * - 请求 / 响应类型：全部经结构化克隆（structured clone）传输，仅允许可克隆数据。
 * - 核心数据模型复用 core/models.ts；AnalysisResult / CleanOptions 分别由
 *   T6 的 core/analysis/engine.ts 与 core/cleaning/cleaner.ts 定义。
 *
 * 约定：handler 一律用 ipcMain.handle（invoke 风格）；错误统一 throw，
 * preload 层捕获后以 Error(message) 形式 reject 给渲染进程。
 */
import type {
  ChannelDef,
  DetectionResult,
  LayoutType,
  RawFile,
  StandardizedData
} from '../../core/models'
import type { AnalysisResult } from '../../core/analysis/engine'
import type { CleanOptions } from '../../core/cleaning/cleaner'

/** IPC 通道名常量表 */
export const IPC = {
  /** 打开文件对话框（过滤 csv/txt/tsv） */
  OpenFile: 'dialog:openFile',
  /** 保存文件对话框（导出目标路径选择，T12 用） */
  SaveFile: 'dialog:saveFile',
  /** 格式侦察：engine:detectFile(path) */
  DetectFile: 'engine:detectFile',
  /** 表头解析 → 通道定义：engine:parseHeader(rows, headerRows, opts) */
  ParseHeader: 'engine:parseHeader',
  /** 解析+标准化：engine:parseFile(path, raw, channels) */
  ParseFile: 'engine:parseFile',
  /** 统计分析：engine:analyze(data) */
  Analyze: 'engine:analyze',
  /** 数据清洗：engine:clean(data, options) */
  Clean: 'engine:clean',
  /** 导出：engine:export(data, format, path) */
  Export: 'engine:export',
  /** 数据预览（表格）：engine:getPreview(data, maxRows) */
  GetPreview: 'engine:getPreview',
  /** 图表序列（降采样）：engine:getChartSeries(data, channelIndexes, maxPoints) */
  GetChartSeries: 'engine:getChartSeries',
  /** 主进程菜单事件推送（webContents.send）：menu:event */
  MenuEvent: 'menu:event',
  /** 写文件（图表 PNG/HTML 默认目录导出；本地桌面应用，渲染进程可信） */
  WriteFile: 'dialog:writeFile'
} as const

/** 全部 IPC 通道名的联合类型 */
export type IpcChannel = (typeof IPC)[keyof typeof IPC]

// ---------------- 请求 / 响应类型 ----------------

/** dialog:openFile 返回：用户取消或选中的文件信息 */
export interface OpenFileResult {
  /** 用户是否取消 */
  canceled: boolean
  /** 选中文件绝对路径（取消时缺省） */
  path?: string
  /** 文件名 */
  name?: string
  /** 文件大小（字节） */
  size?: number
}

/** dialog:saveFile 返回：用户取消或保存路径 */
export interface SaveFileResult {
  /** 用户是否取消 */
  canceled: boolean
  /** 保存路径（取消时缺省） */
  path?: string
}

/** engine:detectFile 请求 */
export interface DetectFileRequest {
  /** 待检测文件绝对路径 */
  path: string
}

/** engine:parseHeader 请求：由检测结果的 sampleRows + 校正参数生成通道定义（T4） */
export interface ParseHeaderRequest {
  /** 完整行矩阵（preamble + 表头 + 数据，取检测结果的 sampleRows 即可） */
  rows: string[][]
  /** 表头行数（校正后） */
  headerRows: number
  /** 数据布局（缺省时按表头内容推断） */
  layout?: LayoutType
  /** 表头前的引号元信息行数（默认 0） */
  preambleLines?: number
}

/** engine:parseFile 请求 */
export interface ParseFileRequest {
  /** 文件绝对路径 */
  path: string
  /** 检测得到的原始文件描述（含编码/分隔符/表头行数等解析参数） */
  raw: RawFile
  /** 通道定义（由表头解析得到，T4 输出） */
  channels: ChannelDef[]
}

/** engine:analyze 请求 */
export interface AnalyzeRequest {
  /** 标准化数据 */
  data: StandardizedData
}

/** engine:clean 请求 */
export interface CleanRequest {
  /** 标准化数据 */
  data: StandardizedData
  /** 清洗选项 */
  options: CleanOptions
}

/** 导出格式 */
export type ExportFormat = 'csv' | 'xlsx'

/** engine:export 请求 */
export interface ExportRequest {
  /** 标准化数据 */
  data: StandardizedData
  /** 导出格式：csv 或 xlsx */
  format: ExportFormat
  /** 导出目标路径 */
  path: string
}

/** engine:export 返回（与 core/export 的 ExportOutcome 一致） */
export interface ExportResult {
  /** 导出文件绝对路径 */
  path: string
  /** 文件字节数 */
  bytes: number
  /** 导出行数 */
  rows: number
}

/** dialog:writeFile 请求：向目标路径写入文本或 base64 内容（父目录自动创建） */
export interface WriteFileRequest {
  /** 目标文件绝对路径 */
  path: string
  /** 文件内容（文本或 base64） */
  content: string
  /** 内容编码：utf8（默认）或 base64 */
  encoding?: 'utf8' | 'base64'
}

/** dialog:writeFile 返回 */
export interface WriteFileResult {
  /** 写入路径 */
  path: string
  /** 写入字节数 */
  bytes: number
}

/** engine:getPreview 请求 */
export interface GetPreviewRequest {
  /** 标准化数据 */
  data: StandardizedData
  /** 返回的最大行数（默认 1000） */
  maxRows?: number
}

/** 预览表中的一行：时间 + 各通道值（NaN 统一转为 null，便于表格展示为 "--"） */
export interface PreviewRow {
  /** 时间戳（Unix 毫秒；无时间轴时为 null） */
  time: number | null
  /** 各通道数值（缺省为 null） */
  values: (number | null)[]
}

/** engine:getPreview 返回 */
export interface PreviewData {
  /** 表头：第一项为时间列名（'时间'），其余为 通道名(单位) */
  headers: string[]
  /** 数据行（≤ maxRows 行） */
  rows: PreviewRow[]
  /** 数据总行数 */
  totalRows: number
}

/** engine:getChartSeries 请求 */
export interface GetChartSeriesRequest {
  /** 标准化数据 */
  data: StandardizedData
  /** 需要出图的通道索引（对应 data.channels 下标） */
  channelIndexes: number[]
  /** 最大点数（默认 100000，超过则降采样） */
  maxPoints?: number
}

/** 单个通道的图表序列（降采样后） */
export interface ChartSeries {
  /** 通道索引 */
  channelIndex: number
  /** 系列名（通道名） */
  name: string
  /** 工程单位（可缺省） */
  unit?: string
  /** 时间戳（Unix 毫秒） */
  timestamps: number[]
  /** 数值（NaN 转为 null） */
  values: (number | null)[]
}

// ---------------- preload 暴露的全局 API（daqAPI） ----------------

/** 渲染进程经 window.daqAPI 可调用的全部方法（preload 逐一对齐 IPC 通道） */
export interface DaqApi {
  /** 打开文件对话框（csv/txt/tsv） */
  openFileDialog(): Promise<OpenFileResult>
  /** 保存文件对话框（默认文件名与过滤器可选） */
  saveFileDialog(defaultPath?: string, filters?: { name: string; extensions: string[] }[]): Promise<SaveFileResult>
  /** 格式侦察 */
  detectFile(path: string): Promise<DetectionResult>
  /** 表头解析 → 通道定义（T4 引擎） */
  parseHeader(rows: string[][], headerRows: number, opts?: { layout?: LayoutType; preambleLines?: number }): Promise<ChannelDef[]>
  /** 解析 + 标准化 */
  parseFile(path: string, raw: RawFile, channels: ChannelDef[]): Promise<StandardizedData>
  /** 拖拽文件的真实路径（Electron webUtils.getPathForFile；非拖拽来源文件返回空串） */
  getPathForFile(file: File): string
  /** 统计分析 */
  analyze(data: StandardizedData): Promise<AnalysisResult>
  /** 数据清洗 */
  clean(data: StandardizedData, options: CleanOptions): Promise<StandardizedData>
  /** 导出 CSV / Excel */
  exportData(data: StandardizedData, format: ExportFormat, path: string): Promise<ExportResult>
  /** 预览前 N 行 */
  getPreview(data: StandardizedData, maxRows?: number): Promise<PreviewData>
  /** 图表序列（降采样） */
  getChartSeries(data: StandardizedData, channelIndexes: number[], maxPoints?: number): Promise<ChartSeries[]>
  /** 写文件（图表 PNG/HTML 导出；编码 utf8 或 base64） */
  writeFile(path: string, content: string, encoding?: 'utf8' | 'base64'): Promise<WriteFileResult>
  /** 订阅主进程菜单事件（如 文件→打开文件）；返回取消订阅函数 */
  onMenuEvent(callback: (action: MenuAction) => void): () => void
}

/** 主进程菜单触发的动作（经 webContents.send 推送） */
export type MenuAction = 'openFile' | 'redetect' | 'applyClean'
