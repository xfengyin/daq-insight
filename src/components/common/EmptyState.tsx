/**
 * EmptyState — 空状态占位（未解析数据时各页面的提示）
 */
import type { ReactNode } from 'react'

interface EmptyStateProps {
  children: ReactNode
}

export default function EmptyState({ children }: EmptyStateProps) {
  return <div className="placeholder">{children}</div>
}
