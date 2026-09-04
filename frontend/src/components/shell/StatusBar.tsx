/**
 * 底部状态条（handoff §3.1：34px）。
 * 内容由页面传入；令牌化渲染（零硬编码色值）。
 */
import type { ReactNode } from 'react'

export function StatusBar({ children }: { children?: ReactNode }) {
  return (
    <div className="flex h-[34px] shrink-0 items-center gap-4 overflow-x-hidden border-t border-border bg-muted px-3 text-[11px] leading-none text-muted-foreground">
      {children}
    </div>
  )
}

/** 状态条通用片段：右侧 mono 路径（移动端可截断）。 */
export function StatusBarPath({ path }: { path: string }) {
  return (
    <span className="ml-auto max-w-[320px] truncate font-mono text-[10px] text-muted-foreground" title={path}>
      {path}
    </span>
  )
}
