/**
 * 分层边界测试。
 *
 * docs/架构.md 写着两条结构性断言：
 *   「core 内部只依赖 core/models.ts，不依赖 electron / react / src 任何模块，保证可单测」
 *   「依赖方向：渲染进程 → IPC → 主进程 → core」
 *
 * 这两条**没有任何东西在守**：从 core/ 里 `import { ipcRenderer } from 'electron'` 照样能编译通过，
 * 只有跑起来才会在 Node 环境里炸。这个文件把边界变成可执行的断言。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** 抽出一个文件里所有 import/export-from 的模块说明符 */
function specifiers(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]/g)) out.push(m[1])
  for (const m of source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1])
  return out
}

/** 把相对说明符解析成仓库内的绝对路径；非相对返回 null */
function resolveLocal(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  return resolve(dirname(fromFile), spec)
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/')
}

describe('分层边界（docs/架构.md 的结构性断言）', () => {
  const coreFiles = walk(resolve(ROOT, 'core'))
  const srcFiles = walk(resolve(ROOT, 'src'))

  it('扫描到了足够多的文件（防止目录改名后测试变成永远通过）', () => {
    expect(coreFiles.length).toBeGreaterThanOrEqual(8)
    expect(srcFiles.length).toBeGreaterThanOrEqual(10)
  })

  it('core/ 不依赖 react / electron / src/', () => {
    const offenders: string[] = []
    const forbiddenPkg = /^(react|react-dom|electron|electron\/.*)$/
    for (const file of coreFiles) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        const shown = relative(ROOT, file) + ' → ' + spec
        if (forbiddenPkg.test(spec)) offenders.push(shown)
        const local = resolveLocal(file, spec)
        if (local && (isInside(local, resolve(ROOT, 'src')) || isInside(local, resolve(ROOT, 'electron')))) {
          offenders.push(shown)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('src/ 不直接依赖 electron/（渲染进程不该够到主进程）', () => {
    const offenders: string[] = []
    for (const file of srcFiles) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (/^electron(\/|$)/.test(spec)) offenders.push(relative(ROOT, file) + ' → ' + spec)
        const local = resolveLocal(file, spec)
        if (local && isInside(local, resolve(ROOT, 'electron'))) {
          offenders.push(relative(ROOT, file) + ' → ' + spec)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('core/ 只依赖 node: 内置与已声明的那几个解析库之外的第三方要显式加进来', () => {
    // 不是为了限制，而是为了让「core 新增一个运行时依赖」这件事被看见：
    // core 是要在 Node 里单测的纯逻辑层，多一个重量级依赖会影响可测试性。
    const allowed = new Set([
      'node:fs', 'node:fs/promises', 'node:path', 'node:os', 'node:util', 'node:buffer', 'node:crypto',
      'papaparse', 'iconv-lite', 'jschardet', 'xlsx'
    ])
    const seen = new Set<string>()
    for (const file of coreFiles) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.')) continue
        seen.add(spec)
      }
    }
    expect([...seen].filter(s => !allowed.has(s))).toEqual([])
  })
})
