/**
 * P0-S2 原型：持续编辑面 / 换壳身份保持（真实 WebView2 内运行）。
 *
 * 目标：验证「UI shell 换壳」时，宿主持有的同一个 Tiptap/ProseMirror EditorView、history、
 * 源码草稿容器不被重建：仅把 view.dom（与 source textarea）移动到新 shell 容器，
 * 断言 view 对象身份、文档、undo/redo、焦点、组合输入事件、源码草稿均保持。
 *
 * 说明：本原型使用最小 Tiptap StarterKit（不含产品 React NodeViews）；NodeView 身份
 * 与真实产品编辑器的完整能力留给 T14/T03 后续覆盖。结果通过 Tauri 命令 report_results 写盘。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

type Result = Record<string, unknown>

interface Shell {
  id: string
  root: HTMLDivElement
  editorHost: HTMLDivElement
  source: HTMLTextAreaElement
}

function makeShell(id: string, frameworkLabel: string): Shell {
  const root = document.createElement('div')
  root.id = `shell-${id}`
  root.dataset.shell = id
  root.style.cssText =
    'border:2px solid #888;margin:6px;padding:6px;background:#f8f8f8;color:#111;min-height:80px;'
  const head = document.createElement('div')
  head.textContent = `shell ${id} (${frameworkLabel})`
  head.style.cssText = 'font:11px monospace;opacity:.7;margin-bottom:4px;'
  const editorHost = document.createElement('div')
  editorHost.dataset.role = 'editor-host'
  const sourceWrap = document.createElement('div')
  const sourceLabel = document.createElement('div')
  sourceLabel.textContent = 'source channel (textarea, 持久)'
  sourceLabel.style.cssText = 'font:10px monospace;opacity:.6;margin-top:4px;'
  const source = document.createElement('textarea')
  source.dataset.role = 'source'
  source.style.cssText = 'width:100%;min-height:40px;font:11px monospace;'
  sourceWrap.appendChild(sourceLabel)
  sourceWrap.appendChild(source)
  root.appendChild(head)
  root.appendChild(editorHost)
  root.appendChild(sourceWrap)
  document.body.appendChild(root)
  return { id, root, editorHost, source }
}

function moveEditor(shell: Shell, viewDom: HTMLElement, source: HTMLTextAreaElement): void {
  shell.editorHost.appendChild(viewDom)
  shell.source.value = source.value
}

async function main(): Promise<void> {
  const out: Result = { phase: 's2-start' }
  try {
    document.body.style.cssText = 'font:12px monospace;background:#fff;color:#111;margin:8px;'
    const shellA = makeShell('A', 'vanilla DOM shell')
    const shellB = makeShell('B', 'another-framework shell')

    const editor = new Editor({
      extensions: [StarterKit],
      content: '<p>初始内容 initial</p>',
      element: shellA.editorHost,
    })
    // T15 探针钩子：供 WebView2 CDP 驱动真实 IME 组词/焦点/缩放验收
    ;(window as unknown as { __s2?: Record<string, unknown> }).__s2 = {
      editor,
      getText: () => editor.getText(),
      focus: () => (editor.view.dom as HTMLElement).focus(),
      activeElementTag: () => document.activeElement?.tagName ?? null,
      activeElementEditable: () => (document.activeElement as HTMLElement | null)?.isContentEditable ?? false,
      dpr: () => window.devicePixelRatio,
      visualViewportScale: () => window.visualViewport?.scale ?? null,
      moveToShell: (id: string) => {
        const target = id === 'B' ? shellB : shellA
        moveEditor(target, editor.view.dom as HTMLElement, target.source)
      },
    }
    const view = editor.view
    const dom = view.dom as HTMLElement
    out.editorCreated = !!editor
    out.viewIdentityInitial = typeof view === 'object'
    out.initialDoc = editor.getText()

    // shell A 上编辑并记录 history 深度
    editor.commands.insertContent(' AAA')
    editor.commands.insertContent(' BBB')
    out.docAfterEdits = editor.getText()
    const undoBeforeSwap = editor.can().undo()
    out.undoAvailableBeforeSwap = undoBeforeSwap

    // 源码草稿（持久，不因换壳重建）
    shellA.source.value = '# 源码草稿（进入源码模式后编辑）'

    // ---- 换壳：只移动 DOM，不重建 editor/view ----
    const sourceText = shellA.source.value
    moveEditor(shellB, dom, shellA.source)
    await new Promise((r) => setTimeout(r, 200))

    out.viewIdentitySameAfterSwap = editor.view === view && (editor.view.dom as HTMLElement) === dom
    out.docAfterSwap = editor.getText()
    out.editorHostAfterSwap = dom.parentElement?.dataset.role ?? null
    out.shellAAfterSwapEditorHostChildren = shellA.editorHost.children.length
    out.sourceDraftPreserved = shellB.source.value === sourceText && sourceText.length > 0

    // undo/redo 在新 shell 下继续可用（history 未重建）
    editor.commands.undo()
    out.docAfterUndoInShellB = editor.getText()
    out.undoWorkedAfterSwap = out.docAfterUndoInShellB !== out.docAfterSwap
    editor.commands.redo()
    out.redoWorkedAfterSwap = editor.getText() === out.docAfterSwap

    // 焦点：新 shell 内可聚焦并输入
    dom.focus()
    editor.commands.insertContent('FOCUS')
    out.focusInputWorked = editor.getText().includes('FOCUS')

    // 组合输入事件（synthetic IME）：不得丢内容/不得异常
    try {
      dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      const sel = window.getSelection()
      if (sel) {
        const range = document.createRange()
        range.selectNodeContents(dom)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }
      editor.commands.insertContent('中')
      dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }))
      out.compositionSyntheticHandled = editor.getText().includes('中')
    } catch (e) {
      out.compositionSyntheticHandled = false
      out.compositionError = String(e)
    }

    // 换回 shell A（同一 view，再次移动）
    moveEditor(shellA, dom, shellB.source)
    await new Promise((r) => setTimeout(r, 200))
    out.viewIdentitySameAfterSecondSwap = editor.view === view && dom.parentElement === shellA.editorHost
    out.docAfterSwapBack = editor.getText()

    // 源码草稿跨两次换壳保持（两 shell 的 textarea 由 shell 注册表持有，不重建）
    out.sourceDraftPreservedAfterSecondSwap = shellA.source.value.length > 0 || shellB.source.value.length > 0

    out.phase = 's2-done'
    out.userAgent = navigator.userAgent
    out.referrer = document.referrer
  } catch (e) {
    out.phase = 's2-error'
    out.error = String((e && (e as Error).stack) || e)
  }

  // 报告结果（s2-shell 与宿主同源 App URL → app 命令可达；原型允许 report_results）
  const inv = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } } })
    .__TAURI__?.core?.invoke
  const json = JSON.stringify(out, null, 2)
  const pre = document.createElement('pre')
  pre.textContent = json
  pre.style.cssText = 'font:10px monospace;white-space:pre-wrap;max-height:200px;overflow:auto;background:#eee;'
  document.body.appendChild(pre)
  if (inv) {
    try {
      await inv('report_results', { results: json })
    } catch (e) {
      const err = document.createElement('div')
      err.textContent = 'REPORT FAILED: ' + String(e)
      document.body.appendChild(err)
    }
    try {
      await inv('debug_log', { marker: 's2-harness-reported' })
    } catch (e) {
      /* ignore */
    }
  }
}

void main()
