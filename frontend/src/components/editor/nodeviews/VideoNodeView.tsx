/**
 * 视频节点视图（决策点 4：v1 仅本地视频引用与展示）。
 * src 为 workspace 相对路径（约束 4）。
 *
 * Focus（task-3）：卡片 --card + --border + --radius-control；
 * 标题/缺失提示 --text-3 12.5px；删除旧硬编码灰蓝（border-gray-200/text-gray-700/text-blue-300）。
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { attachmentUrl } from '../../../api/client'
import { Icon } from '../../icons'

export default function VideoNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const a = node.attrs
  const src = (a.src as string) || ''
  const title = (a.title as string) || ''
  const poster = (a.poster as string) || ''
  const controls = (a.controls as boolean) ?? true
  const autoplay = (a.autoplay as boolean) ?? false
  const loop = (a.loop as boolean) ?? false
  const url = src ? attachmentUrl(src) : ''

  return (
    <NodeViewWrapper
      contentEditable={false}
      className="ke-video my-2 rounded-control border border-border bg-card"
    >
      <div className="group relative p-2">
        {url ? (
          <video
            controls={controls}
            autoPlay={autoplay}
            loop={loop}
            poster={poster ? attachmentUrl(poster) : undefined}
            className="mx-auto max-h-[480px] w-full rounded-[6px] bg-black"
            // Phase 6.4：默认只加载元数据，避免多附件文档打开时全部缓冲视频
            preload="metadata"
          >
            <source src={url} />
            您的浏览器不支持 video 标签
          </video>
        ) : (
          <p className="px-3 py-6 text-center text-[12.5px] text-text-3">视频缺失：{title || src}</p>
        )}

        {title ? (
          <div className="px-1 pt-2 text-center text-[12.5px] font-medium text-text-2">
            {title}
          </div>
        ) : null}

        <div className="absolute right-3 top-3 hidden gap-1 rounded-control bg-card p-1 shadow-soft group-hover:flex">
          <input
            value={title}
            placeholder="视频标题"
            className="w-28 rounded-control border border-border bg-card px-1.5 py-0.5 text-[12px] text-foreground outline-none focus:border-primary"
            onChange={(e) => updateAttributes({ title: e.target.value })}
          />
          <button
            type="button"
            title="删除视频"
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
    </NodeViewWrapper>
  )
}
