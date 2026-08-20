/**
 * App — DAQ Insight 渲染进程根组件（T9：文件导入 + 检测配置 UI）
 *
 * 页面结构：顶部标题栏 + 左侧导航（文件导入/通道与预览/分析/导出）+ 内容区。
 * 流程：拖拽/选择文件 → 自动 detectFile → DetectionPanel 展示与校正 → 重新检测 / 下一步解析。
 * 解析结果存 App 级 state（parsed），供 T10 通道表/预览表、T11 图表、T12 分析/导出复用。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DetectionResult, RawFile, StandardizedData } from '../core/models'
import { MeasurementType } from '../core/models'
import FileDrop from './components/FileDrop'
import type { PickedFile } from './components/FileDrop'
import DetectionPanel from './components/DetectionPanel'
import ChannelTable from './components/ChannelTable'
import DataPreview from './components/DataPreview'
import PlotView from './components/PlotView'
import StatsPanel from './components/StatsPanel'
import ExportDialog from './components/ExportDialog'

type NavPage = 'import' | 'channels' | 'plot' | 'analysis' | 'export'

const NAV_ITEMS: { key: NavPage; label: string; flag: string }[] = [
  { key: 'import', label: '文件导入', flag: '' },
  { key: 'channels', label: '通道与预览', flag: '' },
  { key: 'plot', label: '波形', flag: '' },
  { key: 'analysis', label: '分析', flag: '' },
  { key: 'export', label: '导出', flag: '' }
]

/** 冒烟自检样本（headless 验证用；?smoke=1 时自动执行完整流程） */
const SAMPLE_PATH = '/vol2/@appshare/deepseek.harness/home/代码开发/daq-insight/tests/fixtures/samples/standard.csv'
const LARGE_PATH = '/vol2/@appshare/deepseek.harness/home/代码开发/daq-insight/tests/fixtures/samples/large.csv'

function App() {
  const [page, setPage] = useState<NavPage>('import')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [parsed, setParsed] = useState<StandardizedData | null>(null)
  const [selectedChannels, setSelectedChannels] = useState<number[]>([])
  const [parseMs, setParseMs] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [smokeLog, setSmokeLog] = useState<string[]>([])
  const chartRef = useRef<unknown>(null)
  const it4Simulated = useRef(false)
  const [chartDataUrl, setChartDataUrl] = useState<string | null>(null)

  const logLine = (t: string) => {
    console.log(t)
    setSmokeLog((prev) => [...prev, t].slice(-40))
  }

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
  }, [])

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
    [file]
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
    [file]
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

  /** 冒烟 DOM 检查：通道表/预览表实际渲染行数（仅 ?smoke=1 时记录） */
  useEffect(() => {
    const smoke = new URLSearchParams(window.location.search).get('smoke') === '1'
    if (!smoke || page !== 'channels' || !parsed) return
    const chRows = document.querySelectorAll('.channel-table tbody tr').length
    const previewRows = document.querySelectorAll('.data-preview tbody tr').length
    const headers = Array.from(document.querySelectorAll('.data-preview thead th')).map((th) => th.textContent?.trim() ?? '')
    logLine('[T10] DOM 渲染: 通道表行=' + chRows + ' 预览表数据行=' + previewRows + ' 表头=' + JSON.stringify(headers))
    // IT4：类型编辑（standard.csv 长格式 degC 通道应显示"待确认"）
    const uncertainCount = document.querySelectorAll('.uncertain-tag').length
    const selectCount = document.querySelectorAll('.type-select').length
    logLine('[IT4] DOM: 类型下拉=' + selectCount + ' 待确认标签=' + uncertainCount)
    const selects = Array.from(document.querySelectorAll('.type-select')) as HTMLSelectElement[]
    const ch102Select = selects[1]
    if (ch102Select && !it4Simulated.current) {
      it4Simulated.current = true
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
      setter?.call(ch102Select, MeasurementType.TEMPERATURE_RTD)
      ch102Select.dispatchEvent(new Event('change', { bubbles: true }))
      logLine('[IT4] 模拟选择 CH102 → RTD（temperature_rtd）')
      window.setTimeout(() => {
        const afterSelects = Array.from(document.querySelectorAll('.type-select')) as HTMLSelectElement[]
        const after = afterSelects[1]?.value ?? 'N/A'
        const uncertainAfter = document.querySelectorAll('.uncertain-tag').length
        const statsCell = Array.from(document.querySelectorAll('.stats-table tbody tr')).map((tr) => tr.textContent ?? '')
        logLine('[IT4] 更新后 CH102 类型=' + after + ' 待确认标签=' + uncertainAfter + '（期望 temperature_rtd / 1）')
        if (statsCell.length > 0) {
          logLine('[IT4] 统计表行数=' + statsCell.length + '（类型更新后统计/导出将使用新类型）')
        }
      }, 400)
    }
  }, [page, parsed, selectedChannels])

  /** 冒烟 DOM 检查：波形 → 分屏 → 分析/清洗 → 导出（独立 runner，不受页面切换影响） */
  useEffect(() => {
    const smoke = new URLSearchParams(window.location.search).get('smoke') === '1'
    if (!smoke) return
    const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms))
    let cancelled = false
    const clickByText = (text: string): boolean => {
      const btn = (Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]).find((b) => b.textContent?.trim() === text)
      if (btn) {
        btn.click()
        return true
      }
      return false
    }
    const waitFor = async (fn: () => boolean, timeoutMs = 20000): Promise<boolean> => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        if (cancelled) return false
        if (fn()) return true
        await sleep(250)
      }
      return false
    }
    const run = async () => {
      // 等波形页 overlay 渲染完成（T11 冒烟流程已切到 plot 页并绘出 canvas）
      await waitFor(() => document.querySelectorAll('.plot-widget canvas').length > 0)
      if (cancelled) return
      logLine('[T11] 波形页 DOM: 图容器=' + document.querySelectorAll('.plot-widget').length + ' canvas=' + document.querySelectorAll('.plot-widget canvas').length)
      clickByText('分屏')
      logLine('[T11] 点击「分屏」按钮')
      await sleep(2000)
      if (cancelled) return
      logLine('[T11] 分屏模式 DOM: 图容器=' + document.querySelectorAll('.plot-widget').length + ' canvas=' + document.querySelectorAll('.plot-widget canvas').length)

      // T12：分析页
      clickByText('分析')
      logLine('[T12] 进入「分析」页')
      await waitFor(() => document.querySelectorAll('.stats-table tbody tr').length > 0)
      if (cancelled) return
      logLine('[T12] DOM: 统计表行=' + document.querySelectorAll('.stats-table tbody tr').length + ' 质量卡片=' + document.querySelectorAll('.quality-cards .result-card').length)
      clickByText('应用清洗')
      logLine('[T12] 点击「应用清洗」')
      await sleep(1200)
      if (cancelled) return

      // T12：导出页
      clickByText('导出')
      logLine('[T12] 进入「导出」页')
      await sleep(800)
      if (cancelled) return
      clickByText('导出数据')
      logLine('[T12] 点击「导出数据」（CSV 默认路径）')
      await sleep(1800)
      if (cancelled) return
      clickByText('导出图表')
      logLine('[T12] 点击「导出图表」（PNG 默认路径）')
      await sleep(1200)
      if (cancelled) return
      logLine('[T12-smoke] 全流程点击完成')
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])
  /** 菜单事件（文件→打开文件 等） */
  useEffect(() => {
    return window.daqAPI?.onMenuEvent((action) => {
      logLine('[menu] ' + action)
    })
  }, [])

  /** ?smoke=1 冒烟自检（headless 验证；T9 验收流程的自动化等价物） */
  useEffect(() => {
    const smoke = new URLSearchParams(window.location.search).get('smoke') === '1'
    if (!smoke) return
    const run = async () => {
      const daq = window.daqAPI
      if (!daq) {
        logLine('[T9-smoke] ❌ window.daqAPI 不存在')
        return
      }
      try {
        logLine('[T9-smoke] ① 自动检测 standard.csv')
        const dr = await daq.detectFile(SAMPLE_PATH)
        setFile({ path: SAMPLE_PATH, name: 'standard.csv', size: 0 })
        setDetection(dr)
        logLine('[T9-smoke] ① 检测结果: ' + JSON.stringify({ encoding: dr.raw.encoding, delimiter: dr.raw.delimiter, headerRows: dr.raw.headerRows, layout: dr.raw.layout, preambleLines: dr.raw.preambleLines }))

        logLine('[T9-smoke] ② 手动校正：分隔符→;（重新检测生效）')
        const corrected1 = { ...dr.raw, delimiter: ';' }
        setDetection({ ...dr, raw: corrected1, notes: [...dr.notes, '（冒烟）手动校正 分隔符→;'] })
        logLine('[T9-smoke] ② 校正后分隔符=' + corrected1.delimiter)

        logLine('[T9-smoke] ②b 校正回退：分隔符→' + dr.raw.delimiter + '，编码→utf-8（用于有效解析）')
        const corrected2 = { ...dr.raw, delimiter: dr.raw.delimiter, encoding: 'utf-8' }
        setDetection({ ...dr, raw: corrected2, notes: [...dr.notes, '（冒烟）手动校正 编码→utf-8'] })

        logLine('[T9-smoke] ③ 下一步：parseHeader + parseFile')
        const channels = await daq.parseHeader(corrected2.sampleRows, corrected2.headerRows, {
          layout: corrected2.layout,
          preambleLines: corrected2.preambleLines
        })
        const t0 = performance.now()
        const data = await daq.parseFile(SAMPLE_PATH, corrected2, channels)
        setParseMs(Math.round(performance.now() - t0))
        setParsed(data)
        setSelectedChannels(data.channels.map((c) => c.def.index))
        setPage('channels')
        logLine('[T9-smoke] ③ 解析完成: 通道=' + data.channels.map((c) => c.def.name + '(' + c.def.measurementType + ')').join(',') + ' 行数=' + (data.channels[0]?.values.length ?? 0) + ' 时间轴=' + (data.timeIndex?.length ?? 0))
        console.log('[T9-smoke] StandardizedData 摘要', {
          channels: data.channels.map((c) => ({ name: c.def.name, type: c.def.measurementType, unit: c.def.unit })),
          rows: data.channels[0]?.values.length ?? 0,
          metadata: data.metadata
        })
        logLine('[T9-smoke] ✅ 全流程完成')

        logLine('[T11-smoke] ④ 性能验证：解析 large.csv（20000 行 x 5 通道）')
        const tA = performance.now()
        const detL = await daq.detectFile(LARGE_PATH)
        const rawL = detL.raw
        const chL = await daq.parseHeader(rawL.sampleRows, rawL.headerRows, { layout: rawL.layout, preambleLines: rawL.preambleLines })
        const dataL = await daq.parseFile(LARGE_PATH, rawL, chL)
        const tB = performance.now()
        logLine('[T11-smoke] ④ large.csv 解析: ' + Math.round(tB - tA) + 'ms 布局=' + (rawL.layout ?? 'wide') + ' 通道=' + dataL.channels.length + ' 行=' + (dataL.channels[0]?.values.length ?? 0))
        const tC = performance.now()
        const seriesL = await daq.getChartSeries(dataL, dataL.channels.map((c) => c.def.index), 100000)
        const tD = performance.now()
        logLine('[T11-smoke] ④ getChartSeries: ' + Math.round(tD - tC) + 'ms 系列=' + seriesL.length + ' 总点数=' + seriesL.reduce((n, s) => n + s.values.length, 0))
        setParsed(dataL)
        setSelectedChannels(dataL.channels.map((c) => c.def.index))
        setParseMs(Math.round(tB - tA))
        setPage('plot')
        logLine('[T11-smoke] ⑤ 波形页已切换到 large.csv（canvas 检查稍后）')
      } catch (err) {
        logLine('[T9-smoke] ❌ ' + (err instanceof Error ? err.message : String(err)))
      }
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 当前波形图 PNG dataURL（图表导出用；取 PlotView 缓存的快照，卸载后仍可用） */
  const getChartDataUrl = useCallback((): string | null => chartDataUrl, [chartDataUrl])

  const apiOk = typeof window !== 'undefined' && !!window.daqAPI

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="logo">DAQ Insight</span>
        <span className="subtitle">DAQ970A 智能数据工具</span>
        <span className="topbar-extra">{apiOk ? '' : '⚠ preload 未注入 daqAPI'}</span>
      </header>
      <div className="body">
        <nav className="sidebar">
          {NAV_ITEMS.map((item) => (
            <button key={item.key} className={'nav-item' + (page === item.key ? ' active' : '')} onClick={() => setPage(item.key)}>
              {item.label}
              {item.flag && <span className="nav-flag">{item.flag}</span>}
            </button>
          ))}
        </nav>
        <main className="content">
          {page === 'import' && (
            <>
              <h2 className="page-title">文件导入</h2>
              <FileDrop file={file} busy={busy} error={error} onFile={handleFile} />
              {detection && (
                <>
                  <DetectionPanel detection={detection} busy={busy} onApply={handleApply} onNext={handleNext} />
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
          )}
          {page === 'channels' &&
            (parsed ? (
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
                <ChannelTable data={parsed} selected={selectedChannels} onToggle={toggleChannel} onToggleAll={toggleAllChannels} onRename={handleRename} onTypeChange={handleTypeChange} />
                <h3 className="section-title">数据预览</h3>
                <DataPreview data={parsed} selected={selectedChannels} />
              </>
            ) : (
              <div className="placeholder">请先在「文件导入」页解析数据</div>
            ))}
          {page === 'plot' &&
            (parsed ? (
              <>
                <h2 className="page-title">时域波形</h2>
                <PlotView data={parsed} selected={selectedChannels} onToggle={toggleChannel} onToggleAll={toggleAllChannels} onChartRef={(c) => (chartRef.current = c)} onChartDataUrl={setChartDataUrl} />
              </>
            ) : (
              <div className="placeholder">请先在「文件导入」页解析数据</div>
            ))}
          {page === 'analysis' &&
            (parsed ? (
              <>
                <h2 className="page-title">统计分析</h2>
                <StatsPanel data={parsed} onCleaned={setParsed} onNotify={logLine} />
              </>
            ) : (
              <div className="placeholder">请先在「文件导入」页解析数据</div>
            ))}
          {page === 'export' &&
            (parsed ? (
              <>
                <h2 className="page-title">导出</h2>
                <ExportDialog data={parsed} sourcePath={file?.path} getChartDataUrl={getChartDataUrl} onNotify={logLine} />
              </>
            ) : (
              <div className="placeholder">请先在「文件导入」页解析数据</div>
            ))}
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