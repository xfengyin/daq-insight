import { describe, it, expect } from 'vitest';
import {
  matchUnit,
  matchMeasurementType,
  unitToMeasurementType
} from '../core/identification/identifier';
import { MeasurementType } from '../core/models';

// 本仓不做数值换算：文件写 12.5 mV，读进来还是 12.5。
// 所以单位标签必须与文件一致，否则 1000 倍的差距被一个标签盖住。
describe('matchUnit 保留量级前缀', () => {
  it('带前缀的写法原样返回，而不是折叠成基准单位', () => {
    expect(matchUnit('mV')).toBe('mV');
    expect(matchUnit('V (mV)')).toBe('mV');
    expect(matchUnit('mA')).toBe('mA');
    expect(matchUnit('ms')).toBe('ms');
    expect(matchUnit('kHz')).toBe('kHz');
    expect(matchUnit('MHz')).toBe('MHz');
    expect(matchUnit('kΩ')).toBe('kΩ');
    expect(matchUnit('MΩ')).toBe('MΩ');
    expect(matchUnit('kA')).toBe('kA');
  });

  it('μ 与 ASCII 的 u 都认，统一成 μ', () => {
    expect(matchUnit('μV')).toBe('μV');
    expect(matchUnit('uV')).toBe('μV');
    expect(matchUnit('μA')).toBe('μA');
    expect(matchUnit('uA')).toBe('μA');
  });

  it('基准单位仍是基准单位', () => {
    expect(matchUnit('V')).toBe('V');
    expect(matchUnit('A')).toBe('A');
    expect(matchUnit('Hz')).toBe('Hz');
    expect(matchUnit('s')).toBe('s');
    expect(matchUnit('degC')).toBe('degC');
    expect(matchUnit('ohm')).toBe('Ω');
  });

  it('裸符号也要认得出来（\b 对非 ASCII 不成立）', () => {
    // 这条是这次顺带发现的同类 bug：一列直接叫「Ω」或「℃」时，
    // 原来的 \\b...\\b 一个都匹配不上 —— 电阻列、温度列因此识别不出来。
    expect(matchUnit('Ω')).toBe('Ω');
    expect(matchUnit('℃')).toBe('degC');
    expect(matchUnit('°C')).toBe('degC');
    expect(matchMeasurementType('Ω')).toBe(MeasurementType.RESISTANCE_2W);
    expect(matchMeasurementType('℃')).toBe(MeasurementType.TEMPERATURE_TC);
    expect(unitToMeasurementType('Ω')).toBe(MeasurementType.RESISTANCE_2W);
  });

  it('前缀只改变标签，不改变测量类型', () => {
    // 这是关键：标 mV 的通道仍然要被认成直流电压
    expect(unitToMeasurementType('mV')).toBe(MeasurementType.DC_VOLTAGE);
    expect(unitToMeasurementType('mA')).toBe(MeasurementType.DC_CURRENT);
    expect(unitToMeasurementType('ms')).toBe(MeasurementType.PERIOD);
  });
});
