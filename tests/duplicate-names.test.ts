import { describe, it, expect } from 'vitest';
import { parseHeader } from '../core/parsing/header';

// 表头重名在真实文件里很常见（宽表导出常只写测量功能，不写通道号）。
// 重名不会让解析失败，但会让所有「按名字找通道」的下游失去区分度：
// 图例两行一样、统计摘要只命中第一个、改了一个另一个看着像没改。
describe('宽表：同名通道要可区分', () => {
  it('Volt, Volt, Volt → Volt / Volt (2) / Volt (3)', () => {
    const rows = [
      ['Time', 'Volt', 'Volt', 'Volt'],
      ['2024-01-15 10:30:00', '1.0', '2.0', '3.0']
    ];
    const defs = parseHeader(rows, 1);
    expect(defs.map((d) => d.name)).toEqual(['Time', 'Volt', 'Volt (2)', 'Volt (3)']);
    // 列索引仍是真实列号，不能被改名动过
    expect(defs.map((d) => d.index)).toEqual([0, 1, 2, 3]);
  });

  it('本来就不重名的通道不受影响', () => {
    const rows = [
      ['Time', 'Volt', 'Amp'],
      ['2024-01-15 10:30:00', '1.0', '2.0']
    ];
    expect(parseHeader(rows, 1).map((d) => d.name)).toEqual(['Time', 'Volt', 'Amp']);
  });

  it('后缀不与已有的名字撞车', () => {
    // 文件里本来就有 "Volt (2)" 这一列时，第二个 "Volt" 不能也叫 "Volt (2)"
    const rows = [
      ['Volt', 'Volt', 'Volt (2)'],
      ['1.0', '2.0', '3.0']
    ];
    const names = parseHeader(rows, 1).map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
