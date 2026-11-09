import { describe, it, expect } from 'vitest';
import { extractChannelNumber, matchMeasurementType } from '../core/identification/identifier';
import { MeasurementType } from '../core/models';

// 同一类 bug 的另一半：\b 对非 ASCII 不成立。
// 上一轮修了单位表，这一轮补上「类型表」与「通道号」两处。
describe('非 ASCII 边界', () => {
  it('一列直接叫「Ω」要被认成 2W 电阻（不是靠单位兜底，而是类型表本身）', () => {
    expect(matchMeasurementType('Ω')).toBe(MeasurementType.RESISTANCE_2W);
    expect(matchMeasurementType('kΩ')).toBe(MeasurementType.RESISTANCE_2W);
    expect(matchMeasurementType('ohm')).toBe(MeasurementType.RESISTANCE_2W);
  });

  it('中文通道号「通道101」要能提取（文档里写着支持，此前实际不成立）', () => {
    expect(extractChannelNumber('通道101')).toBe(101);
    expect(extractChannelNumber('通道 7')).toBe(7);
    // ASCII 写法不受影响
    expect(extractChannelNumber('CH101')).toBe(101);
    expect(extractChannelNumber('Channel 102')).toBe(102);
  });
});
