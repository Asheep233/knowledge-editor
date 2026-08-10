/**
 * 通用信息块节点视图（InfoBlock）。
 * 数据模型 { id, label, title, color } + PM 可编辑内容（content: 'inline*'，v0.7.0）。
 * 块内文字是真实 PM 节点（NodeViewContent 挂载），可插入脚注上标等 inline 节点；
 * 标题/徽章/颜色/删除控件单独 contentEditable={false}（wrapper 保持可编辑，
 * 否则 contentDOM 继承禁编辑导致块内无法输入，phase 6U 修复）。
 * 徽章颜色与块背景同步同一色系；徽章默认空文本（placeholder 不再显示「信息」）。
 */
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

/** 每个色系的块背景/边框 + 徽章配色 */
const COLOR_MAP: Record<string, { block: string; badge: string }> = {
  blue: { block: 'bg-sky-50 border-sky-200', badge: 'bg-sky-100 text-sky-700' },
  yellow: { block: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-700' },
  green: { block: 'bg-emerald-50 border-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
  red: { block: 'bg-rose-50 border-rose-200', badge: 'bg-rose-100 text-rose-700' },
  purple: { block: 'bg-violet-50 border-violet-200', badge: 'bg-violet-100 text-violet-700' },
}

/** 颜色选项：供用户自由设置背景颜色 */
const COLOR_OPTIONS: Array<{ key: string; cls: string; title: string }> = [
  { key: 'blue', cls: 'bg-sky-400', title: '蓝色' },
  { key: 'yellow', cls: 'bg-amber-400', title: '黄色' },
  { key: 'green', cls: 'bg-emerald-400', title: '绿色' },
  { key: 'red', cls: 'bg-rose-400', title: '红色' },
  { key: 'purple', cls: 'bg-violet-400', title: '紫色' },
]

export default function NoteNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const attrs = node.attrs as Record<string, unknown>
  const color = (attrs.color as string) || 'blue'
  const label = (attrs.label as string) ?? ''
  const title = (attrs.title as string) ?? ''
  const palette = COLOR_MAP[color] ?? COLOR_MAP.blue
  // 内容区为空时显示占位符（PM 空容器有 trailingBreak <br>，:empty 不可用，改用 class 驱动）
  const isEmpty = node.content.size === 0

  return (
    <NodeViewWrapper
      as="div"
      data-ke-note=""
      data-id={attrs.id ?? ''}
      data-label={attrs.label ?? ''}
      data-title={attrs.title ?? ''}
      data-color={color}
      data-author={attrs.author ?? ''}
      data-created={attrs.created ?? ''}
      data-updated={attrs.updated ?? ''}
      className={`ke-note my-2 rounded-lg border-l-4 px-3 py-2 ${palette.block}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <input
              contentEditable={false}
              value={label}
              placeholder=""
              title="徽章文字（可自定义，默认为空）"
              onChange={(e) => {
                updateAttributes({ label: e.target.value })
              }}
              className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide outline-none placeholder:font-normal placeholder:tracking-normal ${palette.badge}`}
            />
            <input
              contentEditable={false}
              value={title}
              placeholder="信息块标题（可自定义）"
              onChange={(e) => {
                updateAttributes({ title: e.target.value })
              }}
              className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-gray-800 outline-none placeholder:font-normal placeholder:text-gray-400"
            />
          </div>
          {/* PM 可编辑内容区：块内文字可插入脚注上标等 inline 节点 */}
          <NodeViewContent
            as="div"
            className={`ke-note-content text-[13px] leading-relaxed text-gray-800 outline-none focus:ring-0${isEmpty ? ' ke-note-content--empty' : ''}`}
          />
          {/* 背景颜色自由选择 */}
          <div className="mt-1.5 flex items-center gap-1.5">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c.key}
                type="button"
                contentEditable={false}
                title={c.title}
                onClick={() => updateAttributes({ color: c.key })}
                className={[
                  'h-4 w-4 rounded-full transition-transform',
                  c.cls,
                  color === c.key ? 'ring-2 ring-blue-400 ring-offset-1' : 'opacity-70 hover:opacity-100',
                ].join(' ')}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          contentEditable={false}
          title="删除信息块"
          className="shrink-0 text-xs text-gray-400 hover:text-rose-500"
          onClick={(e) => {
            e.preventDefault()
            deleteNode()
          }}
        >
          ×
        </button>
      </div>
    </NodeViewWrapper>
  )
}
