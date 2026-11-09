import { describe, it, expect } from 'vitest';
import { analyze } from '../core/analysis/engine';
import { MeasurementType, QualityFlag, type ChannelData, type StandardizedData } from '../core/models';

// 时间戳不保证单调：把两次采样的日志拼起来、或长格式文件按通道分组输出，时间就会往回走。
// 原来的「末项减首项」会算出**负数时长**，采样率也会因为反向间隔被滤掉而变成 0。
function makeData(times: number[]): StandardizedData {
  const def = {
    index: 0, name: 'CH1', channelNumber: 1,
    measurementType: MeasurementType.DC_VOLTAGE, unit: 'V',
    isTimestamp: false, isValid: true
  };
  const ch: ChannelData = {
    def,
    values: times.map(() => 1),
    timestamps: times,
    quality: times.map(() => QualityFlag.GOOD)
  };
  return {
    metadata: { source: 'x', encoding: 'utf-8', delimiter: ',', headerRows: 1, layout: 'wide', rowCount: times.length },
    timeIndex: times,
    channels: [ch]
  };
}

describe('analyze：时间轴乱序', () => {
  it('单调数据：跨度 = 末项 - 首项', () => {
    const r = analyze(makeData([0, 100, 200, 300, 400]));   // 100ms 间隔 → 10Hz
    expect(r.durationMs).toBe(400);
    expect(r.sampleRateHz).toBeCloseTo(10, 6);
  });

  it('两段日志拼接（时间往回走）：跨度为真跨度，不是负数', () => {
    // 0..300 一段，然后又从 0 开始的一段（拼接文件）
    const r = analyze(makeData([0, 100, 200, 300, 0, 100, 200, 300]));
    expect(r.durationMs).toBe(300);          // 改前：300 - 0 ... 末项是 300，恰好也是 300
    expect(r.sampleRateHz).toBeCloseTo(10, 6);
  });

  it('真正的乱序（末项最小）：跨度仍为正', () => {
    const r = analyze(makeData([300, 200, 100, 0]));
    expect(r.durationMs).toBe(300);          // 改前：0 - 300 = -300
    expect(r.sampleRateHz).toBeCloseTo(10, 6); // 改前：反向间隔全被滤掉 → 0
  });

  it('含无效时间戳（NaN）：仍能算跨度', () => {
    const r = analyze(makeData([0, 100, NaN, 200]));
    expect(r.durationMs).toBe(200);
    expect(r.sampleRateHz).toBeCloseTo(10, 6);
  });

  it('只有 0 或 1 个有效点：跨度为 0、采样率为 0', () => {
    expect(analyze(makeData([])).durationMs).toBe(0);
    expect(analyze(makeData([5])).durationMs).toBe(0);
    expect(analyze(makeData([5])).sampleRateHz).toBe(0);
  });

  it('大量数据点不爆栈（10 万点）', () => {
    const n = 100000;
    const times = Array.from({ length: n }, (_, i) => i * 10);
    const r = analyze(makeData(times));
    expect(r.durationMs).toBe((n - 1) * 10);
    expect(r.sampleRateHz).toBeCloseTo(100, 6);
  });
});
