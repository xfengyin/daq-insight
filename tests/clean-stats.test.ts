import { describe, it, expect } from 'vitest';
import { clean } from '../core/cleaning/cleaner';
import { computeChannelStats } from '../core/analysis/statistics';
import { MeasurementType, QualityFlag, type ChannelData, type StandardizedData } from '../core/models';

// 清洗会改数据，但 data.statistics 是**输入的**统计快照。
// 如果不清洗后重算，导出的 xlsx 里「数据」sheet 是清洗后的、「统计摘要」sheet 是清洗前的——
// 同一份文件两张表互相矛盾，而且都长得像对的。
function makeData(values: number[], quality?: QualityFlag[]): StandardizedData {
  const q = quality ?? values.map((v) => (Number.isFinite(v) ? QualityFlag.GOOD : QualityFlag.MISSING))
  const ch: ChannelData = {
    def: {
      index: 0, name: 'CH1', channelNumber: 1,
      measurementType: MeasurementType.DC_VOLTAGE, unit: 'V',
      isTimestamp: false, isValid: true
    },
    values: [...values],
    timestamps: values.map((_, i) => i * 1000),
    quality: [...q]
  }
  const data: StandardizedData = {
    metadata: { source: 'x', encoding: 'utf-8', delimiter: ',', headerRows: 1, layout: 'wide', rowCount: values.length },
    timeIndex: values.map((_, i) => i * 1000),
    channels: [ch]
  }
  data.statistics = { 0: computeChannelStats(ch.values, ch.quality) }
  return data
}

describe('clean 之后统计必须跟着数据走', () => {
  it('drop 掉缺失行后，统计的 count 与数据长度一致', () => {
    const input = makeData([1, NaN, 3, NaN, 5])
    expect(input.statistics![0].count).toBe(3)

    const out = clean(input, { missing: 'drop', outlier: 'none', dedupeTimestamps: false })
    expect(out.channels[0].values).toEqual([1, 3, 5])
    expect(out.statistics![0].count).toBe(3)
    expect(out.statistics![0].mean).toBeCloseTo(3, 10)
  })

  it('去掉异常值后，均值/标准差按剩下的点算（不是清洗前的）', () => {
    // 100 是明显的离群点
    const input = makeData([1, 2, 3, 4, 100])
    const before = input.statistics![0].mean

    const out = clean(input, { missing: 'none', outlier: 'zscore', outlierThreshold: 1.5, dedupeTimestamps: false })
    expect(out.channels[0].values.filter(Number.isFinite).length).toBeLessThan(5)
    const after = out.statistics![0].mean
    expect(after).not.toBeCloseTo(before, 6)          // 真的变了
    expect(after).toBeCloseTo(
      computeChannelStats(out.channels[0].values, out.channels[0].quality).mean, 10
    )                                                  // 且与数据一致
  })

  it('不改动输入对象的 statistics（clean 返回新对象）', () => {
    const input = makeData([1, NaN, 3])
    const snapshot = JSON.stringify(input.statistics)
    clean(input, { missing: 'drop', outlier: 'none', dedupeTimestamps: false })
    expect(JSON.stringify(input.statistics)).toBe(snapshot)
  })
});
