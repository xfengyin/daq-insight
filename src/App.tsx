/**
 * App — DAQ Insight 渲染进程根组件
 *
 * 页面结构：顶部标题栏 + 左侧导航（文件导入/通道与预览/波形/分析/导出）+ 内容区。
 * 流程：拖拽/选择文件 → 自动 detectFile → DetectionPanel 展示与校正 → 重新检测 / 下一步解析。
 * 解析结果存 App 级 state（parsed），供通道表/预览表、图表、分析/导出各页复用。
 *
 * 布局与页面渲染拆至 components/layout 与 pages/；冒烟自检逻辑见 hooks/useSmokeTest。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DetectionResult, RawFile, StandardizedData } from '../core/models'
import { MeasurementType } from '../core/models'
import type { PickedFile } from './components/FileDrop'
import TopBar from './components/layout/TopBar'
import Sidebar from './components/layout/Sidebar'
import type { NavPage } from './components/layout/Sidebar'
import ImportPage from './pages/ImportPage'
import ChannelsPage from './pages/ChannelsPage'
import PlotPage from './pages/PlotPage'
import AnalysisPage from './pages/AnalysisPage'
import ExportPage from './pages/ExportPage'
import { useSmokeLog } from './hooks/useSmokeLog'
import { useSmokeTest } from './hooks/useSmokeTest'

function App() {
  const [page, setPage] = useState<NavPage>('import')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [parsed, setParsed] = useState<StandardizedData | null>(null)
  const [selectedChannels, setSelectedChannels] = useState<number[]>([])
  const [parseMs, setParseMs] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chartDataUrl, setChartDataUrl] = useState<string | null>(null)

  const { lines: smokeLog, logLine } = useSmokeLog()

  /** 文件导入：自动触发格式检测 */
  const handleFile = useCallback(async (f: PickedFile) => {
    setFile(f)
    setError(null)
    setParsed(null)
    setBusy(true)
    try {
      const dr = await window.daqAPI.detectFile(f.path)
      setDetection(dr)
      logLine(
        '[T9] 检测完成: ' +
          JSON.stringify({
            encoding: dr.raw.encoding,
            delimiter: dr.raw.delimiter,
            headerRows: dr.raw.headerRows,
            decimal: dr.raw.decimal,
            layout: dr.raw.layout,
            preambleLines: dr.raw.preambleLines
          })
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [logLine])

  /** 重新检测：重新执行 detectFile 后叠加手动校正参数 */
  const handleApply = useCallback(
    async (raw: RawFile) => {
      if (!file) return
      setBusy(true)
      setError(null)
      try {
        const fresh = await window.daqAPI.detectFile(file.path)
        const merged: DetectionResult = {
          ...fresh,
          raw: { ...fresh.raw, ...raw },
          notes: [...fresh.notes, '已应用手动校正（' + new Date().toLocaleTimeString() + '）']
        }
        setDetection(merged)
        logLine('[T9] 重新检测(校正后): encoding=' + merged.raw.encoding + ' delimiter=' + merged.raw.delimiter + ' headerRows=' + merged.raw.headerRows + ' layout=' + (merged.raw.layout ?? 'wide'))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [file, logLine]
  )

  /** 下一步：解析数据（parseHeader 生成通道定义 → parseFile 标准化） */
  const handleNext = useCallback(
    async (raw: RawFile) => {
      if (!file) return
      setBusy(true)
      setError(null)
      try {
        const channels = await window.daqAPI.parseHeader(raw.sampleRows, raw.headerRows, {
          layout: raw.layout,
          preambleLines: raw.preambleLines
        })
        const t0 = performance.now()
        const data = await window.daqAPI.parseFile(file.path, raw, channels)
        setParseMs(Math.round(performance.now() - t0))
        setParsed(data)
        setSelectedChannels(data.channels.map((c) => c.def.index))
        const summary = {
          channels: data.channels.map((c) => ({ name: c.def.name, type: c.def.measurementType, unit: c.def.unit, isTs: c.def.isTimestamp })),
          rows: data.channels[0]?.values.length ?? 0,
          timeIndex: data.timeIndex?.length ?? 0,
          layout: data.metadata.layout ?? (raw.layout ?? 'wide')
        }
        logLine('[T9] 解析完成: ' + JSON.stringify(summary))
        console.log('[T9] StandardizedData 摘要', summary)
        setPage('channels')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [file, logLine]
  )

  /** 通道勾选 / 重命名 */
  const toggleChannel = useCallback((index: number) => {
    setSelectedChannels((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]))
  }, [])

  const toggleAllChannels = useCallback(
    (checked: boolean) => {
      setSelectedChannels(checked && parsed ? parsed.channels.map((c) => c.def.index) : [])
    },
    [parsed]
  )

  /** IT4：人工校正测量类型（清除不确定性标记，统计/导出经 parsed 自动同步） */
  const handleTypeChange = useCallback((index: number, type: MeasurementType) => {
    setParsed((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        channels: prev.channels.map((c) =>
          c.def.index === index
            ? { ...c, def: { ...c.def, measurementType: type, typeCandidates: undefined, typeConfidence: 1 } }
            : c
        )
      }
    })
  }, [])

  const handleRename = useCallback((index: number, name: string) => {
    setParsed((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        channels: prev.channels.map((c) => (c.def.index === index ? { ...c, def: { ...c.def, name } } : c))
      }
    })
  }, [])

  /** 冒烟自检（?smoke=1；T9-T12 验收流程自动化） */
  useSmokeTest({
    page,
    parsed,
    selectedChannels,
    actions: { setFile, setDetection, setParsed, setSelectedChannels, setParseMs, setPage },
    logLine
  })

  /** 菜单事件（文件→打开文件 等） */
  useEffect(() => {
    return window.daqAPI?.onMenuEvent((action) => {
      logLine('[menu] ' + action)
    })
  }, [logLine])

  /** 当前波形图 PNG dataURL（图表导出用；取 PlotView 缓存的快照，卸载后仍可用） */
  const getChartDataUrl = useCallback((): string | null => chartDataUrl, [chartDataUrl])

  const apiOk = typeof window !== 'undefined' && !!window.daqAPI

  return (
    <div className="app-shell">
      <TopBar apiOk={apiOk} />
      <div className="body">
        <Sidebar page={page} onNavigate={setPage} />
        <main className="content">
          {page === 'import' && (
            <ImportPage file={file} busy={busy} error={error} detection={detection} parsed={parsed} onFile={handleFile} onApply={handleApply} onNext={handleNext} />
          )}
          {page === 'channels' && (
            <ChannelsPage parsed={parsed} file={file} parseMs={parseMs} selected={selectedChannels} onToggle={toggleChannel} onToggleAll={toggleAllChannels} onRename={handleRename} onTypeChange={handleTypeChange} />
          )}
          {page === 'plot' && (
            <PlotPage parsed={parsed} selected={selectedChannels} onToggle={toggleChannel} onToggleAll={toggleAllChannels} onChartDataUrl={setChartDataUrl} />
          )}
          {page === 'analysis' && <AnalysisPage parsed={parsed} onCleaned={setParsed} onNotify={logLine} />}
          {page === 'export' && <ExportPage parsed={parsed} sourcePath={file?.path} getChartDataUrl={getChartDataUrl} onNotify={logLine} />}
          {smokeLog.length > 0 && (
            <div className="smoke-log">
              {smokeLog.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
