/**
 * StatsPanel — 统计分析面板（T12）
 * - 调 daqAPI.analyze(data) 获取逐通道统计表格（均值/标准差/最值/RMS/有效样本/缺失/超量程）
 * - 清洗配置（缺失值策略/异常值策略/阈值/去重时间戳）+「应用清洗」→ daqAPI.clean → onCleaned 刷新
 * - 数据质量概览：总行数、时间跨度、采样率（Hz）
 */
import { useEffect, useState } from 'react'
import type { StandardizedData } from '../../core/models'
import type { AnalysisResult } from '../../core/analysis/engine'
import type { CleanOptions } from '../../core/cleaning/cleaner'
import { ResultCard, ResultCards } from './common/ResultCard'


interface StatsPanelProps {
  /** 标准化数据（App 级 state） */
  data: StandardizedData
  /** 清洗后的数据回传（App 更新 parsed → 统计/图表/预览全部刷新） */
  onCleaned: (cleaned: StandardizedData) => void
  /** 通知（冒烟日志/用户提示） */
  onNotify?: (msg: string) => void
}

/** 数值格式化：保留合适精度，NaN → '--' */
function fmt(v: number | undefined | null, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return '--'
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e6 || abs < 1e-4) return v.toExponential(3)
  return Number(v.toPrecision(digits)).toString()
}

export default function StatsPanel({ data, onCleaned, onNotify }: StatsPanelProps) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [cleanBusy, setCleanBusy] = useState(false)
  const [missing, setMissing] = useState<CleanOptions['missing']>('interpolate')
  const [outlier, setOutlier] = useState<CleanOptions['outlier']>('none')
  const [threshold, setThreshold] = useState('3.5')
  const [dedupe, setDedupe] = useState(false)

  // 数据变化 → 重新分析
  useEffect(() => {
    let cancelled = false
    void window.daqAPI
      .analyze(data)
      .then((r) => {
        if (!cancelled) setAnalysis(r)
      })
      .catch((err) => onNotify?.('分析失败：' + (err instanceof Error ? err.message : String(err))))
    return () => {
      cancelled = true
    }
  }, [data])

  const applyClean = async () => {
    setCleanBusy(true)
    try {
      const options: CleanOptions = {
        missing,
        outlier,
        outlierThreshold: threshold.trim() === '' ? undefined : parseFloat(threshold),
        dedupeTimestamps: dedupe
      }
      const cleaned = await window.daqAPI.clean(data, options)
      onCleaned(cleaned)
      onNotify?.('清洗已应用：' + JSON.stringify(options))
    } catch (err) {
      onNotify?.('清洗失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCleanBusy(false)
    }
  }

  const rows = data.channels[0]?.values.length ?? 0
  const time = data.timeIndex ?? data.channels[0]?.timestamps ?? []
  const durationMs = analysis?.durationMs ?? (time.length >= 2 ? time[time.length - 1] - time[0] : 0)
  const sampleRate = analysis?.sampleRateHz ?? 0

  return (
    <div className="stats-panel">
      {/* 数据质量概览 */}
      <ResultCards className="quality-cards">
        <ResultCard label="总行数" value={rows} />
        <ResultCard label="时间跨度" value={durationMs > 0 ? (durationMs / 1000).toFixed(1) + ' s' : '—'} />
        <ResultCard label="采样率" value={sampleRate > 0 ? sampleRate.toFixed(1) + ' Hz' : '—'} />
        <ResultCard label="通道数" value={data.channels.length} />
      </ResultCards>

      {/* 逐通道统计表 */}
      <h3 className="section-title">逐通道统计</h3>
      <div className="table-wrap stats-table">
        <table>
          <thead>
            <tr>
              <th>通道名</th>
              <th>均值</th>
              <th>标准差</th>
              <th>最小值</th>
              <th>最大值</th>
              <th>RMS</th>
              <th>有效样本</th>
              <th>缺失数</th>
              <th>超量程数</th>
            </tr>
          </thead>
          <tbody>
            {data.channels.map((ch) => {
              const s = analysis?.channelStats[ch.def.name]
              return (
                <tr key={ch.def.index}>
                  <td>
                    <b>{ch.def.name}</b>
                    {ch.def.unit ? <span className="th-unit"> ({ch.def.unit})</span> : null}
                  </td>
                  <td className="cell-num">{s ? fmt(s.mean) : '—'}</td>
                  <td className="cell-num">{s ? fmt(s.std) : '—'}</td>
                  <td className="cell-num">{s ? fmt(s.min) : '—'}</td>
                  <td className="cell-num">{s ? fmt(s.max) : '—'}</td>
                  <td className="cell-num">{s ? fmt(s.rms) : '—'}</td>
                  <td className="cell-num">{s?.count ?? '—'}</td>
                  <td className="cell-num">{s?.missingCount ?? '—'}</td>
                  <td className="cell-num">{s?.overRangeCount ?? '—'}</td>
                </tr>
              )
            })}
            {data.channels.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-cell">暂无通道</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 清洗配置 */}
      <h3 className="section-title">数据清洗</h3>
      <div className="clean-box">
        <label className="field">
          <span className="field-label">缺失值策略</span>
          <select value={missing} onChange={(e) => setMissing(e.target.value as CleanOptions['missing'])}>
            <option value="interpolate">线性插值</option>
            <option value="ffill">前向填充</option>
            <option value="drop">删除行</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">异常值策略</span>
          <select value={outlier} onChange={(e) => setOutlier(e.target.value as CleanOptions['outlier'])}>
            <option value="none">无</option>
            <option value="iqr">IQR（1.5 倍四分位距）</option>
            <option value="zscore">Z-score</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Z-score 阈值</span>
          <input
            type="number"
            step="0.1"
            min="0.5"
            value={threshold}
            disabled={outlier !== 'zscore'}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
        <label className="field check-field">
          <span className="field-label">重复时间戳去重</span>
          <input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} />
          <span className="check-hint">保留首条</span>
        </label>
        <button className="btn primary" onClick={applyClean} disabled={cleanBusy}>
          {cleanBusy ? '清洗中…' : '应用清洗'}
        </button>
        <span className="muted clean-hint">清洗后统计与波形图同步刷新</span>
      </div>
    </div>
  )
}
