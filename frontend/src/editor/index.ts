/**
 * 编辑器组装（约束 1：结构化 Document Model，HTML 不作为主要数据格式）。
 *
 * 数据流：
 *   Markdown 文本 ──(marked tokenizer)──▶ ProseMirror JSON（Document Model）
 *   ProseMirror JSON ──(editor.getMarkdown)──▶ Markdown 文本
 *
 * 编辑器内部始终操作 ProseMirror Document Model（Tiptap Schema 定义），
 * Markdown 仅作为存储/交换格式，由 @tiptap/markdown 双向转换。
 */
import { useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { NoteExtension } from './extensions/NoteExtension'
import { ModuleExtension } from './extensions/ModuleExtension'
import { AttachmentExtension } from './extensions/AttachmentExtension'
import { VideoExtension } from './extensions/VideoExtension'
import { FootnoteExtension } from './extensions/FootnoteExtension'
import { FootnotesExtension } from './extensions/FootnotesExtension'
import {
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
} from './extensions/TableMarkdownExtension'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { uploadAttachment } from '../api/client'
import { attachmentNode, isRealFile } from './upload'

/** 自定义命令的 TS 类型声明（运行时命令由各扩展 addCommands 提供） */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      insertMath: (latex?: string) => ReturnType
      insertMathBlock: (latex?: string) => ReturnType
    }
    note: {
      insertNote: (text?: string, color?: string, title?: string) => ReturnType
    }
    footnote: {
      insertFootnote: (text: string) => ReturnType
      insertPlainFootnote: (text: string) => ReturnType
    }
  }
}

export interface KeEditorOptions {
  /** 初始 Markdown 内容（加载时解析进 Document Model） */
  content: string
  /** 内容变更回调（Phase 6.4：不携带序列化结果——击键时不做全量
   * 序列化，保存时由调用方现场 editor.getMarkdown()，避免大文档输入延迟） */
  onUpdate: () => void
  editable?: boolean
}

export function useKeEditor({ content, onUpdate, editable = true }: KeEditorOptions) {
  return useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
        // footnotes 是非 textblock 的块级节点，固定位于文档末尾。
        // trailingNode 默认会在末尾补一个空段落（视觉上"自动换行"），
        // 把 footnotes 加入 notAfter 避免该行为。
        trailingNode: {
          node: 'paragraph',
          notAfter: ['paragraph', 'footnotes'],
        },
        // 注：StarterKit v3 不含 image 扩展，图片由 ImageMarkdownExtension 提供
        // （补标准 ![]() 的双向转换）。
      }),
      // 兜底必须先注册（@tiptap/markdown 用 marked.use + unshift 注册 tokenizer：
      // 后注册的先执行）。因此 fallback 放在最前，确保具体 ke-* tokenizer 先执行，
      // fallback 只兜底未知 kind（且 tokenizer 正则含负向前瞻排除已知 kind，双保险）。
      GenericFallbackExtension,
      GenericFallbackInlineExtension,
      // 标准 Markdown 图片：![alt](src)
      ImageMarkdownExtension,
      // KE 扩展节点（math / mathBlock / note / module / attach / video / footnote）
      MathExtension,
      MathBlockExtension,
      NoteExtension,
      ModuleExtension,
      AttachmentExtension,
      VideoExtension,
      FootnoteExtension,
      // Phase 3：脚注独立块级节点（footnotes）+ 表格（GFM 往返）
      FootnotesExtension,
      TableMarkdownExtension,
      TableRow,
      TableCell,
      TableHeader,
      // 空文档占位提示：直接点击正文输入（正文字体）
      Placeholder.configure({
        placeholder: '开始输入正文…（Markdown 可用：# 标题、$公式$、- 列表）',
        emptyEditorClass: 'is-editor-empty',
      }),
      // Markdown 序列化/解析：Markdown 作为存储格式
      Markdown.configure({
        indentation: { style: 'space', size: 2 },
      }),
    ],
    content,
    contentType: 'markdown', // 字符串内容按 Markdown 解析进 Document Model
    editable,
    onUpdate: () => onUpdate(),
    editorProps: {
      attributes: {
        class: 'ke-editor-prose',
      },
      // 拖拽添加附件（v0.6.1）：拦截 ProseMirror 对拖入图片的默认
      // base64 内联行为，改为上传后插入 attach/video 节点。必须在此层
      // 处理——PM 的原生 drop 监听先于 React 容器事件执行，容器层
      // onDrop 无法阻止默认插入。
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        const real = Array.from(files).filter(isRealFile)
        if (real.length === 0) return false
        event.preventDefault()
        const pos =
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
          view.state.selection.from
        void (async () => {
          for (const f of real) {
            try {
              const res = await uploadAttachment(f)
              const node = attachmentNode(view.state.schema, res, f.name)
              view.dispatch(view.state.tr.insert(pos, node).scrollIntoView())
            } catch (err) {
              window.alert(`附件上传失败：${String(err)}`)
            }
          }
        })()
        return true
      },
    },
  })
}

/** 文档切换时重新载入 Markdown 内容 */
export function setKeContent(editor: Editor, markdown: string): void {
  editor.commands.setContent(markdown, { contentType: 'markdown' })
}
