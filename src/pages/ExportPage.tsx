/**
 * ExportPage — 导出页（T12）：ExportDialog（数据 CSV/Excel + 图表 PNG/HTML）。
 */
import type { StandardizedData } from '../../core/models'
import ExportDialog from '../components/ExportDialog'
import EmptyState from '../components/common/EmptyState'

interface ExportPageProps {
  /** 解析结果（null 显示空状态） */
  parsed: StandardizedData | null
  /** 原文件路径（默认导出目录推导用） */
  sourcePath?: string
  /** 当前波形图 PNG dataURL */
  getChartDataUrl: () => string | null
  /** 通知（冒烟日志/用户提示） */
  onNotify: (msg: string) => void
}

export default function ExportPage({ parsed, sourcePath, getChartDataUrl, onNotify }: ExportPageProps) {
  if (!parsed) {
    return <EmptyState>请先在「文件导入」页解析数据</EmptyState>
  }
  return (
    <>
      <h2 className="page-title">导出</h2>
      <ExportDialog data={parsed} sourcePath={sourcePath} getChartDataUrl={getChartDataUrl} onNotify={onNotify} />
    </>
  )
}
