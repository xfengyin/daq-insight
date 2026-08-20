/**
 * PlotView — 波形页容器（T11）
 * - 顶部：图表类型切换（波形/叠加/分屏）、通道多选下拉、全部/部分显示
 * - 波形(overlay)：单图多通道叠加（共享坐标）
 * - 叠加(stack)：每通道独立 grid 纵向排列（共时间轴，同图联动缩放）
 * - 分屏(split)：每通道独立图，echarts group 连接实现 dataZoom 联动
 * - 状态栏：当前鼠标位置时间/数值
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { connect, disconnect } from 'echarts/core'
import type { ECharts } from 'echarts/core'
import type { StandardizedData } from '../../core/models'
import type { ChartSeries } from '../shared/types'
import { formatTimestamp, formatValue } from '../shared/units'
import PlotWidget from './PlotWidget'
import type { HoverInfo } from './PlotWidget'

type PlotMode = 'overlay' | 'stack' | 'split'

const MODE_LABELS: { key: PlotMode; label: string }[] = [
  { key: 'overlay', label: '波形' },
  { key: 'stack', label: '叠加' },
  { key: 'split', label: '分屏' }
]

/** 分屏联动分组 */
const SPLIT_GROUP = 'daq-plot-split'

interface PlotViewProps {
  /** 标准化数据（App 级 state） */
  data: StandardizedData
  /** 勾选展示的通道索引 */
  selected: number[]
  /** 切换通道 */
  onToggle: (index: number) => void
  /** 全部/部分显示 */
  onToggleAll: (checked: boolean) => void
  /** 渲染完成（冒烟计时） */
  onRender?: () => void
  /** 主图表实例回传（PNG 导出用；分屏模式回传 null） */
  onChartRef?: (chart: unknown | null) => void
  /** 波形 PNG dataURL 快照回传（图表导出用，图表卸载后仍可用） */
  onChartDataUrl?: (url: string | null) => void
}

export default function PlotView({ data, selected, onToggle, onToggleAll, onRender, onChartRef, onChartDataUrl }: PlotViewProps) {
  const [mode, setMode] = useState<PlotMode>('overlay')
  const [series, setSeries] = useState<ChartSeries[]>([])
  const [loading, setLoading] = useState(false)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [dropOpen, setDropOpen] = useState(false)
  const chartInstances = useRef<(ECharts | null)[]>([])
  const lastChart = useRef<unknown>(null)
  const loadedRef = useRef(false)

  // 勾选通道变化 → 重新拉取降采样序列
  useEffect(() => {
    let cancelled = false
    if (selected.length === 0) {
      setSeries([])
      return
    }
    setLoading(true)
    void window.daqAPI
      .getChartSeries(data, selected, 100000)
      .then((s) => {
        if (!cancelled) {
          setSeries(s)
          loadedRef.current = true
        }
      })
      .catch((err) => console.error('[T11] getChartSeries 失败:', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [data, selected])

  // 分屏模式：所有实例加入同一 group 实现联动
  const registerInstance = useCallback((chart: ECharts | null) => {
    if (chart) {
      chart.group = SPLIT_GROUP
      chartInstances.current.push(chart)
    } else {
      chartInstances.current = []
    }
  }, [])

  // mode 变化：重建分屏实例集合
  useEffect(() => {
    if (mode === 'split') {
      void connect(SPLIT_GROUP)
    }
    return () => {
      // 避免跨模式残留联动
      void disconnect(SPLIT_GROUP)
    }
  }, [mode])

  // 数据/模式变化 → 快照 PNG dataURL（图表导出用，卸载后仍可用）
  useEffect(() => {
    const c = lastChart.current as { getDataURL?: (o?: { type?: string; pixelRatio?: number }) => string } | null
    try {
      onChartDataUrl?.(c?.getDataURL?.({ type: 'png', pixelRatio: 2 }) ?? null)
    } catch {
      onChartDataUrl?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, mode, selected])

  const resetZoomAll = useCallback(() => {
    for (const c of chartInstances.current) {
      c?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
    }
  }, [])

  const toggleChannel = (i: number) => {
    onToggle(i)
    setDropOpen(false)
  }

  const perChannelSeries = useCallback(
    (index: number): ChartSeries[] => series.filter((s) => s.channelIndex === index),
    [series]
  )

  return (
    <div className="plot-view">
      <div className="plot-toolbar">
        <div className="mode-switch">
          {MODE_LABELS.map((m) => (
            <button key={m.key} className={'mode-btn' + (mode === m.key ? ' active' : '')} onClick={() => setMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>

        <div className="ch-select">
          <button className="btn" onClick={() => setDropOpen((v) => !v)}>
            通道选择（{selected.length}/{data.channels.length}）▾
          </button>
          {dropOpen && (
            <div className="ch-dropdown">
              {data.channels.map((c) => {
                const on = selected.includes(c.def.index)
                return (
                  <label key={c.def.index} className={'ch-option' + (on ? ' on' : '')}>
                    <input type="checkbox" checked={on} onChange={() => toggleChannel(c.def.index)} />
                    <span>{c.def.name}</span>
                    {c.def.unit ? <em>{c.def.unit}</em> : null}
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <div className="quick-btns">
          <button className="btn" onClick={() => onToggleAll(true)}>全部显示</button>
          <button className="btn" onClick={() => { const first = data.channels[0]?.def.index; if (first != null) onToggle(first) }}>仅第 1 个</button>
          <button className="btn" onClick={() => onToggleAll(false)}>清除</button>
          {mode === 'split' && (
            <button className="btn" onClick={resetZoomAll}>还原缩放</button>
          )}
        </div>

        {loading && <span className="plot-loading">加载中…</span>}
      </div>

      {selected.length === 0 ? (
        <div className="placeholder">请先勾选要展示的通道</div>
      ) : (
        <>
          {mode === 'split' ? (
            <div className="plot-grid">
              {series.map((s) => (
                <PlotWidget
                  key={s.channelIndex}
                  series={perChannelSeries(s.channelIndex)}
                  height={240}
                  showLegend={false}
                  onHover={setHover}
                  onInstance={(c) => {
                    registerInstance(c)
                    if (c) {
                      onChartRef?.(c)
                      lastChart.current = c
                    }
                  }}
                  onRender={onRender}
                  onResetZoom={resetZoomAll}
                />
              ))}
            </div>
          ) : (
            <PlotWidget
              series={series}
              height={400}
              variant={mode === 'stack' ? 'stack' : 'overlay'}
              showLegend={true}
              onHover={setHover}
              onRender={onRender}
              onInstance={(c) => {
                if (c) {
                  onChartRef?.(c)
                  lastChart.current = c
                }
              }}
              onResetZoom={resetZoomAll}
            />
          )}
        </>
      )}

      {/* 状态栏：鼠标位置时间/数值 */}
      <div className="plot-statusbar">
        {hover ? (
          <span>
            <b>{formatTimestamp(hover.time)}</b>
            <span className="status-sep">|</span>
            <span>{hover.seriesName}: <b>{formatValue(hover.value)}</b></span>
          </span>
        ) : (
          <span className="muted">将鼠标移至波形上查看时间与数值</span>
        )}
        <span className="status-right">
          系列数 {series.length} · 数据点 {series.reduce((n, s) => n + s.values.length, 0)}
        </span>
      </div>
    </div>
  )
}
