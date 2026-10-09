/**
 * F5：**keydown 快捷键入口的 IME（输入法）守卫审计**。
 *
 * 依据：`state/shortcuts.ts` 的 `shouldIgnoreKeyEvent`（`isComposing` / `keyCode 229` /
 * `Dead` / `Unidentified`）。全局分发器链路已守卫：
 *   installShortcutDispatcher → handleShortcutKeydown → resolveActionId / isSuppressedBuiltin
 *   → shouldIgnoreKeyEvent（`registerActionHandlers` 注册的 handler 只能经该链路被触发）。
 *
 * 但**不经过分发器**的裸监听（window keydown / React onKeyDown）必须各自守卫，否则中文/日文
 * 输入法组词时按回车（上屏候选词，keydown 带 isComposing=true 或 keyCode=229）会误触发动作：
 *   - Enter / Escape 类：高风险 —— 组词回车 = 上屏，组词 Escape = 取消组词，
 *     误判会「提交半截输入 / 关闭弹窗 / 触发删除确认 / 跳转 / 保存标题」；
 *   - Ctrl+S / Ctrl+K 类：组合态下按 S/K 通常不构成 IME 提交，风险低（但仍应统一守卫）。
 *
 * 本文件只做**审计与回归钉**，不修改被审计文件：
 *  ① App.tsx 必须零未守卫入口 —— 该文件的键盘处理正由队友补写，本用例**在其改动落地后自动生效**
 *     （新增未守卫监听 → 立刻变红）；
 *  ② 全量入口清单快照 `KNOWN_GAPS`：**清单外**出现任何未守卫入口 → 立刻变红（新增回归）；
 *     清单内某文件被修好（数量减少）→ 也变红，提示把该文件从清单删除（保证清单不腐烂）。
 *
 * 修复者：修好某文件后，请把 `KNOWN_GAPS` 里对应数字改小/删除（失败信息会打印实测明细）。
 * 本轮（task-55 F5）已修：PromptDialog.tsx（Enter/Escape）、RightPanel.tsx（标签输入 Enter/Backspace）。
 * task-58 F5 续修：EditorArea.tsx（window Ctrl+S、页眉标题 Enter/Escape）、
 *   LeftSidebar.tsx（window Ctrl+K、搜索框 Enter）——已从 KNOWN_GAPS 删除（清单同步）。
 * task-63 A09 续修：MathEditorModal.tsx（Escape 分支加 shouldIgnoreReactKeyEvent 守卫，
 *   顺带覆盖审查补充发现「IME 组合态 Esc 仍提交公式」）——已从 KNOWN_GAPS 删除（清单同步）。
 * 仍待修（超出本子任务写入边界）：EditorArea.tsx（window Ctrl+S、页眉标题 Enter）、
 *   LeftSidebar.tsx（window Ctrl+K、搜索框 Enter）、desktop.ts（Ctrl+Q/R 兜底）、
 *   FootnoteNodeView.tsx、FootnotesNodeView.tsx、ImageLightbox.tsx、
 *   WorkspacePicker.tsx、SettingsPanel.tsx。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  handleShortcutKeydown,
  registerActionHandlers,
  resolveActionId,
  shouldIgnoreKeyEvent,
  shouldIgnoreReactKeyEvent,
  __clearActionHandlers,
  __resetWarnings,
} from './shortcuts'

const readSrc = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// ---------------------------------------------------------------------------
// 源码审计器：找出 keydown 入口，判定其处理体是否过 IME 守卫
// ---------------------------------------------------------------------------

/** 判定「已守卫」的源码特征（shouldIgnoreKeyEvent / isComposing / keyCode 229 / 上游已守卫的函数） */
const IME_GUARD =
  /shouldIgnoreKeyEvent|shouldIgnoreReactKeyEvent|isComposing|keyCode\s*===?\s*229|keySpecFromEvent|handleShortcutKeydown/

/** 从已知括号位 `idx` 起，取到其配对闭合处的源码片段 */
function balancedFrom(src: string, idx: number): string {
  if (idx < 0 || idx >= src.length) return ''
  const open = src[idx]
  const close = open === '(' ? ')' : '}'
  let depth = 0
  for (let j = idx; j < src.length; j++) {
    if (src[j] === open) depth++
    else if (src[j] === close) {
      depth--
      if (depth === 0) return src.slice(idx, j + 1)
    }
  }
  return src.slice(idx)
}

/** 语句结束位置（括号配平后遇换行）——用于把「定义语句」整体取出，避免抓到后面的无关箭头 */
function statementEnd(src: string, start: number): number {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') {
      depth--
      if (depth < 0) return i
    } else if (c === '\n' && depth <= 0) return i
  }
  return src.length
}

/** 取 `start` 处定义的「处理体」：整条定义语句（箭头函数/函数声明/调用表达式都含在内） */
function handlerBody(src: string, start: number): string {
  return src.slice(start, statementEnd(src, start))
}

/** 同文件内某个标识符的定义体（取用法之前最后一次定义） */
function definitionBody(src: string, ident: string, beforeIdx: number): string | null {
  const re = new RegExp(`(?:const|let|var|function)\\s+${ident}\\b`, 'g')
  let defIdx = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m.index < beforeIdx) defIdx = m.index
    else break
  }
  return defIdx >= 0 ? handlerBody(src, defIdx) : null
}

/**
 * 处理体是否已过 IME 守卫。
 * 允许一层间接（`handler = handleCapture(action)`、`keySpecFromEvent` 等上游已守卫函数），
 * 避免把「守卫在下一层函数里」误报为缺口；深度限 1，防止模糊匹配掩盖真实缺口。
 */
function isGuarded(src: string, body: string, beforeIdx: number, depth = 0): boolean {
  if (IME_GUARD.test(body)) return true
  if (depth >= 1) return false
  const idents = new Set(Array.from(body.matchAll(/[A-Za-z_$][\w$]*/g), (m) => m[0]))
  for (const id of idents) {
    const def = definitionBody(src, id, beforeIdx)
    if (def && isGuarded(src, def, beforeIdx, depth + 1)) return true
  }
  return false
}

/** 纯类型标注（`onKeyDown={onKeyDown}` 的 prop 定义）不是处理体，跳过不计缺口 */
const isTypeAnnotation = (body: string): boolean => /\)\s*=>\s*void\s*$/.test(body.trim())

export interface KeydownEntry {
  /** 行号（1 起，仅用于失败信息定位） */
  line: number
  /** 入口形态（window 监听 / React onKeyDown） */
  kind: 'window' | 'react'
  /** 处理体源码（截断后的定位片段） */
  snippet: string
  guarded: boolean
}

/** 列出一个源码文件中所有 keydown 入口及其守卫状态 */
export function auditKeydownEntries(src: string): KeydownEntry[] {
  const entries: KeydownEntry[] = []
  const lineOf = (idx: number): number => src.slice(0, idx).split('\n').length

  const push = (mIndex: number, kind: 'window' | 'react', body: string): void => {
    if (isTypeAnnotation(body)) return
    entries.push({
      line: lineOf(mIndex),
      kind,
      snippet: body.slice(0, 160).replace(/\s+/g, ' '),
      guarded: isGuarded(src, body, mIndex),
    })
  }

  // ① window/document.addEventListener('keydown', handler)
  const addRe = /addEventListener\(\s*['"]keydown['"]/g
  let m: RegExpExecArray | null
  while ((m = addRe.exec(src))) {
    const call = balancedFrom(src, src.indexOf('(', m.index))
    const args = call.slice(1, -1)
    const comma = args.indexOf(',')
    const handlerArg = (comma >= 0 ? args.slice(comma + 1) : args).replace(/,\s*(true|false)\s*$/, '').trim()
    const ident = /^[A-Za-z_$][\w$]*$/.exec(handlerArg)?.[0]
    if (ident) {
      const def = definitionBody(src, ident, m.index)
      push(m.index, 'window', def ?? call)
    } else {
      push(m.index, 'window', call) // 内联箭头/函数表达式：调用文本即含处理体
    }
  }

  // ② React onKeyDown={...}
  const reactRe = /onKeyDown=\{/g
  while ((m = reactRe.exec(src))) {
    const region = balancedFrom(src, src.indexOf('{', m.index + 'onKeyDown='.length))
    const expr = region.slice(1, -1).trim()
    const ident = /^[A-Za-z_$][\w$]*$/.exec(expr)?.[0]
    if (ident) {
      const def = definitionBody(src, ident, m.index)
      // 无本地定义 = 由父组件传入（如 SettingsPanel 转发的 onKeyDown）→ 不在本文件审计范围
      if (def) push(m.index, 'react', def)
    } else {
      push(m.index, 'react', region)
    }
  }

  return entries
}

/** 被审计的生产文件（全部 keydown 入口） */
const AUDIT_FILES = [
  '../App.tsx',
  './shortcuts.ts',
  '../desktop.ts',
  '../components/common/PromptDialog.tsx',
  '../components/layout/EditorArea.tsx',
  '../components/layout/LeftSidebar.tsx',
  '../components/layout/RightPanel.tsx',
  '../components/editor/MathEditorModal.tsx',
  '../components/editor/nodeviews/FootnoteNodeView.tsx',
  '../components/editor/nodeviews/FootnotesNodeView.tsx',
  '../components/editor/nodeviews/ImageLightbox.tsx',
  '../components/layout/WorkspacePicker.tsx',
  '../components/settings/SettingsPanel.tsx',
  '../components/settings/ShortcutsSection.tsx',
] as const

const shortName = (rel: string): string => rel.replace('../', '').replace('./', '')

function auditFile(rel: string): KeydownEntry[] {
  return auditKeydownEntries(readSrc(rel))
}

function details(): string {
  const lines: string[] = []
  for (const rel of AUDIT_FILES) {
    for (const e of auditFile(rel)) {
      if (!e.guarded) lines.push(`  ${shortName(rel)}:${e.line} [${e.kind}] ${e.snippet}`)
    }
  }
  return lines.join('\n')
}

/**
 * 已知缺口快照（实测值）——**修好一个就改小/删掉一个**。
 *
 * 为什么用快照而不是「全部为空」：本轮任务边界不允许修改 EditorArea / desktop / settings 等文件，
 * 而这些文件确实存在未守卫入口。快照保证：① 不把已知缺口伪装成绿的；② 新增未守卫入口立即变红；
 * ③ 修好后必须同步清单（否则本用例失败并打印实测明细）。
 */
const KNOWN_GAPS: Record<string, number> = {
  'components/editor/nodeviews/FootnoteNodeView.tsx': 1,
  'components/editor/nodeviews/FootnotesNodeView.tsx': 1,
  'components/editor/nodeviews/ImageLightbox.tsx': 1,
  'components/layout/WorkspacePicker.tsx': 1,
  'components/settings/SettingsPanel.tsx': 2,
  'desktop.ts': 1,
}

describe('F5 — keydown 入口 IME 守卫审计（源码级）', () => {
  it('App.tsx：零未守卫 keydown 入口（队友补键盘监听后本用例自动生效）', () => {
    const bad = auditFile('../App.tsx').filter((e) => !e.guarded)
    expect(
      bad.map((e) => `App.tsx:${e.line} ${e.snippet}`),
      'App.tsx 新增了未过 IME 守卫的 keydown 入口：请用 shouldIgnoreKeyEvent/shouldIgnoreReactKeyEvent 提前 return',
    ).toEqual([])
  })

  it.each(AUDIT_FILES.filter((f) => f !== '../App.tsx'))('%s：未守卫入口数量与已知缺口清单一致', (rel) => {
    const bad = auditFile(rel).filter((e) => !e.guarded)
    const expected = KNOWN_GAPS[shortName(rel)] ?? 0
    expect(
      bad.length,
      `${shortName(rel)} 未守卫入口实测 ${bad.length} 处，清单期望 ${expected} 处。\n实测明细：\n${details()}\n若本文件已修好，请同步 KNOWN_GAPS；若新增了入口，请补 IME 守卫。`,
    ).toBe(expected)
  })

  it('本轮已修文件零缺口：PromptDialog（弹窗 Enter/Escape）与 RightPanel（标签输入）', () => {
    for (const rel of ['../components/common/PromptDialog.tsx', '../components/layout/RightPanel.tsx'] as const) {
      const bad = auditFile(rel).filter((e) => !e.guarded)
      expect(bad.map((e) => `${shortName(rel)}:${e.line} ${e.snippet}`)).toEqual([])
    }
  })

  it('审计器自检：能识别「未守卫」与「已守卫」两种写法（防止审计器失效造成假绿）', () => {
    const unguarded = auditKeydownEntries(`
      const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') e.preventDefault() }
      window.addEventListener('keydown', onKey)
    `)
    expect(unguarded).toHaveLength(1)
    expect(unguarded[0].guarded).toBe(false)

    const guarded = auditKeydownEntries(`
      const onKey = (e: KeyboardEvent) => { if (shouldIgnoreKeyEvent(e)) return; if (e.key === 's') e.preventDefault() }
      window.addEventListener('keydown', onKey)
    `)
    expect(guarded[0].guarded).toBe(true)

    const inline = auditKeydownEntries(`<input onKeyDown={(e) => { if (e.isComposing) return; go() }} />`)
    expect(inline).toHaveLength(1)
    expect(inline[0].guarded).toBe(true)
  })

  it('全局分发器链路：组合输入中的按键不分派、不 preventDefault（handler 注册也不绕过）', () => {
    __clearActionHandlers()
    __resetWarnings()
    const ran = vi.fn()
    const off = registerActionHandlers({ 'doc.save': ran })
    const bindings = { 'doc.save': 'Mod+S' }

    // 组合中（isComposing）与 keyCode 229：都必须零副作用
    for (const ev of [
      { key: 's', ctrlKey: true, isComposing: true },
      { key: 's', ctrlKey: true, keyCode: 229 },
    ]) {
      const preventDefault = vi.fn()
      const stopPropagation = vi.fn()
      const handled = handleShortcutKeydown(
        { ...ev, preventDefault, stopPropagation },
        { getBindings: () => bindings, mac: false },
      )
      expect(handled, 'IME 组合中的按键被分发器消费了').toBeNull()
      expect(preventDefault).not.toHaveBeenCalled()
      expect(stopPropagation).not.toHaveBeenCalled()
    }
    expect(ran).not.toHaveBeenCalled()
    expect(resolveActionId(bindings, { key: 's', ctrlKey: true, isComposing: true }, false)).toBeNull()

    // 非组合态：正常分派（非空对照，证明上面的「不触发」不是替身失效）
    const preventDefault = vi.fn()
    const handled = handleShortcutKeydown(
      { key: 's', ctrlKey: true, preventDefault, stopPropagation: vi.fn() },
      { getBindings: () => bindings, mac: false },
    )
    expect(handled?.actionId).toBe('doc.save')
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(ran).toHaveBeenCalledTimes(1)
    off()
  })

  it('shouldIgnoreKeyEvent / shouldIgnoreReactKeyEvent 覆盖 isComposing、keyCode 229、nativeEvent 透传', () => {
    expect(shouldIgnoreKeyEvent({ key: 'Enter', isComposing: true })).toBe(true)
    expect(shouldIgnoreKeyEvent({ key: 'Enter', keyCode: 229 })).toBe(true)
    expect(shouldIgnoreKeyEvent({ key: 'Dead' })).toBe(true)
    expect(shouldIgnoreKeyEvent({ key: 'Unidentified' })).toBe(true)
    expect(shouldIgnoreKeyEvent({ key: '' })).toBe(true)
    expect(shouldIgnoreKeyEvent({ key: 'Enter' })).toBe(false)
    // React 合成事件：nativeEvent 为准（合成 keyCode 可能为 0）
    expect(shouldIgnoreReactKeyEvent({ key: 'Enter', keyCode: 0, nativeEvent: { keyCode: 229 } })).toBe(true)
    expect(shouldIgnoreReactKeyEvent({ key: 'Enter', keyCode: 0, nativeEvent: { isComposing: true } })).toBe(true)
    expect(shouldIgnoreReactKeyEvent({ key: 'Enter', keyCode: 13, nativeEvent: { keyCode: 13 } })).toBe(false)
  })
})
