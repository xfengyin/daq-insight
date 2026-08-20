/**
 * core/analysis/engine.ts — 统计分析引擎（T6 完整实现）
 * 逐通道统计 + 整体摘要（时间跨度、采样率）。
 */
import type { ChannelStats, StandardizedData } from '../models'
import { computeChannelStats } from './statistics'

/** 整体分析结果：逐通道统计 + 全局摘要 */
export interface AnalysisResult {
  /** 按通道名键控的统计 */
  channelStats: Record<string, ChannelStats>
  /** 时间跨度（毫秒） */
  durationMs: number
  /** 采样率（Hz，由时间索引中位间隔推算） */
  sampleRateHz: number
}

/** 由时间索引中位间隔推算采样率（Hz） */
function estimateSampleRate(time: number[]): number {
  if (time.length < 2) return 0
  const gaps: number[] = []
  for (let i = 1; i < time.length; i++) {
    const g = time[i] - time[i - 1]
    if (g > 0) gaps.push(g)
  }
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  return median > 0 ? 1000 / median : 0
}

/** 对标准化数据执行全通道统计与整体摘要 */
export function analyze(data: StandardizedData): AnalysisResult {
  const channelStats: Record<string, ChannelStats> = {}
  for (const ch of data.channels) {
    channelStats[ch.def.name] = computeChannelStats(ch.values, ch.quality)
  }
  const time = data.timeIndex ?? data.channels[0]?.timestamps ?? []
  const durationMs = time.length >= 2 ? time[time.length - 1] - time[0] : 0
  const sampleRateHz = estimateSampleRate(time)
  return { channelStats, durationMs, sampleRateHz }
}
