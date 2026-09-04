/**
 * 附件节点视图（决策点 4/5：附件卡片按类型；约束 4：workspace 相对路径）。
 * src 为 workspace 相对路径（如 Attachments/images/xxx.png），
 * 经 /api/attachments/{src} 提供访问。
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { attachmentUrl } from '../../../api/client'
import { Icon } from '../../icons'

export default function AttachmentNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const a = node.attrs
  const type = (a.type as string) || 'file'
  const src = (a.src as string) || ''
  const title = (a.title as string) || ''
  const caption = (a.caption as string) || ''
  const width = (a.width as string) || '100%'
  const url = src ? attachmentUrl(src) : ''

  return (
    <NodeViewWrapper
      contentEditable={false}
      className="ke-attach my-2 rounded-lg border border-gray-200 bg-white"
    >
      <div className="group relative p-2">
        {type === 'image' ? (
          <img
            src={url}
            alt={title || '附件图片'}
            className="mx-auto max-h-[480px] rounded object-contain"
            style={{ width }}
            // Phase 6.4：大文档含多图时懒加载，避免阻塞编辑器
            loading="lazy"
            decoding="async"
          />
        ) : type === 'video' ? (
          <video controls className="mx-auto max-h-[480px] w-full rounded" style={{ width }} preload="metadata">
            <source src={url} />
            您的浏览器不支持 video 标签
          </video>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50"
          >
            <Icon name="attachment" className="size-4 shrink-0 text-blue-600" />
            <span className="truncate">{title || src.split('/').pop()}</span>
            <span className="ml-auto shrink-0 text-[11px] text-gray-400">下载</span>
          </a>
        )}

        {title || caption ? (
          <div className="px-1 pt-1.5 text-center">
            {title ? <p className="text-[12px] font-medium text-gray-700">{title}</p> : null}
            {caption ? <p className="text-[11px] text-gray-400">{caption}</p> : null}
          </div>
        ) : null}

        {/* 悬浮操作：标题/说明可编辑 */}
        <div className="absolute right-3 top-3 hidden gap-1 group-hover:flex">
          <input
            value={title}
            placeholder="标题"
            className="w-28 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] outline-none focus:border-blue-300"
            onChange={(e) => updateAttributes({ title: e.target.value })}
          />
          <button
            type="button"
            title="删除附件"
            className="rounded bg-white px-1.5 text-xs text-gray-400 shadow-sm hover:text-rose-500"
            onClick={(e) => {
              e.preventDefault()
              deleteNode()
            }}
          >
            <Icon name="close" className="size-3.5" />
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  )
}
