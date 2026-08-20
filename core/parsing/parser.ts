/**
 * core/parsing/parser.ts — 数据解析与标准化流水线（T5 完整实现）
 * CSV 加载（编码解码+papaparse）→ 按 ChannelDef 类型转换 → 时间索引 → StandardizedData。
 */
import { readFile } from 'node:fs/promises'
import iconv from 'iconv-lite'
import Papa from 'papaparse'
import { MeasurementType, QualityFlag, type ChannelData, type ChannelDef, type ChannelStats, type RawFile, type StandardizedData } from '../models'
import { convertTimestamps, parseTimestamp, parseValue } from './converter'

/** 编码名归一化为 iconv-lite 支持的名称 */
function iconvName(enc: string): string {
  const e = (enc || 'utf-8').toLowerCase()
  if (e.includes('gb')) return 'GBK'
  if (e.includes('big5')) return 'Big5'
  if (e.includes('latin') || e.includes('8859')) return 'latin1'
  if (e.includes('utf-16')) return 'utf16'
  return 'utf-8'
}

/** 读取文件并按检测编码解码为字符串 */
export async function readText(path: string, encoding: string): Promise<string> {
  const buf = await readFile(path)
  const enc = iconvName(encoding)
  if (enc === 'utf-8') return buf.toString('utf-8').replace(/^\uFEFF/, '')
  return iconv.decode(buf, enc)
}

/** 用 papaparse 按分隔符解析文本为行数组 */
export function loadCsvText(text: string, delimiter: string): string[][] {
  const res = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: 'greedy',
    dynamicTyping: false
  })
  return (res.data as string[][]).filter(row => Array.isArray(row) && row.length > 0)
}

/** 从磁盘加载 CSV：读文件 → 解码 → 分行 */
export async function loadCsv(path: string, raw: RawFile): Promise<string[][]> {
  const text = await readText(path, raw.encoding)
  return loadCsvText(text, raw.delimiter)
}

/** 统计摘要（数量级） */
function quickStats(chs: ChannelData[]): Record<number, ChannelStats> {
  const stats: Record<number, ChannelStats> = {}
  for (const ch of chs) {
    let count = 0
    let missing = 0
    let over = 0
    for (const q of ch.quality) {
      if (q === QualityFlag.GOOD) count++
      else if (q === QualityFlag.MISSING) missing++
      else if (q === QualityFlag.OVER_RANGE) over++
    }
    stats[ch.def.index] = { mean: NaN, std: NaN, min: NaN, max: NaN, rms: NaN, count, missingCount: missing, overRangeCount: over }
  }
  return stats
}

/**
 * 组装解析流水线：加载 CSV → 跳过表头 → 按 ChannelDef 逐列转换 → 时间索引 → StandardizedData。
 * channels 中 isTimestamp=true 的列作为时间轴；其余按数值解析（特殊值→NaN+质量标记）。
 */
export async function parseFile(path: string, raw: RawFile, channels: ChannelDef[]): Promise<StandardizedData> {
  const rows = await loadCsv(path, raw)
  const skip = (raw.preambleLines ?? 0) + raw.headerRows
  const dataRows = rows.slice(skip)
  const layout = raw.layout ?? 'wide'
  if (layout === 'long') return buildLongData(path, raw, dataRows, channels)
  return buildWideData(path, raw, dataRows, channels)
}

/** 宽表/扫描格式：一行含全部通道。scan 布局忽略首列扫描号（时间列由 channels 的 isTimestamp 标记）。 */
function buildWideData(path: string, raw: RawFile, dataRows: string[][], channels: ChannelDef[]): StandardizedData {
  const tsDef = channels.find(c => c.isTimestamp)
  const tsIndex = tsDef ? tsDef.index : 0
  const timeRaws = dataRows.map(r => r[tsIndex] ?? '')
  const { times } = convertTimestamps(timeRaws)
  const outChannels: ChannelData[] = []
  for (const def of channels) {
    if (def.isTimestamp) continue
    const values: number[] = []
    const quality: QualityFlag[] = []
    for (const r of dataRows) {
      const cell = r[def.index] ?? ''
      const { value, quality: q } = parseValue(cell, raw.decimal)
      values.push(value)
      quality.push(q)
    }
    outChannels.push({ def, values, timestamps: times, quality })
  }
  const data: StandardizedData = {
    metadata: { source: path, encoding: raw.encoding, delimiter: raw.delimiter, headerRows: raw.headerRows, layout: raw.layout ?? 'wide', rowCount: dataRows.length },
    timeIndex: times,
    channels: outChannels
  }
  data.statistics = quickStats(outChannels)
  return data
}

/** 长格式 pivot：每行 [通道, 读数, 单位, 时间戳]，按时间戳分组、通道号→列。 */
function buildLongData(path: string, raw: RawFile, dataRows: string[][], channels: ChannelDef[]): StandardizedData {
  // 列位置约定（BenchVue 长格式）：0=通道 1=读数 2=单位 3=时间戳
  const CH_COL = 0, VAL_COL = 1, TIME_COL = 3
  // 第一遍：收集有序唯一时间戳与通道号
  const timeList: number[] = []
  const timeIdx = new Map<number, number>()
  const chOrder: number[] = []
  const chSet = new Set<number>()
  for (const r of dataRows) {
    const t = parseTimestampFromCell(r[TIME_COL] ?? '')
    if (!timeIdx.has(t)) { timeIdx.set(t, timeList.length); timeList.push(t) }
    const chNum = Number(r[CH_COL])
    if (!chSet.has(chNum)) { chSet.add(chNum); chOrder.push(chNum) }
  }
  // 第二遍：为每通道分配对齐数组并填充
  const buckets = new Map<number, { values: number[]; quality: QualityFlag[]; unit?: string }>()
  for (const cn of chOrder) buckets.set(cn, { values: new Array(timeList.length).fill(NaN), quality: new Array(timeList.length).fill(QualityFlag.MISSING) })
  for (const r of dataRows) {
    const t = parseTimestampFromCell(r[TIME_COL] ?? '')
    const ti = timeIdx.get(t)!
    const chNum = Number(r[CH_COL])
    const b = buckets.get(chNum)
    if (!b) continue
    const { value, quality } = parseValue(r[VAL_COL] ?? '', raw.decimal)
    b.values[ti] = value
    b.quality[ti] = quality
    if (!b.unit && r[2]) b.unit = r[2].trim()
  }
  // 组装 ChannelData：def 优先取 T4 提供的元数据（按 channelNumber 匹配），否则生成默认
  const outChannels: ChannelData[] = chOrder.map((cn, i) => {
    const b = buckets.get(cn)!
    const provided = channels.find(c => c.channelNumber === cn)
    const def: ChannelDef = provided ?? {
      index: i, name: 'CH' + cn, channelNumber: cn, measurementType: MeasurementType.UNKNOWN, unit: b.unit, isTimestamp: false, isValid: true
    }
    return { def: { ...def, index: i }, values: b.values, timestamps: timeList, quality: b.quality }
  })
  const data: StandardizedData = {
    metadata: { source: path, encoding: raw.encoding, delimiter: raw.delimiter, headerRows: raw.headerRows, preambleLines: raw.preambleLines ?? 0, layout: 'long', rowCount: dataRows.length },
    timeIndex: timeList,
    channels: outChannels
  }
  data.statistics = quickStats(outChannels)
  return data
}

/** 长格式时间戳单元格解析（内部） */
function parseTimestampFromCell(cell: string): number {
  return parseTimestamp(cell)
}
