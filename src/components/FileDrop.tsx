/**
 * FileDrop — 文件导入区（T9）
 * 整窗口拖拽文件（ondrop + dragover 高亮）+「选择文件」按钮（daqAPI.openFileDialog）。
 * 拖入/选择后回调 onFile({path,name,size})，由上层自动触发 detectFile。
 */
import { useState } from 'react'

/** 选中的文件信息 */
export interface PickedFile {
  /** 文件绝对路径 */
  path: string
  /** 文件名 */
  name: string
  /** 文件大小（字节） */
  size: number
}

interface FileDropProps {
  /** 当前已选文件 */
  file: PickedFile | null
  /** 检测中（禁用交互） */
  busy: boolean
  /** 上层错误信息（显示在导入区） */
  error: string | null
  /** 用户选好文件后回调 */
  onFile: (file: PickedFile) => void
}

/** 文件大小格式化：B / KB / MB / GB */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return v.toFixed(u === 0 ? 0 : 1) + ' ' + units[u]
}

/** 从拖拽的 File 列表中解析真实路径（Electron 33：File.path 已移除，走 webUtils） */
function filePathOf(f: File): string {
  try {
    const legacy = (f as File & { path?: string }).path
    if (legacy) return legacy
  } catch {
    /* ignore */
  }
  try {
    return window.daqAPI.getPathForFile(f)
  } catch {
    return ''
  }
}

export default function FileDrop({ file, busy, error, onFile }: FileDropProps) {
  const [dragging, setDragging] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const acceptFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    const f = files[0]
    const path = filePathOf(f)
    if (!path) {
      setLocalError('无法获取文件路径（Electron 环境受限），请改用「选择文件」按钮')
      return
    }
    setLocalError(null)
    onFile({ path, name: f.name, size: f.size })
  }

  const onPick = async () => {
    try {
      const r = await window.daqAPI.openFileDialog()
      if (!r.canceled && r.path) {
        onFile({ path: r.path, name: r.name ?? '', size: r.size ?? 0 })
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const showError = error ?? localError

  return (
    <div
      className={'filedrop' + (dragging ? ' dragging' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        acceptFiles(e.dataTransfer.files)
      }}
    >
      <div className="filedrop-icon">{dragging ? '📥' : '📄'}</div>
      <p className="filedrop-hint">{dragging ? '松开鼠标，开始导入' : '将数据文件拖拽到此处'}</p>
      <p className="filedrop-sub">支持 CSV / TSV / TXT（DAQ970A / BenchVue 导出格式）</p>
      <button className="btn primary" onClick={onPick} disabled={busy}>
        {busy ? '检测中…' : '选择文件'}
      </button>
      {file && (
        <div className="filedrop-file">
          <span className="filedrop-filename" title={file.path}>
            {file.name}
          </span>
          <span className="filedrop-filesize">{formatSize(file.size) || '大小未知'}</span>
        </div>
      )}
      {showError && <p className="error-text">{showError}</p>}
    </div>
  )
}
