import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { parseValue, parseTimestamp } from '../core/parsing/converter'
import { loadCsv, parseFile } from '../core/parsing/parser'
import { FileFormat, MeasurementType, QualityFlag, type ChannelDef, type RawFile } from '../core/models'

const SAMPLES = resolve(__dirname, 'fixtures/samples')

describe('converter.parseValue', () => {
  it('普通数值与小数点风格', () => {
    expect(parseValue('5.009', '.').value).toBeCloseTo(5.009)
    expect(parseValue('5,009', ',').value).toBeCloseTo(5.009)
    expect(parseValue('1.234,567', ',').value).toBeCloseTo(1234.567)
    expect(parseValue('+1.23E+00', '.').value).toBeCloseTo(1.23)
  })
  it('特殊值映射为 NaN + 质量标记', () => {
    expect(parseValue('OVER', '.').quality).toBe(QualityFlag.OVER_RANGE)
    expect(parseValue('UNDER', '.').quality).toBe(QualityFlag.OVER_RANGE)
    expect(parseValue('OPEN', '.').quality).toBe(QualityFlag.INVALID)
    expect(parseValue('SHORT', '.').quality).toBe(QualityFlag.INVALID)
    expect(parseValue('', '.').quality).toBe(QualityFlag.MISSING)
  })
})

describe('converter.parseTimestamp', () => {
  it('多格式解析', () => {
    expect(parseTimestamp('2024-01-15 10:30:00.123')).toBe(Date.UTC(2024, 0, 15, 10, 30, 0, 123))
    expect(parseTimestamp('2024/01/15 10:30:00')).toBe(Date.UTC(2024, 0, 15, 10, 30, 0, 0))
    expect(parseTimestamp('15.01.2024 10:30:00')).toBe(Date.UTC(2024, 0, 15, 10, 30, 0, 0))
    expect(parseTimestamp('2024-01-15T10:30:00.000Z')).toBe(Date.UTC(2024, 0, 15, 10, 30, 0, 0))
  })
  it('无效时间戳返回 NaN', () => {
    expect(parseTimestamp('not-a-time')).toBeNaN()
    expect(parseTimestamp('')).toBeNaN()
  })
})

describe('parser 真实样本集成（standard.csv 长格式）', () => {
  const raw: RawFile = { path: resolve(SAMPLES, 'standard.csv'), format: FileFormat.CSV, encoding: 'utf-8', delimiter: ',', decimal: '.', headerRows: 1, preambleLines: 2, layout: 'long', sampleRows: [] }
  const channels: ChannelDef[] = [
    { index: 0, name: 'CH101', channelNumber: 101, measurementType: MeasurementType.DC_VOLTAGE, unit: 'V', isTimestamp: false, isValid: true },
    { index: 1, name: 'CH102', channelNumber: 102, measurementType: MeasurementType.TEMPERATURE_TC, unit: 'degC', isTimestamp: false, isValid: true },
    { index: 2, name: 'CH103', channelNumber: 103, measurementType: MeasurementType.TEMPERATURE_RTD, unit: 'degC', isTimestamp: false, isValid: true },
    { index: 3, name: 'CH104', channelNumber: 104, measurementType: MeasurementType.FREQUENCY, unit: 'Hz', isTimestamp: false, isValid: true }
  ]
  it('loadCsv 正确解码与分行（303 行含元信息+表头）', async () => {
    const rows = await loadCsv(raw.path, raw)
    expect(rows.length).toBe(303)
  })
  it('parseFile pivot 为宽表：4 通道 × 75 唯一时间戳', async () => {
    const data = await parseFile(raw.path, raw, channels)
    expect(data.channels.length).toBe(4)
    expect(data.timeIndex!.length).toBe(75)
    expect(data.channels[0].values.length).toBe(75)
    expect(Number.isFinite(data.timeIndex![0])).toBe(true)
    expect(data.timeIndex![1] - data.timeIndex![0]).toBe(100)
    expect(Math.min(...data.channels[0].values)).toBeGreaterThan(4)
    expect(Math.max(...data.channels[0].values)).toBeLessThan(7)
    expect(data.statistics).toBeDefined()
  })
  it('parseFile 无 channels 参数时自动从长格式数据提取通道', async () => {
    const data = await parseFile(raw.path, raw, [])
    expect(data.channels.length).toBe(4)
    expect(data.channels[0].def.channelNumber).toBe(101)
    expect(data.channels[0].def.unit).toBe('VDC')
  })
})

describe('parser 宽表布局（tab.txt）', () => {
  const raw: RawFile = { path: resolve(SAMPLES, 'tab.txt'), format: FileFormat.TSV, encoding: 'utf-8', delimiter: '\t', decimal: '.', headerRows: 3, layout: 'wide', sampleRows: [] }
  const channels: ChannelDef[] = [
    { index: 0, name: 'Time', measurementType: MeasurementType.UNKNOWN, isTimestamp: true, isValid: true },
    { index: 1, name: 'CH101', channelNumber: 101, measurementType: MeasurementType.DC_VOLTAGE, unit: 'V', isTimestamp: false, isValid: true },
    { index: 2, name: 'CH102', channelNumber: 102, measurementType: MeasurementType.TEMPERATURE_TC, unit: 'degC', isTimestamp: false, isValid: true },
    { index: 3, name: 'CH103', channelNumber: 103, measurementType: MeasurementType.TEMPERATURE_RTD, unit: 'degC', isTimestamp: false, isValid: true },
    { index: 4, name: 'CH104', channelNumber: 104, measurementType: MeasurementType.FREQUENCY, unit: 'Hz', isTimestamp: false, isValid: true }
  ]
  it('宽表解析：时间列不进入 channels，数值正确', async () => {
    const data = await parseFile(raw.path, raw, channels)
    expect(data.channels.length).toBe(4)
    expect(data.timeIndex!.length).toBe(300)
    expect(data.channels[0].values.length).toBe(300)
    expect(Number.isFinite(data.channels[0].values[0])).toBe(true)
  })
})
