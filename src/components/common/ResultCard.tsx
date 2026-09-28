/**
 * ResultCard — 指标卡片（检测结果 / 数据质量概览共用）
 * ResultCards 为栅格容器；ResultCard 为单卡（标签 + 值 + 可选角标如置信度）。
 */
import type { ReactNode } from 'react'

interface ResultCardsProps {
  /** 附加 class（如 quality-cards，冒烟 DOM 检查依赖） */
  className?: string
  children: ReactNode
}

export function ResultCards({ className, children }: ResultCardsProps) {
  return <div className={'result-cards' + (className ? ' ' + className : '')}>{children}</div>
}

interface ResultCardProps {
  /** 指标名 */
  label: string
  /** 指标值 */
  value: ReactNode
  /** 可选角标（如「置信度 高」，自带 class 控制颜色） */
  badge?: ReactNode
}

export function ResultCard({ label, value, badge }: ResultCardProps) {
  return (
    <div className="result-card">
      <span className="result-label">{label}</span>
      <span className="result-value">{value}</span>
      {badge}
    </div>
  )
}
