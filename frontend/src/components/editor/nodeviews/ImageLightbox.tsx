/**
 * 图片灯箱（handoff §5：正文图片可点击放大）。
 * 全屏遮罩 + 居中大图 + 图注；Esc / 点击遮罩关闭。
 */
import { useEffect } from 'react'
import { Icon } from '../../icons'

interface Props {
  src: string
  alt?: string
  caption?: string
  onClose: () => void
}

export default function ImageLightbox({ src, alt, caption, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt || '图片预览'}
    >
      <img
        src={src}
        alt={alt || ''}
        className="max-h-[85vh] max-w-[92vw] rounded object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="mt-3 flex items-center gap-2">
        <p className="max-w-[80vw] truncate text-sm text-white/85">
          {caption || alt || ''}
        </p>
        <button
          type="button"
          title="关闭（Esc）"
          aria-label="关闭预览"
          onClick={onClose}
          className="rounded-full bg-white/10 p-1.5 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
        >
          <Icon name="close" className="size-4" />
        </button>
      </div>
    </div>
  )
}
