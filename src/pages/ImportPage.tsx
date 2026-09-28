/**
 * ImportPage — 文件导入页（T9）
 * 拖拽/选择文件 → 自动 detectFile → DetectionPanel 展示与校正 → 解析成功后显示摘要。
 */
import type { DetectionResult, RawFile, StandardizedData } from '../../core/models'
import FileDrop from '../components/FileDrop'
import type { PickedFile } from '../components/FileDrop'
import DetectionPanel from '../components/DetectionPanel'

interface ImportPageProps {
  /** 当前已选文件 */
  file: PickedFile | null
  /** 检测/解析中 */
  busy: boolean
  /** 错误信息 */
  error: string | null
  /** 检测结果（null = 尚未检测） */
  detection: DetectionResult | null
  /** 解析结果（null = 尚未解析） */
  parsed: StandardizedData | null
  /** 选好文件回调（自动触发检测） */
  onFile: (file: PickedFile) => void
  /** 重新检测（应用手动校正参数） */
  onApply: (raw: RawFile) => void
  /** 下一步：解析数据 */
  onNext: (raw: RawFile) => void
}

export default function ImportPage({ file, busy, error, detection, parsed, onFile, onApply, onNext }: ImportPageProps) {
  return (
    <>
      <h2 className="page-title">文件导入</h2>
      <FileDrop file={file} busy={busy} error={error} onFile={onFile} />
      {detection && (
        <>
          <DetectionPanel detection={detection} busy={busy} onApply={onApply} onNext={onNext} />
          {parsed && (
            <div className="parse-summary">
              <h3>✅ 解析成功</h3>
              <pre>
                {JSON.stringify(
                  {
                    通道数: parsed.channels.length,
                    通道: parsed.channels.map((c) => c.def.name + (c.def.unit ? ' (' + c.def.unit + ')' : '')),
                    数据行数: parsed.channels[0]?.values.length ?? 0,
                    时间轴点数: parsed.timeIndex?.length ?? 0,
                    布局: parsed.metadata.layout ?? (detection.raw.layout ?? 'wide')
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </>
      )}
    </>
  )
}
