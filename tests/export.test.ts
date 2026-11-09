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
    // 同上：0.20 的 ESM 构建没有绑定 fs，XLSX.readFile 也会走浏览器分支；改用 XLSX.read(Buffer)
    const wb = XLSX.read(readFileSync(out))
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

// ---------- 回归：CSV 转义与公式注入 ----------
describe('CSV 单元格转义', () => {
  it('通道名含逗号 / 引号时，表头与数据行列数仍然一致（改前会多出一列）', async () => {
    const data = mockData()
    data.channels[0].def.name = 'Volt, ch1'
    data.channels[1].def.name = 'He said "hi"'
    const out = resolve(OUT_DIR, 'tricky.csv')
    await exportCsv(data, out)
    const text = readFileSync(out, 'utf-8').replace(/^\uFEFF/, '')
    const parsed = Papa.parse(text, { skipEmptyLines: true })
    expect(parsed.data.length).toBe(5) // 1 表头 + 4 数据
    const header = parsed.data[0] as string[]
    expect(header.length).toBe(3) // 改前：'Time,Volt, ch1,...' 会被切成 4 段
    expect(header[1]).toBe('Volt, ch1 (V)')
    expect(header[2]).toBe('He said "hi" (degC)')
    for (const row of parsed.data as string[][]) {
      expect(row.length).toBe(3)
    }
    rmSync(OUT_DIR, { recursive: true, force: true })
  })

  it('以 = / + / @ 开头的文本会被中和，不会在 Excel 里变成公式', async () => {
    const data = mockData()
    data.channels[0].def.name = '=1+1'
    data.channels[1].def.name = '@SUM(A1)'
    const out = resolve(OUT_DIR, 'formula.csv')
    await exportCsv(data, out)
    const text = readFileSync(out, 'utf-8').replace(/^\uFEFF/, '')
    const header = (Papa.parse(text, { skipEmptyLines: true }).data[0] as string[])
    expect(header[1]).toBe("'=1+1 (V)")
    expect(header[2]).toBe("'@SUM(A1) (degC)")
    rmSync(OUT_DIR, { recursive: true, force: true })
  })
})
