/**
 * useSmokeTest — ?smoke=1 冒烟自检（headless 验证；T9-T12 验收流程的自动化等价物）
 *
 * 三个 effect：
 * 1. T10/IT4 DOM 检查：通道表/预览表渲染行数 + 模拟 CH102 类型校正为 RTD
 * 2. T11/T12 冒烟 runner：波形分屏 → 分析清洗 → 导出（点击文本按钮驱动）
 * 3. T9 全流程：自动检测 standard.csv → 校正 → 解析 → large.csv 性能验证
 *
 * 仅在 URL 带 ?smoke=1 时生效，正常启动零开销。
 */
import { useEffect, useRef } from 'react'
import type { DetectionResult, StandardizedData } from '../../core/models'
import { MeasurementType } from '../../core/models'

/** 冒烟自检样本（headless 验证用） */
const SAMPLE_PATH = '/vol2/@appshare/deepseek.harness/home/代码开发/daq-insight/tests/fixtures/samples/standard.csv'
const LARGE_PATH = '/vol2/@appshare/deepseek.harness/home/代码开发/daq-insight/tests/fixtures/samples/large.csv'

/** 冒烟流程需要的 App 状态与动作 */
export interface SmokeTestContext {
  /** 当前页 */
  page: string
  /** 解析结果 */
  parsed: StandardizedData | null
  /** 勾选通道（依赖项，触发 IT4 检查重跑） */
  selectedChannels: number[]
  /** 状态写回动作 */
  actions: {
    setFile: (f: { path: string; name: string; size: number }) => void
    setDetection: (d: DetectionResult) => void
    setParsed: (d: StandardizedData) => void
    setSelectedChannels: (idx: number[]) => void
    setParseMs: (ms: number) => void
    setPage: (p: 'import' | 'channels' | 'plot' | 'analysis' | 'export') => void
  }
  /** 日志输出 */
  logLine: (text: string) => void
}

function isSmoke(): boolean {
  return new URLSearchParams(window.location.search).get('smoke') === '1'
}

export function useSmokeTest({ page, parsed, selectedChannels, actions, logLine }: SmokeTestContext): void {
  const it4Simulated = useRef(false)
  const { setFile, setDetection, setParsed, setSelectedChannels, setParseMs, setPage } = actions

  /** 冒烟 DOM 检查：通道表/预览表实际渲染行数（仅 ?smoke=1 时记录） */
  useEffect(() => {
    if (!isSmoke() || page !== 'channels' || !parsed) return
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
  }, [page, parsed, selectedChannels, logLine])

  /** 冒烟 DOM 检查：波形 → 分屏 → 分析/清洗 → 导出（独立 runner，不受页面切换影响） */
  useEffect(() => {
    if (!isSmoke()) return
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
  }, [logLine])

  /** ?smoke=1 冒烟自检（headless 验证；T9 验收流程的自动化等价物） */
  useEffect(() => {
    if (!isSmoke()) return
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
}
