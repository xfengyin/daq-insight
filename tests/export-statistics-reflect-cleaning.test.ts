/**
 * 「统计摘要」这一页到底描述的是哪份数据？
 *
 * 曾经描述的是**清洗前**的：clean() 改完 values 没有重算 statistics，
 * 导出器照抄，于是报告里的均值/极值和表格里的数据对不上（#50 修的就是这个）。
 *
 * 这里守两条互相独立的性质：
 *   1. 清洗之后，statistics 必须被重算（cleaner 负责）；
 *   2. 导出器只**忠实转写** statistics，不自己偷偷再算一遍（否则两处真值又分叉）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { clean } from '../core/cleaning/cleaner'
import { exportExcel } from '../core/export/exporter'
import { MeasurementType, QualityFlag, type StandardizedData } from '../core/models'

const OUT_DIR = resolve(__dirname, 'output-stats')

/** 故意塞一个不可能算出来的统计值（999），这样「有没有重算」一眼可辨。 */
const SENTINEL_MEAN = 999

function staleStatisticsData(): StandardizedData {
  const time = [1700000000000, 1700000000100, 1700000000200, 1700000000300]
  return {
    metadata: { source: 'mock' },
    timeIndex: time,
    channels: [
      {
        def: {
          index: 1,
          name: 'CH101',
          channelNumber: 101,
          measurementType: MeasurementType.DC_VOLTAGE,
          unit: 'V',
          isTimestamp: false,
          isValid: true
        },
        values: [1, 2, NaN, 4],
        timestamps: time,
        quality: [QualityFlag.GOOD, QualityFlag.GOOD, QualityFlag.MISSING, QualityFlag.GOOD]
      }
    ],
    // 清洗前的统计（这里用哨兵值代替，方便判断是否被重算）
    statistics: {
      1: {
        mean: SENTINEL_MEAN,
        std: 0,
        min: 1,
        max: 4,
        rms: SENTINEL_MEAN,
        count: 4,
        missingCount: 0,
        overRangeCount: 0
      }
    }
  }
}

function readStatsSheet(out: string): { header: string[]; row: (string | number)[] } {
  const wb = XLSX.read(readFileSync(out))
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['统计摘要'], { header: 1 })
  const header = rows[0] as string[]
  const row = rows.find(r => String(r[0]) === 'CH101') as (string | number)[]
  return { header, row }
}

describe('统计摘要描述的是清洗后的数据', () => {
  it('clean() 会重算 statistics（不再沿用清洗前的值）', () => {
    const cleaned = clean(staleStatisticsData(), {
      missing: 'drop',
      outlier: 'none',
      dedupeTimestamps: false
    })
    const s = cleaned.statistics![1]
    expect(s).toBeDefined()
    expect(s.mean).not.toBe(SENTINEL_MEAN)
    // 丢掉那条缺失值后，样本数应该变少
    expect(s.count).toBe(3)
  })

  it('导出的统计摘要与 clean() 的结果一致', async () => {
    const cleaned = clean(staleStatisticsData(), {
      missing: 'drop',
      outlier: 'none',
      dedupeTimestamps: false
    })
    const out = resolve(OUT_DIR, 'cleaned.xlsx')
    await exportExcel(cleaned, out)

    const { header, row } = readStatsSheet(out)
    const meanIdx = header.indexOf('均值')
    const countIdx = header.indexOf('有效样本')
    expect(meanIdx).toBeGreaterThan(-1)
    expect(Number(row[meanIdx])).toBeCloseTo(cleaned.statistics![1].mean, 6)
    expect(Number(row[countIdx])).toBe(cleaned.statistics![1].count)
    expect(Number(row[meanIdx])).not.toBeCloseTo(SENTINEL_MEAN, 6)

    rmSync(OUT_DIR, { recursive: true, force: true })
  })

  it('导出器本身不重算：给它假的统计，它就如实写假的', async () => {
    // 这条是反方向的性质。如果导出器自己偷偷算一遍，上面第二条也会「碰巧」通过，
    // 但真值就变成了两处维护——这里把它钉住。
    const data = staleStatisticsData()
    const out = resolve(OUT_DIR, 'stale.xlsx')
    await exportExcel(data, out)

    const { header, row } = readStatsSheet(out)
    const meanIdx = header.indexOf('均值')
    expect(Number(row[meanIdx])).toBe(SENTINEL_MEAN)

    rmSync(OUT_DIR, { recursive: true, force: true })
  })
})
