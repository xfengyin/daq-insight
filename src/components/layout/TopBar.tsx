/**
 * TopBar — 顶部标题栏：产品名 + 副标题 + 右侧状态（preload 注入失败时警示）
 */
interface TopBarProps {
  /** daqAPI 是否已注入（preload 正常） */
  apiOk: boolean
}

export default function TopBar({ apiOk }: TopBarProps) {
  return (
    <header className="topbar">
      <span className="logo">DAQ Insight</span>
      <span className="subtitle">DAQ970A 智能数据工具</span>
      <span className="topbar-extra">{apiOk ? '' : '⚠ preload 未注入 daqAPI'}</span>
    </header>
  )
}
