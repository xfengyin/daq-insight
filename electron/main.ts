/**
 * electron/main.ts — Electron 主进程
 *
 * T8：主窗口（1280x800）+ 中文菜单 + IPC 桥接。
 * - 所有 IPC handler 用 ipcMain.handle 注册，通道名与类型见 src/shared/ipc.ts（唯一事实来源）
 * - 核心引擎（detection/parsing/analysis/cleaning/export）经 core/ 静态导入，
 *   当前为 T3/T5/T6/T7 签名桩；对应任务落地后无需改动本文件
 * - getPreview / getChartSeries 为主进程内数据变换，已完整实现
 */
import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join, basename, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { guardWritePath, normalizeWritePath, validateWritePath } from '../core/security/pathguard'

import { IPC } from '../src/shared/ipc'
import type {
  ChartSeries,
  DetectFileRequest,
  ExportRequest,
  GetChartSeriesRequest,
  GetPreviewRequest,
  MenuAction,
  ParseFileRequest,
  PreviewData,
  PreviewRow
} from '../src/shared/ipc'
import type { StandardizedData } from '../core/models'
import type { CleanOptions } from '../core/cleaning/cleaner'
import { detectFile } from '../core/detection/detector'
import { parseHeader } from '../core/parsing/header'
import { parseFile } from '../core/parsing/parser'
import { analyze } from '../core/analysis/engine'
import { clean } from '../core/cleaning/cleaner'
import { exportCsv, exportExcel } from '../core/export/exporter'

// 开发模式下由 electron-vite 注入的渲染进程地址；生产模式加载打包产物
const RENDERER_URL = process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null

// ---- T15 写入路径安全（授权集合 + 允许根目录）----
/** 经保存对话框确认过的写入路径（规范化绝对路径） */
const authorizedWritePaths = new Set<string>()
/** 当前打开/解析的源文件所在目录（导出默认目标，属允许根） */
let currentSourceDir: string | null = null

/** 允许直接写入（无需对话框确认）的根目录：临时目录 + 源文件目录 + userData */
function allowedWriteRoots(): string[] {
  const roots: string[] = [tmpdir()]
  if (currentSourceDir) roots.push(currentSourceDir)
  try {
    roots.push(app.getPath('userData'))
  } catch {
    // 应用未就绪时忽略
  }
  // 冒烟/开发专用阀（仅 DAQ_SMOKE=1 时）：?exportdir= 覆盖的目录显式放行
  if (process.env['DAQ_SMOKE'] === '1' && process.env['DAQ_EXPORT_DIR']) {
    roots.push(resolve(process.env['DAQ_EXPORT_DIR']))
  }
  return roots
}

/**
 * 解析可写路径（T15）：
 * 1) 非法/敏感路径（/etc、home 根等）直接拒绝；2) 授权集合或允许根目录内 → 放行；
 * 3) 其余 → 强制弹保存对话框确认，用户选定后加入授权集合。
 */
async function resolveWritePath(requested: string, win?: BrowserWindow): Promise<string> {
  const verdict = validateWritePath(requested, { authorized: authorizedWritePaths, allowedRoots: allowedWriteRoots() })
  if (verdict.ok) return verdict.path
  if (verdict.reason !== 'unauthorized') throw new Error(verdict.message)
  const options: Electron.SaveDialogOptions = { title: '确认导出路径', defaultPath: normalizeWritePath(requested) }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) throw new Error('写入取消：未选择保存路径')
  const chosen = guardWritePath(result.filePath, { authorized: authorizedWritePaths, allowedRoots: allowedWriteRoots() })
  authorizedWritePaths.add(chosen)
  return chosen
}

/** 取当前焦点窗口或主窗口（用于对话框挂载） */
function dialogWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DAQ Insight - DAQ970A 智能数据工具',
    show: false,
    webPreferences: {
      // 预加载脚本路径（electron-vite 构建输出位于 out/preload/index.js）
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.on('did-finish-load', () => {
    console.log('[daq-insight] 渲染页面加载完成')
  })

  // 冒烟验证钩子（仅设置 DAQ_SMOKE_SHOT 时生效）：加载后 6 秒截屏保存
  const smokeShot = process.env['DAQ_SMOKE_SHOT']
  if (smokeShot) {
    setTimeout(() => {
      void win.webContents
        .capturePage()
        .then((img) => writeFile(smokeShot, img.toPNG()))
        .then(() => console.log('[daq-insight] 冒烟截图已保存: ' + smokeShot))
        .catch((err) => console.error('[daq-insight] 截图失败: ' + String(err)))
    }, 18000)
  }

  if (RENDERER_URL) {
    // 开发模式：加载 Vite Dev Server（DAQ_SMOKE=1 时附加 ?smoke=1 供 headless 自检）
    let smokeUrl = RENDERER_URL
    if (process.env['DAQ_SMOKE'] === '1') {
      smokeUrl = smokeUrl + (smokeUrl.includes('?') ? '&' : '?') + 'smoke=1'
      const exportDir = process.env['DAQ_EXPORT_DIR']
      if (exportDir) smokeUrl = smokeUrl + '&exportdir=' + encodeURIComponent(exportDir)
    }
    void win.loadURL(smokeUrl)
  } else {
    // 生产模式：加载打包后的静态页面
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 中文应用菜单：文件 / 分析 / 视图 / 帮助 */
function createMenu(): void {
  // 菜单动作统一推送到渲染进程（对应 preload 的 daqAPI.onMenuEvent）
  const send = (action: MenuAction): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC.MenuEvent, action)
    }
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: () => send('openFile') },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: '分析',
      submenu: [
        { label: '重新检测格式', accelerator: 'CmdOrCtrl+Shift+D', click: () => send('redetect') },
        { label: '应用清洗', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('applyClean') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => BrowserWindow.getFocusedWindow()?.webContents.reload() },
        { label: '开发者工具', accelerator: 'F12', click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 DAQ Insight',
          click: () => {
            void dialog.showMessageBox(dialogWindow()!, {
              type: 'info',
              title: '关于',
              message: 'DAQ Insight - DAQ970A 智能数据工具',
              detail: '版本 0.1.0\n数据采集文件导入、标准化与波形分析桌面工具'
            })
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------- IPC handlers ----------------

/** dialog:openFile — 打开文件对话框（过滤 csv/txt/tsv），返回文件信息 */
function registerOpenFile(): void {
  ipcMain.handle(IPC.OpenFile, async () => {
    const win = dialogWindow()
    const options: Electron.OpenDialogOptions = {
      title: '选择数据文件',
      properties: ['openFile'],
      filters: [
        { name: 'DAQ 数据文件', extensions: ['csv', 'txt', 'tsv'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const path = result.filePaths[0]
    currentSourceDir = dirname(path)
    let size = 0
    try {
      size = (await stat(path)).size
    } catch {
      size = 0
    }
    return { canceled: false, path, name: basename(path), size }
  })
}

/** dialog:saveFile — 保存文件对话框（T12 导出目标路径选择） */
function registerSaveFile(): void {
  ipcMain.handle(IPC.SaveFile, async (_e, req: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const win = dialogWindow()
    const options: Electron.SaveDialogOptions = {
      title: '保存文件',
      defaultPath: req?.defaultPath,
      filters: req?.filters
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    // T15：对话框确认的路径记入授权集合，后续 writeFile/export 直接放行
    if (!result.canceled && result.filePath) {
      try {
        authorizedWritePaths.add(guardWritePath(result.filePath, { authorized: authorizedWritePaths, allowedRoots: allowedWriteRoots() }))
      } catch (e) {
        return { canceled: true, path: undefined }
      }
    }
    return { canceled: result.canceled, path: result.filePath || undefined }
  })
}

/** dialog:writeFile — 写文件（图表导出；utf8 或 base64；T15 路径守卫） */
function registerWriteFile(): void {
  ipcMain.handle(IPC.WriteFile, async (e, req: import('../src/shared/ipc').WriteFileRequest) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? dialogWindow()
    const finalPath = await resolveWritePath(req.path, win)
    const buf = req.encoding === 'base64' ? Buffer.from(req.content, 'base64') : Buffer.from(req.content, 'utf8')
    await mkdir(dirname(finalPath), { recursive: true })
    await writeFile(finalPath, buf)
    console.log('[T12] 已写入文件: ' + finalPath + ' (' + buf.length + ' bytes)')
    return { path: finalPath, bytes: buf.length }
  })
}

/** engine:detectFile — 格式侦察（T3 引擎） */
function registerDetectFile(): void {
  ipcMain.handle(IPC.DetectFile, async (_e, req: DetectFileRequest) => {
    currentSourceDir = dirname(req.path)
    return detectFile(req.path)
  })
}

/** engine:parseHeader — 表头解析 → 通道定义（T4 引擎） */
function registerParseHeader(): void {
  ipcMain.handle(IPC.ParseHeader, async (_e, req: import('../src/shared/ipc').ParseHeaderRequest) => {
    return parseHeader(req.rows, req.headerRows, { layout: req.layout, preambleLines: req.preambleLines })
  })
}

/** engine:parseFile — 解析 + 标准化（T5 引擎） */
function registerParseFile(): void {
  ipcMain.handle(IPC.ParseFile, async (_e, req: ParseFileRequest) => {
    currentSourceDir = dirname(req.path)
    return parseFile(req.path, req.raw, req.channels)
  })
}

/** engine:analyze — 统计分析（T6 引擎） */
function registerAnalyze(): void {
  ipcMain.handle(IPC.Analyze, async (_e, req: { data: StandardizedData }) => {
    return analyze(req.data)
  })
}

/** engine:clean — 数据清洗（T6 引擎） */
function registerClean(): void {
  ipcMain.handle(IPC.Clean, async (_e, req: { data: StandardizedData; options: CleanOptions }) => {
    return clean(req.data, req.options)
  })
}

/** engine:export — 导出 CSV / Excel（T7 引擎；T15 路径守卫） */
function registerExport(): void {
  ipcMain.handle(IPC.Export, async (e, req: ExportRequest) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? dialogWindow()
    const finalPath = await resolveWritePath(req.path, win)
    const outcome =
      req.format === 'csv' ? await exportCsv(req.data, finalPath) : await exportExcel(req.data, finalPath)
    return { path: outcome.path, bytes: outcome.bytes, rows: outcome.rows }
  })
}

/** engine:getPreview — 返回前 N 行（时间 + 通道值），NaN 统一转 null 供表格展示 */
function registerGetPreview(): void {
  ipcMain.handle(IPC.GetPreview, (_e, req: GetPreviewRequest) => {
    const data = req.data
    const channels = data.channels
    const rowCount = channels.length > 0 ? channels[0].values.length : (data.timeIndex?.length ?? 0)
    const maxRows = req.maxRows ?? 1000
    const n = Math.min(maxRows, rowCount)
    const headers = ['时间', ...channels.map((c) => (c.def.unit ? c.def.name + ' (' + c.def.unit + ')' : c.def.name))]
    const rows: PreviewRow[] = []
    for (let i = 0; i < n; i++) {
      const time = data.timeIndex ? (data.timeIndex[i] ?? null) : (channels[0]?.timestamps?.[i] ?? null)
      const values = channels.map((c) => {
        const v = c.values[i]
        return Number.isFinite(v) ? v : null
      })
      rows.push({ time, values })
    }
    const result: PreviewData = { headers, rows, totalRows: rowCount }
    return result
  })
}

/** engine:getChartSeries — 降采样图表序列（等距抽样；maxPoints 默认 100000） */
function registerGetChartSeries(): void {
  ipcMain.handle(IPC.GetChartSeries, (_e, req: GetChartSeriesRequest) => {
    const data = req.data
    const maxPoints = req.maxPoints ?? 100000
    const timeAxis = data.timeIndex ?? data.channels[0]?.timestamps ?? []
    const series: ChartSeries[] = []
    for (const idx of req.channelIndexes) {
      // def.index 是原始矩阵列号（宽表下与数组下标不一致）→ 优先按 def.index 匹配，回退数组下标
      const ch = data.channels.find((c) => c.def.index === idx) ?? data.channels[idx]
      if (!ch) continue
      const n = ch.values.length
      const timestamps: number[] = []
      const values: (number | null)[] = []
      if (n <= maxPoints) {
        for (let i = 0; i < n; i++) {
          timestamps.push(timeAxis[i] ?? i)
          values.push(Number.isFinite(ch.values[i]) ? ch.values[i] : null)
        }
      } else {
        const step = Math.ceil(n / maxPoints)
        for (let i = 0; i < n; i += step) {
          timestamps.push(timeAxis[i] ?? i)
          values.push(Number.isFinite(ch.values[i]) ? ch.values[i] : null)
        }
      }
      series.push({ channelIndex: idx, name: ch.def.name, unit: ch.def.unit, timestamps, values })
    }
    return series
  })
}

/** 注册全部 IPC handler */
function registerIpcHandlers(): void {
  registerOpenFile()
  registerSaveFile()
  registerWriteFile()
  registerDetectFile()
  registerParseHeader()
  registerParseFile()
  registerAnalyze()
  registerClean()
  registerExport()
  registerGetPreview()
  registerGetChartSeries()
}

app.whenReady().then(() => {
  console.log('[daq-insight] Electron 主进程已启动')
  registerIpcHandlers()
  createMenu()
  createWindow()

  // macOS：点击 Dock 图标且无窗口时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 除 macOS 外，所有窗口关闭时退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
