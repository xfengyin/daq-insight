/**
 * AnalysisPage — 统计分析页（T12）：StatsPanel（逐通道统计 + 数据清洗）。
 */
import type { StandardizedData } from '../../core/models'
import StatsPanel from '../components/StatsPanel'
import EmptyState from '../components/common/EmptyState'

interface AnalysisPageProps {
  /** 解析结果（null 显示空状态） */
  parsed: StandardizedData | null
  /** 清洗后数据回传 */
  onCleaned: (cleaned: StandardizedData) => void
  /** 通知（冒烟日志/用户提示） */
  onNotify: (msg: string) => void
}

export default function AnalysisPage({ parsed, onCleaned, onNotify }: AnalysisPageProps) {
  if (!parsed) {
    return <EmptyState>请先在「文件导入」页解析数据</EmptyState>
  }
  return (
    <>
      <h2 className="page-title">统计分析</h2>
      <StatsPanel data={parsed} onCleaned={onCleaned} onNotify={onNotify} />
    </>
  )
}
