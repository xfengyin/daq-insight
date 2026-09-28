/**
 * ChannelsPage — 通道与预览页（T10 + IT4）
 * 信息栏（文件/行数/通道数/解析耗时）+ 通道定义表（勾选/重命名/类型校正）+ 分页数据预览。
 */
import type { MeasurementType, StandardizedData } from '../../core/models'
import type { PickedFile } from '../components/FileDrop'
import ChannelTable from '../components/ChannelTable'
import DataPreview from '../components/DataPreview'
import EmptyState from '../components/common/EmptyState'

interface ChannelsPageProps {
  /** 解析结果（null 显示空状态） */
  parsed: StandardizedData | null
  /** 当前文件（信息栏回退显示用） */
  file: PickedFile | null
  /** 解析耗时（ms） */
  parseMs: number | null
  /** 勾选通道 */
  selected: number[]
  onToggle: (index: number) => void
  onToggleAll: (checked: boolean) => void
  onRename: (index: number, name: string) => void
  onTypeChange: (index: number, type: MeasurementType) => void
}

export default function ChannelsPage({ parsed, file, parseMs, selected, onToggle, onToggleAll, onRename, onTypeChange }: ChannelsPageProps) {
  if (!parsed) {
    return <EmptyState>请先在「文件导入」页解析数据</EmptyState>
  }
  return (
    <>
      <h2 className="page-title">通道与预览</h2>
      <div className="info-bar">
        <span className="info-item">
          文件：<b title={typeof parsed.metadata.source === 'string' ? parsed.metadata.source : file?.path}>{typeof parsed.metadata.source === 'string' ? parsed.metadata.source : (file?.path ?? '—')}</b>
        </span>
        <span className="info-item">总行数：{parsed.channels[0]?.values.length ?? 0}</span>
        <span className="info-item">通道数：{parsed.channels.length}</span>
        <span className="info-item">解析耗时：{parseMs != null ? parseMs + ' ms' : '—'}</span>
      </div>
      <h3 className="section-title">通道定义（勾选控制预览/图表显示）</h3>
      <ChannelTable data={parsed} selected={selected} onToggle={onToggle} onToggleAll={onToggleAll} onRename={onRename} onTypeChange={onTypeChange} />
      <h3 className="section-title">数据预览</h3>
      <DataPreview data={parsed} selected={selected} />
    </>
  )
}
