/**
 * core/parsing/converter.ts — 字段值与时间戳转换（T5）
 * 特殊值（OVER/UNDER/OPEN/SHORT 等）→ NaN + 质量标记；多格式时间戳解析。
 */
import { QualityFlag } from '../models'

/** 特殊值 → 质量标记映射 */
const SPECIAL: Record<string, QualityFlag> = {
  over: QualityFlag.OVER_RANGE,
  under: QualityFlag.OVER_RANGE,
  open: QualityFlag.INVALID,
  short: QualityFlag.INVALID,
  'sensor error': QualityFlag.INVALID,
  'sensor_error': QualityFlag.INVALID,
  nan: QualityFlag.MISSING,
  '': QualityFlag.MISSING
}

/** 解析单个数值字段：处理小数点风格、科学计数法、特殊值 */
export function parseValue(raw: string, decimal: string): { value: number; quality: QualityFlag } {
  const s = (raw ?? '').trim().replace(/^"+|"+$/g, '')
  const special = SPECIAL[s.toLowerCase()]
  if (special !== undefined) return { value: NaN, quality: special }
  let num = s
  if (decimal === ',') num = num.replace(/\./g, '').replace(',', '.') // 欧洲：千位点、小数逗号
  else num = num.replace(/,/g, '') // 英文千位逗号去掉
  if (num === '') return { value: NaN, quality: QualityFlag.MISSING }
  const v = Number(num)
  if (Number.isNaN(v)) return { value: NaN, quality: QualityFlag.INVALID }
  // BUG-5 修复：超出 double 表示范围（±Infinity）视为超量程
  if (!Number.isFinite(v)) return { value: NaN, quality: QualityFlag.OVER_RANGE }
  // BUG-3 修复：DAQ970A 超量程标准表示 ±9.9E37（含 +9.90000000E+37）识别为 OVER_RANGE
  if (Math.abs(v) >= 9.9e37) return { value: NaN, quality: QualityFlag.OVER_RANGE }
  return { value: v, quality: QualityFlag.GOOD }
}

/**
 * 多格式时间戳解析（返回 Unix 毫秒；失败返回 NaN）。
 * 支持：YYYY-MM-DD HH:mm:ss[.SSS]、YYYY/MM/DD HH:mm:ss[:SSS]、DD.MM.YYYY HH:mm:ss、
 *       ISO 8601、Excel 序列号（数值）、纯毫秒数值。
 */
export function parseTimestamp(raw: string): number {
  const s = (raw ?? '').trim().replace(/^"+|"+$/g, '')
  if (s === '') return NaN
  // 纯数值：毫秒时间戳或 Excel 序列号
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    // Excel 序列号（1899-12-30 起算的天数）通常 < 100000；毫秒时间戳 >= 1e11
    if (n >= 1e11) return n
    if (n > 0 && n < 1000000) return Math.round((n - 25569) * 86400 * 1000) // Excel → Unix
    return n
  }
  // 自定义格式优先（Date.UTC，避免 Date.parse 的本地时区不确定性）：
  // YYYY-MM-DD HH:mm:ss[.SSS]
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?$/)
  if (m) return makeTime(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0), msFrac(m[7]))
  // DD.MM.YYYY HH:mm:ss
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?$/)
  if (m) return makeTime(+m[3], +m[2], +m[1], +m[4], +m[5], +(m[6] ?? 0), msFrac(m[7]))
  // 兜底：ISO 8601 / 其他标准格式（带时区信息的交由 Date.parse）
  const iso = Date.parse(s)
  if (!Number.isNaN(iso)) return iso
  return NaN
}

function msFrac(frac: string | undefined): number {
  if (!frac) return 0
  return Math.round(Number('0.' + frac) * 1000)
}

/** BUG-4 修复：校验日期有效性（Date.UTC 对非法日期会静默滚动，回读比对拒绝） */
function makeTime(y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number): number {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return NaN
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms)
  const dt = new Date(t)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN // 滚动即非法
  return t
}

/** 整列转换为时间索引（返回毫秒数组 + 质量标记） */
export function convertTimestamps(raws: string[]): { times: number[]; quality: QualityFlag[] } {
  const times: number[] = []
  const quality: QualityFlag[] = []
  for (const r of raws) {
    const t = parseTimestamp(r)
    times.push(t)
    quality.push(Number.isNaN(t) ? QualityFlag.INVALID : QualityFlag.GOOD)
  }
  return { times, quality }
}
