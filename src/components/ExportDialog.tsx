/**
 * ExportDialog — 导出对话框（T12）
 * - 数据导出：CSV / Excel；目标路径=保存对话框或默认导出到原文件目录（自动命名）
 * - 图表导出：当前波形图 PNG（echarts getDataURL）与 HTML（PNG 内嵌 + 模板）
 * - 导出后显示成功提示与文件大小
 */
import { useMemo, useState } from 'react'
import type { StandardizedData } from '../../core/models'
import type { ExportFormat } from '../shared/types'
import { formatSize } from '../shared/units'

interface ExportDialogProps {
  /** 标准化数据 */
  data: StandardizedData
  /** 原文件路径（用于默认导出目录） */
  sourcePath?: string
  /** 当前波形图 PNG dataURL（null 表示无图） */
  getChartDataUrl?: () => string | null
  /** 通知（冒烟日志/用户提示） */
  onNotify?: (msg: string) => void
}

export interface ExportDone {
  kind: string
  path: string
  bytes: number
}

/** 由原文件路径推导导出基名（去扩展名） */
function baseNameOf(p: string | undefined): string {
  if (!p) return 'daq-export'
  const name = p.split(/[\\/]/).pop() ?? 'daq-export'
  return name.replace(/\.[^.]+$/, '')
}

/** HTML 图表模板（PNG 内嵌） */
function chartHtml(dataUrl: string, title: string): string {
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<title>DAQ Insight 波形图</title></head>' +
    '<body style="font-family:system-ui,Microsoft YaHei,sans-serif;background:#fff;padding:24px;color:#1f2329">' +
    '<h2 style="font-size:18px">' + title + '</h2>' +
    '<p style="color:#86909c;font-size:12px">导出时间：' + new Date().toLocaleString() + '</p>' +
    '<img src="' + dataUrl + '" style="max-width:100%" alt="DAQ Insight 波形图"/>' +
    '</body></html>'
  )
}

export default function ExportDialog({ data, sourcePath, getChartDataUrl, onNotify }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [pathMode, setPathMode] = useState<'default' | 'custom'>('default')
  const [customPath, setCustomPath] = useState('')
  const [chartType, setChartType] = useState<'png' | 'html'>('png')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<ExportDone[]>([])

  const source = typeof data.metadata.source === 'string' ? data.metadata.source : sourcePath
  const base = baseNameOf(source)

  /** 默认导出目录：优先 URL 覆盖（?exportdir=，dev/冒烟用），否则原文件目录 */
  const exportDirOverride = new URLSearchParams(window.location.search).get('exportdir')
  const dirOf = (): string => {
    if (exportDirOverride) return exportDirOverride
    if (!source) return ''
    const idx = Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\'))
    return idx > 0 ? source.slice(0, idx) : ''
  }

  /** 数据导出默认路径 */
  const dataDefaultPath = useMemo(() => {
    const dir = dirOf()
    const name = base + '-export.' + (format === 'csv' ? 'csv' : 'xlsx')
    return dir ? dir + '/' + name : name
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, base, format, exportDirOverride])

  const notify = (msg: string) => onNotify?.(msg)

  const pickSave = async () => {
    const r = await window.daqAPI.saveFileDialog(dataDefaultPath, [{ name: format === 'csv' ? 'CSV 文件' : 'Excel 文件', extensions: [format === 'csv' ? 'csv' : 'xlsx'] }])
    if (!r.canceled && r.path) {
      setCustomPath(r.path)
      setPathMode('custom')
    }
  }

  const doExportData = async () => {
    const target = pathMode === 'custom' && customPath ? customPath : dataDefaultPath
    setBusy(true)
    try {
      const out = await window.daqAPI.exportData(data, format, target)
      setDone((prev) => [...prev, { kind: format === 'csv' ? 'CSV' : 'Excel', path: out.path, bytes: out.bytes }])
      notify('[T12] 数据导出成功: ' + out.path + ' (' + formatSize(out.bytes) + ')')
    } catch (err) {
      notify('[T12] 数据导出失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  const doExportChart = async () => {
    const url = getChartDataUrl?.()
    if (!url) {
      notify('[T12] 无波形图可导出（请先在「波形」页显示图表）')
      return
    }
    setBusy(true)
    try {
      const ext = chartType === 'png' ? 'png' : 'html'
      const dir = dirOf()
      const target = pathMode === 'custom' && customPath ? customPath : (dir ? dir + '/' : '') + base + '-chart.' + ext
      if (chartType === 'png') {
        const b64 = url.split(',')[1] ?? ''
        const out = await window.daqAPI.writeFile(target, b64, 'base64')
        setDone((prev) => [...prev, { kind: 'PNG 图表', path: out.path, bytes: out.bytes }])
        notify('[T12] PNG 导出成功: ' + out.path + ' (' + formatSize(out.bytes) + ')')
      } else {
        const html = chartHtml(url, base + ' 波形图')
        const out = await window.daqAPI.writeFile(target, html, 'utf8')
        setDone((prev) => [...prev, { kind: 'HTML 图表', path: out.path, bytes: out.bytes }])
        notify('[T12] HTML 导出成功: ' + out.path + ' (' + formatSize(out.bytes) + ')')
      }
    } catch (err) {
      notify('[T12] 图表导出失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="export-dialog">
      {/* 数据导出 */}
      <h3 className="section-title">数据导出</h3>
      <div className="export-box">
        <div className="field">
          <span className="field-label">格式</span>
          <div className="radio-row">
            {(['csv', 'xlsx'] as ExportFormat[]).map((f) => (
              <label key={f} className="radio-item">
                <input type="radio" name="fmt" checked={format === f} onChange={() => setFormat(f)} />
                <span>{f === 'csv' ? 'CSV（UTF-8 BOM）' : 'Excel（.xlsx，3 个 Sheet）'}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">目标路径</span>
          <div className="radio-row">
            <label className="radio-item">
              <input type="radio" name="pathmode" checked={pathMode === 'default'} onChange={() => setPathMode('default')} />
              <span>默认导出到原文件目录</span>
            </label>
            <label className="radio-item">
              <input type="radio" name="pathmode" checked={pathMode === 'custom'} onChange={() => setPathMode('custom')} />
              <span>选择保存位置…</span>
            </label>
          </div>
          {pathMode === 'custom' && (
            <div className="path-row">
              <input className="path-input" value={customPath} placeholder="保存路径" onChange={(e) => setCustomPath(e.target.value)} />
              <button className="btn" onClick={pickSave}>浏览…</button>
            </div>
          )}
          {pathMode === 'default' && <div className="path-hint">将导出到：{dataDefaultPath}</div>}
        </div>
        <button className="btn primary" onClick={doExportData} disabled={busy}>
          {busy ? '导出中…' : '导出数据'}
        </button>
      </div>

      {/* 图表导出 */}
      <h3 className="section-title">图表导出</h3>
      <div className="export-box">
        <div className="field">
          <span className="field-label">格式</span>
          <div className="radio-row">
            <label className="radio-item">
              <input type="radio" name="chartfmt" checked={chartType === 'png'} onChange={() => setChartType('png')} />
              <span>PNG 图片</span>
            </label>
            <label className="radio-item">
              <input type="radio" name="chartfmt" checked={chartType === 'html'} onChange={() => setChartType('html')} />
              <span>HTML（内嵌图片，可分享）</span>
            </label>
          </div>
        </div>
        <div className="field">
          <span className="field-label">目标路径</span>
          <div className="radio-row">
            <label className="radio-item">
              <input type="radio" name="chartpath" checked={pathMode === 'default'} onChange={() => setPathMode('default')} />
              <span>默认导出到原文件目录</span>
            </label>
            <label className="radio-item">
              <input type="radio" name="chartpath" checked={pathMode === 'custom'} onChange={() => setPathMode('custom')} />
              <span>选择保存位置…</span>
            </label>
          </div>
          {pathMode === 'custom' && (
            <div className="path-row">
              <input className="path-input" value={customPath} placeholder="保存路径（含扩展名）" onChange={(e) => setCustomPath(e.target.value)} />
              <button className="btn" onClick={pickSave}>浏览…</button>
            </div>
          )}
        </div>
        <button className="btn primary" onClick={doExportChart} disabled={busy}>
          {busy ? '导出中…' : '导出图表'}
        </button>
      </div>

      {/* 导出记录 */}
      {done.length > 0 && (
        <div className="export-done">
          <h4>导出记录</h4>
          {done.map((d, i) => (
            <div key={i} className="done-item">
              <span className="done-kind">{d.kind}</span>
              <span className="done-path" title={d.path}>{d.path}</span>
              <span className="done-size">{formatSize(d.bytes)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
