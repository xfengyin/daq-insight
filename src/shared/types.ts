/**
 * src/shared/types.ts — 渲染进程共享类型
 *
 * 复用 core/models.ts 的核心数据模型（枚举 + 接口），
 * 并汇总 src/shared/ipc.ts 的 IPC 请求/响应类型与 daqAPI 全局对象类型。
 * 渲染进程统一从这里导入，避免散落引用。
 */
export * from '../../core/models'
export * from './ipc'

/** 渲染进程全局对象类型声明（preload 通过 contextBridge 注入 window.daqAPI） */
declare global {
  interface Window {
    /** 主进程能力桥（详见 src/shared/ipc.ts 的 DaqApi） */
    daqAPI: import('./ipc').DaqApi
  }
}

/** 让本文件成为模块（global 声明需要） */
export {}
