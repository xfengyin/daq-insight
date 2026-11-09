/**
 * src/shared/units.ts — 测量类型中文映射与通用格式化（T10）
 * 通道类型 → 中文名；时间戳毫秒 → 可读字符串；数值显示辅助。
 */
import { MeasurementType } from '../../core/models'

/** 测量类型 → 中文名称 */
export const MEASUREMENT_TYPE_LABELS: Record<MeasurementType, string> = {
  [MeasurementType.DC_VOLTAGE]: '直流电压',
  [MeasurementType.AC_VOLTAGE]: '交流电压',
  [MeasurementType.DC_CURRENT]: '直流电流',
  [MeasurementType.AC_CURRENT]: '交流电流',
  [MeasurementType.TEMPERATURE_TC]: '热电偶温度',
  [MeasurementType.TEMPERATURE_RTD]: 'RTD 温度',
  [MeasurementType.RESISTANCE_2W]: '电阻 2 线',
  [MeasurementType.RESISTANCE_4W]: '电阻 4 线',
  [MeasurementType.FREQUENCY]: '频率',
  [MeasurementType.PERIOD]: '周期',
  [MeasurementType.UNKNOWN]: '未知'
}

/** 测量类型 → 中文名（未知回退） */
export function measurementLabel(t: MeasurementType | undefined | null): string {
  if (t == null) return '未知'
  return MEASUREMENT_TYPE_LABELS[t] ?? '未知'
}

/**
 * 时间戳（Unix 毫秒）→ "YYYY-MM-DD HH:mm:ss.SSS"；空值返回 '--'
 *
 * 用 UTC 取值，和 core/parsing/converter.ts 的 parseTimestamp 保持同一口径：
 * 那里对无时区的日期串走 `Date.UTC`（并已有单测钉住
 * `parseTimestamp('2024-01-15 10:30:00.123') === Date.UTC(...)`）。
 *
 * 之前这里用 getFullYear/getHours 等**本地**取值。在 UTC 的 CI 机器上两者恰好相等，
 * 所以测试一直是绿的；但在 +08:00 的机器上，文件里写的 `10:30:00.123` 会显示成
 * `18:30:00.123` —— 数据的时刻被整体平移了 8 小时。仪器导出的时间戳是墙钟时间，
 * 显示必须与文件里一致，一进一出应当是恒等变换。
 */
export function formatTimestamp(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '--'
  const d = new Date(ms)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  const base = p(d.getUTCFullYear(), 4) + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds())
  return base + '.' + p(d.getUTCMilliseconds(), 3)
}

/** 数值格式化：NaN/null → '--'（由调用方决定样式），有限数返回字符串 */
export function formatValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '--'
  return String(v)
}

/** 文件大小格式化（FileDrop 复用） */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return v.toFixed(u === 0 ? 0 : 1) + ' ' + units[u]
}
