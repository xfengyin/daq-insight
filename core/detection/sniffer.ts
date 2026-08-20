/**
 * core/detection/sniffer.ts — 分隔符 / 表头行数 / 小数点风格嗅探
 *
 * 说明：本实现合并了 T3 prep 原型与船长草稿的优点：
 * - 引号感知拆分保留引号内内容（"Ch102 (TC,K)" → Ch102 (TC,K)，供 T4 表头合并使用）
 * - 表头判定以"数值字段 / 时间戳字段"为核心：含数值字段的行即数据行，
 *   0 数值字段的行计为表头（覆盖长格式 gbk、宽表 3 行表头、scan 等全部样本）
 * - 小数点风格检测剔除日期样式（DD.MM.YYYY）干扰
 */

/** 候选分隔符 */
const DELIMITERS = [',', ';', '\t', '|'] as const

/**
 * 引号感知的行拆分：保留引号内内容，处理 "" 转义。
 * 返回按分隔符拆分的字段数组（不 trim 原始内容，避免破坏列值）。
 */
export function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQuote = false
      } else cur += ch
    } else if (ch === '"') {
      inQuote = true
    } else if (ch === delim) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/** 每行拆出的列数众数（最一致的列数），以及达成该列数的行数占比 */
function columnMode(lines: string[], delim: string): { cols: number; consistency: number } {
  if (lines.length === 0) return { cols: 0, consistency: 0 }
  const counts = new Map<number, number>()
  for (const line of lines) {
    const cols = splitLine(line, delim).length
    counts.set(cols, (counts.get(cols) ?? 0) + 1)
  }
  let bestCols = 0
  let best = 0
  for (const [cols, n] of counts) {
    if (n > best) { best = n; bestCols = cols }
  }
  return { cols: bestCols, consistency: best / lines.length }
}

/**
 * 探测分隔符：对每个候选分隔符统计各行一致列数，
 * 选 (列数 > 1) 且一致性最高的；平局时列数多者优先。
 * 注：english_header.csv 表头 6 列 vs 数据 5 列的陷阱由众数统计自然免疫（数据行占多数）。
 */
export function detectDelimiter(lines: string[]): string {
  const sample = lines.filter(l => l.trim().length > 0).slice(0, 60)
  let best: { delim: string; cols: number; consistency: number } | null = null
  for (const d of DELIMITERS) {
    const { cols, consistency } = columnMode(sample, d)
    if (cols < 2) continue
    if (!best || consistency > best.consistency || (consistency === best.consistency && cols > best.cols)) {
      best = { delim: d, cols, consistency }
    }
  }
  return best?.delim ?? ','
}

/** 严格数值判定：整数 / 小数（. 或 ,）/ 千分位 / 科学计数法（含 +9.9E37 超量程） */
function isNumericField(f: string): boolean {
  const s = f.trim()
  if (s === '') return false
  if (/^[+-]?\d+$/.test(s)) return true
  if (/^[+-]?\d{1,3}([.,]\d{3})+([.,]\d+)?$/.test(s)) return true // 千分位
  if (/^[+-]?(\d+\.?\d*|\d*\.\d+)([eE][+-]?\d+)?$/.test(s)) return true // 科学计数
  if (/^[+-]?\d+,[eE][+-]?\d+$/.test(s)) return true // 欧洲风格科学计数
  return false
}

/** 时间戳判定：YYYY-MM-DD / DD.MM.YYYY / HH:mm:ss(.SSS) 等 */
function isTimestampField(f: string): boolean {
  const s = f.trim()
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) return true
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(s)) return true
  if (/^\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return true
  return false
}

/** 特殊读数（DAQ 超量程/开路等），视为数据行内容 */
const SPECIAL_READINGS = /^(OVER|UNDER|OPEN|SHORT|SENSOR ERROR)$/i

/**
 * 判断一行是否"像数据行"：
 * 至少一个严格数值字段或时间戳字段 → 数据行；
 * 否则视为表头/元信息行。
 */
export function looksLikeDataRow(line: string, delim: string): boolean {
  const parts = splitLine(line, delim)
  if (parts.length < 1) return false
  let dataLike = 0
  let nonEmpty = 0
  for (const p of parts) {
    const s = p.trim()
    if (s === '') continue
    nonEmpty++
    if (isNumericField(s) || isTimestampField(s) || SPECIAL_READINGS.test(s)) dataLike++
  }
  if (nonEmpty === 0) return false
  // 任一数值/时间戳字段即数据行（长格式 gbk：CH101,4.98468,V 中 4.98468 判定数据）
  return dataLike >= 1
}

/** 表头关键词（单位/类型/通道名/中文表头）：出现即倾向表头 */
const HEADER_KEYWORDS = /(channel|reading|unit|timestamp|scan|dcv|acv|dci|aci|tc|rtd|freq|period|ohm|degc|hz|volt|amp|ch\d|通道|读数|单位|时间|日期|类型|电压|电流|温度|频率)/i

/**
 * 探测表头行数：从首行开始，连续"非数据行"计为表头；
 * 数据行（含数值/时间戳）出现即停止。无表头样本返回 0。
 */
export function detectHeaderRows(lines: string[], delim: string): number {
  const meaningful = lines.filter(l => l.trim().length > 0)
  let header = 0
  for (let i = 0; i < Math.min(meaningful.length, 12); i++) {
    const line = meaningful[i]
    if (looksLikeDataRow(line, delim)) break
    // 非数据行：含表头关键词则确认计为表头；否则保守按表头计（表头通常是文本行）
    if (HEADER_KEYWORDS.test(line) || splitLine(line, delim).length >= 2) header = i + 1
    else break
  }
  return header
}

/**
 * 探测小数点风格：'.' 或 ','（欧洲逗号小数）。
 * 剔除日期样式（DD.MM.YYYY / 2024-01-15）与时间戳片段干扰。
 */
export function detectDecimalStyle(lines: string[]): '.' | ',' {
  let dot = 0
  let comma = 0
  const isDateToken = (t: string): boolean => /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(t)
  for (const line of lines.slice(0, 80)) {
    const tokens = line.match(/[0-9][0-9.,]*/g) ?? []
    for (const tk of tokens) {
      if (isDateToken(tk)) continue
      // 数值 token 中最后一个分隔符后跟 1-6 位数字 → 小数分隔符
      const m = tk.match(/([.,])(\d{1,6})$/)
      if (m) {
        if (m[1] === '.') dot++
        else comma++
      }
    }
  }
  return comma > dot ? ',' : '.'
}
