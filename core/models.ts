/**
 * core/models.ts — DAQ Insight 共享核心数据模型
 *
 * 定义数据采集(DAQ)文件导入、通道解析、标准化与检测结果所涉及的
 * 全部共享类型与枚举。主进程、渲染进程与测试均从本模块导入，
 * 保证各层对数据结构的理解完全一致。
 */

/** 文件格式枚举：支持导入的文件类型 */
export enum FileFormat {
  /** 逗号分隔值文本 */
  CSV = 'csv',
  /** 制表符分隔文本 */
  TSV = 'tsv',
  /** 普通文本（自定义分隔符） */
  TXT = 'txt',
  /** Excel 工作簿 */
  XLSX = 'xlsx'
}

/** 测量类型枚举：通道对应的物理量类型 */
export enum MeasurementType {
  /** 直流电压 */
  DC_VOLTAGE = 'dc_voltage',
  /** 交流电压 */
  AC_VOLTAGE = 'ac_voltage',
  /** 直流电流 */
  DC_CURRENT = 'dc_current',
  /** 交流电流 */
  AC_CURRENT = 'ac_current',
  /** 热电偶温度 */
  TEMPERATURE_TC = 'temperature_tc',
  /** 热电阻温度 */
  TEMPERATURE_RTD = 'temperature_rtd',
  /** 两线制电阻 */
  RESISTANCE_2W = 'resistance_2w',
  /** 四线制电阻 */
  RESISTANCE_4W = 'resistance_4w',
  /** 频率 */
  FREQUENCY = 'frequency',
  /** 周期 */
  PERIOD = 'period',
  /** 未知 / 未识别 */
  UNKNOWN = 'unknown'
}

/** 质量标记枚举：单个数据点的质量状态 */
export enum QualityFlag {
  /** 数据良好 */
  GOOD = 'good',
  /** 数据缺失 */
  MISSING = 'missing',
  /** 数据非法（格式错误、无法解析等） */
  INVALID = 'invalid',
  /** 超出量程 */
  OVER_RANGE = 'over_range'
}

/** 数据布局类型：决定解析器如何重组数据 */
export type LayoutType =
  /** 宽表：一行含全部通道（Time,CH101,CH102,...） */
  | 'wide'
  /** 长格式：一行一个通道（Channel,Reading,Unit,Timestamp），需 pivot */
  | 'long'
  /** 扫描格式：首列扫描序号（Scan,Timestamp,CH101,...） */
  | 'scan'

/** 原始文件描述：文件路径、格式与解析参数 */
export interface RawFile {
  /** 文件绝对路径 */
  path: string
  /** 文件格式 */
  format: FileFormat
  /** 文本编码（如 utf-8、gbk）；二进制格式（如 xlsx）可为空字符串 */
  encoding: string
  /** 字段分隔符（如 ','、'\t'、';'） */
  delimiter: string
  /** 十进制小数分隔符（'.' 或 ','） */
  decimal: string
  /** 表头行数（跳过多少行后为数据起始行） */
  headerRows: number
  /** 采样行（去除表头后的原始行内容，每行为一组字符串字段） */
  sampleRows: string[][]
  /** 数据布局（可选，默认 'wide'；'long'/'scan' 需 pivot） */
  layout?: LayoutType
  /** 元信息行数（表头之前的引号元信息行，如 BenchVue 设备行/日志行，可选默认 0） */
  preambleLines?: number
}

/** 通道定义：描述一个数据通道的元信息 */
export interface ChannelDef {
  /** 通道在数据矩阵中的列索引（从 0 开始） */
  index: number
  /** 通道名称 */
  name: string
  /** 仪器通道号（可选） */
  channelNumber?: number
  /** 测量类型 */
  measurementType: MeasurementType
  /** 工程单位（如 V、A、℃、Ω、Hz、s） */
  unit?: string
  /** 量程上限（可选） */
  range?: number
  /** 分辨率（可选） */
  resolution?: number
  /** 是否为时间戳通道 */
  isTimestamp: boolean
  /** 该通道定义是否有效 */
  isValid: boolean
  /** 候选测量类型（类型识别存在歧义时，如长格式仅单位 degC 无法区分 TC/RTD；可选） */
  typeCandidates?: MeasurementType[]
  /** 类型识别置信度（0~1；明确识别时缺省，歧义/兜底时 <1；可选） */
  typeConfidence?: number
}

/** 通道数据：一个通道的数值序列及其逐点质量标记 */
export interface ChannelData {
  /** 通道定义 */
  def: ChannelDef
  /** 数值序列（解析失败的位置以 NaN 填充，并配合 quality 标记说明原因） */
  values: number[]
  /** 采样时间戳（Unix 毫秒，可选） */
  timestamps?: number[]
  /** 与 values 等长的逐点质量标记 */
  quality: QualityFlag[]
}

/** 标准化数据：整份文件标准化后的结果 */
export interface StandardizedData {
  /** 元数据（来源文件、设备信息、采样率等） */
  metadata: Record<string, unknown>
  /** 所有通道数据 */
  channels: ChannelData[]
  /** 统一时间轴（Unix 毫秒，可选） */
  timeIndex?: number[]
  /** 通道统计信息（按通道索引键控） */
  statistics?: Record<number, ChannelStats>
}

/** 检测结果：对原始文件自动检测得到的结论 */
export interface DetectionResult {
  /** 被检测的原始文件描述 */
  raw: RawFile
  /** 各维度检测置信度（0~1） */
  confidence: {
    /** 编码检测置信度 */
    encoding: number
    /** 分隔符检测置信度 */
    delimiter: number
    /** 表头行数检测置信度 */
    headerRows: number
  }
  /** 检测过程中的备注 / 警告信息 */
  notes: string[]
}

/** 通道统计：数值通道的基本统计量 */
export interface ChannelStats {
  /** 算术平均值 */
  mean: number
  /** 标准差（总体标准差） */
  std: number
  /** 最小值 */
  min: number
  /** 最大值 */
  max: number
  /** 均方根值 */
  rms: number
  /** 有效数据点个数 */
  count: number
  /** 缺失数据点个数 */
  missingCount: number
  /** 超量程数据点个数 */
  overRangeCount: number
}
