import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import { exportCsv, exportExcel } from '../core/export/exporter'
import { MeasurementType, QualityFlag, type StandardizedData } from '../core/models'

const OUT_DIR = resolve(__dirname, 'output')
function mockData(): StandardizedData {
  const time = [1700000000000, 1700000000100, 1700000000200, 1700000000300]
  return {
    metadata: { source: 'mock' },
    timeIndex: time,
    channels: [
      { def: { index: 1, name: 'CH101', channelNumber: 101, measurementType: MeasurementType.DC_VOLTAGE, unit: 'V', isTimestamp: false, isValid: true }, values: [1.1, 2.2, NaN, 4.4], timestamps: time, quality: [QualityFlag.GOOD, QualityFlag.GOOD, QualityFlag.MISSING, QualityFlag.GOOD] },
      { def: { index: 2, name: 'CH102', channelNumber: 102, measurementType: MeasurementType.TEMPERATURE_TC, unit: 'degC', isTimestamp: false, isValid: true }, values: [23.1, 24.2, 25.3, 26.4], timestamps: time, quality: [QualityFlag.GOOD, QualityFlag.GOOD, QualityFlag.GOOD, QualityFlag.GOOD] }
    ],
    statistics: { 1: { mean: 2.57, std: 1.41, min: 1.1, max: 4.4, rms: 2.93, count: 3, missingCount: 1, overRangeCount: 0 } }
  }
}

describe('core/export 导出模块', () => {
  it('exportCsv 生成 UTF-8 BOM CSV 且可回读', async () => {
    const data = mockData()
    const out = resolve(OUT_DIR, 'mock.csv')
    const res = await exportCsv(data, out)
    expect(existsSync(out)).toBe(true)
    expect(res.bytes).toBeGreaterThan(0)
    expect(res.rows).toBe(4)
    const text = readFileSync(out, 'utf-8')
    expect(text.charCodeAt(0)).toBe(0xfeff) // BOM
    const parsed = Papa.parse(text.replace(/^\uFEFF/, ''), { skipEmptyLines: true })
    expect(parsed.data.length).toBe(5) // 1 表头 + 4 数据
    expect((parsed.data[0] as string[]).length).toBe(3) // Time + 2 通道
    rmSync(OUT_DIR, { recursive: true, force: true })
  })

  it('exportExcel 生成三表 xlsx 且可回读', async () => {
    const data = mockData()
    const out = resolve(OUT_DIR, 'mock.xlsx')
    const res = await exportExcel(data, out)
    expect(existsSync(out)).toBe(true)
    expect(res.bytes).toBeGreaterThan(0)
    const wb = XLSX.readFile(out)
    expect(wb.SheetNames).toContain('数据')
    expect(wb.SheetNames).toContain('通道定义')
    expect(wb.SheetNames).toContain('统计摘要')
    const sheet = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['数据'], { header: 1 })
    expect(sheet.length).toBe(5)
    rmSync(OUT_DIR, { recursive: true, force: true })
  })

  it('父目录不存在时自动创建', async () => {
    const data = mockData()
    const out = resolve(OUT_DIR, 'deep/nested/out.csv')
    await exportCsv(data, out)
    expect(existsSync(out)).toBe(true)
    rmSync(OUT_DIR, { recursive: true, force: true })
  })
})
