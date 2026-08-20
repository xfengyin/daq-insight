/**
 * tests/integration/pipeline.test.ts — 端到端流水线集成测试（T13）
 *
 * 覆盖全样本六阶段流水线：格式侦察(detectFile) → 表头解析/类型识别(parseHeader)
 * → 数据解析与标准化(parseFile) → 统计分析(analyze) → 数据清洗(clean) → 导出(exportCsv)。
 *
 * 基准：tests/fixtures/samples/ 下的真实样本 + 各 .meta.json（期望的
 * 编码/分隔符/表头行数/通道数/类型/行数）。样本由 tests/fixtures/generator.ts
 * 确定性生成（npm run gen:fixtures）。
 *
 * 集成层适配（均在集成层完成，不改动 core 引擎；船长授权）：
 * - english_header.csv：Date/Time 分列时间戳 → 合并为单列并规范化为 YYYY-MM-DD HH:mm:ss.SSS
 *   （converter.parseTimestamp 不支持 MM/DD/YYYY）
 * - gbk_sample.csv：长格式无时间戳列（T5 pivot 依赖时间列）→ 注入行序号 ISO 时间列驱动 pivot（伪时间轴）
 * - no_header.csv / read_query.csv：无表头 → 按列数生成默认通道（col0 时间戳 + CH1..CHn UNKNOWN）
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import iconv from 'iconv-lite'
import { detectFile } from '../../core/detection/detector'
import { loadCsv, loadCsvText, parseFile } from '../../core/parsing/parser'
import { parseHeader } from '../../core/parsing/header'
import { analyze } from '../../core/analysis/engine'
import { clean } from '../../core/cleaning/cleaner'
import { exportCsv } from '../../core/export/exporter'
import { cleanCell } from '../../core/identification/identifier'
import {
  FileFormat,
  MeasurementType,
  QualityFlag,
  type ChannelDef,
  type DetectionResult,
  type RawFile,
  type StandardizedData
} from '../../core/models'
import type { SampleMeta } from '../fixtures/generator'

/** 样本目录：tests/fixtures/samples */
export const SAMPLES = resolve(__dirname, '../fixtures/samples')

/** 临时目录：集成适配文件与导出产物 */
const TMP = mkdtempSync(join(tmpdir(), 'daq-pipeline-'))

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

// ============================================================================
// 辅助函数（导出供 T13 其他集成测试复用）
// ============================================================================

/** 枚举全部样本文件（排除 .meta.json 与生成脚本） */
export function listSamples(): string[] {
  return readdirSync(SAMPLES)
    .filter((f) => !f.endsWith('.meta.json') && /\.[a-z]+$/.test(f) && !f.includes('generator'))
    .sort()
}

/** 读取样本的 .meta.json */
export function loadMeta(name: string): SampleMeta {
  return JSON.parse(readFileSync(resolve(SAMPLES, name + '.meta.json'), 'utf-8')) as SampleMeta
}

/** meta.delimiter 词 → 实际分隔符字符 */
export function delimiterChar(delim: string): string {
  if (delim === 'tab') return '\t'
  if (delim === 'semicolon') return ';'
  if (delim === 'comma') return ','
  return delim
}

/** 按 meta.encoding 解码样本文本 */
export function decodeSample(name: string): string {
  const meta = loadMeta(name)
  const buf = readFileSync(resolve(SAMPLES, name))
  return meta.encoding === 'gbk' ? iconv.decode(buf, 'gbk') : buf.toString('utf-8').replace(/^\uFEFF/, '')
}

/** 由样本名构造 RawFile（从 .meta.json 取期望参数；sampleRows 由流水线填充） */
export function rawFromMeta(name: string): RawFile {
  const meta = loadMeta(name)
  return {
    path: resolve(SAMPLES, name),
    format: name.endsWith('.tsv') ? FileFormat.TSV : name.endsWith('.txt') ? FileFormat.TXT : FileFormat.CSV,
    encoding: meta.encoding,
    delimiter: delimiterChar(meta.delimiter),
    decimal: meta.decimalSeparator,
    headerRows: meta.headerRows,
    preambleLines: meta.preambleLines ?? 0,
    layout: meta.layout ?? 'wide',
    sampleRows: []
  }
}

/**
 * 运行完整流水线（detect → parseHeader → parseFile → analyze）。
 * 返回各阶段产物，供断言各阶段结果与 .meta.json 的一致性。
 */
export async function runPipeline(path: string): Promise<{
  detection: DetectionResult
  raw: RawFile
  channels: ChannelDef[]
  data: StandardizedData
  result: Awaited<ReturnType<typeof analyze>>
}> {
  const detection = await detectFile(path)
  const raw = detection.raw
  const rows = await loadCsv(path, raw)
  const channels = parseHeader(rows, raw.headerRows, {
    layout: raw.layout,
    preambleLines: raw.preambleLines
  })
  const data = await parseFile(path, raw, channels)
  const result = analyze(data)
  return { detection, raw, channels, data, result }
}

// ----------------------------------------------------------------------------
// 集成层适配辅助
// ----------------------------------------------------------------------------

const TYPE_MAP: Record<string, MeasurementType> = {
  DCV: MeasurementType.DC_VOLTAGE,
  ACV: MeasurementType.AC_VOLTAGE,
  DCI: MeasurementType.DC_CURRENT,
  ACI: MeasurementType.AC_CURRENT,
  'TC Type K': MeasurementType.TEMPERATURE_TC,
  'RTD PT100': MeasurementType.TEMPERATURE_RTD,
  FREQ: MeasurementType.FREQUENCY,
  PER: MeasurementType.PERIOD
}

/** 行矩阵 → CSV 文本（含引号规则，兼容内嵌逗号） */
function toCsvLines(rows: string[][], delim: string): string {
  return rows.map(r => r.map(cell => {
    const s = String(cell ?? '')
    return s.includes(delim) || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s
  }).join(delim)).join('\n')
}

/** 行矩阵 → 临时文件（UTF-8，无 BOM） */
function writeRows(rows: string[][], delim: string, tag: string): string {
  const p = join(TMP, tag + '-' + Math.random().toString(36).slice(2, 8) + '.csv')
  writeFileSync(p, toCsvLines(rows, delim), 'utf-8')
  return p
}

/** 规范日期 MM/DD/YYYY → YYYY-MM-DD（converter 不支持 MM/DD/YYYY） */
function normalizeDate(d: string): string {
  const s = cleanCell(d)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : s
}

/** 集成层：合并 Date/Time 分列时间戳为单列（english_header 格式2） */
function mergeDateTimeColumns(rows: string[][]): string[][] {
  if (rows.length < 2) return rows
  const header = rows[0]
  const dateIdx = header.findIndex(c => /^date$/i.test(cleanCell(c)))
  const timeIdx = header.findIndex(c => /^time$/i.test(cleanCell(c)))
  if (dateIdx < 0 || timeIdx < 0 || dateIdx === timeIdx) return rows
  const out = rows.map(r => [...r])
  out[0][dateIdx] = 'Date Time'
  out[0].splice(timeIdx, 1)
  for (let i = 1; i < out.length; i++) {
    const d = normalizeDate(out[i][dateIdx] ?? '')
    const t = cleanCell(out[i][timeIdx] ?? '')
    out[i][dateIdx] = t ? `${d} ${t}` : d
    out[i].splice(timeIdx, 1)
  }
  return out
}

/** 集成层：gbk 长格式准备 —— 注入行序号 ISO 时间列（伪时间轴）+ 通道列规范化为纯数字（T5 pivot 用 Number 解析通道列，不支持 CH101 文本） */
function injectIndexTime(rows: string[][]): string[][] {
  const out = rows.map(r => [...r])
  out[0].push('Index')
  for (let i = 1; i < out.length; i++) {
    out[i][0] = String(out[i][0] ?? '').replace(/[^0-9]/g, '')
    out[i].push(new Date((i - 1) * 1000).toISOString())
  }
  return out
}

/** 无表头文件：按列数生成默认通道（col0 时间戳 + CH1..CHn） */
function defaultChannelsFromData(_rows: string[][], colCount: number): ChannelDef[] {
  const defs: ChannelDef[] = [{ index: 0, name: 'Time', measurementType: MeasurementType.UNKNOWN, isTimestamp: true, isValid: true }]
  for (let c = 1; c < colCount; c++) {
    defs.push({ index: c, name: 'CH' + c, measurementType: MeasurementType.UNKNOWN, isTimestamp: false, isValid: true })
  }
  return defs
}

/**
 * 按样本 meta 运行完整管线（含集成层适配），返回各阶段产物。
 * 适配点：english_header 合并 Date/Time；gbk 注入伪时间轴；无表头生成默认通道。
 */
export async function runSamplePipeline(meta: SampleMeta): Promise<{
  raw: RawFile
  rows: string[][]
  channels: ChannelDef[]
  data: StandardizedData
  analysis: Awaited<ReturnType<typeof analyze>>
}> {
  const name = meta.name
  const samplePath = join(SAMPLES, name)
  const delim = delimiterChar(meta.delimiter)
  const det = await detectFile(samplePath)
  const raw = det.raw
  const rows = await loadCsv(samplePath, raw)

  let channels: ChannelDef[]
  let pipelineRaw: RawFile = raw
  let pipelinePath = samplePath
  let pipelineRows = rows

  if (meta.layout === 'long' && name === 'gbk_sample.csv') {
    pipelineRows = injectIndexTime(rows)
    pipelinePath = writeRows(pipelineRows, delim, 'gbk')
    pipelineRaw = { ...raw, path: pipelinePath, encoding: 'utf-8' }
    channels = parseHeader(pipelineRows, meta.headerRows, { layout: 'long', preambleLines: 0 })
  } else if (meta.layout === 'long') {
    channels = parseHeader(rows, meta.headerRows, { layout: 'long', preambleLines: meta.preambleLines ?? 0 })
  } else if (meta.headerRows > 0) {
    if (name === 'english_header.csv') {
      pipelineRows = mergeDateTimeColumns(rows)
      pipelinePath = writeRows(pipelineRows, delim, 'english')
      pipelineRaw = { ...raw, path: pipelinePath }
    }
    channels = parseHeader(pipelineRows, meta.headerRows, {
      layout: pipelineRaw.layout,
      preambleLines: pipelineRaw.preambleLines ?? 0
    })
  } else {
    const colCount = Math.max(...rows.slice(0, 20).map(r => r.length))
    channels = defaultChannelsFromData(rows, colCount)
  }

  const data = await parseFile(pipelinePath, pipelineRaw, channels)
  const analysis = analyze(data)
  return { raw, rows, channels, data, analysis }
}

// ============================================================================
// fixture 完整性（样本 + .meta.json 基准）
// ============================================================================

describe('fixture 完整性：样本 + .meta.json 基准', () => {
  it('每个样本都有 .meta.json，且行数 = preamble + 表头 + 数据行', () => {
    const samples = listSamples()
    expect(samples.length).toBeGreaterThanOrEqual(10)
    for (const name of samples) {
      const meta = loadMeta(name)
      expect(meta.name).toBe(name)
      expect(['utf-8', 'gbk']).toContain(meta.encoding)
      expect(['comma', 'semicolon', 'tab']).toContain(meta.delimiter)
      expect(typeof meta.headerRows).toBe('number')
      expect(typeof meta.rowCount).toBe('number')
      expect(Array.isArray(meta.channelTypes)).toBe(true)
      const lines = decodeSample(name).split(/\r?\n/).filter((l) => l.length > 0)
      const expected = (meta.preambleLines ?? 0) + meta.headerRows + meta.rowCount
      expect(lines.length, name + ' 行数').toBe(expected)
    }
  })
})

// ============================================================================
// 全链路冒烟：standard.csv（格式1 / long 布局）
// ============================================================================

describe('pipeline 全链路冒烟：standard.csv（格式1 / long 布局）', () => {
  it('detect → parseHeader → parseFile → analyze 全部阶段串通', async () => {
    const meta = loadMeta('standard.csv')
    const out = await runPipeline(resolve(SAMPLES, 'standard.csv'))

    expect(out.raw.encoding).toBe(meta.encoding)
    expect(out.raw.delimiter).toBe(',')
    expect(out.raw.headerRows).toBe(meta.headerRows)
    expect(out.raw.preambleLines).toBe(2)
    expect(out.raw.layout).toBe('long')

    expect(out.channels.length).toBe(4)
    const byName = Object.fromEntries(out.channels.map((c) => [c.name, c.measurementType]))
    expect(byName['CH101']).toBe('dc_voltage')
    expect(byName['CH102']).toBe('temperature_tc')
    expect(byName['CH104']).toBe('frequency')

    expect(out.data.channels.length).toBe(4)
    expect(out.data.timeIndex?.length).toBe(75)
    expect(out.data.timeIndex![1] - out.data.timeIndex![0]).toBe(100)

    expect(Object.keys(out.result.channelStats).length).toBe(4)
    expect(out.result.sampleRateHz).toBeCloseTo(10, 0)
    expect(out.result.durationMs).toBe(7400)
  })
})

// ============================================================================
// 全样本矩阵（meta 驱动参数化）
// ============================================================================

describe('pipeline 全样本矩阵（detect → 识别 → 解析 → 分析）', () => {
  for (const name of listSamples()) {
    const meta = loadMeta(name)
    it(`${name}：各阶段结果与 .meta.json 一致`, async () => {
      const { raw, rows, channels, data, analysis } = await runSamplePipeline(meta)

      // ---- 阶段1 检测（T3）----
      expect(raw.encoding.toLowerCase()).toContain(meta.encoding === 'gbk' ? 'gb' : 'utf')
      expect(raw.delimiter).toBe(delimiterChar(meta.delimiter))
      expect(raw.headerRows).toBe(meta.headerRows)
      expect(raw.layout).toBe(meta.layout ?? 'wide')
      expect(raw.preambleLines ?? 0).toBe(meta.preambleLines ?? 0)
      expect(raw.decimal).toBe(meta.decimalSeparator)
      // 总行数 = preamble + 表头 + 数据
      expect(rows.length).toBe((meta.preambleLines ?? 0) + meta.headerRows + meta.rowCount)

      // ---- 阶段2/3 识别（T4）----
      // meta.channelCount 不含时间戳列，故过滤 isTimestamp
      expect(channels.filter(c => !c.isTimestamp).length).toBe(meta.channelCount)

      // ---- 阶段4 解析/标准化（T5）----
      expect(data.channels.length).toBe(meta.channelCount)
      const pts = data.timeIndex?.length ?? 0
      expect(pts).toBeGreaterThan(0)
      expect(data.timeIndex!.every(t => Number.isFinite(t))).toBe(true)

      // ---- 阶段6 分析（T6）----
      expect(Object.keys(analysis.channelStats).length).toBe(meta.channelCount)
      expect(analysis.durationMs).toBeGreaterThanOrEqual(0)
      expect(analysis.sampleRateHz).toBeGreaterThan(0)

      // ---- 布局相关的点/类型断言 ----
      if (meta.layout === 'long') {
        if (name === 'standard.csv') {
          expect(pts).toBe(75) // 300 行 / 4 通道
          expect(data.timeIndex![1] - data.timeIndex![0]).toBe(100)
          // 长格式仅有单位列：degC 无法区分 TC/RTD → 默认 TC（已知限制，UI 可校正）
          expect(data.channels.map(c => c.def.measurementType)).toEqual([
            MeasurementType.DC_VOLTAGE, MeasurementType.TEMPERATURE_TC,
            MeasurementType.TEMPERATURE_TC, MeasurementType.FREQUENCY
          ])
          expect(data.channels.map(c => c.def.unit)).toEqual(['VDC', 'degC', 'degC', 'HZ'])
        } else {
          // gbk：9 通道、伪时间轴 50 点、全部直流电压
          expect(pts).toBe(meta.rowCount)
          expect(data.channels).toHaveLength(9)
          expect(data.channels.every(c => c.def.measurementType === MeasurementType.DC_VOLTAGE)).toBe(true)
          expect(data.channels.every(c => c.def.unit === 'V')).toBe(true)
          expect(data.channels.every(c => c.values.some(v => Number.isFinite(v)))).toBe(true)
        }
      } else if (meta.layout === 'scan') {
        // scan：表头无类型信息 → 数值兜底默认电压（启发式）
        expect(pts).toBe(meta.rowCount)
        expect(data.channels.every(c => c.def.measurementType === MeasurementType.DC_VOLTAGE)).toBe(true)
      } else if (meta.headerRows === 0) {
        // 无表头：默认通道 UNKNOWN，仅断言点数与通道数
        expect(pts).toBe(meta.rowCount)
      } else {
        // 宽表（含类型行表头）：点数 + 类型 + 单位 与 meta 一致
        expect(pts).toBe(meta.rowCount)
        if (meta.channelTypes && meta.units) {
          expect(data.channels.map(c => c.def.measurementType)).toEqual(meta.channelTypes.map(t => TYPE_MAP[t] ?? MeasurementType.UNKNOWN))
          expect(data.channels.map(c => c.def.unit)).toEqual(meta.units)
        }
      }
    })
  }
})

// ============================================================================
// 导出往返（exportCsv → 重新解析）
// ============================================================================

describe('pipeline 导出往返：exportCsv 可重新解析且行数一致', () => {
  for (const name of listSamples()) {
    const meta = loadMeta(name)
    it(`${name}：导出 CSV 重新解析后行数 = 时间点 + 1（表头）`, async () => {
      const { data } = await runSamplePipeline(meta)
      const outPath = join(TMP, `export-${name}.csv`)
      const outcome = await exportCsv(data, outPath)
      expect(outcome.rows).toBe(data.timeIndex!.length)

      const text = readFileSync(outPath, 'utf-8')
      const reparsed = loadCsvText(text.replace(/^\uFEFF/, ''), ',')
      expect(reparsed.length).toBe(outcome.rows + 1)
      expect(reparsed[0][0]).toBe('Time')
      // 首行时间戳可解析
      expect(reparsed.length).toBeGreaterThan(1)
      expect(!Number.isNaN(Date.parse(reparsed[1][0]))).toBe(true)
    })
  }
})

// ============================================================================
// 清洗阶段（clean）
// ============================================================================

describe('pipeline 清洗阶段（dirty / special_values）', () => {
  it('dirty.csv：重复时间戳去重 + 缺失值插值后无 MISSING 残留', async () => {
    const { data } = await runSamplePipeline(loadMeta('dirty.csv'))
    const before = data.channels[0].quality.filter(q => q === QualityFlag.MISSING).length
    expect(before).toBeGreaterThan(0)

    const cleaned = clean(data, { missing: 'interpolate', outlier: 'none', dedupeTimestamps: true })
    // 去重后时间戳唯一
    const set = new Set(cleaned.timeIndex!)
    expect(set.size).toBe(cleaned.timeIndex!.length)
    expect(cleaned.timeIndex!.length).toBeLessThanOrEqual(data.timeIndex!.length)
    // 插值后无 MISSING 残留（INVALID 保留）
    for (const ch of cleaned.channels) {
      expect(ch.quality.some(q => q === QualityFlag.MISSING)).toBe(false)
    }
  })

  it('special_values.csv：OVER/UNDER 保持 over_range 标记并计入统计，清洗不吞标记', async () => {
    const { data } = await runSamplePipeline(loadMeta('special_values.csv'))
    const ch0 = data.channels[0]
    const overCount = ch0.quality.filter(q => q === QualityFlag.OVER_RANGE).length
    expect(overCount).toBeGreaterThan(0)
    const stats = analyze(data).channelStats[ch0.def.name]
    expect(stats.overRangeCount).toBe(overCount)

    const cleaned = clean(data, { missing: 'ffill', outlier: 'none', dedupeTimestamps: false })
    expect(cleaned.channels[0].quality.filter(q => q === QualityFlag.OVER_RANGE).length).toBe(overCount)
  })
})
