import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { decideEncoding, detectEncoding } from '../core/detection/encoding';
import { readText } from '../core/parsing/parser';

let dir = '';
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'daq-enc-')) });
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) });

/** Node 的 Buffer 不支持 utf32le，手工拼（每字符 4 字节小端） */
function utf32leBytes(str: string): Buffer {
  const out: number[] = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0;
    out.push(cp & 0xff, (cp >>> 8) & 0xff, (cp >>> 16) & 0xff, (cp >>> 24) & 0xff);
  }
  return Buffer.from(out);
}

describe('编码探测与解码', () => {
  it('低置信度退回 utf-8 时不虚报置信度', () => {
    // 原实现返回 Math.max(confidence, 0.2)：把「我猜的」包装成「检测到 20%」
    expect(decideEncoding('GB2312', 0.1)).toEqual({ encoding: 'utf-8', confidence: 0.1 });
    expect(decideEncoding('GB2312', 0)).toEqual({ encoding: 'utf-8', confidence: 0 });
    // 置信度够高时才采信检测结果
    expect(decideEncoding('GB2312', 0.9)).toEqual({ encoding: 'gbk', confidence: 0.9 });
    expect(decideEncoding('UTF-16LE', 0.8)).toEqual({ encoding: 'utf-16le', confidence: 0.8 });
    // 缺字段按 0 处理，不退化成 NaN 置信度
    expect(decideEncoding('', NaN)).toEqual({ encoding: 'utf-8', confidence: 0 });
  });

  it('UTF-32LE 有 BOM：能探出来，但解码要明确报错而不是当 UTF-8 解', async () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x00]), utf32leBytes('Time,Value')]);
    expect(detectEncoding(buf).encoding).toBe('utf-32le');

    const p = join(dir, 'utf32.csv');
    writeFileSync(p, buf);
    await expect(readText(p, 'utf-32le')).rejects.toThrow(/不支持 UTF-32/);
  });

  it('GBK 中文样本仍然正常解码（别把老功能修坏）', async () => {
    const p = join(dir, 'gbk.csv');
    writeFileSync(p, iconv.encode('通道,读数\n通道1,1.5', 'gbk'));
    const text = await readText(p, 'gbk');
    expect(text).toContain('通道');
    expect(text).toContain('1.5');
  });

  it('UTF-8 BOM 会被去掉（否则首个表头单元格带 BOM）', async () => {
    const p = join(dir, 'bom.csv');
    writeFileSync(p, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Time,Value', 'utf8')]));
    expect((await readText(p, 'utf-8')).startsWith('Time')).toBe(true);
  });
});
