/**
 * ChannelTable — 通道定义表（T10 + IT4 类型人工校正）
 * 列 = 选择框 | 通道名（行内可编辑）| 通道号 | 测量类型（中文，可编辑下拉）| 单位 | 有效性。
 * IT4：测量类型列支持下拉选择（全部 MeasurementType 中文选项）；
 * 若 typeCandidates 存在且 typeConfidence<1 → 黄色"待确认"标签 + 候选推荐；选择后消除标记。
 */
import type { MeasurementType, StandardizedData } from '../../core/models'
import { MEASUREMENT_TYPE_LABELS, measurementLabel } from '../shared/units'

interface ChannelTableProps {
  /** 解析后的标准化数据 */
  data: StandardizedData
  /** 勾选展示的通道索引（保持数据顺序） */
  selected: number[]
  /** 切换单个通道勾选 */
  onToggle: (index: number) => void
  /** 全选 / 全不选 */
  onToggleAll: (checked: boolean) => void
  /** 行内编辑通道名 */
  onRename: (index: number, name: string) => void
  /** 人工校正测量类型（IT4） */
  onTypeChange: (index: number, type: MeasurementType) => void
}

/** 类型是否待确认（有候选且置信度 <1） */
function isUncertain(def: { typeCandidates?: MeasurementType[]; typeConfidence?: number }): boolean {
  return !!def.typeCandidates && def.typeCandidates.length > 0 && (def.typeConfidence ?? 1) < 1
}

export default function ChannelTable({ data, selected, onToggle, onToggleAll, onRename, onTypeChange }: ChannelTableProps) {
  const channels = data.channels
  const selectedSet = new Set(selected)
  const allSelected = channels.length > 0 && selected.length === channels.length

  return (
    <div className="table-wrap channel-table">
      <table>
        <thead>
          <tr>
            <th className="col-check">
              <input type="checkbox" checked={allSelected} onChange={(e) => onToggleAll(e.target.checked)} title="全选/全不选" />
            </th>
            <th>通道名</th>
            <th>通道号</th>
            <th>测量类型</th>
            <th>单位</th>
            <th>有效性</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((ch) => {
            const def = ch.def
            const uncertain = isUncertain(def)
            return (
              <tr key={def.index} className={selectedSet.has(def.index) ? 'row-selected' : 'row-dim'}>
                <td className="col-check">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(def.index)}
                    onChange={() => onToggle(def.index)}
                    title={'展示/隐藏 ' + def.name}
                  />
                </td>
                <td>
                  <input
                    className="name-input"
                    value={def.name}
                    onChange={(e) => onRename(def.index, e.target.value)}
                    title="点击编辑通道名"
                  />
                </td>
                <td>{def.channelNumber ?? '—'}</td>
                <td>
                  <div className="type-cell">
                    <select
                      className={'type-select' + (uncertain ? ' type-uncertain' : '')}
                      value={def.measurementType}
                      onChange={(e) => onTypeChange(def.index, e.target.value as MeasurementType)}
                      title={uncertain ? '类型待确认，可手动选择' : '编辑测量类型'}
                    >
                      {(Object.entries(MEASUREMENT_TYPE_LABELS) as [MeasurementType, string][]).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {uncertain && (
                      <span
                        className="uncertain-tag"
                        title={'识别不确定（置信度 ' + (def.typeConfidence ?? 0).toFixed(2) + '），候选：' + (def.typeCandidates ?? []).map((t) => measurementLabel(t)).join(' / ')}
                      >
                        ⚠ 待确认
                      </span>
                    )}
                  </div>
                </td>
                <td>{def.unit ?? '—'}</td>
                <td>{def.isValid ? '有效' : '无效'}</td>
              </tr>
            )
          })}
          {channels.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-cell">暂无通道（请先解析数据）</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
