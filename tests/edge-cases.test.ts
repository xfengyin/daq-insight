/**
 * tests/edge-cases.test.ts — 边界情况与健壮性测试（独立审查补充）
 *
 * 覆盖：空数据 / 单行单列 / 参差行 / 极端编码 / 超大数值 / NaN 传播 /
 *       时间戳歧义 / 特殊值 / 导出容错。
 *
 * 历史缺陷（船长已修复，断言验证修复后正确行为）：
 * - BUG-1 已修复：exportCsv/exportExcel 对 NaN 时间戳输出 missing 占位，不再抛 RangeError
 * - BUG-2 已修复：computeChannelStats 改用两遍中心化方差，大偏移数据 std 精确
 * - BUG-3 已修复：parseValue 识别 +9.9E37 / 9.9E37（DAQ 超量程标准表示）为 OVER_RANGE
 * - BUG-4 已修复：parseTimestamp 校验非法日期（2024-02-30、2024-13-01）→ NaN
 * - BUG-5 已修复：parseValue 拦截 Infinity（1e309）为 OVER_RANGE（超出量程语义）
 */
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { parseValue, parseTimestamp, convertTimestamps } from '../core/parsing/converter'
import { parseFile, loadCsvText } from '../core/parsing/parser'
import { parseHeader } from '../core/parsing/header'
import { clean } from '../core/cleaning/cleaner'
import { analyze } from '../core/analysis/engine'
import { computeChannelStats } from '../core/analysis/statistics'
import { exportCsv } from '../core/export/exporter'
import { extractChannelNumber, matchMeasurementType, matchUnit, isTimestampHeader } from '../core/identification/identifier'
import { detectFile } from '../core/detection/detector'
import { detectDelimiter, detectHeaderRows, detectDecimalStyle, splitLine, looksLikeDataRow } from '../core/detection/sniffer'
import { FileFormat, MeasurementType, QualityFlag, type ChannelDef, type RawFile, type StandardizedData } from '../core/models'

// ---------- 构造工具 ----------
function mkRaw(overrides: Partial<RawFile> = {}): RawFile {
  return {
    path: 'mock.csv',
    format: FileFormat.CSV,
    encoding: 'utf-8',
    delimiter: ',',
    decimal: '.',
    headerRows: 1,
    sampleRows: [],
    ...overrides
  }
}

function mkChannels(n: number, isTimestamp = false): ChannelDef[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    name: isTimestamp && i === 0 ? 'Time' : 'CH10' + (i + 1),
    channelNumber: 101 + i,
    measurementType: isTimestamp && i === 0 ? MeasurementType.UNKNOWN : MeasurementType.DC_VOLTAGE,
    unit: isTimestamp && i === 0 ? undefined : 'V',
    isTimestamp: isTimestamp && i === 0,
    isValid: true
  }))
}

function mkData(values: number[], quality: QualityFlag[], opts: { time?: number[]; name?: string } = {}): StandardizedData {
  const time = opts.time ?? values.map((_, i) => 1700000000000 + i * 100)
  return {
    metadata: {},
    timeIndex: time,
    channels: [{
      def: { index: 0, name: opts.name ?? 'CH101', channelNumber: 101, measurementType: MeasurementType.DC_VOLTAGE, unit: 'V', isTimestamp: false, isValid: true },
      values, quality, timestamps: time
    }]
  }
}

// ---------- parseValue 边界 ----------
describe('parseValue 边界', () => {
  it('空串 / 空白 / NaN 字面量 → MISSING', () => {
    expect(parseValue('', '.').quality).toBe(QualityFlag.MISSING)
    expect(parseValue('   ', '.').quality).toBe(QualityFlag.MISSING)
    expect(parseValue('NaN', '.').quality).toBe(QualityFlag.MISSING)
  })
  it('OVER/UNDER → OVER_RANGE；OPEN/SHORT/Sensor Error → INVALID', () => {
    expect(parseValue('OVER', '.').quality).toBe(QualityFlag.OVER_RANGE)
    expect(parseValue('under', '.').quality).toBe(QualityFlag.OVER_RANGE)
    expect(parseValue('OPEN', '.').quality).toBe(QualityFlag.INVALID)
    expect(parseValue('SHORT', '.').quality).toBe(QualityFlag.INVALID)
    expect(parseValue('SENSOR ERROR', '.').quality).toBe(QualityFlag.INVALID)
  })
  it('带引号包裹数值 / 首尾空白 → 正常解析', () => {
    expect(parseValue('"5.5"', '.').value).toBe(5.5)
    expect(parseValue('  -5.5  ', '.').value).toBe(-5.5)
  })
  it('欧洲小数（逗号小数 + 千位点）', () => {
    expect(parseValue('1.234,56', ',').value).toBeCloseTo(1234.56)
    expect(parseValue('5,01088', ',').value).toBeCloseTo(5.01088)
  })
  it('英文千分位', () => {
    expect(parseValue('1,000,000', '.').value).toBe(1000000)
  })
  it('科学计数法', () => {
    expect(parseValue('+1.23E+00', '.').value).toBe(1.23)
    expect(parseValue('-2.5e-3', '.').value).toBeCloseTo(-0.0025)
  })
  it('完全非数值 → INVALID', () => {
    expect(parseValue('abc', '.').quality).toBe(QualityFlag.INVALID)
    expect(parseValue('--5', '.').quality).toBe(QualityFlag.INVALID)
  })
  it('BUG-3 已修复：+9.9E37 / 9.9E37（DAQ 超量程标准表示）→ OVER_RANGE + NaN', () => {
    expect(parseValue('+9.9E37', '.').quality).toBe(QualityFlag.OVER_RANGE)
    expect(parseValue('+9.9E37', '.').value).toBeNaN()
    expect(parseValue('9.9E37', '.').quality).toBe(QualityFlag.OVER_RANGE)
    expect(parseValue('9.9E37', '.').value).toBeNaN()
  })
  it('BUG-5 已修复：1e309 → Infinity 拦截为 OVER_RANGE + NaN', () => {
    const r = parseValue('1e309', '.')
    expect(r.value).toBeNaN()
    expect(r.quality).toBe(QualityFlag.OVER_RANGE)
  })
})

// ---------- parseTimestamp 边界 ----------
describe('parseTimestamp 边界', () => {
  it('标准 / 斜杠 / 点分 / ISO 格式', () => {
    expect(parseTimestamp('2024-01-15 10:30:00.123')).toBe(Date.UTC(2024, 0, 15, 10, 30, 0, 123))
    expect(parseTimestamp('2024/01/15 10:30:00')).toBe(Date.UTC(2024, 0, 15, 10, 30, 0, 0))
    expect(parseTimestamp('15.01.2024 10:30:00')).toBe(Date.UTC(2024, 0, 15, 10, 30, 0, 0))
    expect(parseTimestamp('2024-01-15T10:30:00.000Z')).toBe(Date.UTC(2024, 0, 15, 10, 30, 0, 0))
  })
  it('毫秒时间戳与 Excel 序列号', () => {
    expect(parseTimestamp('1700000000000')).toBe(1700000000000)
    expect(parseTimestamp('45000')).toBe(Math.round((45000 - 25569) * 86400 * 1000))
  })
  it('空串 / 垃圾输入 → NaN', () => {
    expect(parseTimestamp('')).toBeNaN()
    expect(parseTimestamp('not-a-time')).toBeNaN()
    expect(parseTimestamp(undefined as unknown as string)).toBeNaN()
  })
  it('BUG-4 已修复：非法日期返回 NaN（2024-02-30、2024-13-01）', () => {
    expect(parseTimestamp('2024-02-30 10:00:00')).toBeNaN()
    expect(parseTimestamp('2024-13-01 10:00:00')).toBeNaN()
    // 合法日期不受影响
    expect(parseTimestamp('2024-02-29 10:00:00')).toBe(Date.UTC(2024, 1, 29, 10, 0, 0, 0))
  })
})

// ---------- convertTimestamps / NaN 传播 ----------
describe('NaN 传播与质量标记', () => {
  it('convertTimestamps：无效时间戳 → NaN + INVALID', () => {
    const { times, quality } = convertTimestamps(['2024-01-15 10:30:00', 'bad', ''])
    expect(times[1]).toBeNaN()
    expect(quality[1]).toBe(QualityFlag.INVALID)
    expect(quality[0]).toBe(QualityFlag.GOOD)
  })
  it('computeChannelStats：空数组 → 全 NaN 统计 + count 0', () => {
    const s = computeChannelStats([], [])
    expect(s.count).toBe(0)
    expect(s.mean).toBeNaN()
    expect(s.min).toBeNaN()
    expect(s.rms).toBeNaN()
  })
  it('computeChannelStats：单点 → count 1、std 0、min=max', () => {
    const s = computeChannelStats([3.3], [QualityFlag.GOOD])
    expect(s.count).toBe(1)
    expect(s.std).toBe(0)
    expect(s.min).toBe(3.3)
    expect(s.max).toBe(3.3)
  })
  it('computeChannelStats：常数序列 → std 0', () => {
    const s = computeChannelStats([5, 5, 5, 5], Array(4).fill(QualityFlag.GOOD))
    expect(s.std).toBe(0)
    expect(s.mean).toBe(5)
  })
  it('BUG-2 已修复：1e9 级大偏移数据 std 精确（期望 ~0.816）', () => {
    const big = [1e9, 1e9 + 1, 1e9 + 2]
    const s = computeChannelStats(big, big.map(() => QualityFlag.GOOD))
    expect(s.mean).toBe(1e9 + 1)
    expect(s.std).toBeCloseTo(0.816, 2)
  })
})

// ---------- parser 边界 ----------
describe('parser / loadCsvText 边界', () => {
  it('空文本 → 空行矩阵', () => {
    expect(loadCsvText('', ',')).toEqual([])
    expect(loadCsvText('\n\n', ',')).toEqual([])
  })
  it('单列多行文本', () => {
    const rows = loadCsvText('a\n1\n2\n', ',')
    expect(rows).toEqual([['a'], ['1'], ['2']])
  })
  it('参差行（缺列）→ 越界单元格按空处理，parseFile 不崩溃', async () => {
    const raw = mkRaw()
    const P = resolve(__dirname, 'output-edge-parse')
    mkdirSync(P, { recursive: true })
    const path1 = resolve(P, 'ragged.csv')
    writeFileSync(path1, 'Time,CH101,CH102\n2024-01-15 10:30:00.000,1.5\n2024-01-15 10:30:00.100,2.5,3.5', 'utf-8')
    const rows = loadCsvText('Time,CH101,CH102\n2024-01-15 10:30:00.000,1.5\n2024-01-15 10:30:00.100,2.5,3.5', ',')
    expect(rows[1].length).toBe(2) // 参差
    const channels = [mkChannels(3)[0], mkChannels(3)[1], mkChannels(3)[2]]
    const data = await parseFile(path1, raw, channels)
    expect(data.channels.length).toBe(3)
    expect(data.channels[2].values[0]).toBeNaN() // 缺列 → MISSING/NaN
    rmSync(P, { recursive: true, force: true })
  })
  it('空通道列表 → 不崩溃', async () => {
    const raw = mkRaw()
    const P = resolve(__dirname, 'output-edge-parse')
    mkdirSync(P, { recursive: true })
    const path1 = resolve(P, 'basic.csv')
    writeFileSync(path1, 'Time,CH101\n2024-01-15 10:30:00.000,1.5\n', 'utf-8')
    const data = await parseFile(path1, raw, [])
    expect(data.channels).toEqual([])
    rmSync(P, { recursive: true, force: true })
  })
  it('数据行为空 → channels 值数组为空', async () => {
    const raw = mkRaw({ headerRows: 2 })
    const P = resolve(__dirname, 'output-edge-parse')
    mkdirSync(P, { recursive: true })
    const path1 = resolve(P, 'only-header.csv')
    writeFileSync(path1, 'a,b\nc,d\n', 'utf-8')
    const data = await parseFile(path1, raw, mkChannels(1))
    expect(data.channels[0].values).toEqual([])
    rmSync(P, { recursive: true, force: true })
  })
})

// ---------- parseHeader 边界 ----------
describe('parseHeader 边界', () => {
  it('headerRows<=0 或空矩阵 → []', () => {
    expect(parseHeader([], 3)).toEqual([])
    expect(parseHeader([['a', 'b']], 0)).toEqual([])
  })
  it('表头行不足时回退（忽略 preamble 误解）', () => {
    const defs = parseHeader([['Time', 'CH101']], 2)
    expect(Array.isArray(defs)).toBe(true)
  })
})

// ---------- clean 边界 ----------
describe('clean 边界', () => {
  it('全 NaN 序列 interpolate → 保持 NaN（不崩溃）', () => {
    const d = clean(mkData([NaN, NaN], [QualityFlag.MISSING, QualityFlag.MISSING]), { missing: 'interpolate', outlier: 'none', dedupeTimestamps: false })
    expect(d.channels[0].values.every(Number.isNaN)).toBe(true)
  })
  it('开头缺失 ffill → 保持 NaN', () => {
    const d = clean(mkData([NaN, 2, NaN], [QualityFlag.MISSING, QualityFlag.GOOD, QualityFlag.MISSING]), { missing: 'ffill', outlier: 'none', dedupeTimestamps: false })
    expect(d.channels[0].values[0]).toBeNaN()
    expect(d.channels[0].values[2]).toBe(2)
  })
  it('全部缺失 drop → 空结果', () => {
    const d = clean(mkData([NaN, NaN], [QualityFlag.MISSING, QualityFlag.MISSING]), { missing: 'drop', outlier: 'none', dedupeTimestamps: false })
    expect(d.channels[0].values).toEqual([])
  })
  it('IQR：少于 4 个有效点 → 不标记', () => {
    const d = clean(mkData([1, 2, 3], [QualityFlag.GOOD, QualityFlag.GOOD, QualityFlag.GOOD]), { missing: 'interpolate', outlier: 'iqr', dedupeTimestamps: false })
    expect(d.channels[0].quality.every(q => q === QualityFlag.GOOD)).toBe(true)
  })
  it('zscore：常数序列（sd=0）→ 不崩溃不标记', () => {
    const d = clean(mkData([7, 7, 7, 7], Array(4).fill(QualityFlag.GOOD)), { missing: 'interpolate', outlier: 'zscore', dedupeTimestamps: false })
    expect(d.channels[0].quality.every(q => q === QualityFlag.GOOD)).toBe(true)
  })
  it('重复时间戳去重保留首条', () => {
    const time = [1000, 1000, 2000]
    const d = clean(mkData([1, 2, 3], Array(3).fill(QualityFlag.GOOD), { time }), { missing: 'interpolate', outlier: 'none', dedupeTimestamps: true })
    expect(d.timeIndex).toEqual([1000, 2000])
    expect(d.channels[0].values).toEqual([1, 3])
  })
})

// ---------- analyze 边界 ----------
describe('analyze 边界', () => {
  it('空 channels / 空时间 → 全零摘要', () => {
    const a = analyze({ metadata: {}, channels: [] })
    expect(a.durationMs).toBe(0)
    expect(a.sampleRateHz).toBe(0)
    expect(a.channelStats).toEqual({})
  })
  it('单点时间 → 采样率 0、跨度 0', () => {
    const a = analyze(mkData([1], [QualityFlag.GOOD]))
    expect(a.sampleRateHz).toBe(0)
    expect(a.durationMs).toBe(0)
  })
})

// ---------- export 边界 ----------
describe('export 边界', () => {
  const OUT = resolve(__dirname, 'output-edge')
  it('BUG-1 已修复：NaN 时间戳导出正常 resolve，文件生成且不抛错', async () => {
    mkdirSync(OUT, { recursive: true })
    const bad = mkData([1], [QualityFlag.GOOD], { time: [NaN] })
    const out = resolve(OUT, 'nan-time.csv')
    const res = await exportCsv(bad, out, { missingPlaceholder: 'N/A' })
    expect(res.path).toBe(out)
    expect(res.bytes).toBeGreaterThan(0)
    expect(res.rows).toBe(1)
    const content = readFileSync(out, 'utf-8')
    expect(content).toContain('N/A') // NaN 时间戳输出 missing 占位
    rmSync(OUT, { recursive: true, force: true })
  })
  it('空数据（无时间行）→ 仅表头', async () => {
    mkdirSync(OUT, { recursive: true })
    const d: StandardizedData = { metadata: {}, timeIndex: [], channels: [] }
    const res = await exportCsv(d, resolve(OUT, 'empty.csv'))
    expect(res.rows).toBe(0)
    expect(res.bytes).toBeGreaterThan(0)
  })
  it('NaN 值用 missingPlaceholder 输出', async () => {
    const d = mkData([1, NaN], [QualityFlag.GOOD, QualityFlag.MISSING])
    const res = await exportCsv(d, resolve(OUT, 'placeholder.csv'), { missingPlaceholder: 'N/A' })
    expect(res.bytes).toBeGreaterThan(0)
    rmSync(OUT, { recursive: true, force: true })
  })
})

// ---------- identification 边界 ----------
describe('identification 边界', () => {
  it('空表头 → 无法识别（undefined / 空名）', () => {
    expect(extractChannelNumber('')).toBeUndefined()
    expect(extractChannelNumber('  ')).toBeUndefined()
    expect(matchMeasurementType('')).toBeUndefined()
    expect(matchUnit('')).toBeUndefined()
    expect(isTimestampHeader('')).toBe(false)
  })
  it('通道号提取边界（CH101 / @101 / 101:DCV / Slot1_Ch01）', () => {
    expect(extractChannelNumber('CH101')).toBe(101)
    expect(extractChannelNumber('@101')).toBe(101)
    expect(extractChannelNumber('101:DCV')).toBe(101)
    expect(extractChannelNumber('Slot1_Ch01')).toBe(1)
    expect(extractChannelNumber('CH99999')).toBeUndefined() // 超上限
    expect(extractChannelNumber('CH0')).toBeUndefined() // 非正
  })
  it('类型识别：4W/2W 优先于通用 OHM', () => {
    expect(matchMeasurementType('4W OHM')).toBe(MeasurementType.RESISTANCE_4W)
    expect(matchMeasurementType('2W OHM')).toBe(MeasurementType.RESISTANCE_2W)
    expect(matchMeasurementType('OHM')).toBe(MeasurementType.RESISTANCE_2W)
  })
})

// ---------- detection 边界 ----------
describe('detection 边界', () => {
  it('空文件 / 单行 / 单列不崩溃', async () => {
    const OUT = resolve(__dirname, 'output-edge-detect')
    mkdirSync(OUT, { recursive: true })
    const fs = await import('node:fs')
    fs.writeFileSync(resolve(OUT, 'empty.csv'), '')
    fs.writeFileSync(resolve(OUT, 'one-line.csv'), 'hello,world')
    fs.writeFileSync(resolve(OUT, 'one-col.csv'), 'a\nb\nc')
    const r1 = await detectFile(resolve(OUT, 'empty.csv'))
    expect(r1.raw.headerRows).toBe(0)
    const r2 = await detectFile(resolve(OUT, 'one-line.csv'))
    expect(r2.raw.delimiter).toBe(',')
    const r3 = await detectFile(resolve(OUT, 'one-col.csv'))
    expect(r3.raw.headerRows).toBe(0)
    rmSync(OUT, { recursive: true, force: true })
  })
  it('空行过滤不影响表头判定', () => {
    expect(detectHeaderRows(['', 'Time,CH101', '', ',DCV', '2024-01-15 10:30:00.000,1.5'], ',')).toBe(2)
  })
  it('纯数值单列 → 数据行', () => {
    expect(looksLikeDataRow('1.5', ',')).toBe(true)
    expect(detectDelimiter(['1.5\n2.5'])).toBe(',')
    expect(detectDecimalStyle(['15.01.2024 10:30:00;5,01088'])).toBe(',')
  })
  it('极端编码：UTF-16LE BOM 文件 detectFile 全链路', async () => {
    const OUT = resolve(__dirname, 'output-edge-detect')
    mkdirSync(OUT, { recursive: true })
    const fs = await import('node:fs')
    const text = 'Time,CH101\n2024-01-15 10:30:00.000,1.5'
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    fs.writeFileSync(resolve(OUT, 'utf16.csv'), buf)
    const res = await detectFile(resolve(OUT, 'utf16.csv'))
    expect(res.raw.encoding).toBe('utf-16le')
    expect(res.raw.delimiter).toBe(',')
    rmSync(OUT, { recursive: true, force: true })
  })
  it('splitLine 引号边界', () => {
    expect(splitLine('"a""b",c', ',')).toEqual(['a"b', 'c'])
    expect(splitLine('a;b;c', ';')).toEqual(['a', 'b', 'c'])
  })
})
