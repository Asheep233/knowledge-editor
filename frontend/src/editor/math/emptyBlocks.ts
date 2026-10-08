/**
 * task-61：空 `mathBlock` 节点清理（数据安全）。
 *
 * 事故指纹：主理人文件里出现
 * ```
 * $$
 *
 * $$
 * ```
 * —— 那是 `MathBlockExtension.renderMarkdown` 对 **latex 为空** 的 mathBlock 的序列化结果，
 * 也就是「某条路径留下了空公式节点，随后被自动保存写进文件」。而解析侧**不会**产生空节点
 * （`mathBlockTokenizer` 对空 latex 返回 undefined，`$$…$$` 会退化成字面文本段落），
 * 所以空节点只可能来自**编辑期**：`Mod-m`（插入块级公式）会先插入 `latex=''` 的节点再开弹窗；
 * 若用户不填内容就切档/等自动保存，该空节点就被写进文件，下次打开变成两行字面 `$$`。
 *
 * 策略：**保存前**（以及离开当前文档前）把「不再被编辑的空 mathBlock」清掉。
 * - 只删 `latex.trim() === ''` 的 `mathBlock`（行内 `math` 不在此列：`$ $` 无实体块语义）；
 * - 正在弹窗编辑的那个（`keepId`）保留 —— 用户还没决定，不能替他删；
 * - 一次事务完成 → **Ctrl+Z 可撤销**；
 * - 非空公式一律不动（含 `\tag`、`align` 等）。
 */
import type { Editor } from '@tiptap/core'
import { KE_VERSION, withFrontmatter } from '../ke'

/** 该节点是否为「空块级公式」（latex 为空或仅空白） */
export function isEmptyMathBlock(node: { type: { name: string }; attrs?: Record<string, unknown> }): boolean {
  if (node.type.name !== 'mathBlock') return false
  const latex = (node.attrs?.latex as string | undefined) ?? ''
  return latex.trim() === ''
}

/**
 * 删除文档中所有「空的块级公式」节点（保留 `keepId` 指定的那个）。
 * @returns 是否发生了删除（false = 本来就干净）
 */
export function pruneEmptyMathBlocks(editor: Editor | null | undefined, keepId?: string | null): boolean {
  // 防御：测试替身（mock editor）与已 destroy 的实例没有可用的 state/view —— 一律视为「无事可做」，
  // 绝不让清理逻辑把保存/切档链路拖崩（它只是数据安全兜底，不是主路径）。
  const state = (editor as { state?: Editor['state'] } | null | undefined)?.state
  const view = (editor as { view?: Editor['view'] } | null | undefined)?.view
  if (!state?.doc || typeof view?.dispatch !== 'function') return false
  const targets: number[] = []
  state.doc.descendants((node, pos) => {
    if (!isEmptyMathBlock(node)) return
    const id = (node.attrs?.id as string | undefined) ?? ''
    if (keepId && id === keepId) return
    targets.push(pos)
  })
  if (targets.length === 0) return false
  const tr = state.tr
  // 从后往前删，避免位置偏移
  for (const pos of targets.reverse()) {
    const node = tr.doc.nodeAt(pos)
    if (node && isEmptyMathBlock(node)) tr.delete(pos, pos + node.nodeSize)
  }
  if (!tr.docChanged) return false
  view.dispatch(tr)
  return true
}

/**
 * task-61（漏网路径）：**保存载荷**统一入口 —— 先清空块，再套 frontmatter。
 *
 * 为什么保存时必须 `keepId = null`（不保留"正在弹窗编辑"的那个）：
 * 弹窗打开期间仍会发生保存（用户按 Ctrl+S、或自动保存到期、或切档 flush）。
 * 旧实现为「用户还没决定」而保留该空节点 → 空 `$$\n\n$$`（列表项内则是缩进版）
 * 照样进文件，主理人在沙箱真机复现到了这条路径。
 * 用户"决定"由**弹窗确认时**表达：那时若目标节点已被清掉，`applyMathInsertCursor`
 * 会按确认的 latex **新插入**节点 —— 既不写空块，也不丢用户输入。
 */
export function markdownForSave(editor: Editor | null | undefined): string | null {
  const ed = editor as Editor | null | undefined
  // 与旧实现同口径：只要能序列化就返回载荷（测试替身只提供 getMarkdown() 时也必须工作）。
  if (!ed || typeof ed.getMarkdown !== 'function') return null
  pruneEmptyMathBlocks(ed, null) // 内部自带防御：替身/已销毁实例 → 无事发生
  return withFrontmatter(ed.getMarkdown(), KE_VERSION)
}
