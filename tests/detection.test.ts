/**
 * tests/detection.test.ts — T3 格式侦察引擎单测
 *
 * 以 tests/fixtures/samples/ 下真实样本 + 各 .meta.json 为基准断言：
 * 编码 / 分隔符 / 表头行数 / 小数点风格 / 布局 / preamble 元信息行。
 */
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import { detectFile } from '../core/detection/detector'
import { detectEncoding } from '../core/detection/encoding'
import { detectDelimiter, detectHeaderRows, detectDecimalStyle, splitLine, looksLikeDataRow } from '../core/detection/sniffer'
import type { LayoutType, RawFile } from '../core/models'

const SAMPLES = resolve(__dirname, 'fixtures/samples')

/** 样本 meta 的分隔符词 → 实际字符 */
function delimChar(meta: string): string {
  if (meta === 'tab') return '\t'
  if (meta === 'semicolon') return ';'
  if (meta === 'comma') return ','
  return meta
}

/** 枚举所有样本文件（排除 meta 与生成脚本） */
function listSamples(): string[] {
  return readdirSync(SAMPLES)
    .filter(f => !f.endsWith('.meta.json') && /\.[a-z]+$/.test(f) && !f.includes('generator'))
    .sort()
}

describe('T3 格式侦察引擎 — 真实样本逐一断言（以 .meta.json 为基准）', () => {
  for (const file of listSamples()) {
    it(`detectFile: ${file} 与 meta 一致`, async () => {
      const meta = JSON.parse(readFileSync(resolve(SAMPLES, file + '.meta.json'), 'utf-8'))
      const res = await detectFile(resolve(SAMPLES, file))
      expect(res.raw.encoding, '编码').toBe(meta.encoding)
      expect(res.raw.delimiter, '分隔符').toBe(delimChar(meta.delimiter))
      expect(res.raw.headerRows, '表头行数').toBe(meta.headerRows)
      expect(res.raw.decimal, '小数点').toBe(meta.decimalSeparator)
      // 布局 / preamble（meta 未声明时用默认）
      if (meta.layout) expect(res.raw.layout, '布局').toBe(meta.layout as LayoutType)
      if (typeof meta.preambleLines === 'number') expect(res.raw.preambleLines, 'preamble 行数').toBe(meta.preambleLines)
      // 关键样本附加断言
      expect(res.raw.format).toBeDefined()
      expect(res.raw.sampleRows.length).toBeGreaterThan(0)
      expect(res.raw.path).toBe(resolve(SAMPLES, file))
    })
  }
})

describe('detectEncoding 边界', () => {
  it('空 Buffer → utf-8', () => {
    expect(detectEncoding(Buffer.alloc(0)).encoding).toBe('utf-8')
  })
  it('UTF-8 BOM 识别', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b\n1,2')])
    expect(detectEncoding(buf).encoding).toBe('utf-8')
    expect(detectEncoding(buf).confidence).toBe(1)
  })
  it('UTF-16LE BOM 识别', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a,b\n1,2', 'utf16le')])
    expect(detectEncoding(buf).encoding).toBe('utf-16le')
  })
  it('纯 ASCII → utf-8（ASCII 是 UTF-8 子集）', () => {
    expect(detectEncoding(Buffer.from('hello,world\n1,2\n')).encoding).toBe('utf-8')
  })
  it('GBK 中文样本识别为 gbk', () => {
    const buf = readFileSync(resolve(SAMPLES, 'gbk_sample.csv'))
    expect(detectEncoding(buf).encoding).toBe('gbk')
  })
})

describe('sniffer 单元函数', () => {
  it('splitLine 保留引号内分隔符', () => {
    expect(splitLine('"Ch102 (TC,K)",1,2', ',')).toEqual(['Ch102 (TC,K)', '1', '2'])
    expect(splitLine('a,"b""c",d', ',')).toEqual(['a', 'b"c', 'd'])
  })
  it('looksLikeDataRow 识别数值/时间戳/特殊值', () => {
    expect(looksLikeDataRow('2024-01-15 10:30:00.000,5.00910,24.825,25.270,50.088', ',')).toBe(true)
    expect(looksLikeDataRow('101,5.004551433E+00,VDC,2024-01-15 10:30:00.000', ',')).toBe(true)
    expect(looksLikeDataRow('CH101,4.98468,V', ',')).toBe(true) // 长格式数据行
    expect(looksLikeDataRow('2024-01-15 10:30:00.000,OVER,24.912,25.011,', ',')).toBe(true)
    expect(looksLikeDataRow('Time,CH101,CH102,CH103,CH104', ',')).toBe(false)
    expect(looksLikeDataRow(',DCV,TC Type K,RTD PT100,FREQ', ',')).toBe(false)
  })
  it('detectDelimiter 处理引号与一致列数', () => {
    expect(detectDelimiter(['a,"b,c",d', '1,2,3', '4,5,6'])).toBe(',')
    expect(detectDelimiter(['a;b;c', '1;2;3', '4;5;6'])).toBe(';')
    expect(detectDelimiter(['a\tb\tc', '1\t2\t3'])).toBe('\t')
  })
  it('detectHeaderRows 无表头 → 0', () => {
    expect(detectHeaderRows(['2024-01-15 10:30:00.000,4.98605,24.806,25.170,50.056'], ',')).toBe(0)
  })
  it('detectDecimalStyle 欧洲逗号', () => {
    expect(detectDecimalStyle(['15.01.2024 10:30:00;5,01088;25,096;25,099;50,061'])).toBe(',')
    expect(detectDecimalStyle(['2024-01-15 10:30:00.000,5.00910,24.825,25.270,50.088'])).toBe('.')
  })
})

describe('detectFile 结构完整性', () => {
  it('standard.csv（long 布局）返回正确 RawFile 结构', async () => {
    const res = await detectFile(resolve(SAMPLES, 'standard.csv'))
    const raw: RawFile = res.raw
    expect(raw.layout).toBe('long')
    expect(raw.preambleLines).toBe(2)
    expect(raw.headerRows).toBe(1)
    expect(raw.sampleRows.length).toBeLessThanOrEqual(50)
    // 引号元信息行应在 sampleRows 中保留
    expect(raw.sampleRows[0][0]).toContain('Keysight Technologies')
    expect(res.confidence.encoding).toBeGreaterThan(0)
    expect(Array.isArray(res.notes)).toBe(true)
  })
  it('scan_format.csv 布局为 scan', async () => {
    const res = await detectFile(resolve(SAMPLES, 'scan_format.csv'))
    expect(res.raw.layout).toBe('scan')
    expect(res.raw.headerRows).toBe(1)
  })
  it('large.csv 大样本侦察耗时可控（< 2s）', async () => {
    const t0 = Date.now()
    await detectFile(resolve(SAMPLES, 'large.csv'))
    expect(Date.now() - t0).toBeLessThan(2000)
  })
  it('不存在的文件 → 明确报错', async () => {
    await expect(detectFile(resolve(SAMPLES, 'no-such-file.csv'))).rejects.toThrow()
  })
})
