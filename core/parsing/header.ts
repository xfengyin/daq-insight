/**
 * core/parsing/header.ts — 表头解析与通道定义生成（T4）
 *
 * 支持三种布局（与 core/models.ts 的 LayoutType 对齐）：
 * - wide（宽表）：多行表头按列合并后逐列识别；时间戳列（time/时间/...）标记 isTimestamp
 * - long（长格式 / BenchVue 导出）：表头形如 Channel,Reading,Unit,Timestamp，
 *   通道定义从数据行的 Channel 列提取唯一通道号、Unit 列提取单位生成
 * - scan（扫描格式）：首列扫描序号（Scan #）跳过，其余按宽表处理
 *
 * 输入 rows 为 loadCsv 的完整行矩阵（preamble + 表头 + 数据），与
 * core/parsing/parser.ts 的 parseFile 输入一致（rows.slice(preamble+header) 即数据）。
 */
import { MeasurementType, type ChannelDef, type LayoutType } from '../models'
import {
  cleanCell,
  identifyChannel,
  inferLayout,
  isScanIndexHeader,
  isTemperatureUnit,
  typeUncertainty,
  unitToMeasurementType
} from '../identification/identifier'

/** parseHeader 选项 */
export interface HeaderParseOptions {
  /** 数据布局（缺省时按表头内容推断） */
  layout?: LayoutType
  /** 表头前的引号元信息行数（BenchVue 设备行/日志行，默认 0） */
  preambleLines?: number
}

/** 取一组单元格中首个非空值（清洗引号与空白） */
function firstNonEmpty(cells: string[]): string | undefined {
  for (const c of cells) {
    const s = cleanCell(c)
    if (s) return s
  }
  return undefined
}

/**
 * 解析表头并生成 ChannelDef 数组。
 * @param rows 完整行矩阵（preamble + 表头 + 数据）
 * @param headerRows 表头行数
 * @param opts 布局与前言行数
 */
export function parseHeader(rows: string[][], headerRows: number, opts?: HeaderParseOptions): ChannelDef[] {
  if (headerRows <= 0 || rows.length === 0) return []

  const preamble = opts?.preambleLines ?? 0
  const headerEnd = preamble + headerRows
  // 表头行不足时回退：忽略 preamble（视为调用方未传入元信息行）
  const start = rows.length >= headerEnd ? preamble : 0
  const headerSlice = rows.slice(start, start + headerRows)
  const colCount = Math.max(0, ...headerSlice.map(r => r.length))

  // 合并多行表头：同一列的多行文本用空格连接
  const headerCells: string[] = []
  for (let c = 0; c < colCount; c++) {
    const merged = headerSlice
      .map(r => cleanCell(r[c] ?? ''))
      .filter(s => s.length > 0)
      .join(' ')
    headerCells.push(merged)
  }

  const layout = opts?.layout ?? inferLayout(headerCells)
  const dataRows = rows.slice(start + headerRows)

  if (layout === 'long') return buildLongChannels(headerCells, dataRows)
  return buildWideChannels(headerCells, dataRows, layout)
}

/** 宽表 / 扫描格式：逐列识别通道；跳过空表头列与扫描序号列 */
function buildWideChannels(headerCells: string[], dataRows: string[][], layout: LayoutType): ChannelDef[] {
  const sampleCount = Math.min(20, dataRows.length)
  const defs: ChannelDef[] = []
  for (let c = 0; c < headerCells.length; c++) {
    const cell = headerCells[c]
    // 扫描格式首列为扫描序号（"Scan #"）：不作为通道
    if (layout === 'scan' && c === 0 && isScanIndexHeader(cell)) continue
    // 空表头列：跳过（保持其余列的真实索引）
    if (cleanCell(cell).length === 0) continue
    const sampleValues: string[] = []
    for (let i = 0; i < sampleCount; i++) sampleValues.push(dataRows[i]?.[c] ?? '')
    const def = identifyChannel(cell, sampleValues)
    def.index = c
    defs.push(def)
  }
  return defs
}

/** 长格式：从数据行提取唯一通道号与单位，生成各通道 ChannelDef */
function buildLongChannels(headerCells: string[], dataRows: string[][]): ChannelDef[] {
  const chNumbers: number[] = []
  const chSet = new Set<number>()
  const units = new Map<number, string>()
  const names = new Map<number, string>()
  for (const r of dataRows) {
    const raw = cleanCell(r[0] ?? '')
    const m = raw.match(/\d+/)
    if (!m) continue
    const n = Number(m[0])
    if (!Number.isInteger(n) || n < 0) continue
    if (!chSet.has(n)) {
      chSet.add(n)
      chNumbers.push(n)
    }
    const u = firstNonEmpty([r[2] ?? ''])
    if (u !== undefined && !units.has(n)) units.set(n, u)
    if (!names.has(n)) names.set(n, /^\d+$/.test(raw) ? `CH${raw}` : raw)
  }
  // headerCells 仅用于校验/诊断，此处通道信息全部来自数据行
  void headerCells
  return chNumbers.map((n, i) => {
    const unit = units.get(n)
    const measurementType = unitToMeasurementType(unit ?? '') ?? MeasurementType.UNKNOWN
    // 不确定性标记：温度单位（degC）无法区分 TC/RTD → 候选 + 低置信度
    let uncertainty: { typeCandidates: MeasurementType[]; typeConfidence: number } | undefined
    if (isTemperatureUnit(unit)) {
      uncertainty = typeUncertainty(MeasurementType.TEMPERATURE_TC, unit, '')
    }
    return {
      index: i,
      name: names.get(n) ?? `CH${n}`,
      channelNumber: n,
      measurementType,
      unit,
      isTimestamp: false,
      isValid: true,
      ...(uncertainty ?? {})
    }
  })
}
