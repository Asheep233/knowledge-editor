/**
 * 正文图片节点视图（handoff §5：`![alt](src)` 标准 Markdown 图片）。
 * - 内容大图展示（全宽、居中），点击放大（灯箱）
 * - 深色主题下图片保持自身内容外观（img 不加滤镜）
 * - alt/title 作为图注展示；title 优先（「图 N：…」语义由用户书写）
 *
 * Focus（task-3）：图片放进 --card + --border + --radius-control 的纸面卡片；
 * 图注 --text-3 / 12.5px（对齐参考稿 .doc-fig figcaption）。
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useState } from 'react'
import ImageLightbox from './ImageLightbox'

export default function ImageNodeView({ node }: NodeViewProps) {
  const a = node.attrs as { src?: string; alt?: string; title?: string | null }
  const src = a.src ?? ''
  const alt = a.alt ?? ''
  const title = a.title ?? ''
  const [lightbox, setLightbox] = useState(false)

  return (
    <NodeViewWrapper
      as="figure"
      contentEditable={false}
      data-ke-image=""
      className="ke-image my-3 flex w-full flex-col items-center"
      style={{ userSelect: 'none' }}
    >
      <div className="w-full rounded-control border border-border bg-card p-2">
        <img
          src={src}
          alt={alt}
          title={title || undefined}
          className="mx-auto max-w-full cursor-zoom-in rounded-[6px] object-contain transition-opacity hover:opacity-95"
          loading="lazy"
          decoding="async"
          onClick={() => setLightbox(true)}
        />
      </div>
      {title || alt ? (
        <figcaption className="mt-2 max-w-full px-2 text-center text-[12.5px] leading-relaxed text-text-3">
          {title || alt}
        </figcaption>
      ) : null}
      {lightbox ? (
        <ImageLightbox src={src} alt={alt} caption={title || alt} onClose={() => setLightbox(false)} />
      ) : null}
    </NodeViewWrapper>
  )
}
