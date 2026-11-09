import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportCsv } from '../core/export/exporter';
import { MeasurementType, QualityFlag, type ChannelData, type StandardizedData } from '../core/models';

let dir = '';
const mk = () => { dir = mkdtempSync(join(tmpdir(), 'daq-csv-')) };
const cleanup = () => { if (dir) rmSync(dir, { recursive: true, force: true }) };

function data(names: string[], values: number[]): StandardizedData {
  const chans: ChannelData[] = names.map((name, i) => ({
    def: { index: i, name, channelNumber: i + 1, measurementType: MeasurementType.DC_VOLTAGE, unit: 'V', isTimestamp: false, isValid: true },
    values,
    timestamps: [Date.UTC(2024, 0, 15, 10, 30, 0)],
    quality: values.map(() => QualityFlag.GOOD)
  }));
  return {
    metadata: { source: 'x', encoding: 'utf-8', delimiter: ',', headerRows: 1, layout: 'wide', rowCount: 1 },
    timeIndex: [Date.UTC(2024, 0, 15, 10, 30, 0)],
    channels: chans.filter((_, i) => i < names.length)
  };
}

async function csv(d: StandardizedData): Promise<string> {
  const p = join(dir, 'out.csv');
  await exportCsv(d, p);
  return readFileSync(p, 'utf-8');
}

// 通道名来自仪器文件表头（用户数据）。
// 以 = + @ 或制表/回车开头的单元格会被 Excel 当公式求值，OWASP 的清单里还有 "-"。
// 但 "-" 直接加进字符类会把负数读数变成文本 —— 这里把两种情形分开钉住。
describe('CSV 导出：公式注入防护不能误伤负数', () => {
  it('负数读数仍是数字，不加前缀', async () => {
    mk();
    const out = await csv(data(['CH1'], [-1.5]));
    expect(out).toContain(',-1.5');
    expect(out).not.toContain("'-1.5");
    cleanup();
  });

  it('科学计数法的负数也不加前缀', async () => {
    mk();
    const out = await csv(data(['CH1'], [-1.25e-9]));
    expect(out).toContain(',-1.25e-9');
    cleanup();
  });

  it('以 - 开头的**文本**（表头）要加前缀', async () => {
    mk();
    const out = await csv(data(['-1+2'], [1]));
    expect(out).toContain("'-1+2");
    cleanup();
  });

  it('= + @ 开头的文本照旧加前缀', async () => {
    mk();
    const out = await csv(data(['=SUM(A1)', '+cmd', '@import'], [1, 2, 3]));
    expect(out).toContain("'=SUM(A1)");
    expect(out).toContain("'+cmd");
    expect(out).toContain("'@import");
    cleanup();
  });
});
