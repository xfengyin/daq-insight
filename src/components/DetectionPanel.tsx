/**
 * DetectionPanel — 检测结果展示 + 手动校正（T9）
 * 展示 encoding/delimiter/headerRows/decimal/layout/preambleLines（带置信度），
 * 提供校正控件（自动→保持检测值），「重新检测」按校正参数更新，「下一步」触发解析。
 */
import { useMemo, useState } from 'react'
import type { DetectionResult, LayoutType, RawFile } from '../../core/models'

interface DetectionPanelProps {
  /** 检测结果（来自 daqAPI.detectFile） */
  detection: DetectionResult
  /** 解析中（禁用按钮） */
  busy: boolean
  /** 校正后参数回调（重新检测 / 下一步共用） */
  onApply: (raw: RawFile) => void
  /** 下一步：解析数据回调 */
  onNext: (raw: RawFile) => void
}

/** 校正状态：'auto' 表示沿用自动检测值 */
interface Corrections {
  encoding: 'auto' | 'utf-8' | 'gbk' | 'latin-1'
  delimiter: 'auto' | ',' | ';' | '\t' | '|'
  decimal: 'auto' | '.' | ','
  layout: 'auto' | LayoutType
  headerRows: string
  preambleLines: string
}

/** 置信度 → 中文标签 */
function confidenceLabel(v: number | undefined): { text: string; cls: string } {
  const c = typeof v === 'number' ? v : 0
  if (c >= 0.85) return { text: '高', cls: 'conf-high' }
  if (c >= 0.6) return { text: '中', cls: 'conf-mid' }
  return { text: '低', cls: 'conf-low' }
}

/** 分隔符展示名 */
const DELIM_LABEL: Record<string, string> = {
  ',': '逗号 (,)',
  ';': '分号 (;)',
  '\t': '制表符 (\t)',
  '|': '竖线 (|)'
}

const LAYOUT_LABEL: Record<string, string> = {
  wide: '宽表',
  long: '长格式',
  scan: '扫描'
}

export default function DetectionPanel({ detection, busy, onApply, onNext }: DetectionPanelProps) {
  const raw = detection.raw
  const [corr, setCorr] = useState<Corrections>({
    encoding: 'auto',
    delimiter: 'auto',
    decimal: 'auto',
    layout: 'auto',
    headerRows: '',
    preambleLines: ''
  })

  /** 按校正生成最终 RawFile（'auto' 沿用检测值） */
  const corrected: RawFile = useMemo(() => {
    const hr = corr.headerRows === '' ? raw.headerRows : Math.max(0, parseInt(corr.headerRows, 10) || 0)
    const pr = corr.preambleLines === '' ? (raw.preambleLines ?? 0) : Math.max(0, parseInt(corr.preambleLines, 10) || 0)
    return {
      ...raw,
      encoding: corr.encoding === 'auto' ? raw.encoding : corr.encoding,
      delimiter: corr.delimiter === 'auto' ? raw.delimiter : corr.delimiter,
      decimal: corr.decimal === 'auto' ? raw.decimal : corr.decimal,
      layout: corr.layout === 'auto' ? raw.layout : corr.layout,
      headerRows: hr,
      preambleLines: pr
    }
  }, [raw, corr])

  const set = <K extends keyof Corrections>(k: K, v: Corrections[K]) => setCorr((prev) => ({ ...prev, [k]: v }))

  const encConf = confidenceLabel(detection.confidence.encoding)
  const delimConf = confidenceLabel(detection.confidence.delimiter)
  const headerConf = confidenceLabel(detection.confidence.headerRows)

  return (
    <div className="detection-panel">
      <div className="panel-title-row">
        <h3>格式检测结果</h3>
        <span className="muted">{raw.layout === 'long' ? '长格式（每行一个通道）' : raw.layout === 'scan' ? '扫描格式' : '宽表格式'}</span>
      </div>

      {/* 检测结果卡片 */}
      <div className="result-cards">
        <div className="result-card">
          <span className="result-label">编码</span>
          <span className="result-value">{raw.encoding}</span>
          <span className={'conf ' + encConf.cls}>置信度 {encConf.text}</span>
        </div>
        <div className="result-card">
          <span className="result-label">分隔符</span>
          <span className="result-value">{DELIM_LABEL[raw.delimiter] ?? raw.delimiter}</span>
          <span className={'conf ' + delimConf.cls}>置信度 {delimConf.text}</span>
        </div>
        <div className="result-card">
          <span className="result-label">表头行数</span>
          <span className="result-value">{raw.headerRows} 行</span>
          <span className={'conf ' + headerConf.cls}>置信度 {headerConf.text}</span>
        </div>
        <div className="result-card">
          <span className="result-label">小数点</span>
          <span className="result-value">{raw.decimal === ',' ? '逗号 (,)' : '点 (.)'}</span>
        </div>
        <div className="result-card">
          <span className="result-label">布局</span>
          <span className="result-value">{LAYOUT_LABEL[raw.layout ?? 'wide'] ?? raw.layout ?? '宽表'}</span>
        </div>
        <div className="result-card">
          <span className="result-label">元信息行</span>
          <span className="result-value">{raw.preambleLines ?? 0} 行</span>
        </div>
      </div>

      {detection.notes.length > 0 && (
        <ul className="detect-notes">
          {detection.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {/* 手动校正 */}
      <div className="correction-box">
        <h4>手动校正（选择「自动」则沿用检测值）</h4>
        <div className="correction-grid">
          <label className="field">
            <span className="field-label">编码</span>
            <select value={corr.encoding} onChange={(e) => set('encoding', e.target.value as Corrections['encoding'])}>
              <option value="auto">自动</option>
              <option value="utf-8">UTF-8</option>
              <option value="gbk">GBK</option>
              <option value="latin-1">Latin-1</option>
            </select>
          </label>

          <div className="field">
            <span className="field-label">分隔符</span>
            <div className="radio-row">
              {(['auto', ',', ';', '\t', '|'] as const).map((d) => (
                <label key={d} className="radio-item">
                  <input type="radio" name="delim" checked={corr.delimiter === d} onChange={() => set('delimiter', d)} />
                  <span>{d === 'auto' ? '自动' : d === '\t' ? '\t' : d}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">表头行数</span>
            <input
              type="number"
              min={0}
              placeholder={'自动 (' + raw.headerRows + ')'}
              value={corr.headerRows}
              onChange={(e) => set('headerRows', e.target.value)}
            />
          </label>

          <div className="field">
            <span className="field-label">小数点风格</span>
            <div className="radio-row">
              {(['auto', '.', ','] as const).map((d) => (
                <label key={d} className="radio-item">
                  <input type="radio" name="decimal" checked={corr.decimal === d} onChange={() => set('decimal', d)} />
                  <span>{d === 'auto' ? '自动' : d === '.' ? '点 (.)' : '逗号 (,)'}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">布局</span>
            <select value={corr.layout} onChange={(e) => set('layout', e.target.value as Corrections['layout'])}>
              <option value="auto">自动</option>
              <option value="wide">宽表</option>
              <option value="long">长格式</option>
              <option value="scan">扫描</option>
            </select>
          </label>

          <label className="field">
            <span className="field-label">元信息行数</span>
            <input
              type="number"
              min={0}
              placeholder={'自动 (' + (raw.preambleLines ?? 0) + ')'}
              value={corr.preambleLines}
              onChange={(e) => set('preambleLines', e.target.value)}
            />
          </label>
        </div>
      </div>

      {/* 前 10 行原始预览 */}
      <div className="raw-preview">
        <h4>前 {Math.min(10, raw.sampleRows.length)} 行原始内容</h4>
        <pre className="raw-pre">{raw.sampleRows.slice(0, 10).map((r) => r.join(corrected.delimiter)).join('\n')}</pre>
      </div>

      <div className="panel-actions">
        <button className="btn" onClick={() => onApply(corrected)} disabled={busy}>
          重新检测
        </button>
        <button className="btn primary" onClick={() => onNext(corrected)} disabled={busy}>
          {busy ? '解析中…' : '下一步：解析数据'}
        </button>
      </div>
    </div>
  )
}
