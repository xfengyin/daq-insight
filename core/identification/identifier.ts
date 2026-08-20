/**
 * core/identification/identifier.ts — 通道 / 测量类型 / 单位自动识别（T4）
 *
 * 基于 patterns.ts 模式库实现：
 * - extractChannelNumber：通道号提取（CH101 / CH 101 / 101 / Slot1_Ch01 / @101 / 101:DCV）
 * - matchMeasurementType / matchUnit：测量类型与单位识别
 * - isTimestampHeader：时间戳列判定
 * - inferLayout：宽表 / 长格式 / 扫描格式 布局推断
 * - identifyChannel：单列完整通道定义识别（含样本数值兜底）
 */
import { MeasurementType, type ChannelDef, type LayoutType } from '../models'
import {
  CHANNEL_NUMBER_PATTERNS,
  DEFAULT_UNIT_BY_TYPE,
  SCAN_INDEX_RE,
  TIMESTAMP_RE,
  TYPE_PATTERNS,
  UNIT_PATTERNS,
  UNIT_TO_TYPE
} from './patterns'

/** 清洗单元格：去首尾空白与包裹引号 */
export function cleanCell(cell: string): string {
  return (cell ?? '').trim().replace(/^"+|"+$/g, '').trim()
}

/** 提取通道号：依次尝试各模式，取首个合法命中 */
export function extractChannelNumber(headerText: string): number | undefined {
  const text = cleanCell(headerText)
  if (!text) return undefined
  for (const re of CHANNEL_NUMBER_PATTERNS) {
    const m = text.match(re)
    if (m?.[1]) {
      const n = Number(m[1])
      if (Number.isInteger(n) && n > 0 && n < 10000) return n
    }
  }
  return undefined
}

/** 识别测量类型：先类型模式表，再单位→类型兜底表 */
export function matchMeasurementType(text: string): MeasurementType | undefined {
  const t = cleanCell(text)
  if (!t) return undefined
  for (const p of TYPE_PATTERNS) {
    if (p.regex.test(t)) return p.type
  }
  for (const u of UNIT_TO_TYPE) {
    if (u.regex.test(t)) return u.type
  }
  return undefined
}

/** 识别显式单位标记，返回规范化单位（V / A / degC / Ω / Hz / s / K） */
export function matchUnit(text: string): string | undefined {
  const t = cleanCell(text)
  if (!t) return undefined
  for (const p of UNIT_PATTERNS) {
    if (p.regex.test(t)) return p.unit
  }
  return undefined
}

/** 单位→测量类型（用于长格式 Unit 列等仅含单位的场景） */
export function unitToMeasurementType(unit: string): MeasurementType | undefined {
  const u = cleanCell(unit)
  if (!u) return undefined
  for (const p of UNIT_TO_TYPE) {
    if (p.regex.test(u)) return p.type
  }
  return undefined
}

/** 是否为时间戳列（列名含 time / timestamp / date / 时间 / 日期 等关键词） */
export function isTimestampHeader(text: string): boolean {
  return TIMESTAMP_RE.test(cleanCell(text))
}

/** 是否为扫描序号列（scan 布局首列，如 "Scan #"） */
export function isScanIndexHeader(text: string): boolean {
  return SCAN_INDEX_RE.test(cleanCell(text))
}

/**
 * 推断数据布局：
 * - 首列表头为 Channel/通道 且次列为 Reading/读数/value → long（长格式）
 * - 首列表头以 Scan 开头 → scan（扫描格式）
 * - 其余 → wide（宽表）
 */
export function inferLayout(headerCells: string[]): LayoutType {
  const c0 = cleanCell(headerCells[0] ?? '')
  const c1 = cleanCell(headerCells[1] ?? '')
  if (/^(?:channel|chan|通道)$/i.test(c0) && /^(?:reading|读数|value)$/i.test(c1)) return 'long'
  if (/^scan/i.test(c0)) return 'scan'
  return 'wide'
}

/** 温度单位判定：degC / °C / ℃ / °F（TC 与 RTD 无法仅凭单位区分） */
export function isTemperatureUnit(unit: string | undefined): boolean {
  const u = cleanCell(unit ?? '')
  return /(?:degc|°c|℃|°f|celsius)/i.test(u)
}

/** 显式热电偶/热电阻类型标记（表头中出现即视为类型明确，不再歧义） */
function hasExplicitTempKind(text: string): boolean {
  return /(?:tc|thermocouple|rtd|pt\s*-?\s*1000?|type\s*[kjetnrsb])/i.test(text)
}

/** 无类型信息时的通用候选（按出现概率排序，电压类优先） */
export const GENERIC_TYPE_CANDIDATES: MeasurementType[] = [
  MeasurementType.DC_VOLTAGE,
  MeasurementType.AC_VOLTAGE,
  MeasurementType.DC_CURRENT,
  MeasurementType.AC_CURRENT,
  MeasurementType.TEMPERATURE_TC,
  MeasurementType.TEMPERATURE_RTD,
  MeasurementType.FREQUENCY
]

/**
 * 类型不确定性标记：
 * - 明确类型（表头显式 TC/RTD/DCV 等标记）→ 无歧义（不设候选/置信度）
 * - 温度单位（degC）且无显式 TC/RTD 标记 → [TC, RTD]，置信度 0.5
 * - 完全无类型信息（数值兜底）→ 通用候选，置信度 0.3
 */
export function typeUncertainty(
  measurementType: MeasurementType | undefined,
  unit: string | undefined,
  headerText: string
): { typeCandidates: MeasurementType[]; typeConfidence: number } | undefined {
  if (measurementType === MeasurementType.TEMPERATURE_TC && isTemperatureUnit(unit) && !hasExplicitTempKind(headerText)) {
    return { typeCandidates: [MeasurementType.TEMPERATURE_TC, MeasurementType.TEMPERATURE_RTD], typeConfidence: 0.5 }
  }
  if (measurementType === undefined || measurementType === MeasurementType.UNKNOWN) {
    return { typeCandidates: GENERIC_TYPE_CANDIDATES, typeConfidence: 0.3 }
  }
  return undefined
}

/** 从样本数值兜底推断测量类型（表头无任何标记时使用） */
function inferFromValues(sampleValues: string[]): MeasurementType | undefined {
  const nums: number[] = []
  for (const v of sampleValues.slice(0, 50)) {
    const s = cleanCell(v)
    if (!s) continue
    const n = Number(s)
    if (Number.isFinite(n)) nums.push(n)
  }
  if (nums.length < 3) return undefined
  const maxAbs = Math.max(...nums.map(Math.abs))
  const allIntegers = nums.every(n => Number.isInteger(n))
  // 全为小整数 → 更像序号/计数列，不判定
  if (allIntegers && maxAbs < 10000) return undefined
  // 数值量大或含小数 → 默认按电压类（启发式）
  return MeasurementType.DC_VOLTAGE
}

/**
 * 识别单列通道定义。
 * @param headerText 列合并后的表头文本（多行表头已用空格连接）
 * @param sampleValues 该列前若干数据样本（用于兜底推断，可选）
 */
export function identifyChannel(headerText: string, sampleValues: string[] = []): ChannelDef {
  const name = cleanCell(headerText)
  const channelNumber = extractChannelNumber(name)
  const isTs = isTimestampHeader(name)
  const isScan = isScanIndexHeader(name)

  let measurementType: MeasurementType | undefined
  let fromValuesFallback = false // 类型是否来自数值兜底（无表头类型信息）
  if (!isTs && !isScan) {
    measurementType = matchMeasurementType(name)
    if (measurementType === undefined) {
      measurementType = inferFromValues(sampleValues)
      fromValuesFallback = measurementType !== undefined
    }
  }

  let unit = isTs || isScan ? undefined : matchUnit(name)
  if (!unit && measurementType !== undefined && measurementType !== MeasurementType.UNKNOWN) {
    const def = DEFAULT_UNIT_BY_TYPE[measurementType]
    unit = def || undefined
  }

  const finalType = isTs || isScan ? MeasurementType.UNKNOWN : (measurementType ?? MeasurementType.UNKNOWN)
  // 不确定性标记：温度单位（degC）歧义 → TC/RTD 候选；数值兜底 → 通用候选低置信
  let uncertainty: { typeCandidates: MeasurementType[]; typeConfidence: number } | undefined
  if (!isTs && !isScan) {
    if (fromValuesFallback) {
      uncertainty = { typeCandidates: GENERIC_TYPE_CANDIDATES, typeConfidence: 0.3 }
    } else {
      uncertainty = typeUncertainty(finalType, unit, name)
    }
  }
  return {
    index: -1, // 由 parseHeader 回填真实列索引
    name: name || (channelNumber !== undefined ? `CH${channelNumber}` : ''),
    channelNumber,
    measurementType: finalType,
    unit,
    isTimestamp: isTs,
    isValid: isScan ? false : name.length > 0 || channelNumber !== undefined || isTs,
    ...(uncertainty ?? {})
  }
}
