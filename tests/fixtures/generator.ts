/**
 * DAQ970A 导出文件模拟样本生成器
 * ==============================
 *
 * 用途：为解析引擎（T3 格式侦察 / T4 表头与通道识别 / T5 数据解析）生成
 *       多种真实世界格式变体的 DAQ970A 导出样本，并附带 .meta.json
 *       元数据（期望编码/分隔符/表头行数/通道数/类型），供测试断言使用。
 *
 * 运行方式（任选其一）：
 *   npm run gen:fixtures
 *   node tests/fixtures/generator.ts          # Node.js ≥ 23.6（原生 TS type stripping）
 *   npx tsx tests/fixtures/generator.ts
 *
 * 生成物：tests/fixtures/samples/ 下每个样本文件 + 同名 .meta.json
 *
 * 运行时 API（供测试/其他模块导入，无需落盘即可拿到内容）：
 *   import { generateStandard, generateAll, allMeta, writeSamples, ... } from './generator'
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 本文件所在目录（ESM 下的 __dirname 替代） */
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// 类型定义
// ============================================================================

/** 样本元数据：与 .meta.json 结构一致，供测试断言使用 */
export interface SampleMeta {
  /** 样本文件名（不含路径） */
  name: string;
  /** 文件编码：utf-8 | gbk */
  encoding: 'utf-8' | 'gbk';
  /** 分隔符描述：comma | semicolon | tab */
  delimiter: 'comma' | 'semicolon' | 'tab';
  /** 表头行数（不包含可选设备行；no_header 为 0） */
  headerRows: number;
  /** 数据通道数（不含时间戳列） */
  channelCount: number;
  /** 各通道测量类型（按列顺序，不含时间戳列） */
  channelTypes: string[];
  /** 各通道单位（按列顺序，不含时间戳列；无单位时为空串） */
  units: string[];
  /** 数据行数 */
  rowCount: number;
  /** 时间戳格式说明（无时间戳列时为 null） */
  timestampFormat: string | null;
  /** 小数点分隔符：. | , */
  decimalSeparator: '.' | ',';
  /** 数据布局：wide=时间戳+各通道列；long=通道/读数/单位/时间戳（一通道一行）；scan=扫描序号+时间戳+各通道列；缺省为 wide */
  layout?: 'wide' | 'long' | 'scan';
  /** 表头之前的元信息行数（如引号包裹的设备行/日志行） */
  preambleLines?: number;
  /** 数值是否科学计数法（如 1.234567890E+00） */
  scientific?: boolean;
  /** 表头列名是否双引号包裹 */
  headerQuoted?: boolean;
  /** 单行表头是否内嵌类型信息（english_header 专用） */
  headerEmbedsTypes?: boolean;
  /** 表头中是否存在嵌入逗号（english_header 专用陷阱，引号内） */
  headerHasEmbeddedComma?: boolean;
  /** dirty.csv 的脏数据说明 */
  issues?: string[];
  /** 其他说明 */
  notes?: string;
}

/** 样本内容：UTF-8 时是字符串，GBK 时是字节 Buffer */
export interface SampleFile {
  name: string;
  content: string | Buffer;
  meta: SampleMeta;
}

// ============================================================================
// 常量与工具
// ============================================================================

/** 可选设备行（Keysight 导出文件常见首行） */
export const DEVICE_LINE = 'Keysight Technologies,34970A/DAQ970A Data Logger';

/** 标准 CSV 时间戳起点 */
export const BASE_TIME = new Date('2024-01-15T10:30:00.000+08:00');
/** 采样间隔（毫秒） */
export const SAMPLE_INTERVAL_MS = 100;

/**
 * 确定性伪随机数生成器（mulberry32），保证每次重新生成结果一致，
 * 便于测试断言与回归。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 整数填充：'7' -> '007' */
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** 生成 "2024-01-15 10:30:00.123" 格式时间戳（本地时区语义，固定 +08:00） */
export function fmtTimestamp(d: Date, withMillis = true): string {
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1, 2);
  const da = pad(d.getDate(), 2);
  const h = pad(d.getHours(), 2);
  const mi = pad(d.getMinutes(), 2);
  const s = pad(d.getSeconds(), 2);
  return withMillis ? `${y}-${mo}-${da} ${h}:${mi}:${s}.${pad(d.getMilliseconds(), 3)}` : `${y}-${mo}-${da} ${h}:${mi}:${s}`;
}

/** 生成 "15.01.2024 10:30:00"（DD.MM.YYYY）格式时间戳 */
export function fmtTimestampEuro(d: Date): string {
  const da = pad(d.getDate(), 2);
  const mo = pad(d.getMonth() + 1, 2);
  const y = d.getFullYear();
  const h = pad(d.getHours(), 2);
  const mi = pad(d.getMinutes(), 2);
  const s = pad(d.getSeconds(), 2);
  return `${da}.${mo}.${y} ${h}:${mi}:${s}`;
}

/** 按索引生成时间戳（起点 BASE_TIME，间隔 SAMPLE_INTERVAL_MS） */
export function timestampAt(i: number, withMillis = true): string {
  return fmtTimestamp(new Date(BASE_TIME.getTime() + i * SAMPLE_INTERVAL_MS), withMillis);
}

/** 生成模拟通道值：按测量类型返回带小数的数字字符串 */
export function genValue(type: string, t: number, rnd: () => number, decimals = 3): string {
  const n = (v: number) => v.toFixed(decimals);
  switch (type) {
    case 'DCV':
      return n(5 + Math.sin(t / 10) * 0.5 + (rnd() - 0.5) * 0.04);
    case 'ACV':
      return n(220 + Math.sin(t / 8) * 3 + (rnd() - 0.5) * 1.2);
    case 'TC Type K':
      return n(25 + Math.sin(t / 7) * 2 + (rnd() - 0.5) * 0.6);
    case 'RTD PT100':
      return n(25.2 + Math.sin(t / 9) * 1.5 + (rnd() - 0.5) * 0.4);
    case 'FREQ':
      return n(50 + Math.sin(t / 5) * 0.5 + (rnd() - 0.5) * 0.2);
    default:
      return n(10 + (rnd() - 0.5) * 5);
  }
}

/** 科学计数法格式化：1.23456789 -> "1.234567890E+00"（大写 E，指数带符号两位） */
export function sci(v: number, decimals = 9): string {
  const [m, e] = v.toExponential(decimals).split('e');
  const sign = e.startsWith('-') ? '-' : '+';
  const exp = Math.abs(parseInt(e, 10)).toString().padStart(2, '0');
  return `${m}E${sign}${exp}`;
}

// ============================================================================
// GBK 编码（自包含实现，无需外部依赖）
// ============================================================================

/**
 * 本生成器用到的中文字符 → GBK 双字节编码（大写十六进制）。
 * 扩展字符时请用 `python3 -c "print('字'.encode('gbk').hex())"` 计算后补充。
 */
const GBK_MAP: Record<string, string> = {
  通: 'CDA8', 道: 'B5C0', 读: 'B6C1', 数: 'CAFD', 单: 'B5A5', 位: 'CEBB',
  时: 'CAB1', 间: 'BCE4', 电: 'B5E7', 压: 'D1B9', 频: 'C6B5', 率: 'C2CA',
  温: 'CEC2', 度: 'B6C8', 阻: 'D7E8', 抗: 'BFB9', 值: 'D6B5', 类: 'C0E0',
  型: 'D0CD', 传: 'B4AB', 感: 'B8D0', 器: 'C6F7', 测: 'B2E2', 量: 'C1BF',
};

/** 将字符串编码为 GBK 字节（ASCII 原样，中文字符查表，其余抛错） */
export function encodeGbk(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      bytes.push(code);
    } else {
      const hex = GBK_MAP[ch];
      if (!hex) {
        throw new Error(`encodeGbk: 缺少字符 "${ch}" (U+${code.toString(16).toUpperCase()}) 的 GBK 映射`);
      }
      bytes.push(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16));
    }
  }
  return Buffer.from(bytes);
}

// ============================================================================
// 标准 3 行表头构建
// ============================================================================

/** 标准多行表头：通道号行 / 类型行 / 单位行（含时间戳列占位） */
export function buildStandardHeader(
  channels: string[],
  types: string[],
  units: string[],
  delim: string,
): string {
  const r1 = ['Time', ...channels].join(delim);
  const r2 = ['', ...types].join(delim);
  const r3 = ['', ...units].join(delim);
  return [r1, r2, r3].join('\n');
}

// ============================================================================
// 各样本内容生成函数（导出，供运行时调用）
// ============================================================================

/** 1. standard.csv：格式1（BenchVue/PathWave 导出）：2 行引号元信息 + 表头 Channel,Reading,Unit,Timestamp + 科学计数法，长格式 4 通道 × 75 扫描 = 300 行 */
export function generateStandard(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 300; // 总行数 = 扫描数 × 通道数
  const scans = Math.ceil(rows / 4);
  const rnd = mulberry32(opts.seed ?? 20240115);
  const channels = [
    { id: '101', type: 'DCV', unit: 'VDC', base: 5, amp: 0.5 },
    { id: '102', type: 'TC Type K', unit: 'degC', base: 25, amp: 2 },
    { id: '103', type: 'RTD PT100', unit: 'degC', base: 25.2, amp: 1.5 },
    { id: '104', type: 'FREQ', unit: 'HZ', base: 50, amp: 0.5 },
  ];
  const lines: string[] = [
    '"Keysight Technologies,34970A Data Acquisition System"',
    '"Log File Created: 2024-01-15 10:30:00"',
    'Channel,Reading,Unit,Timestamp',
  ];
  for (let s = 0; s < scans; s++) {
    const ts = fmtTimestamp(new Date(BASE_TIME.getTime() + s * SAMPLE_INTERVAL_MS), true);
    for (const ch of channels) {
      if (lines.length - 3 >= rows) break;
      const v = ch.base + Math.sin(s / 10) * ch.amp + (rnd() - 0.5) * ch.amp * 0.04;
      lines.push(`${ch.id},${sci(v, 9)},${ch.unit},${ts}`);
    }
  }
  return {
    name: 'standard.csv',
    content: lines.join('\n'),
    meta: {
      name: 'standard.csv',
      encoding: 'utf-8',
      delimiter: 'comma',
      headerRows: 1,
      preambleLines: 2,
      layout: 'long',
      channelCount: 4,
      channelTypes: channels.map((c) => c.type),
      units: channels.map((c) => c.unit),
      rowCount: rows,
      timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
      decimalSeparator: '.',
      scientific: true,
      notes: '格式1（BenchVue 导出）：2 行引号元信息（设备行/日志行）+ 表头 Channel,Reading,Unit,Timestamp；长格式（每通道一行），科学计数法；4 通道 × 75 扫描，同扫描各行共享时间戳',
    },
  };
}

/** 2. semicolon.tsv：分号分隔（扩展名 .tsv 但内容为分号分隔），3 行表头 */
export function generateSemicolon(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 300;
  const rnd = mulberry32(opts.seed ?? 20240201);
  const channels = ['CH201', 'CH202', 'CH203', 'CH204'];
  const types = ['DCV', 'TC Type K', 'RTD PT100', 'FREQ'];
  const units = ['V', 'degC', 'degC', 'Hz'];
  const header = buildStandardHeader(channels, types, units, ';');
  const data: string[] = [];
  for (let i = 0; i < rows; i++) {
    const vals = types.map((t, c) => genValue(t, i, rnd, c === 0 ? 5 : 3));
    data.push([timestampAt(i), ...vals].join(';'));
  }
  return {
    name: 'semicolon.tsv',
    content: [header, ...data].join('\n'),
    meta: {
      name: 'semicolon.tsv',
      encoding: 'utf-8',
      delimiter: 'semicolon',
      headerRows: 3,
      channelCount: 4,
      channelTypes: types,
      units,
      rowCount: rows,
      timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
      decimalSeparator: '.',
      notes: '文件名为 .tsv 但实际分隔符为分号（模拟命名与内容不一致的真实文件）',
    },
  };
}

/** 3. tab.txt：制表符分隔，3 行表头 */
export function generateTab(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 300;
  const rnd = mulberry32(opts.seed ?? 20240301);
  const channels = ['CH301', 'CH302', 'CH303', 'CH304'];
  const types = ['DCV', 'TC Type K', 'RTD PT100', 'FREQ'];
  const units = ['V', 'degC', 'degC', 'Hz'];
  const header = buildStandardHeader(channels, types, units, '\t');
  const data: string[] = [];
  for (let i = 0; i < rows; i++) {
    const vals = types.map((t, c) => genValue(t, i, rnd, c === 0 ? 5 : 3));
    data.push([timestampAt(i), ...vals].join('\t'));
  }
  return {
    name: 'tab.txt',
    content: [header, ...data].join('\n'),
    meta: {
      name: 'tab.txt',
      encoding: 'utf-8',
      delimiter: 'tab',
      headerRows: 3,
      channelCount: 4,
      channelTypes: types,
      units,
      rowCount: rows,
      timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
      decimalSeparator: '.',
      notes: '制表符分隔，扩展名为 .txt（模拟扩展名与内容不符）',
    },
  };
}

/** 4. gbk_sample.csv：GBK 编码，单行中文表头 通道,读数,单位 */
export function generateGbk(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 50;
  const rnd = mulberry32(opts.seed ?? 20240401);
  const header = '通道,读数,单位';
  const data: string[] = [];
  for (let i = 0; i < rows; i++) {
    const ch = `CH10${(i % 9) + 1}`;
    const val = (5 + Math.sin(i / 10) * 0.5 + (rnd() - 0.5) * 0.04).toFixed(5);
    data.push(`${ch},${val},V`);
  }
  // 通道号循环 CH101..CH109（9 个唯一通道），共 rows 行数据
  const uniqueCount = 9;
  return {
    name: 'gbk_sample.csv',
    content: encodeGbk([header, ...data].join('\n')),
    meta: {
      name: 'gbk_sample.csv',
      encoding: 'gbk',
      delimiter: 'comma',
      headerRows: 1,
      preambleLines: 0,
      layout: 'long',
      channelCount: uniqueCount,
      channelTypes: Array.from({ length: uniqueCount }, () => 'DCV'),
      units: Array.from({ length: uniqueCount }, () => 'V'),
      rowCount: rows,
      timestampFormat: null,
      decimalSeparator: '.',
      notes: `GBK 编码（非 UTF-8），单行中文表头 通道,读数,单位；长格式（每行一个通道读数），通道号循环 CH101-CH109（9 个唯一通道），共 ${rows} 行数据，无时间戳列`,
    },
  };
}

/** 5. euro_decimal.csv：小数点为逗号、分号分隔、DD.MM.YYYY 时间戳 */
export function generateEuroDecimal(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 100;
  const rnd = mulberry32(opts.seed ?? 20240501);
  const channels = ['CH401', 'CH402', 'CH403', 'CH404'];
  const types = ['DCV', 'TC Type K', 'RTD PT100', 'FREQ'];
  const units = ['V', 'degC', 'degC', 'Hz'];
  const header = buildStandardHeader(channels, types, units, ';');
  const data: string[] = [];
  for (let i = 0; i < rows; i++) {
    const vals = types.map((t, c) => {
      const v = genValue(t, i, rnd, c === 0 ? 5 : 3);
      return v.replace('.', ','); // 小数点转逗号
    });
    data.push([fmtTimestampEuro(new Date(BASE_TIME.getTime() + i * 1000)), ...vals].join(';'));
  }
  return {
    name: 'euro_decimal.csv',
    content: [header, ...data].join('\n'),
    meta: {
      name: 'euro_decimal.csv',
      encoding: 'utf-8',
      delimiter: 'semicolon',
      headerRows: 3,
      channelCount: 4,
      channelTypes: types,
      units,
      rowCount: rows,
      timestampFormat: 'DD.MM.YYYY HH:mm:ss',
      decimalSeparator: ',',
      notes: '欧式格式：小数点为逗号，分号分隔，日期 DD.MM.YYYY',
    },
  };
}

/** 6. special_values.csv：包含 OVER/UNDER/OPEN/SHORT/空白 等特殊值 */
export function generateSpecialValues(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 60;
  const rnd = mulberry32(opts.seed ?? 20240601);
  const channels = ['CH501', 'CH502', 'CH503', 'CH504'];
  const types = ['DCV', 'TC Type K', 'RTD PT100', 'FREQ'];
  const units = ['V', 'degC', 'degC', 'Hz'];
  const header = buildStandardHeader(channels, types, units, ',');
  const data: string[] = [];
  // 真实 Keysight 特殊读数：OVER/UNDER 超欠量程、OPEN/SHORT 开短路、+9.9E37 超量程数值、引号包裹的 Sensor Error、空白未读
  const specials: string[] = ['OVER', 'UNDER', 'OPEN', 'SHORT', '+9.90000000E+37', '"Sensor Error"', ''];
  for (let i = 0; i < rows; i++) {
    const vals = types.map((t, c) => {
      // 周期性混入特殊值：每 ~9 行让某列出现一次特殊值，末列为空白（模拟未读数）
      if (i % 9 === c) return specials[(i + c) % specials.length];
      if (i % 7 === 0 && c === 3) return ''; // FREQ 列空白
      return genValue(t, i, rnd, c === 0 ? 5 : 3);
    });
    data.push([timestampAt(i), ...vals].join(','));
  }
  return {
    name: 'special_values.csv',
    content: [header, ...data].join('\n'),
    meta: {
      name: 'special_values.csv',
      encoding: 'utf-8',
      delimiter: 'comma',
      headerRows: 3,
      channelCount: 4,
      channelTypes: types,
      units,
      rowCount: rows,
      timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
      decimalSeparator: '.',
      issues: ['包含特殊值 OVER(超量程)/UNDER(欠量程)/OPEN(开路)/SHORT(短路)/+9.90000000E+37(超量程数值)/"Sensor Error"(引号包裹错误)/空白未读字段'],
    },
  };
}

/** 7. no_header.csv：无表头，首行即数据 */
export function generateNoHeader(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 100;
  const rnd = mulberry32(opts.seed ?? 20240701);
  const types = ['DCV', 'TC Type K', 'RTD PT100', 'FREQ'];
  const data: string[] = [];
  for (let i = 0; i < rows; i++) {
    const vals = types.map((t, c) => genValue(t, i, rnd, c === 0 ? 5 : 3));
    data.push([timestampAt(i), ...vals].join(','));
  }
  return {
    name: 'no_header.csv',
    content: data.join('\n'),
    meta: {
      name: 'no_header.csv',
      encoding: 'utf-8',
      delimiter: 'comma',
      headerRows: 0,
      channelCount: 4,
      channelTypes: types,
      units: ['V', 'degC', 'degC', 'Hz'],
      rowCount: rows,
      timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
      decimalSeparator: '.',
      notes: '无表头，首行即数据（无法从表头推断类型，需按数值特征识别）',
    },
  };
}

/** 8. english_header.csv：格式2（前面板 USB 存储导出）：日期/时间分列、双引号表头、列名内嵌类型（引号内嵌入逗号陷阱） */
export function generateEnglishHeader(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 300;
  const rnd = mulberry32(opts.seed ?? 20240801);
  const cols = ['Date', 'Time', 'Ch101 (DCV)', 'Ch102 (TC,K)', 'Ch103 (RTD,PT100)', 'Ch104 (FREQ)'];
  const header = cols.map((c) => `"${c}"`).join(',');
  const data: string[] = [];
  for (let i = 0; i < rows; i++) {
    const d = new Date(BASE_TIME.getTime() + i * SAMPLE_INTERVAL_MS);
    const date = `${pad(d.getMonth() + 1, 2)}/${pad(d.getDate(), 2)}/${d.getFullYear()}`;
    const time = `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`;
    const dcv = (5 + Math.sin(i / 10) * 0.5 + (rnd() - 0.5) * 0.04).toFixed(5);
    const tc = (25 + Math.sin(i / 7) * 2 + (rnd() - 0.5) * 0.6).toFixed(4);
    const rtd = (25.2 + Math.sin(i / 9) * 1.5 + (rnd() - 0.5) * 0.4).toFixed(4);
    const freq = (50 + Math.sin(i / 5) * 0.5 + (rnd() - 0.5) * 0.2).toFixed(4);
    data.push(`"${date}","${time}",${dcv},${tc},${rtd},${freq}`);
  }
  return {
    name: 'english_header.csv',
    content: [header, ...data].join('\n'),
    meta: {
      name: 'english_header.csv',
      encoding: 'utf-8',
      delimiter: 'comma',
      headerRows: 1,
      layout: 'wide',
      channelCount: 4,
      channelTypes: ['DCV', 'TC Type K', 'RTD PT100', 'FREQ'],
      units: ['V', 'degC', 'degC', 'Hz'],
      rowCount: rows,
      timestampFormat: 'MM/DD/YYYY + HH:mm:ss.SSS（Date/Time 分列，均引号包裹）',
      decimalSeparator: '.',
      headerQuoted: true,
      headerEmbedsTypes: true,
      headerHasEmbeddedComma: true,
      notes: '格式2（前面板 USB 导出）：表头整行双引号包裹，列名内嵌类型；Date/Time 分列且引号包裹；Ch102 (TC,K) 与 Ch103 (RTD,PT100) 含引号内嵌入逗号（需按 CSV 引号规则解析，朴素逗号切分表头得 8 段）',
    },
  };
}

/** 9. large.csv：5 通道 × 20000 行（性能验证用，程序生成） */
export function generateLarge(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 20000;
  const rnd = mulberry32(opts.seed ?? 20240901);
  const channels = ['CH101', 'CH102', 'CH103', 'CH104', 'CH105'];
  const types = ['DCV', 'TC Type K', 'RTD PT100', 'FREQ', 'ACV'];
  const units = ['V', 'degC', 'degC', 'Hz', 'V'];
  const header = buildStandardHeader(channels, types, units, ',');
  const data: string[] = new Array(rows);
  for (let i = 0; i < rows; i++) {
    const vals = types.map((t, c) => genValue(t, i, rnd, c === 0 || c === 4 ? 5 : 3));
    data[i] = [timestampAt(i), ...vals].join(',');
  }
  return {
    name: 'large.csv',
    content: [header, ...data].join('\n'),
    meta: {
      name: 'large.csv',
      encoding: 'utf-8',
      delimiter: 'comma',
      headerRows: 3,
      channelCount: 5,
      channelTypes: types,
      units,
      rowCount: rows,
      timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
      decimalSeparator: '.',
      notes: '大样本：5 通道 × 20000 行，用于性能验证',
    },
  };
}

/** 10. dirty.csv：重复时间戳、缺失值（空字段）、行尾多余分隔符等脏数据 */
export function generateDirty(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 120;
  const rnd = mulberry32(opts.seed ?? 20241001);
  const channels = ['CH101', 'CH102', 'CH103', 'CH104'];
  const types = ['DCV', 'TC Type K', 'RTD PT100', 'FREQ'];
  const units = ['V', 'degC', 'degC', 'Hz'];
  const header = buildStandardHeader(channels, types, units, ',');
  const data: string[] = [];
  const issues: string[] = [];
  let duplicateCount = 0;
  let emptyFieldCount = 0;
  let raggedCount = 0;

  for (let i = 0; i < rows; i++) {
    const vals = types.map((t, c) => genValue(t, i, rnd, c === 0 ? 5 : 3));
    let ts = timestampAt(i);

    // 重复时间戳：第 10/11 行与第 40~42 行共享时间戳
    if (i === 11) ts = timestampAt(10);
    if (i === 41 || i === 42) ts = timestampAt(40);
    if (i === 11 || i === 41 || i === 42) duplicateCount++;

    const row = [ts, ...vals];
    // 缺失值：第 5、25、55 行某字段为空；第 75 行两个字段为空
    if (i === 5) { row[2] = ''; emptyFieldCount++; }
    if (i === 25) { row[4] = ''; emptyFieldCount++; }
    if (i === 55) { row[1] = ''; emptyFieldCount++; }
    if (i === 75) { row[2] = ''; row[4] = ''; emptyFieldCount += 2; }

    let line = row.join(',');
    // 行尾多余分隔符：第 15 行末多一个逗号（空尾字段）
    if (i === 15) { line = line + ','; emptyFieldCount++; }
    // 参差行：第 65 行只有 4 列（少最后一列）
    if (i === 65) { line = [ts, ...vals.slice(0, 3)].join(','); raggedCount++; }
    // 字段首尾空白：第 85 行 CH102 值带前导空格
    if (i === 85) { line = [ts, vals[0], ' ' + vals[1], vals[2], vals[3]].join(','); }

    data.push(line);
  }
  issues.push(`重复时间戳 ${duplicateCount} 处（第 10/11、40/41/42 行组）`);
  issues.push(`空字段 ${emptyFieldCount} 处（第 5/15/25/55/75 行）`);
  issues.push(`参差行 ${raggedCount} 处（第 65 行仅 4 列）`);
  issues.push('字段首尾空白（第 85 行 CH102 前导空格）');

  return {
    name: 'dirty.csv',
    content: [header, ...data].join('\n'),
    meta: {
      name: 'dirty.csv',
      encoding: 'utf-8',
      delimiter: 'comma',
      headerRows: 3,
      channelCount: 4,
      channelTypes: types,
      units,
      rowCount: rows,
      timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
      decimalSeparator: '.',
      issues,
      notes: '脏数据样本：重复时间戳、空字段、参差行、字段空白，用于清洗模块测试',
    },
  };
}

/** 11. scan_format.csv：格式4（BenchVue 表格视图导出）：扫描序号 + 时间戳 + 各通道，普通小数 */
export function generateScanFormat(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 200;
  const rnd = mulberry32(opts.seed ?? 20241101);
  const header = '"Scan #","Timestamp","Ch101","Ch102","Ch103","Ch104"';
  const types = ['DCV', 'TC Type K', 'RTD PT100', 'FREQ'];
  const data: string[] = [];
  for (let i = 0; i < rows; i++) {
    const vals = types.map((t, c) => genValue(t, i, rnd, c === 0 ? 8 : 4));
    data.push(`${i + 1},"${timestampAt(i)}",${vals.join(',')}`);
  }
  return {
    name: 'scan_format.csv',
    content: [header, ...data].join('\n'),
    meta: {
      name: 'scan_format.csv',
      encoding: 'utf-8',
      delimiter: 'comma',
      headerRows: 1,
      layout: 'scan',
      channelCount: 4,
      channelTypes: types,
      units: ['V', 'degC', 'degC', 'Hz'],
      rowCount: rows,
      timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
      decimalSeparator: '.',
      headerQuoted: true,
      notes: '格式4（BenchVue 表格视图）：首列扫描序号（无引号），时间戳列引号包裹，数值普通小数',
    },
  };
}

/** 12. read_query.csv：格式3（READ? 批量查询转储）：无表头，科学计数法（带前导 + 号） */
export function generateReadQuery(opts: { rows?: number; seed?: number } = {}): SampleFile {
  const rows = opts.rows ?? 300;
  const rnd = mulberry32(opts.seed ?? 20241201);
  const types = ['DCV', 'TC Type K', 'RTD PT100', 'FREQ'];
  const data: string[] = [];
  for (let i = 0; i < rows; i++) {
    const vals = types.map((t, c) => {
      const v = parseFloat(genValue(t, i, rnd, c === 0 ? 8 : 4));
      return '+' + sci(v, 8);
    });
    data.push([timestampAt(i), ...vals].join(','));
  }
  return {
    name: 'read_query.csv',
    content: data.join('\n'),
    meta: {
      name: 'read_query.csv',
      encoding: 'utf-8',
      delimiter: 'comma',
      headerRows: 0,
      layout: 'wide',
      channelCount: 4,
      channelTypes: types,
      units: ['V', 'degC', 'degC', 'Hz'],
      rowCount: rows,
      timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
      decimalSeparator: '.',
      scientific: true,
      notes: '格式3（READ? 转储）：无表头，固定列序（时间戳+各通道），科学计数法带前导 + 号（如 +1.23456789E+00）',
    },
  };
}

// ============================================================================
// 汇总与落盘
// ============================================================================

/** 全部样本生成函数（按固定顺序） */
export const GENERATORS: Array<() => SampleFile> = [
  generateStandard,
  generateSemicolon,
  generateTab,
  generateGbk,
  generateEuroDecimal,
  generateSpecialValues,
  generateNoHeader,
  generateEnglishHeader,
  generateLarge,
  generateDirty,
  generateScanFormat,
  generateReadQuery,
];

/** 生成全部样本（内存态，不落盘） */
export function generateAll(): SampleFile[] {
  return GENERATORS.map((g) => g());
}

/** 全部样本元数据（供测试导入断言） */
export function allMeta(): SampleMeta[] {
  return generateAll().map((f) => f.meta);
}

/** 将全部样本写入 outDir（默认 tests/fixtures/samples），每个文件附带 .meta.json */
export function writeSamples(outDir?: string): SampleFile[] {
  const dir = outDir ?? path.join(THIS_DIR, 'samples');
  fs.mkdirSync(dir, { recursive: true });
  const files = generateAll();
  for (const f of files) {
    const target = path.join(dir, f.name);
    fs.writeFileSync(target, f.content, f.meta.encoding === 'gbk' ? undefined : 'utf8');
    fs.writeFileSync(path.join(dir, f.name + '.meta.json'), JSON.stringify(f.meta, null, 2) + '\n', 'utf8');
  }
  return files;
}

// ============================================================================
// CLI 入口
// ============================================================================

function main(): void {
  const files = writeSamples();
  console.log(`[DAQ970A fixtures] 已生成 ${files.length} 个样本到 tests/fixtures/samples/：`);
  for (const f of files) {
    const size = Buffer.isBuffer(f.content) ? f.content.length : Buffer.byteLength(f.content, 'utf8');
    const typeInfo = f.meta.channelTypes.join('/');
    console.log(
      `  - ${f.name.padEnd(20)} ${f.meta.encoding.padEnd(6)} ${f.meta.delimiter.padEnd(9)} ` +
        `header=${f.meta.headerRows} ch=${f.meta.channelCount}[${typeInfo}] rows=${f.meta.rowCount} ` +
        `(${size} bytes)`,
    );
  }
  console.log('完成。每个样本附同名 .meta.json 供测试断言。');
}

// 直接执行时生成样本（兼容 node / tsx 两种运行方式）
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}
