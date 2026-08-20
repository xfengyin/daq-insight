import { describe, expect, it } from 'vitest'
import { FileFormat, MeasurementType, QualityFlag } from '../core/models'

// 空测试：验证 core/models 共享数据模型可正常导入与编译
describe('core/models 共享数据模型', () => {
  it('基础枚举可从 core/models 正常导入', () => {
    expect(FileFormat.CSV).toBe('csv')
    expect(FileFormat.XLSX).toBe('xlsx')
    expect(MeasurementType.UNKNOWN).toBe('unknown')
    expect(QualityFlag.GOOD).toBe('good')
  })
})
