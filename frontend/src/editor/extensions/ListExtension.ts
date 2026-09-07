/**
 * 列表扩展：自定义 OrderedList 输入规则（v1.1.5 ⑥）。
 *
 * 默认 Tiptap 输入规则只认 `1. `（硬编码 orderedListInputRegex = /^(\d+)\.\s$/），
 * Obsidian 式 `1) ` 输入不会转换 → 两行混排（列表 + 纯文本）导致 `)` 视觉不对齐。
 * 本扩展仅替换输入规则为 `1. ` 或 `1) `（CommonMark 双分隔符），
 * 序列化输出仍为规范化的 `1. `（连续、无空行、渲染对齐）。
 */
import { OrderedList } from '@tiptap/extension-list'
import { wrappingInputRule } from '@tiptap/core'

const LIST_INPUT_RE = /^(\d+)[.)]\s$/

export const OrderedListParenExtension = OrderedList.extend({
  addInputRules() {
    const joinPredicate = (match: RegExpMatchArray, node: { attrs: { type?: string | null }; childCount: number; attrsStart?: number }) => {
      const hasDefaultType = !node.attrs.type || node.attrs.type === '1'
      const start = (node.attrs as { start?: number }).start ?? 1
      return hasDefaultType && node.childCount + start === Number(match[1])
    }
    const rule = wrappingInputRule({
      find: LIST_INPUT_RE,
      type: this.type,
      getAttributes: (match) => ({ start: Number(match[1]) }),
      joinPredicate,
    })
    return [rule]
  },
})

export default OrderedListParenExtension
