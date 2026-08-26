/**
 * P0 关键缺陷前端回归测试（knowledge-editor-fix-checklist.md）。
 *
 * 覆盖：
 * - P0-1  withFrontmatter 合并语义：保留 title/tags/自定义键，仅更新 ke_version；
 * - P0-4  setKeContent 后 can().undo()===false（切换文档不跨文档串内容）；
 * - P1-1  setKeContent 加载不触发 update/保存（emitUpdate=false）；
 * - P1-6  单飞保存队列：串行 latest-wins，乱序响应不覆盖磁盘；失败不卡链。
 */
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { setKeContent } from './index'
import { parseFrontmatter, stripFrontmatter, withFrontmatter } from './ke'
import { createSaveQueue } from '../utils/save-queue'

const EXTENSIONS = [
  StarterKit.configure({ trailingNode: { node: 'paragraph' } }),
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

function makeEditor(content: string): Editor {
  return new Editor({ extensions: EXTENSIONS, content, contentType: 'markdown' })
}

// ---------- P0-1：withFrontmatter 合并语义 ----------

describe('P0-1 withFrontmatter 保全字段', () => {
  it('保留 title/tags/自定义键，仅更新 ke_version', () => {
    const md = '---\ntitle: 旧标题\ntags: [a, b]\ncustom_key: hello\nke_version: 1\n---\n\n正文\n'
    const out = withFrontmatter(md, 2)
    expect(out).toContain('title: 旧标题')
    expect(out).toContain('tags: [a, b]')
    expect(out).toContain('custom_key: hello')
    expect(out).toContain('ke_version: 2')
    expect(out.endsWith('\n---\n\n正文\n')).toBe(true)
    // 不得出现重复 frontmatter：解析结果应恰为一个块，正文不再以 --- 开头
    const { content } = parseFrontmatter(out)
    expect(content).toBe('正文\n')
    expect(content.startsWith('---')).toBe(false)
  })

  it('无 frontmatter 时写入版本头（幂等）', () => {
    const out = withFrontmatter('# 纯正文\n')
    expect(out).toBe('---\nke_version: 1\n---\n\n# 纯正文\n')
    // 二次调用不叠加
    expect(withFrontmatter(out)).toBe(out)
  })

  it('stripFrontmatter 仍解析版本号与正文', () => {
    const { version, content } = stripFrontmatter('---\nke_version: 3\n---\n\n正文X\n')
    expect(version).toBe(3)
    expect(content).toBe('正文X\n')
  })
})

// ---------- P0-4 + P1-1：setKeContent 不进 undo 栈、加载不触发保存 ----------

describe('setKeContent 切换文档安全', () => {
  it('P0-4：加载 A → 切 B → can().undo()===false，undo 不串回 A', () => {
    const ed = makeEditor('# 文档A')
    setKeContent(ed, '# 文档B')
    expect(ed.can().undo()).toBe(false)
    // 用户输入后 undo 可用，且撤销的是本次编辑而非跨文档内容
    ed.commands.insertContent(' 追加')
    expect(ed.getMarkdown()).toContain('追加')
    expect(ed.can().undo()).toBe(true)
    ed.commands.undo()
    expect(ed.getMarkdown()).not.toContain('追加')
    expect(ed.getMarkdown()).toContain('文档B')
  })

  it('P1-1：加载不触发 update 事件（不会标 dirty → 3s 自动保存）', () => {
    const ed = makeEditor('# 初始')
    let updates = 0
    ed.on('update', () => {
      updates += 1
    })
    setKeContent(ed, '# 新文档')
    expect(updates).toBe(0)
    // 用户真实编辑仍派发 update
    ed.commands.insertContent(' X')
    expect(updates).toBeGreaterThanOrEqual(1)
  })
})

// ---------- P1-6：单飞保存队列 ----------

describe('P1-6 单飞保存队列', () => {
  it('两个保存串行执行（latest-wins），乱序响应不覆盖磁盘', async () => {
    const order: string[] = []
    const exec = async (t: { docId: string; md: string; seq: number }) => {
      order.push(t.md)
      // 旧请求故意慢于新请求返回（若并发执行，后完成的旧响应会覆盖磁盘）
      if (t.seq === 1) await new Promise((r) => setTimeout(r, 20))
      return true
    }
    const q = createSaveQueue(exec)
    const p1 = q.push({ docId: 'a.md', md: '旧内容', seq: 1 })
    const p2 = q.push({ docId: 'a.md', md: '新内容', seq: 2 })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe(true)
    expect(r2).toBe(true)
    // 串行：旧内容先落盘，新内容最后落盘
    expect(order).toEqual(['旧内容', '新内容'])
  })

  it('一处失败不卡死队列，后续任务继续', async () => {
    const q = createSaveQueue(async (t) => {
      if (t.seq === 2) throw new Error('boom')
      return true
    })
    const r1 = await q.push({ docId: 'a', md: 'm1', seq: 1 })
    const r2 = await q.push({ docId: 'a', md: 'm2', seq: 2 })
    const r3 = await q.push({ docId: 'a', md: 'm3', seq: 3 })
    expect(r1).toBe(true)
    expect(r2).toBe(false)
    expect(r3).toBe(true)
  })
})
