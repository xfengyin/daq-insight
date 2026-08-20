/**
 * tests/pathguard.test.ts — T15 写入路径安全守卫单元测试
 *
 * 覆盖：../ 穿越、绝对路径、非法字符、敏感目录、授权集合、允许根目录、相对路径。
 */
import { describe, expect, it } from 'vitest'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  guardWritePath,
  hasIllegalPathChars,
  isSensitiveWritePath,
  isWithinAllowedRoots,
  normalizeWritePath,
  validateWritePath
} from '../core/security/pathguard'

const HOME = resolve(homedir())

describe('normalizeWritePath 规范化', () => {
  it('去包裹引号与空白，解析为绝对路径', () => {
    expect(normalizeWritePath('  "a/b.csv"  ')).toBe(resolve('a/b.csv'))
    expect(normalizeWritePath('x/../y.csv')).toBe(resolve('y.csv'))
  })
  it('../ 穿越折叠：逃逸到 /etc 后由敏感检查拦截', () => {
    const escaped = normalizeWritePath('/data/daq/../../etc/cron.d/evil')
    expect(escaped).toBe('/etc/cron.d/evil')
    expect(isSensitiveWritePath(escaped)).toBe(true)
  })
  it('win32 盘符路径：折叠 .. 且不经过 POSIX resolve', () => {
    expect(normalizeWritePath('C:\\Users\\a\\..\\out.csv')).toBe('C:/Users/out.csv')
    expect(normalizeWritePath('C:/Users/a/../out.csv')).toBe('C:/Users/out.csv')
  })
  it('空路径 / 空字节 → 抛错', () => {
    expect(() => normalizeWritePath('')).toThrow()
    expect(() => normalizeWritePath('  ')).toThrow()
    expect(() => normalizeWritePath('a\u0000b')).toThrow()
  })
})

describe('hasIllegalPathChars 非法字符', () => {
  it('Windows 非法字符 < > " | ? * 与控制字符', () => {
    for (const bad of ['a<b.csv', 'a>b.csv', 'a"b.csv', 'a|b.csv', 'a?b.csv', 'a*b.csv', 'a\x01b.csv']) {
      expect(hasIllegalPathChars(bad), bad).toBe(true)
    }
  })
  it('非盘符冒号拒绝，盘符冒号允许', () => {
    expect(hasIllegalPathChars('a:b.csv')).toBe(true)
    expect(hasIllegalPathChars('C:/x/y.csv')).toBe(false)
  })
  it('尾随点 / 空格拒绝（Windows 文件名规则）', () => {
    expect(hasIllegalPathChars('/tmp/x.')).toBe(true)
    expect(hasIllegalPathChars('/tmp/x ')).toBe(true)
    expect(hasIllegalPathChars('/tmp/ok.csv')).toBe(false)
  })
})

describe('isSensitiveWritePath 敏感目录', () => {
  it('POSIX 敏感目录整棵子树拒绝', () => {
    for (const p of ['/etc/passwd', '/etc/cron.d/evil', '/usr/bin/x', '/var/log/x.log', '/boot/x']) {
      expect(isSensitiveWritePath(p), p).toBe(true)
    }
  })
  it('用户主目录根：直接子级拒绝，子目录允许', () => {
    expect(isSensitiveWritePath(join(HOME, 'out.csv'))).toBe(true)
    expect(isSensitiveWritePath(HOME)).toBe(true)
    expect(isSensitiveWritePath(join(HOME, 'Desktop', 'out.csv'))).toBe(false)
  })
  it('win32 敏感目录（platform 注入）', () => {
    expect(isSensitiveWritePath('C:/Windows/system32/evil.exe', 'win32')).toBe(true)
    expect(isSensitiveWritePath('C:/Program Files/x.exe', 'win32')).toBe(true)
    expect(isSensitiveWritePath('C:/Users/a/Desktop/out.csv', 'win32')).toBe(false)
  })
  it('普通目录不误伤', () => {
    expect(isSensitiveWritePath(resolve(tmpdir(), 'out.csv'))).toBe(false)
    expect(isSensitiveWritePath(join(HOME, 'Desktop', 'out.csv'))).toBe(false)
  })
})

describe('isWithinAllowedRoots 允许根目录', () => {
  it('根目录下与根本身均视为允许', () => {
    const root = resolve(tmpdir(), 'daq-write-test')
    expect(isWithinAllowedRoots(join(root, 'a', 'b.csv'), [root])).toBe(true)
    expect(isWithinAllowedRoots(root, [root])).toBe(true)
    expect(isWithinAllowedRoots(join(root, '..', 'x.csv'), [root])).toBe(false)
  })
})

describe('validateWritePath / guardWritePath 综合', () => {
  const root = resolve(tmpdir(), 'daq-write-test')
  const sourceDir = join(root, 'source')
  const authorized = new Set<string>([normalizeWritePath(join(root, 'confirmed', 'a.csv'))])
  const opts = { authorized, allowedRoots: [sourceDir] }

  it('允许根目录内直接放行', () => {
    const p = join(sourceDir, 'out.csv')
    expect(validateWritePath(p, opts)).toEqual({ ok: true, path: normalizeWritePath(p) })
    expect(guardWritePath(p, opts)).toBe(normalizeWritePath(p))
  })
  it('授权集合放行（即使不在允许根目录）', () => {
    const p = join(root, 'confirmed', 'a.csv')
    expect(validateWritePath(p, opts).ok).toBe(true)
  })
  it('../ 穿越逃逸到敏感目录 → sensitive（固定深度路径，不依赖 tmpdir 层级）', () => {
    const p = '/data/daq/../../etc/x'
    expect(normalizeWritePath(p)).toBe('/etc/x')
    const v = validateWritePath(p, opts)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('sensitive')
  })
  it('敏感路径即使已授权也拒绝', () => {
    const p = '/etc/evil.sh'
    authorized.add(p)
    const v = validateWritePath(p, { ...opts, authorized })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('sensitive')
  })
  it('非法路径返回 invalid', () => {
    const v = validateWritePath('/tmp/a<b.csv', opts)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('invalid')
  })
  it('根目录外的普通路径 → 未授权', () => {
    const v = validateWritePath(join(root, 'other', 'x.csv'), opts)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('unauthorized')
  })
  it('guardWritePath 对未授权路径抛错', () => {
    expect(() => guardWritePath(join(root, 'other', 'x.csv'), opts)).toThrow(/未授权/)
  })
  it('目录不存在的允许根也能正确比较（纯字符串前缀）', () => {
    const v = validateWritePath(join(sourceDir, 'x.csv'), { allowedRoots: [join(root, 'no-such-dir')] })
    expect(v.ok).toBe(false)
  })
  it('dirname 语义：home 根下两级目录仍允许', () => {
    // 与 isSensitiveWritePath 行为一致：~/a/b.csv 允许（dirname 为 ~/a）
    expect(dirname(join(HOME, 'a', 'b.csv'))).toBe(join(HOME, 'a'))
    expect(isSensitiveWritePath(join(HOME, 'a', 'b.csv'))).toBe(false)
  })
})
