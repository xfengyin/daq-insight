import { describe, expect, it } from 'vitest'
import { clean } from '../core/cleaning/cleaner'
import { computeChannelStats } from '../core/analysis/statistics'
import { analyze } from '../core/analysis/engine'
import { MeasurementType, QualityFlag, type StandardizedData } from '../core/models'

function mkChannel(name: string, values: number[], quality?: QualityFlag[]): StandardizedData['channels'][number] {
  const time = values.map((_, i) => 1700000000000 + i * 100)
  return { def: { index: 1, name, channelNumber: 101, measurementType: MeasurementType.DC_VOLTAGE, unit: 'V', isTimestamp: false, isValid: true }, values, timestamps: time, quality: quality ?? values.map(v => (Number.isFinite(v) ? QualityFlag.GOOD : QualityFlag.MISSING)) }
}
function mkData(values: number[], quality?: QualityFlag[]): StandardizedData {
  const ch = mkChannel('CH101', values, quality)
  return { metadata: {}, timeIndex: ch.timestamps, channels: [ch] }
}

describe('computeChannelStats', () => {
  it('已知数组统计精确匹配', () => {
    const s = computeChannelStats([2, 4, 4, 4, 5, 5, 7, 9], Array(8).fill(QualityFlag.GOOD))
    expect(s.mean).toBe(5)
    expect(s.std).toBeCloseTo(2, 6)
    expect(s.min).toBe(2)
    expect(s.max).toBe(9)
    expect(s.count).toBe(8)
    expect(s.rms).toBeCloseTo(Math.sqrt((4+16+16+16+25+25+49+81)/8), 6)
  })
  it('忽略 NaN 与 MISSING，正确计数', () => {
    const q = [QualityFlag.GOOD, QualityFlag.MISSING, QualityFlag.GOOD, QualityFlag.OVER_RANGE]
    const s = computeChannelStats([1, NaN, 3, 99], q)
    expect(s.count).toBe(2)
    expect(s.missingCount).toBe(1)
    expect(s.overRangeCount).toBe(1)
    expect(s.mean).toBe(2)
  })
})

describe('clean', () => {
  it('线性插值填充缺失', () => {
    const d = clean(mkData([1, NaN, 3, NaN, 5]), { missing: 'interpolate', outlier: 'none', dedupeTimestamps: false })
    expect(d.channels[0].values).toEqual([1, 2, 3, 4, 5])
  })
  it('前向填充', () => {
    const d = clean(mkData([1, NaN, NaN, 4, NaN]), { missing: 'ffill', outlier: 'none', dedupeTimestamps: false })
    expect(d.channels[0].values).toEqual([1, 1, 1, 4, 4])
  })
  it('drop 删除含缺失的行', () => {
    const d = clean(mkData([1, NaN, 3, 4]), { missing: 'drop', outlier: 'none', dedupeTimestamps: false })
    expect(d.channels[0].values.length).toBe(3)
    expect(d.timeIndex!.length).toBe(3)
  })
  it('Z-score 异常值被标记并置 NaN', () => {
    // 单点极端值会拉高 sd，故用阈值 2（此时 z(50)≈2.65 触发，正常点 z≈0.38 安全）
    const vals = [5, 5.1, 4.9, 5.0, 5.2, 4.8, 5.1, 50]
    const d = clean(mkData(vals), { missing: 'interpolate', outlier: 'zscore', outlierThreshold: 2, dedupeTimestamps: false })
    expect(d.channels[0].values[7]).toBeNaN()
    expect(d.channels[0].quality[7]).toBe('invalid')
    expect(Number.isFinite(d.channels[0].values[0])).toBe(true)
  })
  it('重复时间戳去重保留首条', () => {
    const ch = mkChannel('CH101', [1, 2, 3])
    ch.timestamps = [1000, 1000, 2000]
    const d = clean({ metadata: {}, timeIndex: [1000, 1000, 2000], channels: [ch] }, { missing: 'interpolate', outlier: 'none', dedupeTimestamps: true })
    expect(d.timeIndex).toEqual([1000, 2000])
    expect(d.channels[0].values).toEqual([1, 3])
  })
})

describe('analyze', () => {
  it('逐通道统计 + 采样率计算', () => {
    const d = analyze(mkData([1, 2, 3, 4, 5]))
    expect(d.channelStats['CH101'].mean).toBe(3)
    expect(d.sampleRateHz).toBeCloseTo(10, 1)
    expect(d.durationMs).toBe(400)
  })
})
