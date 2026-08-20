/**
 * core/analysis/statistics.ts — 通道统计计算（T6）
 * 忽略 NaN 与非 GOOD 质量标记的点，计算均值/标准差/极值/RMS。
 */
import { QualityFlag, type ChannelStats } from '../models'

/**
 * 计算单通道统计。
 * values 与 quality 等长；NaN 或 quality !== GOOD 的点不计入统计，
 * 但按质量标记分别累计缺失与超量程数。
 */
export function computeChannelStats(values: number[], quality: QualityFlag[]): ChannelStats {
  const good: number[] = []
  let missingCount = 0
  let overRangeCount = 0
  for (let i = 0; i < values.length; i++) {
    const q = quality[i] ?? QualityFlag.GOOD
    const v = values[i]
    if (q === QualityFlag.MISSING) missingCount++
    else if (q === QualityFlag.OVER_RANGE) overRangeCount++
    if (q === QualityFlag.GOOD && Number.isFinite(v)) good.push(v)
  }
  const count = good.length
  if (count === 0) {
    return { mean: NaN, std: NaN, min: NaN, max: NaN, rms: NaN, count: 0, missingCount, overRangeCount }
  }
  let sum = 0
  let sqSum = 0
  let min = Infinity
  let max = -Infinity
  for (const v of good) {
    sum += v
    sqSum += v * v
    if (v < min) min = v
    if (v > max) max = v
  }
  const mean = sum / count
  // BUG-2 修复：两遍法（中心化）计算方差，避免 E[x²]-E[x]² 在大偏移数据上的灾难性抵消
  let centered = 0
  for (const v of good) centered += (v - mean) * (v - mean)
  const variance = centered / count
  const std = Math.sqrt(Math.max(variance, 0))
  const rms = Math.sqrt(sqSum / count)
  return { mean, std, min, max, rms, count, missingCount, overRangeCount }
}
