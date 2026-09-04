/**
 * 视频节点视图（决策点 4：v1 仅本地视频引用与展示）。
 * src 为 workspace 相对路径（约束 4）。
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
      className="ke-video my-2 rounded-lg border border-gray-200 bg-white"
    >
      <div className="group relative p-2">
        {url ? (
          <video
            controls={controls}
            autoPlay={autoplay}
            loop={loop}
            poster={poster ? attachmentUrl(poster) : undefined}
            className="mx-auto max-h-[480px] w-full rounded bg-black"
            // Phase 6.4：默认只加载元数据，避免多附件文档打开时全部缓冲视频
            preload="metadata"
          >
            <source src={url} />
            您的浏览器不支持 video 标签
          </video>
        ) : (
          <p className="px-3 py-6 text-center text-xs text-gray-400">视频缺失：{title || src}</p>
        )}

        {title ? (
          <div className="px-1 pt-1.5 text-center text-[12px] font-medium text-gray-700">
            {title}
          </div>
        ) : null}

        <div className="absolute right-3 top-3 hidden gap-1 group-hover:flex">
          <input
            value={title}
            placeholder="视频标题"
            className="w-28 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] outline-none focus:border-blue-300"
            onChange={(e) => updateAttributes({ title: e.target.value })}
          />
          <button
            type="button"
            title="删除视频"
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
