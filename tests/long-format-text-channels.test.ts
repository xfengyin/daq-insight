import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from '../core/parsing/parser';
import { FileFormat, type RawFile } from '../core/models';

// 长格式（BenchVue 导出）的 Channel 列不一定是纯数字，也可能是 "CH101" 这样的文本标签。
// 原来直接 Number(该列)：文本标签得到 NaN，所有行挤进同一个 NaN 桶，
// 输出只剩「一个通道」，且每个时间点只保留最后写入的值。
let dir = '';
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'daq-long-')) });
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) });

const CSV = [
  '"Keysight Technologies,34970A Data Acquisition System"',
  '"Log File Created: 2024-01-15 10:30:00"',
  'Channel,Reading,Unit,Timestamp',
  'CH101,5.0E+00,VDC,2024-01-15 10:30:00.000',
  'CH102,2.5E+01,degC,2024-01-15 10:30:00.000',
  'CH101,6.0E+00,VDC,2024-01-15 10:30:01.000',
  'CH102,2.6E+01,degC,2024-01-15 10:30:01.000'
].join('\n');

function rawFor(path: string): RawFile {
  return {
    path,
    format: FileFormat.CSV,
    encoding: 'utf-8',
    delimiter: ',',
    decimal: '.',
    headerRows: 1,
    sampleRows: [],
    layout: 'long',
    preambleLines: 2
  };
}

describe('长格式：文本通道标签', () => {
  it('CH101 / CH102 各自成为独立通道，值不互相覆盖', async () => {
    const p = join(dir, 'text-channels.csv');
    writeFileSync(p, CSV, 'utf-8');
    const data = await parseFile(p, rawFor(p), []);

    expect(data.channels.map((c) => c.def.name)).toEqual(['CH101', 'CH102']);
    expect(data.channels[0].values).toEqual([5, 6]);       // 改前：只有一个名为 CHNaN 的通道
    expect(data.channels[1].values).toEqual([25, 26]);
    expect(data.channels[0].def.channelNumber).toBe(101);  // 仍然是识别出的仪器通道号
    expect(data.channels[1].def.channelNumber).toBe(102);
  });

  it('纯数字标签仍然按数字分组（原有行为不变）', async () => {
    const p = join(dir, 'numeric-channels.csv');
    writeFileSync(p, [
      'Channel,Reading,Unit,Timestamp',
      '101,5.0E+00,VDC,2024-01-15 10:30:00.000',
      '102,2.5E+01,degC,2024-01-15 10:30:00.000',
      '101,6.0E+00,VDC,2024-01-15 10:30:01.000'
    ].join('\n'), 'utf-8');
    const data = await parseFile(p, rawFor(p), []);
    expect(data.channels.map((c) => c.def.channelNumber)).toEqual([101, 102]);
    expect(data.channels[0].values).toEqual([5, 6]);
    expect(data.channels[1].values[0]).toBe(25);
  });
});
