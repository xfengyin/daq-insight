/**
 * core/export/exporter.ts — 数据导出模块（T7 完整实现）
 * 导出标准化数据为 CSV（UTF-8 BOM）或 Excel（SheetJS 三表）。
 * 签名保持与 T8 IPC 占位桩一致（ExportOutcome / ExportCsvOptions）。
 */
import { mkdirSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import * as XLSX from 'xlsx'
import type { StandardizedData } from '../models'

/** 导出结果 */
export interface ExportOutcome {
  /** 导出文件绝对路径 */
  path: string
  /** 文件字节数 */
  bytes: number
  /** 导出行数（数据行，不含表头） */
  rows: number
}

/** CSV 导出选项 */
export interface ExportCsvOptions {
  /** 时间戳格式：iso（默认）或 raw（毫秒数值） */
  timestampFormat?: 'iso' | 'raw'
  /** 缺失值（NaN）占位符，默认空串 */
  missingPlaceholder?: string
}

function fmt(v: number, missing: string): string {
  return Number.isNaN(v) || !Number.isFinite(v) ? missing : String(v)
}

/** BUG-1 修复：NaN/非有限时间戳输出占位（不再 new Date(NaN).toISOString() 抛 RangeError） */
function fmtTime(ms: number, mode: 'iso' | 'raw', missing = ''): string {
  if (!Number.isFinite(ms)) return missing
  return mode === 'raw' ? String(ms) : new Date(ms).toISOString()
}

function timeArray(data: StandardizedData): number[] {
  return data.timeIndex ?? data.channels[0]?.timestamps ?? []
}

function toCsvText(data: StandardizedData, opts: ExportCsvOptions): string {
  const mode = opts.timestampFormat ?? 'iso'
  const missing = opts.missingPlaceholder ?? ''
  const header = ['Time', ...data.channels.map(c => (c.def.unit ? c.def.name + ' (' + c.def.unit + ')' : c.def.name))]
  const time = timeArray(data)
  const rows: string[] = [header.join(',')]
  for (let i = 0; i < time.length; i++) {
    const cells = [fmtTime(time[i], mode, missing)]
    for (const ch of data.channels) cells.push(fmt(ch.values[i] ?? NaN, missing))
    rows.push(cells.join(','))
  }
  return '\uFEFF' + rows.join('\n')
}

/** UTF-8 BOM 导出 CSV：首行表头（通道名+单位），之后时间戳+各通道值；NaN → 空 */
export async function exportCsv(data: StandardizedData, path: string, opts?: ExportCsvOptions): Promise<ExportOutcome> {
  mkdirSync(dirname(path), { recursive: true })
  const text = toCsvText(data, opts ?? {})
  await writeFile(path, text, 'utf-8')
  return { path, bytes: statSync(path).size, rows: timeArray(data).length }
}

function sheetData(data: StandardizedData): (string | number)[][] {
  const header = ['Time', ...data.channels.map(c => c.def.name)]
  const time = timeArray(data)
  const rows: (string | number)[][] = [header]
  for (let i = 0; i < time.length; i++) {
    // BUG-1 修复：NaN 时间戳输出空字符串（Excel 单元格），不抛 RangeError
    const row: (string | number)[] = [Number.isFinite(time[i]) ? new Date(time[i]).toISOString() : '']
    for (const ch of data.channels) {
      const v = ch.values[i] ?? NaN
      row.push(Number.isFinite(v) ? v : NaN)
    }
    rows.push(row)
  }
  return rows
}

function sheetChannels(data: StandardizedData): (string | number)[][] {
  const rows: (string | number)[][] = [['名称', '通道号', '测量类型', '单位']]
  for (const ch of data.channels) {
    rows.push([ch.def.name, ch.def.channelNumber ?? '', ch.def.measurementType, ch.def.unit ?? ''])
  }
  return rows
}

function sheetStats(data: StandardizedData): (string | number)[][] | null {
  if (!data.statistics) return null
  const rows: (string | number)[][] = [['通道', '均值', '标准差', '最小值', '最大值', 'RMS', '有效样本', '缺失数', '超量程数']]
  for (const [key, s] of Object.entries(data.statistics)) {
    const ch = data.channels.find(c => String(c.def.index) === key || c.def.name === key)
    rows.push([ch?.def.name ?? key, s.mean, s.std, s.min, s.max, s.rms, s.count, s.missingCount, s.overRangeCount])
  }
  return rows
}

/** SheetJS 生成 .xlsx：Sheet1 数据 / Sheet2 通道定义 / Sheet3 统计摘要 */
export async function exportExcel(data: StandardizedData, path: string): Promise<ExportOutcome> {
  mkdirSync(dirname(path), { recursive: true })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetData(data)), '数据')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetChannels(data)), '通道定义')
  const s3 = sheetStats(data)
  if (s3) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s3), '统计摘要')
  XLSX.writeFile(wb, path)
  return { path, bytes: statSync(path).size, rows: timeArray(data).length }
}
