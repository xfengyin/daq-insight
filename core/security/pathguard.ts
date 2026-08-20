/**
 * core/security/pathguard.ts — 写入路径安全守卫（T15）
 *
 * 纯逻辑、不依赖 Electron，可独立单测。用于 IPC 写通道（dialog:writeFile / engine:export）
 * 在真正落盘前对渲染进程提交的路径做校验：
 * 1. 规范化：去包裹引号/空白、统一分隔符、path.resolve 防 ../ 穿越（win32 盘符路径手工折叠）
 * 2. 非法字符：空字节 / 控制符 / < > " | ? * / 非盘符冒号 / 尾随点或空格
 * 3. 敏感目录：/etc /usr /bin ... 及用户主目录根（~/x.csv 拒绝，~/Desktop/x.csv 允许）
 * 4. 授权集合：经保存对话框确认的路径（用户显式选择）直接放行
 * 5. 允许根目录：源文件目录 / 系统临时目录 / userData 等白名单内直接放行
 *
 * 校验顺序：非法/敏感 优先于 授权集合（即使对话框确认的敏感路径也拒绝）。
 */
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

/** 守卫选项 */
export interface WritePathGuardOptions {
  /** 已授权路径集合（保存对话框确认后加入；元素为规范化绝对路径） */
  authorized?: ReadonlySet<string>
  /** 允许直接写入的根目录列表（规范化后比较） */
  allowedRoots?: ReadonlyArray<string>
  /** 平台（默认 process.platform；测试可注入 'win32' 模拟） */
  platform?: string
}

/** 校验结果 */
export type WritePathVerdict =
  | { ok: true; path: string }
  | { ok: false; reason: 'invalid' | 'sensitive' | 'unauthorized'; message: string }

/** win32 绝对路径（盘符 + 冒号 + 斜杠），如 C:/Windows */
function isWinAbsolute(p: string): boolean {
  return /^[A-Za-z]:\//.test(p)
}

/** 手工折叠 win32 盘符路径的 . / .. 段（path.resolve 在非 win 平台不处理盘符） */
function collapseWinPath(p: string): string {
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/**
 * 非法字符检测（Windows 文件名规则，跨平台一致执行）：
 * 控制字符 / < > " | ? * / 非盘符冒号 / 尾随点或空格。
 */
export function hasIllegalPathChars(p: string): boolean {
  const s = String(p ?? '')
  if (/[\u0000-\u001f<>"|?*]/.test(s)) return true
  const colon = s.indexOf(':')
  if (colon >= 0 && !(colon === 1 && isWinAbsolute(s))) return true
  const base = s.replace(/\\/g, '/').split('/').pop() ?? ''
  if (base !== '.' && base !== '..' && /[. ]$/.test(base)) return true
  return false
}

/** 规范化写入路径：去引号/空白 → 统一分隔符 → 折叠 .. → 绝对路径；非法则抛错 */
export function normalizeWritePath(requested: string): string {
  const raw = String(requested ?? '').trim()
  if (raw.length === 0) throw new Error('写入路径为空')
  if (raw.includes('\u0000')) throw new Error('写入路径包含空字节')
  const cleaned = raw.replace(/^"+|"+$/g, '').replace(/\\/g, '/')
  if (hasIllegalPathChars(cleaned)) throw new Error('写入路径包含非法字符')
  return isWinAbsolute(cleaned) ? collapseWinPath(cleaned) : resolve(cleaned)
}

/** 敏感目录前缀表（写入到这些目录下或本身即拒绝；home 根有专门处理，不在此列） */
const SENSITIVE_BLOCKS: ReadonlyArray<string> = [
  '/etc', '/usr', '/bin', '/sbin', '/var', '/boot', '/proc', '/sys', '/dev',
  '/lib', '/lib64', '/opt', '/run'
]

/** Windows 敏感目录前缀表 */
const SENSITIVE_BLOCKS_WIN: ReadonlyArray<string> = [
  'C:/Windows', 'C:/Program Files', 'C:/Program Files (x86)', 'C:/ProgramData',
  'C:/Program Files/Common Files', 'C:/Recovery', 'C:/System Volume Information'
]

/**
 * 敏感路径判定：
 * - 用户主目录根：拒绝 home 本身及直接子级写入（~/x.csv），子目录（~/Desktop/x.csv）允许
 * - POSIX：/etc /usr /bin /sbin /var /boot /proc /sys /dev /lib /lib64 /opt /run 整棵子树
 * - win32：C:\Windows、C:\Program Files、C:\ProgramData 等
 */
export function isSensitiveWritePath(input: string, platform: string = process.platform): boolean {
  const a = normalizeWritePath(input)
  const home = normalizeWritePath(homedir())
  if (a === home || dirname(a) === home) return true
  const blocks = platform === 'win32' ? SENSITIVE_BLOCKS_WIN : SENSITIVE_BLOCKS
  for (const b of blocks) {
    const nb = b.replace(/\\/g, '/')
    if (a === nb || a.startsWith(nb + '/')) return true
  }
  return false
}

/** 路径是否位于任一允许根目录下（或等于根本身） */
export function isWithinAllowedRoots(input: string, roots: ReadonlyArray<string>): boolean {
  const a = normalizeWritePath(input)
  for (const r of roots) {
    const nr = normalizeWritePath(r)
    if (a === nr || a.startsWith(nr + '/')) return true
  }
  return false
}

/**
 * 写入路径校验（不抛错，返回判定结果）。
 * 顺序：非法 → 敏感 → 授权集合 → 允许根目录 → 未授权。
 */
export function validateWritePath(requested: string, opts: WritePathGuardOptions = {}): WritePathVerdict {
  let norm: string
  try {
    norm = normalizeWritePath(requested)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: 'invalid', message: '写入路径不合法: ' + message }
  }
  const platform = opts.platform ?? process.platform
  if (isSensitiveWritePath(norm, platform)) {
    return { ok: false, reason: 'sensitive', message: '拒绝写入敏感路径: ' + norm }
  }
  if (opts.authorized && opts.authorized.has(norm)) {
    return { ok: true, path: norm }
  }
  if (opts.allowedRoots && opts.allowedRoots.length > 0 && isWithinAllowedRoots(norm, opts.allowedRoots)) {
    return { ok: true, path: norm }
  }
  return { ok: false, reason: 'unauthorized', message: '写入路径未授权: ' + norm }
}

/** 写入路径校验（抛错版）：不通过即 throw */
export function guardWritePath(requested: string, opts: WritePathGuardOptions = {}): string {
  const v = validateWritePath(requested, opts)
  if (!v.ok) throw new Error(v.message)
  return v.path
}
