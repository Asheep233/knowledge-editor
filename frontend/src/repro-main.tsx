/**
 * 临时复现页（排查「插入注释上标后自动换行」，不入正式构建）：
 * 复用真实 useKeEditor 配置（含 trailingNode、Placeholder、editorProps class），
 * 提供两个插入按钮（block 样式 / plain 样式），并把 editor 暴露到 window 供脚本检查。
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent } from '@tiptap/react'
import './index.css'
import { useKeEditor } from './editor'

declare global {
  interface Window {
    __repro?: {
      editor: ReturnType<typeof useKeEditor>
      insertBlock: () => boolean
      insertPlain: () => boolean
    }
  }
}

function Repro() {
  const [md, setMd] = useState('')
  const editor = useKeEditor({
    content: '第一段内容。',
    onUpdate: () => setMd(editor?.getMarkdown() ?? ''),
    editable: true,
  })

  useEffect(() => {
    if (!editor) return
    setMd(editor.getMarkdown())
    window.__repro = {
      editor,
      insertBlock: () => editor.commands.insertFootnote('注释内容A'),
      insertPlain: () => editor.commands.insertPlainFootnote('注释内容B'),
    }
    return () => {
      if (window.__repro?.editor === editor) window.__repro = undefined
    }
  }, [editor])

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button id="btn-block" type="button" onClick={() => editor?.commands.insertFootnote('注释内容A')}>
          插入注释（block 样式）
        </button>
        <button id="btn-plain" type="button" onClick={() => editor?.commands.insertPlainFootnote('注释内容B')}>
          插入注释（plain 样式）
        </button>
        <button id="btn-cursor-end" type="button" onClick={() => editor?.commands.setTextSelection(editor.state.doc.content.size)}>
          光标移末尾
        </button>
      </div>
      <EditorContent editor={editor} />
      <div id="md-out" style={{ marginTop: 16, fontSize: 12, color: '#666', whiteSpace: 'pre-wrap' }}>
        {md}
      </div>
    </div>
  )
}

createRoot(document.getElementById('app')!).render(<Repro />)
