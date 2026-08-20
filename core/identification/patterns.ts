/**
 * core/identification/patterns.ts — 通道 / 测量类型 / 单位识别正则模式库（T4）
 *
 * 集中管理 DAQ970A / 34970A 导出文件表头中出现的各类标记的匹配规则：
 * - 测量类型标记（DCV / VDC / TC Type K / RTD PT100 / FREQ / PER ...）
 * - 单位标记（V / mV / A / degC / Hz / Ω / s ...）
 * - 通道号标记（CH101 / CH 101 / 101 / Slot1_Ch01 / @101 / 101:DCV ...）
 * - 时间戳列关键词（time / timestamp / date / 时间 / 日期 ...）
 *
 * 规则按数组顺序匹配、先命中者优先；具体识别逻辑见 identifier.ts。
 */
import { MeasurementType } from '../models'

/** 单个测量类型模式 */
export interface TypePattern {
  /** 模式标签（用于诊断与展示） */
  label: string
  /** 匹配到的测量类型 */
  type: MeasurementType
  /** 匹配正则（不区分大小写） */
  regex: RegExp
}

/**
 * 测量类型模式表。
 * 注意顺序：2W/4W 电阻须在通用 OHM 之前；TC/RTD 在温度单位兜底之前。
 */
export const TYPE_PATTERNS: TypePattern[] = [
  { label: '4W', type: MeasurementType.RESISTANCE_4W, regex: /(?:^|[^a-z0-9])4s*w(?:ire)?(?:[^a-z0-9]|$)|fours*-?s*wire/i },
  { label: '2W', type: MeasurementType.RESISTANCE_2W, regex: /(?:^|[^a-z0-9])2s*w(?:ire)?(?:[^a-z0-9]|$)|twos*-?s*wire/i },
  { label: 'DCV', type: MeasurementType.DC_VOLTAGE, regex: /\bdcv\b|\bvdc\b|\bdc\s*volt/i },
  { label: 'ACV', type: MeasurementType.AC_VOLTAGE, regex: /\bacv\b|\bvac\b|\bac\s*volt/i },
  { label: 'DCI', type: MeasurementType.DC_CURRENT, regex: /\bdci\b|\badc\b|\bdc\s*amp/i },
  { label: 'ACI', type: MeasurementType.AC_CURRENT, regex: /\baci\b|\baac\b|\bac\s*amp/i },
  { label: 'TC', type: MeasurementType.TEMPERATURE_TC, regex: /\bthermocouple\b|\btc\b|\btype\s*[kjetnrsb]\b/i },
  { label: 'RTD', type: MeasurementType.TEMPERATURE_RTD, regex: /\brtd\b|\bpt\s*-?\s*1000?\b/i },
  { label: 'OHM', type: MeasurementType.RESISTANCE_2W, regex: /\bohm\b|\bohms\b|\bΩ\b|\bres\b|\bresistance\b/i },
  { label: 'FREQ', type: MeasurementType.FREQUENCY, regex: /\bfreq\b|\bhz\b|\bk?hz\b/i },
  { label: 'PER', type: MeasurementType.PERIOD, regex: /\bperiod\b|\bper\b/i }
]

/** 单个单位模式 */
export interface UnitPattern {
  /** 规范化单位（V / A / degC / Ω / Hz / s / K） */
  unit: string
  /** 匹配正则（不区分大小写） */
  regex: RegExp
}

/**
 * 单位模式表（表头中出现的显式单位标记，按数组顺序先命中者优先）。
 * 注意组内长单位在前（kv 先于 v、ma 先于 a、ms 先于 s），避免前缀误配。
 * 裸 K 被有意排除（易与热电偶类型 K 混淆），Kelvin 以全称/degK 形式匹配。
 */
export const UNIT_PATTERNS: UnitPattern[] = [
  { unit: 'V', regex: /\b(?:kv|mv|μv|uv|v)\b/i },
  { unit: 'A', regex: /\b(?:ka|ma|μa|ua|a)\b/i },
  { unit: 'degC', regex: /\b(?:degc|°c|℃|°f|celsius)\b/i },
  { unit: 'Ω', regex: /\b(?:kω|mω|mohm|ohm|ohms|Ω)\b/i },
  { unit: 'Hz', regex: /\b(?:mhz|khz|hz)\b/i },
  { unit: 's', regex: /\b(?:ms|s)\b/i },
  { unit: 'K', regex: /\bkelvin\b|\bdeg\s*k\b/i }
]

/** 单个 单位→测量类型 兜底映射 */
export interface UnitToTypeEntry {
  /** 单位文本（原始形态，如 VDC / degC / HZ） */
  unit: string
  /** 对应的测量类型 */
  type: MeasurementType
  /** 匹配正则（不区分大小写） */
  regex: RegExp
}

/**
 * 单位→测量类型 兜底表（用于长格式 Unit 列、或表头仅含单位而无类型标记的场景）。
 * 裸 V 默认按直流电压、裸 A 默认按直流电流处理。
 */
export const UNIT_TO_TYPE: UnitToTypeEntry[] = [
  { unit: 'VDC', type: MeasurementType.DC_VOLTAGE, regex: /\b(?:vdc|dcv)\b/i },
  { unit: 'VAC', type: MeasurementType.AC_VOLTAGE, regex: /\b(?:vac|acv)\b/i },
  { unit: 'ADC', type: MeasurementType.DC_CURRENT, regex: /\b(?:adc|dci)\b/i },
  { unit: 'AAC', type: MeasurementType.AC_CURRENT, regex: /\b(?:aac|aci)\b/i },
  { unit: 'degC', type: MeasurementType.TEMPERATURE_TC, regex: /\b(?:degc|°c|℃|°f|celsius)\b/i },
  { unit: 'Hz', type: MeasurementType.FREQUENCY, regex: /\b(?:mhz|khz|hz)\b/i },
  { unit: 'Ω', type: MeasurementType.RESISTANCE_2W, regex: /\b(?:kω|mω|ohm|ohms|Ω)\b/i },
  { unit: 'V', type: MeasurementType.DC_VOLTAGE, regex: /\b(?:kv|mv|μv|uv|v)\b/i },
  { unit: 'A', type: MeasurementType.DC_CURRENT, regex: /\b(?:ka|ma|μa|ua|a)\b/i },
  { unit: 's', type: MeasurementType.PERIOD, regex: /\b(?:ms|s)\b/i },
  { unit: 'K', type: MeasurementType.TEMPERATURE_TC, regex: /\bkelvin\b|\bdeg\s*k\b/i }
]

/** 测量类型默认工程单位（表头无显式单位时使用） */
export const DEFAULT_UNIT_BY_TYPE: Record<MeasurementType, string> = {
  [MeasurementType.DC_VOLTAGE]: 'V',
  [MeasurementType.AC_VOLTAGE]: 'V',
  [MeasurementType.DC_CURRENT]: 'A',
  [MeasurementType.AC_CURRENT]: 'A',
  [MeasurementType.TEMPERATURE_TC]: 'degC',
  [MeasurementType.TEMPERATURE_RTD]: 'degC',
  [MeasurementType.RESISTANCE_2W]: 'Ω',
  [MeasurementType.RESISTANCE_4W]: 'Ω',
  [MeasurementType.FREQUENCY]: 'Hz',
  [MeasurementType.PERIOD]: 's',
  [MeasurementType.UNKNOWN]: ''
}

/** 时间戳列关键词（列名命中即视为时间戳列） */
export const TIMESTAMP_RE =
  /\b(?:time|timestamp|date|clock|scan\s*time)\b|时间|日期|时刻|时钟/i

/** 扫描序号列（scan 布局首列，如 "Scan #"） */
export const SCAN_INDEX_RE = /^scan\s*#?$/i

/**
 * 通道号提取模式（按顺序尝试，取首个命中；数字须为正整数且 < 10000）：
 * 1. Slot1_Ch01（槽位+通道）
 * 2. CH101 / CH 101 / Ch102 / 通道101 / Channel 101
 * 3. @101
 * 4. 101:DCV（通道号+冒号+类型）
 * 5. 整格纯数字 101
 */
export const CHANNEL_NUMBER_PATTERNS: RegExp[] = [
  /\bslot\s*\d+\s*[-_]\s*ch\s*(\d+)/i,
  /\b(?:ch|chan|channel|通道)\s*[-_]?\s*(\d+)/i,
  /@\s*(\d+)/,
  /^(\d{2,3})\s*[:：]/,
  /^(\d{2,3})$/
]
