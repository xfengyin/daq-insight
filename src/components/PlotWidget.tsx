/**
 * PlotWidget — ECharts 时域波形组件（T11 + T14 按需引入瘦身）
 * - x 轴时间（time），y 轴数值；系列名 = 通道名+单位
 * - dataZoom inside + slider；tooltip axis 触发（时间+值）；legend；还原缩放按钮
 * - 大数据量：数据经 daqAPI.getChartSeries 降采样（maxPoints 100000）+ echarts sampling:'lttb'
 * - 多通道叠加（≥10 色色板）；variant='stack' 时每通道独立 grid 纵向排列（共时间轴）
 * - 响应容器尺寸（ResizeObserver）
 *
 * T14：仅注册用到的模块（LineChart / Grid / Tooltip / DataZoom / Legend / Title / Canvas），
 * 包体积从全量 3.36MB 显著下降。
 */
import { useEffect, useRef } from 'react'
import { init, use } from 'echarts/core'
import type { ECharts, EChartsCoreOption } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ChartSeries } from '../shared/types'
import { formatTimestamp, formatValue } from '../shared/units'

/** 按需注册（模块级执行一次） */
use([
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  LegendComponent,
  TitleComponent,
  AxisPointerComponent,
  CanvasRenderer
])

/** 12 色色板（多通道颜色区分） */
const PALETTE = [
  '#2f54eb', '#fa8c16', '#52c41a', '#eb2f96', '#13c2c2', '#722ed1',
  '#a0d911', '#f5222d', '#faad14', '#1677ff', '#95de64', '#ff7a45'
]

export type PlotVariant = 'overlay' | 'stack'

/** 鼠标悬停信息（状态栏用） */
export interface HoverInfo {
  /** 时间（Unix 毫秒） */
  time: number | null
  /** 悬停系列名 */
  seriesName: string
  /** 悬停值 */
  value: number | null
}

interface PlotWidgetProps {
  /** 已降采样的图表序列 */
  series: ChartSeries[]
  /** 图高度（px） */
  height?: number
  /** overlay: 共享坐标叠加；stack: 每通道独立 grid */
  variant?: PlotVariant
  /** 是否显示图例 */
  showLegend?: boolean
  /** 鼠标悬停回调（状态栏） */
  onHover?: (info: HoverInfo | null) => void
  /** 注册实例（分屏联动/冒烟检查用） */
  onInstance?: (chart: ECharts | null) => void
  /** 还原缩放按钮点击 */
  onResetZoom?: () => void
}

function seriesName(s: ChartSeries): string {
  return s.unit ? s.name + ' (' + s.unit + ')' : s.name
}

function buildOption(series: ChartSeries[], variant: PlotVariant, height: number, showLegend: boolean): EChartsCoreOption {
  const baseSeries = series.map((s) => ({
    name: seriesName(s),
    type: 'line' as const,
    showSymbol: false,
    sampling: 'lttb' as const,
    smooth: false,
    lineStyle: { width: 1.2 },
    emphasis: { focus: 'series' as const },
    data: s.timestamps.map((t, j) => [t, s.values[j]] as [number, number | null])
  }))

  if (variant === 'stack' && series.length > 0) {
    const n = series.length
    const topPad = 28
    const bottomPad = 64
    const slot = (height - topPad - bottomPad) / n
    const grids = series.map((_, i) => ({
      left: 70,
      right: 20,
      top: topPad + i * slot,
      height: slot - 6
    }))
    return {
      animation: false,
      color: PALETTE,
      tooltip: { trigger: 'axis', formatter: axisTooltip },
      legend: { show: false },
      grid: grids,
      xAxis: series.map((_, i) => ({
        type: 'time' as const,
        gridIndex: i,
        axisLabel: { fontSize: 10, hideOverlap: true },
        splitLine: { show: i === n - 1 }
      })),
      yAxis: series.map((s, i) => ({
        type: 'value' as const,
        gridIndex: i,
        scale: true,
        name: seriesName(s),
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10 }
      })),
      dataZoom: [
        { type: 'inside', xAxisIndex: 'all' as unknown as number },
        { type: 'slider', xAxisIndex: 'all' as unknown as number, bottom: 8, height: 18 }
      ],
      series: baseSeries.map((s, i) => ({ ...s, xAxisIndex: i, yAxisIndex: i }))
    }
  }

  return {
    animation: false,
    color: PALETTE,
    tooltip: { trigger: 'axis', formatter: axisTooltip },
    legend: { show: showLegend, type: 'scroll', top: 0, textStyle: { fontSize: 11 } },
    grid: { left: 70, right: 20, top: 36, bottom: 72 },
    xAxis: { type: 'time', axisLabel: { fontSize: 10, hideOverlap: true } },
    yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 10 } },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, bottom: 8, height: 18 }
    ],
    series: baseSeries
  }
}

/** axis 触发的 tooltip：时间 + 各系列值 */
function axisTooltip(params: unknown): string {
  const arr = Array.isArray(params) ? (params as { seriesName: string; value: unknown; marker: string }[]) : [(params as { seriesName: string; value: unknown; marker: string })]
  const first = arr[0]
  const time = Array.isArray(first?.value) ? formatTimestamp(first.value[0] as number) : '--'
  const lines = arr.map((p) => p.marker + ' ' + p.seriesName + ': <b>' + formatValue(Array.isArray(p.value) ? (p.value[1] as number) : null) + '</b>')
  return '<b style="font-size:12px">' + time + '</b><br/>' + lines.join('<br/>')
}

export default function PlotWidget({ series, height = 320, variant = 'overlay', showLegend = true, onHover, onInstance, onResetZoom }: PlotWidgetProps) {
  const divRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ECharts | null>(null)

  // 初始化 + 事件 + ResizeObserver + 释放
  useEffect(() => {
    const el = divRef.current
    if (!el) return
    const chart = init(el)
    chartRef.current = chart
    onInstance?.(chart)

    const hover = (p: unknown) => {
      const pp = p as { componentType?: string; value?: unknown; seriesName?: string }
      if (pp?.componentType === 'series' && Array.isArray(pp.value) && onHover) {
        onHover({ time: pp.value[0] as number, seriesName: pp.seriesName ?? '', value: pp.value[1] as number })
      }
    }
    chart.on('mousemove', hover)
    const out = () => onHover?.(null)
    chart.on('mouseout', out)

    const ro = new ResizeObserver(() => {
      chart.resize()
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.off('mousemove', hover)
      chart.off('mouseout', out)
      onInstance?.(null)
      chart.dispose()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 数据/形态变化 → setOption
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setOption(buildOption(series, variant, height, showLegend), { notMerge: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, variant, height, showLegend])

  return (
    <div className="plot-widget">
      <div ref={divRef} style={{ width: '100%', height }} />
      {onResetZoom && (
        <button className="plot-reset" title="还原缩放" onClick={onResetZoom}>
          ⟲ 还原
        </button>
      )}
    </div>
  )
}
