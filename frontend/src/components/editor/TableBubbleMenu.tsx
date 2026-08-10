/**
 * 表格气泡菜单（表格功能增强）：
 * 光标进入表格（或拖选单元格）时，在表格上方浮动显示操作条，
 * 支持增删行列、合并/拆分单元格、删除整个表格。
 *
 * 实现：Tiptap v3 BubbleMenu（Floating UI 定位）。
 * - shouldShow 覆盖默认的「非空选区」限制：折叠光标位于单元格内也显示；
 * - appendTo body：避免被编辑区滚动容器裁剪；
 * - 按钮 onMouseDown preventDefault：防止点击按钮导致编辑器失焦而隐藏菜单。
 */
import { BubbleMenu } from '@tiptap/react/menus'
import { useCurrentEditor, useEditorState, type Editor } from '@tiptap/react'

function TBtn({
  label,
  title,
  onClick,
  disabled,
}: {
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={[
        'rounded px-2 py-1 text-[11px] transition-colors',
        disabled ? 'cursor-not-allowed text-gray-300' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function MenuDivider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200" />
}

function TableBubbleMenuInner({ editor }: { editor: Editor }) {
  const s =
    useEditorState({
      editor,
      selector: ({ editor: e }) => {
        if (!e) {
          return { canMerge: false, canSplit: false, canDelRow: false, canDelCol: false, canDelTable: false }
        }
        return {
          canMerge: e.can().mergeCells(),
          canSplit: e.can().splitCell(),
          canDelRow: e.can().deleteRow(),
          canDelCol: e.can().deleteColumn(),
          canDelTable: e.can().deleteTable(),
        }
      },
    }) ?? { canMerge: false, canSplit: false, canDelRow: false, canDelCol: false, canDelTable: false }

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={0}
      appendTo={() => document.body}
      shouldShow={({ editor: ed, view, element }) =>
        ed.isEditable && ed.isActive('table') && (view.hasFocus() || element.contains(document.activeElement))
      }
      options={{ placement: 'top', offset: 8 }}
      className="z-50 flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1 py-0.5 shadow-lg"
    >
      <TBtn label="上插行" title="在上方插入一行" onClick={() => editor.chain().focus().addRowBefore().run()} />
      <TBtn label="下插行" title="在下方插入一行" onClick={() => editor.chain().focus().addRowAfter().run()} />
      <MenuDivider />
      <TBtn label="左插列" title="在左侧插入一列" onClick={() => editor.chain().focus().addColumnBefore().run()} />
      <TBtn label="右插列" title="在右侧插入一列" onClick={() => editor.chain().focus().addColumnAfter().run()} />
      <MenuDivider />
      <TBtn
        label="删行"
        title="删除当前行"
        disabled={!s.canDelRow}
        onClick={() => editor.chain().focus().deleteRow().run()}
      />
      <TBtn
        label="删列"
        title="删除当前列"
        disabled={!s.canDelCol}
        onClick={() => editor.chain().focus().deleteColumn().run()}
      />
      <MenuDivider />
      <TBtn
        label="合并"
        title="合并选中的多个单元格"
        disabled={!s.canMerge}
        onClick={() => editor.chain().focus().mergeCells().run()}
      />
      <TBtn
        label="拆分"
        title="拆分已合并的单元格"
        disabled={!s.canSplit}
        onClick={() => editor.chain().focus().splitCell().run()}
      />
      <MenuDivider />
      <TBtn
        label="删表"
        title="删除整个表格"
        disabled={!s.canDelTable}
        onClick={() => editor.chain().focus().deleteTable().run()}
      />
    </BubbleMenu>
  )
}

export default function TableBubbleMenu() {
  const { editor } = useCurrentEditor()
  if (!editor) return null
  return <TableBubbleMenuInner editor={editor} />
}
