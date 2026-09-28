/**
 * useSmokeLog — 冒烟/通知日志（T9-T12 headless 验证用）
 * logLine 同时输出到 console 与页面右下角的 smoke-log 面板（最多保留 40 行）。
 */
import { useCallback, useState } from 'react'

export interface SmokeLog {
  /** 当前日志行（倒序截断至 40 行） */
  lines: string[]
  /** 追加一行日志（console + 面板） */
  logLine: (text: string) => void
}

export function useSmokeLog(): SmokeLog {
  const [lines, setLines] = useState<string[]>([])

  const logLine = useCallback((t: string) => {
    console.log(t)
    setLines((prev) => [...prev, t].slice(-40))
  }, [])

  return { lines, logLine }
}
