/**
 * tests/identification.test.ts — T4 表头解析 + 通道/类型自动识别 单元测试
 *
 * 以 T2 生成的 DAQ970A 模拟样本为基准（tests/fixtures/samples/*.meta.json 为期望契约）：
 * - standard.csv      长格式（BenchVue 导出，preamble 2 行）
 * - english_header.csv 宽表单行表头、列名内嵌类型（含引号内嵌逗号）
 * - gbk_sample.csv    GBK 编码、中文长格式表头（通道/读数/单位）
 * - special_values.csv 宽表 3 行表头（含 OVER/OPEN/超量程特殊值）
 * - semicolon.tsv / tab.txt 宽表 3 行表头（分号/制表符分隔）
 * - scan_format.csv   扫描格式（首列 Scan #）
 */
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { parseHeader } from '../core/parsing/header'
import { loadCsv } from '../core/parsing/parser'
import {
  extractChannelNumber,
  identifyChannel,
  inferLayout,
  unitToMeasurementType
} from '../core/identification/identifier'
import { FileFormat, MeasurementType, type RawFile } from '../core/models'

const SAMPLES = join(process.cwd(), 'tests', 'fixtures', 'samples')
const {
  DC_VOLTAGE, AC_VOLTAGE, DC_CURRENT, AC_CURRENT,
  TEMPERATURE_TC, TEMPERATURE_RTD, RESISTANCE_2W, RESISTANCE_4W,
  FREQUENCY, PERIOD, UNKNOWN
} = MeasurementType

function makeRaw(
  name: string,
  encoding: string,
  delimiter: string,
  headerRows: number,
  layout?: RawFile['layout'],
  preambleLines?: number
): RawFile {
  return {
    path: join(SAMPLES, name),
    format: FileFormat.CSV,
    encoding,
    delimiter,
    decimal: '.',
    headerRows,
    sampleRows: [],
    layout,
    preambleLines
  }
}

describe('identifyChannel 单列识别', () => {
  it('CH101 (DCV) → 通道号 101 / 直流电压 / 单位 V', () => {
    const d = identifyChannel('CH101 (DCV)')
    expect(d.channelNumber).toBe(101)
    expect(d.measurementType).toBe(DC_VOLTAGE)
    expect(d.unit).toBe('V')
    expect(d.isValid).toBe(true)
  })

  it('列名内嵌类型：Ch102 (TC,K) → TC 热电偶；Ch103 (RTD,PT100) → RTD；Ch104 (FREQ) → 频率', () => {
    const tc = identifyChannel('Ch102 (TC,K)')
    expect(tc.channelNumber).toBe(102)
    expect(tc.measurementType).toBe(TEMPERATURE_TC)
    expect(tc.unit).toBe('degC')
    const rtd = identifyChannel('Ch103 (RTD,PT100)')
    expect(rtd.channelNumber).toBe(103)
    expect(rtd.measurementType).toBe(TEMPERATURE_RTD)
    expect(rtd.unit).toBe('degC')
    const freq = identifyChannel('Ch104 (FREQ)')
    expect(freq.measurementType).toBe(FREQUENCY)
    expect(freq.unit).toBe('Hz')
  })

  it('通道号多种形态：Slot1_Ch01 / @101 / 101:DCV / CH 101', () => {
    expect(identifyChannel('Slot1_Ch01').channelNumber).toBe(1)
    expect(identifyChannel('@101').channelNumber).toBe(101)
    expect(identifyChannel('101:DCV').channelNumber).toBe(101)
    expect(identifyChannel('CH 101').channelNumber).toBe(101)
  })

  it('电阻 2W/4W 前缀优先于通用 OHM', () => {
    expect(identifyChannel('4W-Ω').measurementType).toBe(RESISTANCE_4W)
    expect(identifyChannel('2W Ohm').measurementType).toBe(RESISTANCE_2W)
  })

  it('交流/电流/周期类型', () => {
    expect(identifyChannel('CH201 (ACV)').measurementType).toBe(AC_VOLTAGE)
    expect(identifyChannel('CH202 (DCI)').measurementType).toBe(DC_CURRENT)
    expect(identifyChannel('CH203 (ACI)').measurementType).toBe(AC_CURRENT)
    expect(identifyChannel('CH204 (PERIOD)').measurementType).toBe(PERIOD)
    expect(identifyChannel('CH204 (PER)').measurementType).toBe(PERIOD)
  })

  it('时间戳/扫描列判定', () => {
    expect(identifyChannel('Timestamp').isTimestamp).toBe(true)
    expect(identifyChannel('Date').isTimestamp).toBe(true)
    expect(identifyChannel('时间').isTimestamp).toBe(true)
    expect(identifyChannel('Scan #').isValid).toBe(false)
  })

  it('避免误提取：PT100 不是通道号；Channel 无数字无通道号', () => {
    expect(extractChannelNumber('PT100')).toBeUndefined()
    expect(extractChannelNumber('Channel')).toBeUndefined()
    expect(identifyChannel('Channel').measurementType).toBe(UNKNOWN)
  })

  it('单位→类型兜底映射', () => {
    expect(unitToMeasurementType('VDC')).toBe(DC_VOLTAGE)
    expect(unitToMeasurementType('degC')).toBe(TEMPERATURE_TC)
    expect(unitToMeasurementType('HZ')).toBe(FREQUENCY)
    expect(unitToMeasurementType('V')).toBe(DC_VOLTAGE)
  })
})

describe('inferLayout 布局推断', () => {
  it('长格式 / 扫描 / 宽表', () => {
    expect(inferLayout(['Channel', 'Reading', 'Unit', 'Timestamp'])).toBe('long')
    expect(inferLayout(['通道', '读数', '单位'])).toBe('long')
    expect(inferLayout(['Scan #', 'Timestamp', 'Ch101'])).toBe('scan')
    expect(inferLayout(['Date', 'Time', 'Ch101 (DCV)'])).toBe('wide')
  })
})

describe('parseHeader 对真实样本', () => {
  it('standard.csv：长格式（BenchVue），4 通道 DCV/TC-K/RTD-PT100/FREQ', async () => {
    const raw = makeRaw('standard.csv', 'utf-8', ',', 1, 'long', 2)
    const rows = await loadCsv(raw.path, raw)
    const defs = parseHeader(rows, raw.headerRows, { layout: raw.layout, preambleLines: raw.preambleLines })
    expect(defs).toHaveLength(4)
    expect(defs.map(d => d.channelNumber)).toEqual([101, 102, 103, 104])
    // 长格式只有单位列（degC），TC/RTD 无法从单位区分 → 默认 TC
    expect(defs.map(d => d.measurementType)).toEqual([DC_VOLTAGE, TEMPERATURE_TC, TEMPERATURE_TC, FREQUENCY])
    expect(defs.map(d => d.unit)).toEqual(['VDC', 'degC', 'degC', 'HZ'])
    expect(defs.every(d => d.isValid && !d.isTimestamp)).toBe(true)
  })

  it('english_header.csv：单行表头内嵌类型，Date/Time 双时间戳列 + 4 通道', async () => {
    const raw = makeRaw('english_header.csv', 'utf-8', ',', 1, 'wide')
    const rows = await loadCsv(raw.path, raw)
    const defs = parseHeader(rows, raw.headerRows)
    expect(defs).toHaveLength(6)
    expect(defs.filter(d => d.isTimestamp).map(d => d.name)).toEqual(['Date', 'Time'])
    const chs = defs.filter(d => !d.isTimestamp)
    expect(chs.map(d => d.channelNumber)).toEqual([101, 102, 103, 104])
    expect(chs.map(d => d.measurementType)).toEqual([DC_VOLTAGE, TEMPERATURE_TC, TEMPERATURE_RTD, FREQUENCY])
    expect(chs.map(d => d.unit)).toEqual(['V', 'degC', 'degC', 'Hz'])
    expect(chs.map(d => d.index)).toEqual([2, 3, 4, 5])
  })

  it('gbk_sample.csv：GBK 编码中文长格式表头，通道循环 CH101..CH109 全部直流电压', async () => {
    const raw = makeRaw('gbk_sample.csv', 'gbk', ',', 1, 'long')
    const rows = await loadCsv(raw.path, raw)
    const defs = parseHeader(rows, raw.headerRows, { layout: 'long' })
    // fixture 为 50 行数据但通道号循环 101..109（9 个唯一通道）
    expect(defs).toHaveLength(9)
    expect(defs[0].channelNumber).toBe(101)
    expect(defs[defs.length - 1].channelNumber).toBe(109)
    expect(defs.every(d => d.measurementType === DC_VOLTAGE)).toBe(true)
    expect(defs.every(d => d.unit === 'V')).toBe(true)
    expect(defs[0].name).toBe('CH101')
  })

  it('special_values.csv：3 行表头合并，4 通道识别正确', async () => {
    const raw = makeRaw('special_values.csv', 'utf-8', ',', 3, 'wide')
    const rows = await loadCsv(raw.path, raw)
    const defs = parseHeader(rows, raw.headerRows)
    expect(defs).toHaveLength(5)
    expect(defs[0].name).toBe('Time')
    expect(defs[0].isTimestamp).toBe(true)
    const chs = defs.slice(1)
    expect(chs.map(d => d.channelNumber)).toEqual([501, 502, 503, 504])
    expect(chs.map(d => d.measurementType)).toEqual([DC_VOLTAGE, TEMPERATURE_TC, TEMPERATURE_RTD, FREQUENCY])
    expect(chs.map(d => d.unit)).toEqual(['V', 'degC', 'degC', 'Hz'])
  })

  it('semicolon.tsv：分号分隔 3 行表头，4 通道 CH201-204', async () => {
    const raw = makeRaw('semicolon.tsv', 'utf-8', ';', 3, 'wide')
    const rows = await loadCsv(raw.path, raw)
    const defs = parseHeader(rows, raw.headerRows)
    expect(defs).toHaveLength(5)
    expect(defs.filter(d => !d.isTimestamp).map(d => d.channelNumber)).toEqual([201, 202, 203, 204])
  })

  it('tab.txt：制表符分隔 3 行表头，4 通道 CH301-304', async () => {
    const raw = makeRaw('tab.txt', 'utf-8', '\t', 3, 'wide')
    const rows = await loadCsv(raw.path, raw)
    const defs = parseHeader(rows, raw.headerRows)
    expect(defs).toHaveLength(5)
    expect(defs.filter(d => !d.isTimestamp).map(d => d.channelNumber)).toEqual([301, 302, 303, 304])
  })

  it('scan_format.csv：扫描格式，跳过 Scan # 列，Timestamp + 4 通道', async () => {
    const raw = makeRaw('scan_format.csv', 'utf-8', ',', 1, 'scan')
    const rows = await loadCsv(raw.path, raw)
    const defs = parseHeader(rows, raw.headerRows, { layout: 'scan' })
    expect(defs).toHaveLength(5)
    expect(defs[0].isTimestamp).toBe(true)
    const chs = defs.slice(1)
    expect(chs.map(d => d.channelNumber)).toEqual([101, 102, 103, 104])
    // 表头无类型/单位标记 → 数值兜底推断为电压类（启发式，可在 UI 校正）
    expect(chs.map(d => d.measurementType)).toEqual([DC_VOLTAGE, DC_VOLTAGE, DC_VOLTAGE, DC_VOLTAGE])
    expect(chs.every(d => d.unit === 'V')).toBe(true)
  })
})

describe('类型识别不确定性标记（IT3）', () => {
  it('identifyChannel：显式 TC 标记 → 无歧义（不设候选/置信度）', () => {
    const d = identifyChannel('Ch102 (TC,K)')
    expect(d.measurementType).toBe(TEMPERATURE_TC)
    expect(d.typeCandidates).toBeUndefined()
    expect(d.typeConfidence).toBeUndefined()
  })

  it('identifyChannel：显式 RTD 标记 → 无歧义', () => {
    const d = identifyChannel('Ch103 (RTD,PT100)')
    expect(d.measurementType).toBe(TEMPERATURE_RTD)
    expect(d.typeCandidates).toBeUndefined()
  })

  it('identifyChannel：仅温度单位 degC（无显式 TC/RTD）→ 候选 [TC, RTD] 且置信度 <1', () => {
    const d = identifyChannel('CH102 (degC)')
    expect(d.measurementType).toBe(TEMPERATURE_TC)
    expect(d.typeCandidates).toEqual([TEMPERATURE_TC, TEMPERATURE_RTD])
    expect(d.typeConfidence!).toBeLessThan(1)
  })

  it('identifyChannel：数值兜底（无类型信息）→ 通用候选 + 低置信度 0.3', () => {
    const d = identifyChannel('CH999', ['5.1', '5.2', '5.3'])
    expect(d.measurementType).toBe(DC_VOLTAGE)
    expect(d.typeCandidates).toBeDefined()
    expect(d.typeCandidates![0]).toBe(DC_VOLTAGE)
    expect(d.typeConfidence).toBe(0.3)
  })

  it('长格式 standard.csv：degC 通道（TC/RTD 歧义）→ 候选含 TC+RTD 且置信度<1；明确通道无标记', async () => {
    const raw = makeRaw('standard.csv', 'utf-8', ',', 1, 'long', 2)
    const rows = await loadCsv(raw.path, raw)
    const defs = parseHeader(rows, raw.headerRows, { layout: raw.layout, preambleLines: raw.preambleLines })
    expect(defs).toHaveLength(4)
    // CH102/CH103 单位 degC：TC/RTD 歧义候选
    expect(defs[1].measurementType).toBe(TEMPERATURE_TC)
    expect(defs[1].typeCandidates).toEqual([TEMPERATURE_TC, TEMPERATURE_RTD])
    expect(defs[1].typeConfidence!).toBeLessThan(1)
    expect(defs[2].typeCandidates).toEqual([TEMPERATURE_TC, TEMPERATURE_RTD])
    // CH101 (VDC) / CH104 (HZ)：明确类型，无歧义
    expect(defs[0].typeCandidates).toBeUndefined()
    expect(defs[3].typeCandidates).toBeUndefined()
    // 向后兼容：既有字段不受影响
    expect(defs.map(d => d.measurementType)).toEqual([DC_VOLTAGE, TEMPERATURE_TC, TEMPERATURE_TC, FREQUENCY])
  })
})
