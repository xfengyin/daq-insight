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

/**
 * 由时间索引中位间隔推算采样率（Hz）。
 *
 * 先**排序**再取间隔：文件里的时间戳不保证单调——
 * 把两次采样的日志拼在一起、或长格式文件按通道分组输出，时间就会往回走。
 * 不排序时反向间隔全被 g > 0 滤掉，采样率会算成 0 或离谱的数。
 */
function estimateSampleRate(time: number[]): number {
  const sorted = time.filter((t) => Number.isFinite(t)).sort((a, b) => a - b)
  if (sorted.length < 2) return 0
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i] - sorted[i - 1]
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
  // 时间跨度取 max-min，而不是「末项-首项」：时间戳不保证单调（见 estimateSampleRate 的注释），
  // 用末项减首项会算出负数时长。
  // 用循环而不是 Math.max(...arr)：数据文件动辄十几万行，展开参数会爆栈。
  let minT = Infinity
  let maxT = -Infinity
  let nTime = 0
  for (const t of time) {
    if (!Number.isFinite(t)) continue
    nTime++
    if (t < minT) minT = t
    if (t > maxT) maxT = t
  }
  const durationMs = nTime >= 2 ? maxT - minT : 0
  const sampleRateHz = estimateSampleRate(time)
  return { channelStats, durationMs, sampleRateHz }
}
