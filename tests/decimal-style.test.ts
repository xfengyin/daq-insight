import { describe, it, expect } from 'vitest';
import { detectDecimalStyle } from '../core/detection/sniffer';
import { parseValue } from '../core/parsing/converter';
import { QualityFlag } from '../core/models';

// 逗号分隔的文件里，"1,100" 是「两个整数列」，不是「小数逗号」。
// 原实现整行扫 token，把**分隔符**当成了小数点，于是判成欧洲格式；
// 接下来 parseValue 会按「点=千位分隔符」把小数去掉 —— 4.98 变成 498。
describe('detectDecimalStyle 必须先按分隔符切开', () => {
  it('逗号分隔 + 整数列，不能判成欧洲小数逗号', () => {
    const lines = ['Time,Count', '1,100', '2,200', '3,300'];
    expect(detectDecimalStyle(lines, ',')).toBe('.');
  });

  it('逗号分隔 + 浮点列，仍是点小数', () => {
    const lines = ['Time,Value', '1,4.98', '2,5.02'];
    expect(detectDecimalStyle(lines, ',')).toBe('.');
  });

  it('分号分隔 + 欧洲小数逗号，仍能认出来', () => {
    const lines = ['Time;Value', '1;1,5', '2;2,5'];
    expect(detectDecimalStyle(lines, ';')).toBe(',');
  });

  it('制表符分隔不受影响', () => {
    const lines = ['Time\tValue', '1\t1,5', '2\t2,5'];
    expect(detectDecimalStyle(lines, '\t')).toBe(',');
  });

  it('回归：判错风格会把读数放大 100 倍', () => {
    const lines = ['Time,Value', '1,4.98'];
    const style = detectDecimalStyle(lines, ',');
    expect(style).toBe('.');

    // 正确风格：4.98 就是 4.98
    expect(parseValue('4.98', style)).toEqual({ value: 4.98, quality: QualityFlag.GOOD });
    // 误判成欧洲风格时，点被当成千位分隔符去掉了
    expect(parseValue('4.98', ',')).toEqual({ value: 498, quality: QualityFlag.GOOD });
  });
});
