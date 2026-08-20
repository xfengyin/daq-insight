/**
 * core/detection/encoding.ts — 文本编码探测
 * 用 jschardet 检测原始字节编码，回退 utf-8；重点保证 GBK 中文样本可识别。
 */
import jschardet from 'jschardet'

/** 编码探测结果（归一化后的编码名） */
export interface EncodingGuess {
  /** 归一化编码名（如 utf-8、gbk、latin-1） */
  encoding: string
  /** 置信度 0~1 */
  confidence: number
}

/** 把 jschardet 返回的编码名归一化为我们统一使用的名称 */
function normalize(name: string): string {
  const n = name.trim().toLowerCase()
  if (n.includes('utf-8') || n.includes('utf8')) return 'utf-8'
  if (n.includes('utf-32le') || n.includes('utf32le')) return 'utf-32le'
  if (n.includes('utf-32be') || n.includes('utf32be')) return 'utf-32be'
  if (n.includes('utf-16le') || n.includes('utf16le')) return 'utf-16le'
  if (n.includes('utf-16be') || n.includes('utf16be')) return 'utf-16be'
  if (n.includes('utf-16') || n.includes('utf16')) return 'utf-16'
  if (n.includes('gb18030') || n.includes('gb2312') || n.includes('gbk')) return 'gbk'
  if (n === 'big5-hkscs' || n.includes('big5')) return 'big5'
  if (n.includes('ascii')) return 'utf-8' // ASCII 是 UTF-8 子集，统一为 utf-8 与 meta 基准一致
  if (n.includes('latin') || n.includes('iso-8859') || n.includes('windows-1252')) return 'latin-1'
  return n || 'utf-8'
}

/** BOM 嗅探：命中返回编码名，未命中返回 null */
function sniffBom(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8'
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xfe && buf[2] === 0x00 && buf[3] === 0x00) return 'utf-32le'
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0xfe && buf[3] === 0xff) return 'utf-32be'
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le'
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be'
  return null
}

/** 快速判定字节流是否全部为 ASCII（0x00-0x7F） */
function isAscii(buf: Buffer): boolean {
  const len = Math.min(buf.length, 65536)
  for (let i = 0; i < len; i++) {
    if (buf[i] > 0x7f) return false
  }
  return true
}

/**
 * 从原始字节探测编码。
 * 1) BOM 嗅探（UTF-8 / UTF-16LE/BE / UTF-32LE/BE）→ 直接返回
 * 2) 纯 ASCII → utf-8（ASCII 是 UTF-8 子集）
 * 3) jschardet 检测，置信度阈值 0.2 以下回退 utf-8
 */
export function detectEncoding(buf: Buffer): EncodingGuess {
  if (buf.length === 0) return { encoding: 'utf-8', confidence: 1 }
  const bom = sniffBom(buf)
  if (bom) return { encoding: bom, confidence: 1 }
  if (isAscii(buf)) return { encoding: 'utf-8', confidence: 1 }
  const res = jschardet.detect(buf)
  const raw = res?.encoding ?? ''
  const confidence = typeof res?.confidence === 'number' ? res.confidence : 0
  let enc = normalize(raw)
  if (confidence < 0.2) enc = 'utf-8'
  return { encoding: enc, confidence: Math.max(confidence, 0.2) }
}

/** 判断是否为 UTF-16（有 BOM FF FE / FE FF） */
export function hasUtf16Bom(buf: Buffer): boolean {
  return buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))
}
