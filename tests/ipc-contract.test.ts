/**
 * IPC 契约的一致性测试。
 *
 * src/shared/ipc.ts 自称是通道名的「唯一事实来源」（原文），三处引用它：
 *   electron/main.ts     ipcMain.handle(IPC.X, …)
 *   electron/preload.ts  ipcRenderer.invoke(IPC.X, …) / .on(IPC.X, …)
 *   src/…（渲染进程）     通过 window.daqAPI.* 间接调用
 *
 * 于是有三类「声明与实际不符」的可能，都不会被类型系统发现：
 *   1. 通道声明了，但没人注册 handler  → 渲染进程 invoke 会一直挂着
 *   2. preload 暴露了调用，但 main 没注册 → 同上，而且是运行时才炸
 *   3. 用了 ipc.ts 里没有的通道名（字符串写错）
 *
 * 本文件不 import electron，只**读源码文本**做交叉检查——这样测试不需要跑起
 * 一个 Electron 进程，失败信息也能直接指出是哪一行对不上。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const IPC_TS = readFileSync(resolve(ROOT, 'src/shared/ipc.ts'), 'utf8')
const MAIN_TS = readFileSync(resolve(ROOT, 'electron/main.ts'), 'utf8')
const PRELOAD_TS = readFileSync(resolve(ROOT, 'electron/preload.ts'), 'utf8')

/** ipc.ts 里声明了哪些通道：键名 → 通道字符串 */
function declaredChannels(): Map<string, string> {
  const out = new Map<string, string>()
  // 形如:  OpenFile: 'dialog:openFile',
  for (const m of IPC_TS.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*):\s*'([^']+)'/gm)) {
    out.set(m[1], m[2])
  }
  return out
}

/** 某个文件里出现过的 IPC.<键> */
function usedKeys(source: string): Set<string> {
  const out = new Set<string>()
  for (const m of source.matchAll(/IPC\.([A-Za-z][A-Za-z0-9_]*)/g)) out.add(m[1])
  return out
}

/** main.ts 里注册了 handler 的通道键 */
function handledKeys(): Set<string> {
  const out = new Set<string>()
  for (const m of MAIN_TS.matchAll(/ipcMain\.(?:handle|handleOnce|on)\(\s*IPC\.([A-Za-z][A-Za-z0-9_]*)/g)) {
    out.add(m[1])
  }
  return out
}

/** preload.ts 里用 invoke 调用的通道键 */
function invokedKeys(): Set<string> {
  const out = new Set<string>()
  for (const m of PRELOAD_TS.matchAll(/ipcRenderer\.invoke\(\s*IPC\.([A-Za-z][A-Za-z0-9_]*)/g)) {
    out.add(m[1])
  }
  return out
}

describe('IPC 契约（ipc.ts ↔ main.ts ↔ preload.ts）', () => {
  const declared = declaredChannels()

  it('解析到了三份文件的内容（防止正则失效后测试变成永远通过）', () => {
    expect(declared.size).toBeGreaterThanOrEqual(8)
    expect(handledKeys().size).toBeGreaterThanOrEqual(8)
    expect(invokedKeys().size).toBeGreaterThanOrEqual(8)
  })

  it('三处引用的通道名都在 ipc.ts 里声明过（不会用到没声明的名字）', () => {
    const declaredKeys = new Set(declared.keys())
    const unknown: string[] = []
    for (const [file, src] of [
      ['electron/main.ts', MAIN_TS],
      ['electron/preload.ts', PRELOAD_TS]
    ] as const) {
      for (const k of usedKeys(src)) if (!declaredKeys.has(k)) unknown.push(`${file} → IPC.${k}`)
    }
    expect(unknown).toEqual([])
  })

  it('preload 暴露的每个 invoke 通道，main 都注册了 handler', () => {
    // 这一条正是当初那个死通道（声明 + 暴露，但没有 handler）会踩中的：
    // 渲染进程一调用就永远挂着，既没有报错也不会返回。
    const handled = handledKeys()
    const missing = [...invokedKeys()].filter(k => !handled.has(k))
    expect(missing).toEqual([])
  })

  it('声明的每个通道都至少被用了一次（声明的通道必须是活的）', () => {
    const used = new Set([...usedKeys(MAIN_TS), ...usedKeys(PRELOAD_TS)])
    const dead = [...declared.keys()].filter(k => !used.has(k))
    expect(dead).toEqual([])
  })

  it('每个通道字符串都不与别的通道重复（复制粘贴最容易出的错）', () => {
    const byName = new Map<string, string[]>()
    for (const [key, channel] of declared) {
      byName.set(channel, [...(byName.get(channel) ?? []), key])
    }
    const dups = [...byName.entries()].filter(([, keys]) => keys.length > 1)
    expect(dups).toEqual([])
  })
})
