/**
 * core/cleaning/cleaner.ts — 可配置数据清洗（T6 完整实现）
 * 缺失值插值/填充/删除、异常值标记（IQR/Z-score）、重复时间戳去重。
 */
import { QualityFlag, type ChannelStats, type StandardizedData } from '../models'
import { computeChannelStats } from '../analysis/statistics'

/** 清洗选项 */
export interface CleanOptions {
  /** 缺失值策略：线性插值 / 前向填充 / 删除行 / 不处理 */
  missing: 'interpolate' | 'ffill' | 'drop' | 'none'
  /** 异常值策略：无 / IQR / Z-score */
  outlier: 'none' | 'iqr' | 'zscore'
  /** Z-score 阈值（默认 3.5） */
  outlierThreshold?: number
  /** 重复时间戳去重（保留首条） */
  dedupeTimestamps: boolean
}

function cloneData(data: StandardizedData): StandardizedData {
  return {
    metadata: { ...data.metadata },
    timeIndex: data.timeIndex ? [...data.timeIndex] : undefined,
    statistics: data.statistics ? { ...data.statistics } : undefined,
    channels: data.channels.map(ch => ({
      def: { ...ch.def },
      values: [...ch.values],
      timestamps: ch.timestamps ? [...ch.timestamps] : undefined,
      quality: [...ch.quality]
    }))
  }
}

/** 缺失点判定：仅 MISSING 可填充（INVALID/OVER_RANGE 保留原标记，不视为缺失） */
function isMissing(values: number[], quality: QualityFlag[], i: number): boolean {
  return !Number.isFinite(values[i]) && quality[i] !== QualityFlag.INVALID && quality[i] !== QualityFlag.OVER_RANGE
}

/**
 * 插值权重：按**时间**取比例，而不是按下标。
 *
 * 只有采样严格等间隔时两者才等价。DAQ 日志常有掉采、暂停、手动触发，
 * 下标间距 1 可能对应 1ms 也可能对应 100s；按下标插值会把「刚过上一个点」的
 * 缺失值插到两个点的正中间。时间不可用（缺 timeIndex、时间戳非有限、时间非递增）时
 * 才退回下标比例，保证旧行为仍是兜底。
 */
function interpFraction(time: number[] | undefined, prev: number, i: number, next: number): number {
  if (
    time &&
    Number.isFinite(time[prev]) &&
    Number.isFinite(time[i]) &&
    Number.isFinite(time[next]) &&
    time[next] > time[prev]
  ) {
    return (time[i] - time[prev]) / (time[next] - time[prev])
  }
  return (i - prev) / (next - prev)
}

function fillInterpolate(values: number[], quality: QualityFlag[], time?: number[]): void {
  for (let i = 0; i < values.length; i++) {
    if (isMissing(values, quality, i)) {
      let prev = i - 1
      let next = i + 1
      while (prev >= 0 && !Number.isFinite(values[prev])) prev--
      while (next < values.length && !Number.isFinite(values[next])) next++
      const pv = prev >= 0 ? values[prev] : NaN
      const nv = next < values.length ? values[next] : NaN
      if (Number.isFinite(pv) && Number.isFinite(nv)) {
        const t = interpFraction(time, prev, i, next)
        values[i] = pv + (nv - pv) * t
      } else if (Number.isFinite(pv)) values[i] = pv
      else if (Number.isFinite(nv)) values[i] = nv
      else values[i] = NaN
      if (Number.isFinite(values[i])) quality[i] = QualityFlag.GOOD
    }
  }
}

function fillForward(values: number[], quality: QualityFlag[]): void {
  let last = NaN
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) last = values[i]
    else if (isMissing(values, quality, i) && Number.isFinite(last)) { values[i] = last; quality[i] = QualityFlag.GOOD }
  }
}

function markIqrOutliers(values: number[], quality: QualityFlag[]): void {
  const good = values.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (good.length < 4) return
  const q1 = good[Math.floor(good.length * 0.25)]
  const q3 = good[Math.floor(good.length * 0.75)]
  const iqr = q3 - q1
  const lo = q1 - 1.5 * iqr
  const hi = q3 + 1.5 * iqr
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isFinite(v) && (v < lo || v > hi)) { quality[i] = QualityFlag.INVALID; values[i] = NaN }
  }
}

function markZscoreOutliers(values: number[], quality: QualityFlag[], threshold: number): void {
  const good = values.filter(Number.isFinite)
  if (good.length < 3) return
  const mean = good.reduce((a, b) => a + b, 0) / good.length
  const sd = Math.sqrt(good.reduce((a, b) => a + (b - mean) ** 2, 0) / good.length)
  if (sd === 0) return
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isFinite(v) && Math.abs((v - mean) / sd) > threshold) { quality[i] = QualityFlag.INVALID; values[i] = NaN }
  }
}

/** 按配置清洗数据（返回新对象，不改原数据） */
export function clean(data: StandardizedData, opts: CleanOptions): StandardizedData {
  const out = cloneData(data)
  if (opts.dedupeTimestamps && out.timeIndex) {
    const seen = new Set<number>()
    const keep: number[] = []
    out.timeIndex.forEach((t, i) => { if (!seen.has(t)) { seen.add(t); keep.push(i) } })
    if (keep.length !== out.timeIndex.length) {
      out.timeIndex = keep.map(i => out.timeIndex![i])
      for (const ch of out.channels) {
        ch.values = keep.map(i => ch.values[i])
        ch.quality = keep.map(i => ch.quality[i])
        if (ch.timestamps) ch.timestamps = keep.map(i => ch.timestamps![i])
      }
    }
  }
  for (const ch of out.channels) {
    if (opts.outlier === 'iqr') markIqrOutliers(ch.values, ch.quality)
    else if (opts.outlier === 'zscore') markZscoreOutliers(ch.values, ch.quality, opts.outlierThreshold ?? 3.5)
  }
  for (const ch of out.channels) {
    if (opts.missing === 'interpolate') fillInterpolate(ch.values, ch.quality, out.timeIndex ?? ch.timestamps)
    else if (opts.missing === 'ffill') fillForward(ch.values, ch.quality)
  }
  if (opts.missing === 'drop') {
    const time = out.timeIndex ?? out.channels[0]?.timestamps ?? []
    const keep: number[] = []
    for (let i = 0; i < time.length; i++) {
      if (out.channels.every(ch => Number.isFinite(ch.values[i] ?? NaN))) keep.push(i)
    }
    out.timeIndex = keep.map(i => time[i])
    for (const ch of out.channels) {
      ch.values = keep.map(i => ch.values[i])
      ch.quality = keep.map(i => ch.quality[i])
      if (ch.timestamps) ch.timestamps = keep.map(i => ch.timestamps![i])
    }
  }
  // 统计必须按**清洗后**的数据重算。
  //
  // 原来这里直接把输入的 statistics 克隆过来（cloneData），于是清洗之后
  // data.statistics 描述的还是清洗前的数据。最明显的后果：导出的 xlsx 里
  // 「数据」sheet 是清洗后的、「统计摘要」sheet 是清洗前的，同一份文件里两张表互相矛盾，
  // 而且都长得像对的。StatsPanel 会自己再 analyze 一次，所以界面上看不出来。
  // 键用 def.index：StandardizedData.statistics 的类型是 Record<number, …>，
  // parser 的 quickStats 也是这么建的。（导出端的 sheetStats 两种键都认，
  // 所以这里对齐类型，而不是对齐 analyze 的按名键。）
  const recomputed: Record<number, ChannelStats> = {}
  for (const ch of out.channels) {
    recomputed[ch.def.index] = computeChannelStats(ch.values, ch.quality)
  }
  out.statistics = recomputed
  return out
}
