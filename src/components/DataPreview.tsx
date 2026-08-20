/**
 * DataPreview — 数据预览表（T10）
 * 分页展示前 1000 行：第一列时间，其余为勾选通道数值；NaN 显示灰字 "--"；表头带单位。
 */
import { useMemo, useState } from 'react'
import type { StandardizedData } from '../../core/models'
import { formatTimestamp, formatValue } from '../shared/units'

interface DataPreviewProps {
  /** 解析后的标准化数据 */
  data: StandardizedData
  /** 勾选展示的通道索引 */
  selected: number[]
  /** 每页行数（默认 100） */
  pageSize?: number
  /** 最多展示行数（默认 1000） */
  maxRows?: number
}

export default function DataPreview({ data, selected, pageSize = 100, maxRows = 1000 }: DataPreviewProps) {
  const [page, setPage] = useState(0)

  // 勾选通道（保持数据顺序）；时间列取统一时间轴或首通道时间戳
  const channels = useMemo(
    () => data.channels.filter((c) => selected.includes(c.def.index)),
    [data, selected]
  )
  const timeAxis = useMemo(() => data.timeIndex ?? data.channels[0]?.timestamps ?? [], [data])

  const totalRows = Math.min(maxRows, channels.length > 0 ? channels[0].values.length : timeAxis.length)
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  const curPage = Math.min(page, totalPages - 1)
  const start = curPage * pageSize
  const end = Math.min(totalRows, start + pageSize)

  const rows = useMemo(() => {
    const out: { time: number | null; values: (number | null)[] }[] = []
    for (let i = start; i < end; i++) {
      out.push({
        time: timeAxis[i] ?? null,
        values: channels.map((c) => {
          const v = c.values[i]
          return Number.isFinite(v) ? v : null
        })
      })
    }
    return out
  }, [channels, timeAxis, start, end])

  if (channels.length === 0) {
    return <div className="placeholder">未勾选通道</div>
  }

  return (
    <div className="table-wrap data-preview">
      <div className="preview-meta">
        共 {totalRows} 行数据（{channels.length} 通道）
        {data.channels[0]?.values.length > maxRows ? '，仅展示前 ' + maxRows + ' 行' : ''}
      </div>
      <table>
        <thead>
          <tr>
            <th className="col-time">时间</th>
            {channels.map((c) => (
              <th key={c.def.index}>
                {c.def.name}
                {c.def.unit ? <span className="th-unit"> ({c.def.unit})</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={start + i}>
              <td className="col-time time-cell">{formatTimestamp(r.time)}</td>
              {r.values.map((v, j) => (
                <td key={j} className={v == null ? 'cell-nan' : 'cell-num'}>
                  {formatValue(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>
            上一页
          </button>
          <span className="page-info">
            {curPage + 1} / {totalPages}
          </span>
          <button className="btn" disabled={curPage >= totalPages - 1} onClick={() => setPage(curPage + 1)}>
            下一页
          </button>
        </div>
      )}
    </div>
  )
}
