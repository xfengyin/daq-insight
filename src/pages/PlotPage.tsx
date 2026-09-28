/**
 * PlotPage — 时域波形页（T11）：PlotView 容器（模式切换/通道选择/状态栏）。
 */
import type { StandardizedData } from '../../core/models'
import PlotView from '../components/PlotView'
import EmptyState from '../components/common/EmptyState'

interface PlotPageProps {
  /** 解析结果（null 显示空状态） */
  parsed: StandardizedData | null
  /** 勾选通道 */
  selected: number[]
  onToggle: (index: number) => void
  onToggleAll: (checked: boolean) => void
  /** 波形 PNG dataURL 快照回传（图表导出用） */
  onChartDataUrl: (url: string | null) => void
}

export default function PlotPage({ parsed, selected, onToggle, onToggleAll, onChartDataUrl }: PlotPageProps) {
  if (!parsed) {
    return <EmptyState>请先在「文件导入」页解析数据</EmptyState>
  }
  return (
    <>
      <h2 className="page-title">时域波形</h2>
      <PlotView data={parsed} selected={selected} onToggle={onToggle} onToggleAll={onToggleAll} onChartDataUrl={onChartDataUrl} />
    </>
  )
}
