/** T08 实验：@tiptap/markdown 的 headless（无 DOM）parse→serialize 可行性探针。 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'

const cases: Array<{ name: string; md: string }> = [
  { name: 'basic', md: '---\ntitle: T\n---\n\n# 标题\n\n段落 **粗体** 与 `code`。\n' },
  { name: 'list', md: '- a\n- b\n\n1. c\n2. d\n' },
  { name: 'table', md: '| a | b |\n| --- | --- |\n| 1 | 2 |\n' },
  { name: 'crlf', md: '# t\r\n\r\np\r\n' },
  { name: 'unknown-comment', md: '<!-- ke-unknown: {"a":1} -->\n\n正文\n' },
  { name: 'html', md: '<div data-x="1">raw</div>\n' },
]

const out: Array<Record<string, unknown>> = []
for (const c of cases) {
  try {
    const editor = new Editor({
      extensions: [StarterKit, Markdown.configure({ indentation: { style: 'space', size: 2 } })],
      content: c.md,
      contentType: 'markdown',
    })
    const back = (editor as unknown as { getMarkdown: () => string }).getMarkdown()
    out.push({ name: c.name, ok: true, input: c.md, output: back, same: back === c.md })
  } catch (e) {
    out.push({ name: c.name, ok: false, error: String((e as Error)?.message ?? e) })
  }
}
console.log(JSON.stringify(out, null, 2))
