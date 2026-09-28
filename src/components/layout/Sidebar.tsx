/**
 * Sidebar — 左侧导航（文件导入/通道与预览/波形/分析/导出）
 */
/** 页面键 */
export type NavPage = 'import' | 'channels' | 'plot' | 'analysis' | 'export'

/** 导航项定义（flag 为可选角标） */
const NAV_ITEMS: { key: NavPage; label: string; flag: string }[] = [
  { key: 'import', label: '文件导入', flag: '' },
  { key: 'channels', label: '通道与预览', flag: '' },
  { key: 'plot', label: '波形', flag: '' },
  { key: 'analysis', label: '分析', flag: '' },
  { key: 'export', label: '导出', flag: '' }
]

interface SidebarProps {
  /** 当前页 */
  page: NavPage
  /** 切换页面 */
  onNavigate: (page: NavPage) => void
}

export default function Sidebar({ page, onNavigate }: SidebarProps) {
  return (
    <nav className="sidebar">
      {NAV_ITEMS.map((item) => (
        <button key={item.key} className={'nav-item' + (page === item.key ? ' active' : '')} onClick={() => onNavigate(item.key)}>
          {item.label}
          {item.flag && <span className="nav-flag">{item.flag}</span>}
        </button>
      ))}
    </nav>
  )
}
