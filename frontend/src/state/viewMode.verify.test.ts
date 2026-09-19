/**
 * 源码模式（字符串直存）—— 独立对抗验证套件 ①：视图态与**直存基底**（task-42 · verifier-attach）
 *
 * 规范：`docs/document-format.md` §6「编辑通道与视图」9 条硬契约（尤其 §6.2-1 不经 PM、§6.2-3 frontmatter
 * 以原块为准、§6.2-7 BOM/换行还原复用既有 traits）。
 * 我的可行性依据：`docs/analysis-1.1.10/source-mode.md` §4.1（41 构造实测：经 PM 一次往返
 * **逐字节一致 0/41**；其中 F-1…F-5 属首轮即丢/即坏）。
 *
 * 本文件第一层是**现在就能跑**的「直存基底」不变量（只依赖既有 `editor/ke.ts`，与被验证组件解耦）：
 *   ★ 核心性质：**零编辑保存 = 恒等映射** —— 有 frontmatter 的原文经
 *     `frontmatterBlockOf + withFrontmatter + applyDocTraits(captureDocTraits)` 组装后必须与原文**逐字节相同**。
 *     这条若成立，源码通道"打开→不改→保存"就不可能丢字节；它是整个模式立身之本的数学基础。
 * 第二层是待 task-41 冻结后实现的运行期用例（it.todo）。
 *
 * 写入边界（task-42）：本文件 + `SourceModeView.verify.test.tsx` + 报告；不得修改任何源码。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useKeEditor } from '../editor/index'
import * as vm from './viewMode'
import {
  KE_FRONTMATTER_KEY,
  KE_VERSION,
  applyDocTraits,
  captureDocTraits,
  frontmatterBlockOf,
  stripFrontmatter,
  withFrontmatter,
} from '../editor/ke'

const BOM = '\ufeff'

const readSrc = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

beforeEach(() => {
  // 视图态是模块级单值：逐用例重置，避免串味
  vm.__resetViewModeForTest('wysiwyg')
})

/**
 * 直存链路的组装（与设计文档 §2「保存路径」+ `document-format.md` §6.2.1 同构）：
 * **源码通道**必须显式传 `{ stripCaretArtifacts: false }` —— 否则用户真写的 U+200B 会被当光标锚点删除。
 * 本套件只做字符串运算，不碰组件。
 */
function directSavePayload(raw: string, editedBody?: string): string {
  const fm = frontmatterBlockOf(raw) ?? ''
  const body = editedBody ?? stripFrontmatter(raw).content
  const merged = withFrontmatter(fm + body, KE_VERSION, { stripCaretArtifacts: false })
  return applyDocTraits(merged, captureDocTraits(raw))
}

/** 正文（WYSIWYG）通道口径：默认参数 → 仍剥除光标锚点（P3-16，修复不得把正文通道改坏） */
function wysiwygPayload(raw: string): string {
  const fm = frontmatterBlockOf(raw) ?? ''
  const body = stripFrontmatter(raw).content
  return applyDocTraits(withFrontmatter(fm + body, KE_VERSION), captureDocTraits(raw))
}

// 高敏感样本（取自 41 构造矩阵里首轮即丢/即坏与最易被规范的项）
const SENSITIVE: Array<{ name: string; raw: string }> = [
  {
    name: '任务列表 - [x]（PM 通道会丢复选框：F-1）',
    raw: `---\n${KE_FRONTMATTER_KEY}: 1\n# 保留我\n---\n\n- [x] 完成\n- [ ] 未完成\n`,
  },
  {
    name: '行内 HTML <span style>（PM 通道会丢标签：F-2）',
    raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n正文 <span style="color:red">红</span> 结尾\n`,
  },
  {
    name: 'HTML 实体 &copy;（PM 通道二次转义：F-3）',
    raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n版权所有 &copy; 2026\n`,
  },
  {
    name: 'CRLF 全文（PM 通道统一为 LF：F-5）',
    raw: `---\r\n${KE_FRONTMATTER_KEY}: 1\r\n---\r\n\r\n# 标题\r\n\r\n正文\r\n`,
  },
  {
    name: 'BOM 开头（F-4）',
    raw: `${BOM}---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n正文\n`,
  },
  {
    name: '未知/损坏 ke-* 标记',
    raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n<!-- ke-future: {"x":1} -->\n\n<!-- ke-attach: {"src": broken -->\n`,
  },
  {
    name: '正文中的 --- 分隔线（不得被当成新 frontmatter）',
    raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n---\n\n正文\n`,
  },
  {
    name: 'frontmatter 含注释与未知键（逐字节保留）',
    raw: `---\n# 我是一条注释\n${KE_FRONTMATTER_KEY}: 1\ntitle: 标题\ncustom: [a, b]\n---\n\n正文\n`,
  },
]

/** 设计内规范化构造（41 矩阵 (a) 类）：正文通道会改写，源码通道零编辑保存必须**同样恒等** */
const DESIGN_NORMALIZED: Array<{ name: string; raw: string }> = [
  { name: 'GFM 脚注（正文通道会转 ke 方言）', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n正文[^1]。\n\n[^1]: 脚注内容\n` },
  { name: 'ke-note 缺默认字段（正文通道会补 kind/color）', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n<!-- ke-note: {"id":"n1","title":"注"} -->\n` },
  { name: 'ke-attach 缺 kind/id/type', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n<!-- ke-attach: {"src":"a.png"} -->\n` },
  { name: 'Obsidian 式 1) 有序列表', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n1) 第一\n2) 第二\n` },
  { name: '表格分隔行无空格 + 文档以表格开头（会插前导空行）', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n|a|b|\n|---|---|\n|1|2|\n` },
  { name: '引用式链接 + 定义行', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n[文字][ref]\n\n[ref]: https://x "标题"\n` },
  { name: '角括号自动链接', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n<https://x>\n` },
  { name: 'Setext 标题', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n标题\n====\n` },
  { name: '波浪线围栏', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n~~~js\nconst a = 1\n~~~\n` },
  { name: '缩进代码块（4 空格）', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n    indented code\n` },
  { name: '松散列表（列表项间空行）', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n- 一\n\n- 二\n` },
  { name: '紧凑列表 + 尾随 3 空格硬换行', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n- 一\n- 二  \n- 三\n` },
  { name: '连续多空行 + 转义星号', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n第一段\n\n\n\n\\*转义星号\\*\n` },
  { name: ':::note 未识别容器 + 嵌套引用块', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n:::note\n引用块内：\n> 一级\n> > 二级\n:::\n` },
  { name: 'HTML 块 <div> + 普通注释', raw: `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n<div>块</div>\n\n<!-- 普通注释 -->\n` },
]

/** 对抗边界样本：零编辑保存若**不是**恒等，即内容被静默改动 */
const EDGE_U200B = `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n前\u200b后\n`
const EDGE_MIXED_EOL = `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\nA\nB\nC\r\nD\n`

const SAMPLE_FM = `---\n# 注释\n${KE_FRONTMATTER_KEY}: 1\ntitle: 标题\n---\n\n正文\n`

describe('V0-1 直存基底：frontmatter 区块与 BOM/换行 traits', () => {
  it('frontmatterBlockOf + stripFrontmatter 重组 == 原文（含 BOM / CRLF / 注释与未知键）', () => {
    for (const { name, raw } of SENSITIVE) {
      const fm = frontmatterBlockOf(raw) ?? ''
      const body = stripFrontmatter(raw).content
      // 注：BOM 由 traits 还原（两个 helper 都刻意剥离 BOM，见 ke.ts F-4 注释）
      const reassembled = applyDocTraits(fm + body, captureDocTraits(raw))
      expect(reassembled, `重组不等价：${name}`).toBe(raw)
      expect(fm + body, `重组（未还原 BOM/换行）应为原文去掉 BOM：${name}`).toBe(raw.startsWith(BOM) ? raw.slice(1) : raw)
    }
  })

  it('正文里的 --- 不会被当作 frontmatter（只匹配文档开头块）', () => {
    const raw = `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n---\n\n正文\n`
    const body = stripFrontmatter(raw).content
    expect(body).toBe('---\n\n正文\n')
    expect(frontmatterBlockOf(raw)).toBe(`---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n`)
  })

  it('captureDocTraits/applyDocTraits：BOM 与 CRLF 往返还原且幂等', () => {
    const crlf = `# 标题\r\n\r\n正文\r\n`
    const t = captureDocTraits(BOM + crlf)
    expect(t).toEqual({ bom: true, eol: '\r\n' })
    const restored = applyDocTraits('# 标题\n\n正文\n', t)
    expect(restored).toBe(BOM + crlf)
    expect(applyDocTraits(restored, t), 'traits 还原必须幂等').toBe(restored)

    const lf = captureDocTraits('# 标题\n\n正文\n')
    expect(lf).toEqual({ bom: false, eol: '\n' })
  })

  it('withFrontmatter 只更新 ke_version：未知键/注释逐字节保留', () => {
    const out = withFrontmatter(SAMPLE_FM, KE_VERSION)
    expect(out).toBe(SAMPLE_FM) // 版本已是最新 → 整篇逐字节不变
    const bumped = withFrontmatter(SAMPLE_FM, 9)
    expect(bumped).toBe(SAMPLE_FM.replace(`${KE_FRONTMATTER_KEY}: 1`, `${KE_FRONTMATTER_KEY}: 9`))
    expect(bumped, '未知键与注释必须保留').toContain('# 注释')
    expect(bumped).toContain('title: 标题')
  })
})

describe('V0-2b ★ 设计内规范化构造：源码通道零编辑保存同样必须恒等', () => {
  it('正文通道会改写的 15 个构造，经源码通道零编辑保存必须逐字节不变', () => {
    for (const { name, raw } of DESIGN_NORMALIZED) {
      expect(directSavePayload(raw), `源码通道零编辑保存改变了字节：${name}`).toBe(raw)
    }
  })

  it('样本集判别力自检：必须真的包含会被正文通道改写的写法', () => {
    const joined = DESIGN_NORMALIZED.map((x) => x.raw).join('\n')
    for (const marker of ['[^1]:', '1) 第', '|---|---|', '[ref]:', '====', '~~~js', '    indented']) {
      expect(joined.includes(marker), `样本集缺构造：${marker}`).toBe(true)
    }
  })
})

describe('V0-2c 对抗边界：零编辑保存不得静默改动任何字节', () => {
  it('正文含用户写入的 U+200B：源码通道零编辑保存必须原样保留（§6.2.1 / stripCaretArtifacts:false）', () => {
    expect(directSavePayload(EDGE_U200B), '用户写入的零宽空格被静默删除').toBe(EDGE_U200B)
  })

  it('对照：正文通道（默认参数）仍剥除 U+200B 光标锚点 —— 修复源码通道不得改坏 WYSIWYG 语义', () => {
    expect(wysiwygPayload(EDGE_U200B), '正文通道必须继续剥除 P3-16 光标锚点').toBe(EDGE_U200B.replace(/\u200b/g, ''))
    // 默认参数 = 不传开关 → 与显式 true 等价
    const mergedDefault = withFrontmatter(EDGE_U200B, KE_VERSION)
    expect(mergedDefault.includes('\u200b'), '默认参数必须仍剥除锚点').toBe(false)
    const mergedFalse = withFrontmatter(EDGE_U200B, KE_VERSION, { stripCaretArtifacts: false })
    expect(mergedFalse.includes('\u200b'), '显式 false 必须保留用户字符').toBe(true)
  })

  it('D-4（已声明限制）：纯 LF / 纯 CRLF 文档零编辑保存逐字节保留；混合 EOL 统一为主导风格', () => {
    // 纯 LF —— 必须逐字节保留
    const pureLf = `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\nA\nB\nC\nD\n`
    expect(directSavePayload(pureLf), '纯 LF 文档必须逐字节保留').toBe(pureLf)

    // 纯 CRLF —— 必须逐字节保留（含 BOM 组合）
    const pureCrlf = `---\r\n${KE_FRONTMATTER_KEY}: 1\r\n---\r\n\r\nA\r\nB\r\n`
    expect(directSavePayload(pureCrlf), '纯 CRLF 文档必须逐字节保留').toBe(pureCrlf)

    // 混合 EOL —— D-4 已声明限制：DocTraits 为文档级模型，统一为文档主导风格（此处 LF）
    const out = directSavePayload(EDGE_MIXED_EOL)
    expect(out, 'D-4：混合 EOL 按主导风格统一（documented behavior）').toBe(EDGE_MIXED_EOL.replace(/\r\n/g, '\n'))
    expect(out.includes('\r'), '统一后不得残留 CR').toBe(false)
    expect(out.replace(/\r\n/g, '\n'), '除换行风格外不得改动任何字节').toBe(
      EDGE_MIXED_EOL.replace(/\r\n/g, '\n'),
    )
  })
})

describe('V0-2 ★ 零编辑保存 = 恒等映射（直存保真的数学基础）', () => {
  it('有 frontmatter 的原文：零编辑经直存链路 → 逐字节等于原文', () => {
    for (const { name, raw } of SENSITIVE) {
      expect(directSavePayload(raw), `零编辑保存改变了字节：${name}`).toBe(raw)
    }
  })

  it('对照：零编辑也不能凭空新增/删除 frontmatter 键', () => {
    const out = directSavePayload(SAMPLE_FM)
    expect(out.split('\n').filter((l) => l.includes(':'))).toEqual(
      SAMPLE_FM.split('\n').filter((l) => l.includes(':')),
    )
  })

  it('无 frontmatter 的原文：用户正文逐字节保留，仅新增版本头', () => {
    const rawNoFm = `# 标题\n\n- [x] 完成 &copy;\n`
    const out = directSavePayload(rawNoFm)
    expect(out).toBe(`---\n${KE_FRONTMATTER_KEY}: ${KE_VERSION}\n---\n\n${rawNoFm}`)
    expect(out.endsWith(rawNoFm), '正文必须原样追加').toBe(true)
  })

  it('BOM/CRLF 原文：正文按 traits 还原（用户写 LF 也按原文换行风格落盘）', () => {
    const raw = `---\r\n${KE_FRONTMATTER_KEY}: 1\r\n---\r\n\r\n# 标题\r\n\r\n- [x] 完成\r\n`
    // 用户在 textarea 里看到的是 LF（HTML textarea API 会把换行规范化为 LF）
    const editedLf = `# 标题\n\n- [x] 完成\n`
    const payload = directSavePayload(raw, editedLf)
    expect(payload.startsWith(BOM)).toBe(false)
    expect(payload).toBe(raw) // 按 traits 还原后应与原文一致
  })
})

// ============================================================================
// 第二层：待「源码就绪 + 冻结 sha」后实现的运行期用例
// ============================================================================
describe('V1 视图态模块（state/viewMode.ts）', () => {
  const fakeStorage = (init: Record<string, string> = {}) => {
    const map = new Map(Object.entries(init))
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v)
      },
    }
  }

  it('读写往返：writeViewMode("source") → 存储键 ke.viewMode；readViewMode 读回 source', () => {
    const st = fakeStorage()
    vm.writeViewMode('source', st)
    expect(st.map.get(vm.VIEW_MODE_STORAGE_KEY)).toBe('source')
    expect(vm.readViewMode(st)).toBe('source')
    vm.writeViewMode('wysiwyg', st)
    expect(vm.readViewMode(st)).toBe('wysiwyg')
  })

  it('默认与非法值：缺失/垃圾/大小写不符 → 一律 wysiwyg（既有版本行为不变）', () => {
    expect(vm.normalizeViewMode(undefined)).toBe('wysiwyg')
    expect(vm.normalizeViewMode(null)).toBe('wysiwyg')
    expect(vm.normalizeViewMode('SOURCE')).toBe('wysiwyg')
    expect(vm.normalizeViewMode('source ')).toBe('wysiwyg')
    expect(vm.normalizeViewMode('')).toBe('wysiwyg')
    expect(vm.normalizeViewMode(1)).toBe('wysiwyg')
    expect(vm.readViewMode(fakeStorage({ [vm.VIEW_MODE_STORAGE_KEY]: '{}' }))).toBe('wysiwyg')
    expect(vm.readViewMode(null)).toBe('wysiwyg')
  })

  it('全局单值 + 订阅：setViewMode 通知一次；同值 no-op；退订后不再通知', () => {
    vm.__resetViewModeForTest('wysiwyg')
    const spy = vi.fn()
    const off = vm.subscribeViewMode(spy)

    vm.setViewMode('source')
    expect(vm.getViewMode()).toBe('source')
    expect(spy).toHaveBeenCalledTimes(1)

    vm.setViewMode('source') // 同值
    expect(spy, '同值 setViewMode 必须 no-op（不触发重渲染）').toHaveBeenCalledTimes(1)

    vm.setViewMode('wysiwyg')
    expect(spy).toHaveBeenCalledTimes(2)

    off()
    vm.setViewMode('source')
    expect(spy, '退订后不得再通知').toHaveBeenCalledTimes(2)
  })

  it('全局语义：存储键固定且不含文档 id（不按文档记忆）', () => {
    expect(vm.VIEW_MODE_STORAGE_KEY).toBe('ke.viewMode')
    expect(vm.VIEW_MODE_STORAGE_KEY.includes('/'), '存储键不得含文档路径').toBe(false)
  })

  it('存储不可用时不崩：写抛错被吞、读抛错回退 wysiwyg；内存态仍生效', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => vm.writeViewMode('source', throwing)).not.toThrow()
    expect(vm.readViewMode(throwing)).toBe('wysiwyg')

    vm.__resetViewModeForTest('wysiwyg')
    vm.setViewMode('source')
    expect(vm.getViewMode()).toBe('source')
  })

  it('canEnterSourceMode：无文档 / 只读 / 版本预览态均不可进入', () => {
    expect(vm.canEnterSourceMode({ hasArticle: false, readOnly: false })).toBe(false)
    expect(vm.canEnterSourceMode({ hasArticle: true, readOnly: true })).toBe(false)
    expect(vm.canEnterSourceMode({ hasArticle: false, readOnly: true })).toBe(false)
    expect(vm.canEnterSourceMode({ hasArticle: true, readOnly: false })).toBe(true)
  })

  it('__resetViewModeForTest：重置为指定态并清空订阅者（避免用例间串味）', () => {
    const spy = vi.fn()
    vm.subscribeViewMode(spy)
    vm.__resetViewModeForTest('source')
    expect(vm.getViewMode()).toBe('source')
    vm.setViewMode('wysiwyg')
    expect(spy, '重置应清空订阅者').not.toHaveBeenCalled()
  })
})

describe('V2 未知/损坏 ke-* 标记的 diff 检测（保存提示的判据）', () => {
  const KNOWN = '<!-- ke-note: {"kind":"note","id":"n1","title":"注","color":"blue"} -->'
  const UNKNOWN_KIND = '<!-- ke-future: {"x":1} -->'
  const BROKEN_JSON = '<!-- ke-attach: {"src": broken -->'
  const UNCLOSED = '<!-- ke-module: {"id":"m1"}'

  it('scanKeMarkers：合法已知 kind → known；未知 kind / 损坏 JSON / 未闭合 → unknown', () => {
    const r = vm.scanKeMarkers(`正文\n${KNOWN}\n${UNKNOWN_KIND}\n${BROKEN_JSON}\n\n${UNCLOSED}`)
    expect(r.known, '仅合法已知 ke-* 计为 known').toBe(1)
    expect(r.unknown.length).toBe(3)
    expect(r.unknown.join('\n')).toContain('ke-future')
    expect(r.unknown.join('\n')).toContain('ke-attach')
    expect(r.unknown.join('\n')).toContain('ke-module')
  })

  it('不误报：合法 ke-* 内部生成的 ke-<hex> 稳定 id 不得被当成未知标记', () => {
    const r = vm.scanKeMarkers(`<!-- ke-note: {"kind":"note","id":"ke-66fe4755e166","title":"x"} -->`)
    expect(r.known).toBe(1)
    expect(r.unknown, 'keStableId 的 ke-<hex> 不得误报').toEqual([])
  })

  it('未改动 → unknownMarkersChanged=false（首次保存不得弹提示）', () => {
    const src = `正文\n${UNKNOWN_KIND}\n普通段落\n`
    expect(vm.unknownMarkersChanged(src, src)).toBe(false)
    expect(vm.hasUnknownKeMarkers(src)).toBe(true)
  })

  it('改写 / 删除 / 新增未知标记 → 必须判为改动（保存必须提示）', () => {
    const before = `正文\n${UNKNOWN_KIND}\n`
    expect(vm.unknownMarkersChanged(before, `正文\n<!-- ke-future: {"x":2} -->\n`), '改写').toBe(true)
    expect(vm.unknownMarkersChanged(before, '正文\n'), '删除').toBe(true)
    expect(vm.unknownMarkersChanged('正文\n', before), '新增').toBe(true)
  })

  it('仅改动普通正文（已知语法）→ 不得误报', () => {
    const before = `# 标题\n\n正文一\n\n- [x] 完成\n\n${KNOWN}\n`
    const after = `# 标题改了\n\n正文二 &copy; <span>x</span>\n\n- [ ] 未完成\n\n${KNOWN}\n`
    expect(vm.unknownMarkersChanged(before, after), '只改普通正文不得触发提示').toBe(false)
  })

  it('标记顺序变化但集合相同 → 不算改动；数量变化 → 算改动', () => {
    const a = `${UNKNOWN_KIND}\n${BROKEN_JSON}\n`
    const b = `${BROKEN_JSON}\n${UNKNOWN_KIND}\n`
    expect(vm.unknownMarkersChanged(a, b), '集合相同、顺序不同 → 不算改动').toBe(false)
    expect(vm.unknownMarkersChanged(a, `${UNKNOWN_KIND}\n`), '数量减少 → 算改动').toBe(true)
  })

  it('hasUnknownKeMarkers：无未知标记的干净文档为 false（切回正文不得无谓提示）', () => {
    expect(vm.hasUnknownKeMarkers(`# 标题\n\n普通正文\n${KNOWN}\n`)).toBe(false)
    expect(vm.hasUnknownKeMarkers(`正文 <span>x</span> &copy;\n`), '普通 HTML 不属 ke-* 未知标记').toBe(false)
  })
})

describe('V3 直存载荷组装（buildSourceSavePayload / buildSourceDraft）', () => {
  it('载荷 = 原 frontmatter 区块（逐字节）+ 用户正文 + ke_version；敏感方言不被规范化', () => {
    const base = `---\n# 注释\n${KE_FRONTMATTER_KEY}: 1\ntitle: 标题\n---\n\n旧正文\n`
    const edited = `- [x] 完成\n\n正文 <span style="color:red">红</span> &copy;\n\n<!-- ke-future: {"x":1} -->\n`
    const payload = vm.buildSourceSavePayload(base, edited)

    expect(payload).toBe(`---\n# 注释\n${KE_FRONTMATTER_KEY}: 1\ntitle: 标题\n---\n\n${edited}`)
    expect(payload, 'frontmatter 注释与未知键逐字节保留').toContain('# 注释')
    expect(payload, '- [x] 复选框不得被剥成 - ').toContain('- [x] 完成')
    expect(payload, '行内 HTML 不得被剥离').toContain('<span style="color:red">红</span>')
    expect(payload, 'HTML 实体不得二次转义').toContain('&copy;')
    expect(payload, '未知 ke-* 原样保留').toContain('ke-future: {"x":1}')
  })

  it('正文里手写 --- 不产生第二个 frontmatter/ke_version 头', () => {
    const base = `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n旧\n`
    const payload = vm.buildSourceSavePayload(base, `---\n\n正文\n`)
    expect(payload.match(new RegExp(KE_FRONTMATTER_KEY, 'g'))?.length, 'ke_version 只允许出现一次').toBe(1)
    expect(payload).toBe(`---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n---\n\n正文\n`)
  })

  it('零编辑保存恒等：18 个高敏感/规范化构造经 buildSourceSavePayload(base, 正文) 逐字节等于原文', () => {
    for (const { name, raw } of [...SENSITIVE, ...DESIGN_NORMALIZED]) {
      const body = vm.sourceBodyOf(raw)
      expect(vm.buildSourceSavePayload(raw, body), `零编辑保存改变字节：${name}`).toBe(raw)
    }
  })

  it('BOM/CRLF 还原：非换行字节不变 + 换行按 traits 还原（含用户只写 LF 的情形）', () => {
    const crlf = `---\r\n${KE_FRONTMATTER_KEY}: 1\r\n---\r\n\r\n# 标题\r\n\r\n- [x] 完成\r\n`
    const lfBody = `# 标题\n\n- [x] 完成\n`
    expect(vm.buildSourceSavePayload(crlf, lfBody)).toBe(crlf)

    const bom = `${BOM}---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n正文\n`
    expect(vm.buildSourceSavePayload(bom, '正文\n')).toBe(bom)

    // 混合 EOL = D-4 已声明限制（统一为主导风格）；除换行外不得改动
    const mixed = `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\nA\nB\nC\r\nD\n`
    const out = vm.buildSourceSavePayload(mixed, vm.sourceBodyOf(mixed))
    expect(out, 'D-4：混合 EOL 统一为主导风格').toBe(mixed.replace(/\r\n/g, '\n'))
  })

  it('U+200B 保留（源码通道）；草稿恒 LF/无 BOM 且同样保留 U+200B', () => {
    const base = `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n前\u200b后\n`
    expect(vm.buildSourceSavePayload(base, vm.sourceBodyOf(base)), '源码载荷必须保留用户零宽空格').toBe(base)

    const crlf = `---\r\n${KE_FRONTMATTER_KEY}: 1\r\n---\r\n\r\n前\u200b后\r\n`
    const draft = vm.buildSourceDraft(crlf, '前\u200b后\r\n')
    expect(draft.includes('\r'), '草稿必须恒 LF').toBe(false)
    expect(draft.startsWith(BOM), '草稿必须无 BOM').toBe(false)
    expect(draft.includes('\u200b'), '草稿不得剥除用户零宽空格').toBe(true)
  })

  it('≥256KB 大文档：纯字符串拼接（无 parse/serialize），且不抛错', () => {
    const body = '段落内容 &copy; <span>x</span>\n'.repeat(12000) // ≈ 300KB
    const base = `---\n${KE_FRONTMATTER_KEY}: 1\n---\n\n${body}`
    const t0 = Date.now()
    const out = vm.buildSourceSavePayload(base, body + '尾部\n')
    const ms = Date.now() - t0
    expect(out.endsWith('尾部\n')).toBe(true)
    expect(out.length).toBeGreaterThan(300_000)
    expect(ms, `256KB 直存耗时 ${ms}ms 应远低于正文切换量级`).toBeLessThan(500)

    // 源码级：本模块不得引入 tiptap/prosemirror
    const src = readSrc('./viewMode.ts')
    for (const forbidden of ['@tiptap', 'prosemirror']) {
      expect(src.includes(forbidden), `viewMode 不得依赖 ${forbidden}`).toBe(false)
    }
  })
})

// ============================================================================
// V4 对照实验：正文通道（真实 PM 管线）必变 vs 源码通道逐字节不变
// ============================================================================
describe('V4 对照实验（先实测、后取证）', () => {
  it('真实 PM 管线实测每个样本；源码通道对全部样本逐字节不变；只有实测变化的样本作为对照证据', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    let ed: { commands: { setContent: (s: string, o?: unknown) => void }; getMarkdown: () => string } | null = null
    const Probe = () => {
      // 真实应用管线（useKeEditor = 应用同一套扩展）
      const editor = useKeEditor({ content: '# probe\n', onUpdate: () => undefined })
      useEffect(() => {
        ed = editor as unknown as typeof ed
      }, [editor])
      return null
    }
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(Probe))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(ed, '未取得真实编辑器实例').toBeTruthy()

    // 行尾换行不计差（与仓库 fidelity-regression 同口径）
    const norm = (v: string): string => v.replace(/\s+$/, '')
    const changed: string[] = []
    const unchanged: string[] = []

    for (const { name, raw } of [...SENSITIVE, ...DESIGN_NORMALIZED]) {
      const body = stripFrontmatter(raw).content
      let pmOut = ''
      await act(async () => {
        ed!.commands.setContent(body, { contentType: 'markdown', emitUpdate: false })
        pmOut = ed!.getMarkdown()
      })
      ;(norm(pmOut) === norm(body) ? unchanged : changed).push(name)

      // 源码通道：零编辑保存必须逐字节等于原文（本模式的价值主张）
      expect(vm.buildSourceSavePayload(raw, body), `源码通道改变了字节：${name}`).toBe(raw)
    }

    // 实测结论（本用例运行时锁定）：至少存在若干「正文通道确实改写」的样本，
    // 否则对照实验失去意义；同时全部样本在源码通道恒等。
    // eslint-disable-next-line no-console
    console.log(
      'CONTRAST changed=' + JSON.stringify(changed) + ' unchanged=' + JSON.stringify(unchanged),
    )
    expect(changed.length, '正文通道实测改写的样本必须存在（对照实验非平凡）').toBeGreaterThan(0)
    expect(changed.length + unchanged.length).toBe(SENSITIVE.length + DESIGN_NORMALIZED.length)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})

// 说明：源码模式的**对照实验**（同输入经正文通道必变、经源码通道不变）需要真实 PM 管线，
// 已列入 `SourceModeView.verify.test.tsx`（组件级）与第二段报告。
export const SENSITIVE_SAMPLES = SENSITIVE
