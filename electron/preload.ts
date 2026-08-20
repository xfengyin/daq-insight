/**
 * electron/preload.ts — 预加载脚本
 *
 * T8：通过 contextBridge 暴露类型化的 window.daqAPI（见 src/shared/ipc.ts 的 DaqApi）。
 * - 全部方法经 ipcRenderer.invoke 走白名单通道（通道名引用 IPC 常量，单一事实来源）
 * - 不暴露 ipcRenderer 本体：渲染进程只能调用白名单方法
 * - 错误统一由主进程 throw → 渲染进程收到 rejected Promise(Error(message))
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../src/shared/ipc'
import type { DaqApi, MenuAction } from '../src/shared/ipc'

const api: DaqApi = {
  openFileDialog: () => ipcRenderer.invoke(IPC.OpenFile),
  saveFileDialog: (defaultPath, filters) => ipcRenderer.invoke(IPC.SaveFile, { defaultPath, filters }),
  detectFile: (path) => ipcRenderer.invoke(IPC.DetectFile, { path }),
  parseHeader: (rows, headerRows, opts) =>
    ipcRenderer.invoke(IPC.ParseHeader, { rows, headerRows, layout: opts?.layout, preambleLines: opts?.preambleLines }),
  parseFile: (path, raw, channels) => ipcRenderer.invoke(IPC.ParseFile, { path, raw, channels }),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  writeFile: (path, content, encoding) => ipcRenderer.invoke(IPC.WriteFile, { path, content, encoding }),
  analyze: (data) => ipcRenderer.invoke(IPC.Analyze, { data }),
  clean: (data, options) => ipcRenderer.invoke(IPC.Clean, { data, options }),
  exportData: (data, format, path) => ipcRenderer.invoke(IPC.Export, { data, format, path }),
  getPreview: (data, maxRows) => ipcRenderer.invoke(IPC.GetPreview, { data, maxRows }),
  getChartSeries: (data, channelIndexes, maxPoints) =>
    ipcRenderer.invoke(IPC.GetChartSeries, { data, channelIndexes, maxPoints }),
  onMenuEvent: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, action: MenuAction): void => callback(action)
    ipcRenderer.on(IPC.MenuEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.MenuEvent, listener)
    }
  }
}

contextBridge.exposeInMainWorld('daqAPI', api)
