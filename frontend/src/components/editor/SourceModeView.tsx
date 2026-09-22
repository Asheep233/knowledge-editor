/**
 * task-41（v1.2.0-pre.2）：源码模式视图 —— 原生 `<textarea>` 直接编辑 Markdown 原文。
 *
 * 契约（`docs/design-1.2.0-source-mode.md` §2/§3）：
 *  - 受控 `<textarea>`（等宽字体）+ 顶部说明条（frontmatter 已隐藏）+ 保存状态；
 *  - **零依赖、无实时高亮/解析**：≥256KB 文档同样只是一个 textarea（不做 parse/serialize）；
 *  - 排他：正文（ProseMirror）此时不可写，本组件是唯一可写通道；
 *  - 只读态（版本预览等）禁用编辑并说明原因。
 * 本组件不自持保存逻辑：值/变更/保存状态全部由宿主（EditorArea）传入，保证「字符串直存」走既有保存链。
 */
import type { ReactNode, RefObject } from 'react'

export interface SourceModeViewProps {
  /** 当前正文原文（**不含 frontmatter**；由宿主按 `stripFrontmatter(raw).content` 提供） */
  value: string
  /** 编辑回调（宿主据此走防抖保存 / 恢复点登记） */
  onChange: (next: string) => void
  /** 保存状态文案（复用 EditorArea 的 saveLabel） */
  saveLabel?: ReactNode
  /** 只读：禁用 textarea（规范 §6.2-8：只读/版本预览态不提供源码编辑） */
  readOnly?: boolean
  /** 只读原因（展示在说明条右侧） */
  readOnlyReason?: string
  /** 文档标题（说明条展示） */
  title?: string
  /** 附加提示（如「未知语法改动已暂缓保存」） */
  notice?: string | null
  /** 供宿主聚焦/测量 */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}

export default function SourceModeView({
  value,
  onChange,
  saveLabel,
  readOnly = false,
  readOnlyReason,
  title,
  notice,
  textareaRef,
}: SourceModeViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="source-mode-view">
      {/* 2026-09-22 用户实测反馈：说明条此前是全宽 + 全宽下边框，既像「一条神秘线条」，
          又与居中列宽的正文标题不齐。改为与页眉/正文**同一列**（780px + 32px 内边距），
          说明条收成列内的一条胶囊。 */}
      <div className="mx-auto w-full max-w-[780px] shrink-0 px-[32px] pt-3">
        <div
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12px]"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
          data-testid="source-mode-banner"
        >
          <span className="font-medium" style={{ color: 'var(--foreground)' }}>
            源码模式
          </span>
          <span className="min-w-0 truncate">
            直接编辑 Markdown 原文；frontmatter 已隐藏（保存时按原块逐字节保留，仅更新 ke_version）
          </span>
          {title ? <span className="ml-auto shrink-0 opacity-70">{title}</span> : null}
          {saveLabel ? <span className={title ? 'shrink-0' : 'ml-auto shrink-0'}>{saveLabel}</span> : null}
          {readOnly ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-[1px] text-[11px]">
              {readOnlyReason ?? '只读'}
            </span>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p
          className="mx-auto mt-2 w-full max-w-[780px] shrink-0 rounded-md border border-amber-200 bg-amber-50 px-[32px] py-1.5 text-[12px] text-amber-700"
          data-testid="source-mode-notice"
        >
          {notice}
        </p>
      ) : null}

      {/* 编辑区与页眉/正文同列（780px + 32px 内边距）→ 源码与标题左边界对齐 */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        disabled={readOnly}
        spellCheck={false}
        aria-label="Markdown 原文"
        data-testid="source-textarea"
        placeholder="在此直接编辑 Markdown 原文…"
        className="ke-scroll mx-auto min-h-0 w-full max-w-[780px] flex-1 resize-none bg-background px-[32px] py-3 font-mono text-[13px] leading-[1.6] text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
        style={{ tabSize: 2 }}
      />
    </div>
  )
}
