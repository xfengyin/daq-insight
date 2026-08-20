/**
 * core/detection/detector.ts — 文件格式侦察引擎（入口）
 *
 * 组合 detectEncoding / detectDelimiter / detectHeaderRows / detectDecimalStyle，
 * 读取文件前 100 行（约 64KB）做侦察，输出完整 DetectionResult。
 * 额外输出 layout（wide/long/scan）与 preambleLines（引号元信息行数）。
 */
import { open } from 'node:fs/promises'
import iconv from 'iconv-lite'
import { FileFormat, type DetectionResult, type LayoutType, type RawFile } from '../models'
import { detectEncoding } from './encoding'
import { detectDelimiter, detectHeaderRows, detectDecimalStyle, splitLine } from './sniffer'

/** 侦察读取上限：约 64KB */
const MAX_BYTES = 64 * 1024
/** 最大分析行数 */
const MAX_LINES = 100
/** sampleRows 行数 */
const SAMPLE_ROWS = 50

/** 从扩展名推断文件格式 */
function formatFromPath(path: string): FileFormat {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'csv') return FileFormat.CSV
  if (ext === 'tsv') return FileFormat.TSV
  if (ext === 'xlsx' || ext === 'xls') return FileFormat.XLSX
  return FileFormat.TXT
}

/** 分离文件名（兼容 \ 与 /） */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/**
 * 布局判定启发式：
 * 取表头行（preamble 之后首个非空行）——含 Channel,Reading,Unit 等 → long；
 * 首列含 Scan → scan；否则 wide。
 */
function detectLayout(headerLine: string | undefined, headerRows: number): LayoutType {
  const line = (headerLine ?? '').toLowerCase()
  // 英文 + 中文表头关键词（通道/读数/单位）均判长格式；中文样本 gbk_sample.csv 依赖此项
  if (/(channel|reading|unit|通道|读数|单位).*(channel|reading|unit|通道|读数|单位)/.test(line) || /channel,.*reading,.*unit/i.test(line)) return 'long'
  if (headerRows === 0) {
    // 无表头：看首行是否像 scan（首列小整数 + 第二列时间戳）
    if (/^"?\d+"?[,;\t]"?\d{4}[-/.]/.test(line)) return 'scan'
    return 'wide'
  }
  if (/^"?scan/i.test(line) || /[,;\t]"?scan/i.test(line)) return 'scan'
  return 'wide'
}

/** 读取文件前 MAX_BYTES 字节（大文件性能安全） */
async function readHead(path: string): Promise<Buffer> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(MAX_BYTES + 4)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    return bytesRead < buf.length ? buf.subarray(0, bytesRead) : buf
  } finally {
    await fh.close()
  }
}

/**
 * 组合式文件侦察：检测编码 / 分隔符 / 表头行数 / 小数点风格 / 布局 / 元信息行，
 * 返回完整 DetectionResult（sampleRows 为前 SAMPLE_ROWS 行原始拆分，含表头供 T4 复用）。
 */
export async function detectFile(path: string): Promise<DetectionResult> {
  const buf = await readHead(path)
  const encGuess = detectEncoding(buf)

  // 解码文本（utf-8 去除 BOM；GBK 等由 iconv-lite 处理）
  let text: string
  if (encGuess.encoding === 'utf-8') {
    text = buf.toString('utf-8').replace(/^\uFEFF/, '')
  } else {
    text = iconv.decode(buf, encGuess.encoding)
  }
  const lines = text.split(/\r?\n/).slice(0, MAX_LINES)

  const delimiter = detectDelimiter(lines)
  const sampleLines = lines.filter(l => l.trim().length > 0)

  // 元信息行（preamble）：前导"整行引号包裹且仅 1 个字段"的行（如 BenchVue 设备行/日志行）
  let preambleLines = 0
  for (const line of sampleLines) {
    const t = line.trim()
    if (!(t.startsWith('"') && t.endsWith('"'))) break
    if (splitLine(t, delimiter).length !== 1) break
    preambleLines++
  }

  const afterPreamble = sampleLines.slice(preambleLines)
  const headerRows = detectHeaderRows(afterPreamble, delimiter)
  const decimal = detectDecimalStyle(lines)

  // 布局：表头行取 preamble 之后第一个非空行；无表头时取首行
  const headerLine = afterPreamble[0]
  const layout = detectLayout(headerLine, headerRows)

  const raw: RawFile = {
    path,
    format: formatFromPath(path),
    encoding: encGuess.encoding,
    delimiter,
    decimal,
    headerRows,
    sampleRows: lines.slice(0, SAMPLE_ROWS).map(l => splitLine(l, delimiter)),
    layout,
    preambleLines
  }

  const notes: string[] = []
  if (preambleLines > 0) notes.push(`检测到 ${preambleLines} 行引号元信息（preamble）`)
  if (layout === 'long') notes.push('长格式布局（每行一个通道），需 pivot 转宽表')
  if (layout === 'scan') notes.push('扫描格式布局（首列为扫描序号）')
  if (decimal === ',') notes.push('小数点为逗号（欧洲风格）')
  if (encGuess.encoding !== 'utf-8') notes.push(`编码识别为 ${encGuess.encoding}`)

  return {
    raw,
    confidence: {
      encoding: encGuess.confidence,
      delimiter: 0.9,
      headerRows: headerRows > 0 ? 0.85 : 0.9
    },
    notes
  }
}

export { baseName }
