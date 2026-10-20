/**
 * 附件节点视图（决策点 4/5：附件卡片按类型；约束 4：workspace 相对路径）。
 * src 为 workspace 相对路径（如 Attachments/images/xxx.png），
 * 经 /api/attachments/{src} 提供访问。
 *
 * handoff §5：
 * - ke-attach type=image：内容大图 + 居中图注，点击放大（灯箱）
 * - ke-attach type=file：文件卡 = 图标 + 文件名 + 大小 + 下载按钮（大小经
 *   /api/attachments/list 元数据查询，不依赖属性入参）
 * - ke-attach type=video：保留原生播放器
 *
 * Focus（task-3）：卡片统一 --card + --border + --radius-control；
 * 说明/元信息 --text-3；删除旧硬编码蓝灰（text-blue-600/bg-blue-50/border-gray-*）。
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { attachmentUrl, listAttachments } from '../../../api/client'
import { Icon } from '../../icons'
import ImageLightbox from './ImageLightbox'

/** 附件元数据缓存（按 src），避免每个节点重复请求 /api/attachments/list */
const sizeCache = new Map<string, number | null>()

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 查询附件大小：// 命中缓存直接返回，否则走 listAttachments 元数据 */
function useAttachmentSize(src: string, type: string): number | null {
  const [size, setSize] = useState<number | null>(() => sizeCache.get(src) ?? null)
  useEffect(() => {
    if (type !== 'file' || !src || sizeCache.has(src)) return
    let alive = true
    listAttachments()
      .then(({ attachments }) => {
        const hit = attachments.find((it) => it.rel_path.replace(/\\/g, '/') === src.replace(/\\/g, '/'))
        const s = hit?.size ?? null
        sizeCache.set(src, s)
        if (alive) setSize(s)
      })
      .catch(() => sizeCache.set(src, null))
    return () => {
      alive = false
    }
  }, [src, type])
  return size
}

export default function AttachmentNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const a = node.attrs
  const type = (a.type as string) || 'file'
  const src = (a.src as string) || ''
  const title = (a.title as string) || ''
  const caption = (a.caption as string) || ''
  const width = (a.width as string) || '100%'
  const url = src ? attachmentUrl(src) : ''
  const size = useAttachmentSize(src, type)
  const [lightbox, setLightbox] = useState(false)

  return (
    <NodeViewWrapper
      contentEditable={false}
      className="ke-attach my-2 rounded-control border border-border bg-card"
    >
      <div className="group relative p-2">
        {type === 'image' ? (
          <>
            <img
              src={url}
              alt={title || caption || '附件图片'}
              className="mx-auto max-h-[480px] cursor-zoom-in rounded-[6px] object-contain transition-opacity hover:opacity-95"
              style={{ width }}
              // Phase 6.4：大文档含多图时懒加载，避免阻塞编辑器
              loading="lazy"
              decoding="async"
              onClick={() => setLightbox(true)}
            />
            {/* 居中图注（handoff：以内容大图展示，附「图 N：…」语义的 caption） */}
            {(title || caption) && (
              <p className="px-1 pt-2 text-center text-[12.5px] leading-relaxed text-text-3">
                {caption || title}
              </p>
            )}
          </>
        ) : type === 'video' ? (
          <video controls className="mx-auto max-h-[480px] w-full rounded-[6px]" style={{ width }} preload="metadata">
            <source src={url} />
            您的浏览器不支持 video 标签
          </video>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 rounded-control border border-border bg-surface-2 px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-surface-3"
          >
            <Icon name="attachment" className="size-4 shrink-0 text-primary" />
            <span className="truncate">{title || src.split('/').pop()}</span>
            {size != null && size > 0 ? (
              <span className="shrink-0 text-[11.5px] text-text-3">{fmtSize(size)}</span>
            ) : null}
            <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[11.5px] text-text-3">
              <Icon name="download" className="size-3" /> 下载
            </span>
          </a>
        )}

        {/* 悬浮操作：标题/说明可编辑 */}
        <div className="absolute right-3 top-3 hidden gap-1 rounded-control bg-card p-1 shadow-soft group-hover:flex">
          <input
            value={title}
            placeholder="标题"
            className="w-28 rounded-control border border-border bg-card px-1.5 py-0.5 text-[12px] text-foreground outline-none focus:border-primary"
            onChange={(e) => updateAttributes({ title: e.target.value })}
          />
          <button
            type="button"
            title="删除附件"
            className="rounded-control bg-card px-1.5 text-xs text-text-3 transition-colors hover:text-danger"
            onClick={(e) => {
              e.preventDefault()
              deleteNode()
            }}
          >
            <Icon name="close" className="size-3.5" />
          </button>
        </div>
      </div>

      {lightbox ? (
        <ImageLightbox
          src={url}
          alt={title || '附件图片'}
          caption={caption || title}
          onClose={() => setLightbox(false)}
        />
      ) : null}
    </NodeViewWrapper>
  )
}
