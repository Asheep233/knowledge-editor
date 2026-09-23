/**
 * task-50-A：公式节点 id 唯一性（根治「复制公式后编辑第二行却改到第一行」）。
 *
 * 背景：`math`/`mathBlock` 的 `id` 是**局部身份**（用于打开/保存时定位节点）。复制粘贴会经
 * `renderHTML(data-id)` ↔ `parseHTML` 原样带过 id → 同一文档出现两个同 id 公式 →
 * 定位逻辑命中第一个 → **用户改第二行、动的是第一行**（静默写错节点）。
 *
 * 策略：每次 **docChanged** 事务后扫描一次 `math`/`mathBlock` 的 id，保留第一个，其余用
 * `newId()` 重写（`setNodeMarkup`）。返回的 tr 作为 appendedTransaction 应用：
 *  - **单事务**（与触发它的编辑同一步撤销，撤销后回到重复状态，可再编辑再修复）；
 *  - 无重复 → 返回 null（**不产生空事务**）；
 *  - 只挑选 docChanged 事务（纯选区事务零开销）。
 *
 * ⚠️ **只处理 math / mathBlock**：`footnote`/`footnotes.items` 的 id 是**引用语义**
 * （引用节点与定义条目按 id 关联），去重会打断脚注编号/文本查找，故明确不碰。
 * 其它 ke-* 标记也不在本扩展范围内。
 *
 * 性能：一次 `descendants` 遍历（math 节点数量少）；大文档每次编辑一次遍历（实测说明见回报）。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { newId } from '../ke'
import { isMathNode } from '../math/cursor'

export const MATH_ID_UNIQUENESS_KEY = new PluginKey('mathIdUniqueness')

export const MathIdUniqueness = Extension.create({
  name: 'mathIdUniqueness',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: MATH_ID_UNIQUENESS_KEY,
        appendTransaction(
          transactions: readonly Transaction[],
          _oldState: EditorState,
          newState: EditorState,
        ) {
          // 纯选区/元数据事务：零开销直接返回（不产生空事务）
          if (!transactions.some((tr) => tr.docChanged)) return null

          const seen = new Set<string>()
          const duplicates: number[] = []
          newState.doc.descendants((node, pos) => {
            if (!isMathNode(node)) return true
            const id = (node.attrs.id as string) ?? ''
            if (!id) return true
            if (seen.has(id)) duplicates.push(pos)
            else seen.add(id)
            return true
          })
          if (duplicates.length === 0) return null

          const tr = newState.tr
          for (const pos of duplicates) {
            const node = tr.doc.nodeAt(pos)
            if (!node || !isMathNode(node)) continue
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newId() })
          }
          // setNodeMarkup 不改尺寸，多个位置的 pos 不会互相影响
          return tr.steps.length > 0 ? tr : null
        },
      }),
    ]
  },
})
