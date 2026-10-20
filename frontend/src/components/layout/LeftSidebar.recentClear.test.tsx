/**
 * F3「最近更新 → 清空」行为迁移说明（task-12）。
 *
 * 原实现位于 LeftSidebar（「最近更新」视图 → 「清空」按钮）：
 *   `void clearRecentDocuments().then(refreshAll)`
 * 后端 down / 请求失败时 Promise rejected 且无 catch → unhandled rejection（控制台报错；
 * 用户只看到「点了没反应」）。修复 = `.catch(...)` + 可见提示（window.alert 约定）。
 *
 * ⚠ 本文件旧 UI 级用例已删除：task-12 把侧栏 IA 收口为「导航 5 项 + 文件树 + footer」，
 * 「最近更新 / 清空」随功能迁到主画布知识库页（LibraryPage，task-9 独立实现并有自己的测试）。
 * 侧栏不再渲染 recent/tags 视图，因此无法也不应在 LeftSidebar 上复测该 UI。
 *
 * 保留一个**防回退**源码守卫：侧栏不得重新长回「最近/标签」双实现或抢走 clearRecentDocuments，
 * 否则迁移会悄悄退化成两套状态。迁移后的行为（失败提示 / 无 unhandled rejection）由
 * LibraryPage 侧测试覆盖（task-9）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SIDEBAR_SRC = readFileSync(resolve(process.cwd(), 'src/components/layout/LeftSidebar.tsx'), 'utf8')

describe('F3 — 最近/清空最近文档已迁出侧栏（防回退守卫）', () => {
  it('LeftSidebar 不再调用 clearRecentDocuments / getRecentDocuments / getTags（清空逻辑归 LibraryPage）', () => {
    expect(SIDEBAR_SRC, 'clearRecentDocuments 又出现在侧栏').not.toMatch(/clearRecentDocuments/)
    expect(SIDEBAR_SRC, 'getRecentDocuments 又出现在侧栏').not.toMatch(/getRecentDocuments/)
    expect(SIDEBAR_SRC, 'getTags 又出现在侧栏').not.toMatch(/getTags/)
  })

  it('LeftSidebar 不再内嵌「最近更新」视图入口与标签筛选状态（已迁主画布页面）', () => {
    expect(SIDEBAR_SRC, '侧栏又出现「最近更新」入口').not.toContain('最近更新')
    expect(SIDEBAR_SRC, '侧栏又出现标签筛选状态').not.toMatch(/setActiveTag|activeTag/)
  })
})
