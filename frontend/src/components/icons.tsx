/**
 * 线性 SVG 图标集（handoff §9「无 emoji/占位图，线性风格」）。
 * 全部 16×16 viewBox、stroke=currentColor、无填充；统一 1.5px 描边。
 * 用法：<Icon name="search" className="size-4" /> 或直接引用组件。
 */
import type { ReactNode } from 'react'

export type IconName =
  | 'search'
  | 'rebuild'
  | 'folder'
  | 'file'
  | 'chevron-down'
  | 'chevron-right'
  | 'plus'
  | 'settings'
  | 'save'
  | 'history'
  | 'attachment'
  | 'export'
  | 'caret'
  | 'note'
  | 'module'
  | 'formula'
  | 'image'
  | 'video'
  | 'file-text'
  | 'link'
  | 'list'
  | 'ordered-list'
  | 'quote'
  | 'code'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'tags'
  | 'trash'
  | 'download'
  | 'close'
  | 'dots'
  | 'check'
  | 'chevron-left'
  | 'bulb'
  | 'table'
  | 'undo'
  | 'redo'
  | 'edit'
  | 'alert'
  | 'folder-plus'

const PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </>
  ),
  rebuild: (
    <>
      <path d="M13 3.5A6.5 6.5 0 1 0 14 8" />
      <path d="M13 1.5v2.5h-2.5" />
    </>
  ),
  folder: (
    <path d="M1.5 4.5v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8l-1.5-2h-4a1 1 0 0 0-1 1.5Z" />
  ),
  file: (
    <path d="M4 1.5h5.5L13 5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm5.5 0V5H13" />
  ),
  'chevron-down': <path d="M4 6l4 4 4-4" />,
  'chevron-right': <path d="M6 4l4 4-4 4" />,
  plus: <path d="M8 3v10M3 8h10" />,
  settings: (
    <>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
    </>
  ),
  save: (
    <>
      <path d="M3 1.5h8.5L14 4v10a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14V2a.5.5 0 0 1 1-.5Z" />
      <path d="M5 1.5V6h6V1.5M5 14.5V10h6v4.5" />
    </>
  ),
  history: (
    <>
      <path d="M2.5 8a5.5 5.5 0 1 1 1.6 3.9M2.5 11.5V8" />
      <path d="M8 5v3l2 2" />
    </>
  ),
  attachment: (
    <>
      <path d="M9 3.5 3.8 8.7a3 3 0 0 0 4.2 4.3l5.2-5.2a4.5 4.5 0 0 0-6.4-6.4L1.6 6.6" />
    </>
  ),
  export: (
    <>
      <path d="M8 2.5V10M4.5 6.5 8 3l3.5 3.5" />
      <path d="M2.5 14.5h11" />
    </>
  ),
  caret: <path d="M5 6.5h6L8 10Z" />,
  note: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1" />
      <path d="M2 6.5h12" />
    </>
  ),
  module: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M2 6h12M5.5 6V13.5" />
    </>
  ),
  formula: (
    <>
      <path d="M9.5 3.5h4M6.5 3.5h3M7 12.5l3-9M6 8h4M5 12.5H2.5" />
    </>
  ),
  image: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <path d="M5 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM2.5 11.5l3.5-3.5 3 3 2-2 3.5 3" />
    </>
  ),
  video: (
    <>
      <rect x="1.5" y="3" width="13" height="10" rx="1" />
      <path d="M6.5 5.8v4.4l4-2.2Z" />
    </>
  ),
  'file-text': (
    <>
      <path d="M4 1.5h5.5L13 5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm5.5 0V5H13" />
      <path d="M5 8h6M5 10.5h6M5 13h4" />
    </>
  ),
  link: (
    <>
      <path d="M6.5 9.5 9.5 6.5M7 11.5l-2 2a2.3 2.3 0 0 1-3.3-3.3l2-2M9 4.5l2-2a2.3 2.3 0 0 1 3.3 3.3l-2 2" />
    </>
  ),
  list: <path d="M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01" />,
  'ordered-list': (
    <>
      <path d="M5 4h9M5 8h9M5 12h9" />
      <path d="M2 3.5h1v2.5M2 8.5h1.5L2 10.5h2M2.5 12.5v2h2" />
    </>
  ),
  quote: (
    <>
      <path d="M3 6.5h4v4l-2 2H3v-2h2V8H3Z" />
      <path d="M9 6.5h4v4l-2 2H9v-2h2V8H9Z" />
    </>
  ),
  code: <path d="M5 5 2 8l3 3M11 5l3 3-3 3M9 3.5 7 12.5" />,
  bold: <path d="M5 2.5h4a2.5 2.5 0 0 1 0 5H5Zm0 5h4.5a2.75 2.75 0 0 1 0 5.5H5Z" />,
  italic: <path d="M9.5 3h-4M13 3h-1.5M6 13h5M8.5 3 7 13" />,
  underline: <path d="M4 2.5v5.5a4 4 0 0 0 8 0V2.5M3 13.5h10" />,
  strike: <path d="M8 3.5c-2.5 0-4 1-4 2.5M8 12.5c2.5 0 4-1 4-2.3M2.5 8h11" />,
  tags: (
    <>
      <path d="M2 2h5l7 7-5 5-7-7Z" />
      <path d="M4.5 4.5h.01" />
    </>
  ),
  trash: (
    <>
      <path d="M3 4.5h10M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4.5 4.5l.5 9a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.5-9M6.5 7v4.5M9.5 7v4.5" />
    </>
  ),
  download: (
    <>
      <path d="M8 2.5V10M4.5 6.5 8 10l3.5-3.5" />
      <path d="M2.5 13.5h11" />
    </>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  dots: <path d="M4 8h.01M8 8h.01M12 8h.01" />,
  check: <path d="M3 8.5 6.5 12 13 4.5" />,
  'chevron-left': <path d="M10 4 6 8l4 4" />,
  bulb: (
    <>
      <path d="M8 2.5a4.5 4.5 0 0 0-2.6 8.2c.5.4.8 1 .9 1.6h3.4c.1-.6.4-1.2.9-1.6A4.5 4.5 0 0 0 8 2.5Z" />
      <path d="M6.5 14.5h3" />
    </>
  ),
  table: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <path d="M1.5 6h13M7 6v7.5" />
    </>
  ),
  undo: (
    <>
      <path d="M3 5h6a4 4 0 0 1 0 8H6" />
      <path d="M5.5 2.5 3 5l2.5 2.5" />
    </>
  ),
  redo: (
    <>
      <path d="M13 5H7a4 4 0 0 0 0 8h3" />
      <path d="M10.5 2.5 13 5l-2.5 2.5" />
    </>
  ),
  edit: <path d="M9.5 3.5 12.5 6.5 5.5 13.5 2 14l.5-3.5Z" />,
  alert: (
    <>
      <path d="M8 2 14.5 13.5h-13Z" />
      <path d="M8 6.5v3.5M8 11.8h.01" />
    </>
  ),
  'folder-plus': (
    <>
      <path d="M1.5 4.5v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8l-1.5-2h-4a1 1 0 0 0-1 1.5Z" />
      <path d="M8 7.5v3.5M6.2 9.2h3.6" />
    </>
  ),
}

export interface IconProps {
  name: IconName
  className?: string
  /** 无障碍标签（图标按钮必须提供） */
  label?: string
}

export function Icon({ name, className = 'size-4', label }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {PATHS[name]}
    </svg>
  )
}
