/**
 * 列表扩展（v1.1.5 ⑥）。
 *
 * 1) OrderedListParenExtension：输入规则支持 `1. ` / `1) `（Obsidian 式）；
 *    默认 Tiptap 输入规则只认 `1. `（硬编码 orderedListInputRegex = /^(\d+)\.\s$/），
 *    `1) ` 不转换 → 两行混排（列表 + 纯文本）→ `)` 视觉不对齐。
 *    序列化输出仍为规范化的 `1. `（连续、无空行、渲染对齐）。
 *
 * 2) KeListItem：空列表项 Enter 行为（Obsidian 式）。
 *    Tiptap 默认：空列表项 Enter = 退出列表——用户输入 `1. `（转换后项为空）
 *    立即回车 → 列表"被删掉"。改为：空项 Enter → 继续列表（生成下一项）；
 *    新项仍空再 Enter → 退出列表（回到段落）；非空项 Enter → 正常 split。
 */
import { OrderedList } from '@tiptap/extension-list'
import { ListItem } from '@tiptap/extension-list'
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

let continuationEmpty = false

export const KeListItem = ListItem.extend({
  // 高优先级：确保 Enter 行为对列表项生效（默认同优先级时按键可能被 StarterKit 系抢先）
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const ed = this.editor
        const { $from } = ed.state.selection
        let li: ReturnType<typeof $from.node> | null = null
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'listItem') {
            li = $from.node(d)
            break
          }
        }
        if (!li) return false
        const isEmpty = li.textContent.length === 0 && li.childCount <= 1
        if (isEmpty) {
          if (continuationEmpty) {
            continuationEmpty = false
            return ed.commands.liftListItem('listItem')
          }
          continuationEmpty = true
          // splitListItem 对「真空项」会内部转 lift（删列表的根因）——
          // 手动事务：在当前 li 后插入同列表的新空 li，并把光标移到其中。
          const schema = ed.state.schema
          const newLi = schema.nodes.listItem.create(
            null,
            schema.nodes.paragraph.create(null),
          )
          // 定位当前 li 的结束位置（作为同级插入点）
          let pos = -1
          let endPos = -1
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              pos = $from.before(d)
              endPos = $from.after(d)
              break
            }
          }
          if (pos < 0 || endPos < 0) return false
          const tr = ed.state.tr.insert(endPos, newLi).scrollIntoView()
          ed.view.dispatch(tr)
          ed.commands.setTextSelection(endPos + 1) // 新 li 的 paragraph 首
          return true
        }
        continuationEmpty = false
        return ed.commands.splitListItem('listItem')
      },
    }
  },
})

export default OrderedListParenExtension
