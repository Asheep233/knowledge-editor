/**
 * task-41（v1.2.0-pre.2）· 源码模式纯逻辑测试（`state/viewMode.ts`）。
 *
 * 规范：`document-format.md` §6「编辑通道与视图」（§6.2-1 不经 PM、§6.2-3 frontmatter 原块、
 * §6.2-6 全局视图态、§6.2.1 U+200B 不剥除 / D-4 换行按 traits 还原）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetViewModeForTest,
  buildSourceDraft,
  buildSourceSavePayload,
  canEnterSourceMode,
  getViewMode,
  hasUnknownKeMarkers,
  normalizeViewMode,
  readViewMode,
  scanKeMarkers,
  setViewMode,
  sourceBodyOf,
  subscribeViewMode,
  unknownMarkersChanged,
  VIEW_MODE_STORAGE_KEY,
  writeViewMode,
  type StorageLike,
} from './viewMode'

const BOM = '\ufeff'
const ZWSP = '\u200b'

/** 可注入存储替身 */
function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  } satisfies StorageLike & { dump: () => Record<string, string> }
}

beforeEach(() => {
  __resetViewModeForTest('wysiwyg')
})

describe('① 视图态：全局单值 + 存储', () => {
  it('V1 读写往返；键 = ke.viewMode', () => {
    const s = memStorage()
    expect(readViewMode(s)).toBe('wysiwyg')
    writeViewMode('source', s)
    expect(s.dump()).toEqual({ [VIEW_MODE_STORAGE_KEY]: 'source' })
    expect(readViewMode(s)).toBe('source')
  })

  it('V2 非法/缺失值一律回退 wysiwyg（默认视图与既有版本一致）', () => {
    for (const bad of [null, '', 'SOURCE', 'wysiwygx', '1']) {
      expect(normalizeViewMode(bad)).toBe('wysiwyg')
    }
    expect(readViewMode(memStorage({ [VIEW_MODE_STORAGE_KEY]: '???' }))).toBe('wysiwyg')
  })

  it('V3 存储不可用（异常）不抛错', () => {
    const boom: StorageLike = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readViewMode(boom)).toBe('wysiwyg')
    expect(() => writeViewMode('source', boom)).not.toThrow()
  })

  it('V4 setViewMode 写存储 + 通知订阅者；同值 no-op', () => {
    const s = memStorage()
    writeViewMode('wysiwyg', s)
    const listener = vi.fn()
    const off = subscribeViewMode(listener)
    setViewMode('source')
    expect(getViewMode()).toBe('source')
    expect(listener).toHaveBeenCalledTimes(1)
    setViewMode('source') // 同值
    expect(listener).toHaveBeenCalledTimes(1)
    setViewMode('wysiwyg')
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    setViewMode('source')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('V5 只读/无文档不得进入源码模式（§6.2-8）', () => {
    expect(canEnterSourceMode({ hasArticle: true, readOnly: false })).toBe(true)
    expect(canEnterSourceMode({ hasArticle: true, readOnly: true })).toBe(false)
    expect(canEnterSourceMode({ hasArticle: false, readOnly: false })).toBe(false)
  })
})

describe('② 源码正文：frontmatter 隐藏且逐字节', () => {
  it('S1 frontmatter 隐藏，正文逐字节（CRLF 不被规范化）', () => {
    const raw = `---\r\ntitle: x\r\nke_version: 1\r\n---\r\n\r\n# 标题\r\n\r\n正文\r\n`
    expect(sourceBodyOf(raw)).toBe('# 标题\r\n\r\n正文\r\n')
  })

  it('S2 无 frontmatter：整篇即正文', () => {
    expect(sourceBodyOf('# 纯正文\n')).toBe('# 纯正文\n')
  })

  it('S3 敏感方言（任务列表 / 行内 HTML / 实体）原样（未经 PM 规范化）', () => {
    const body = '- [x] 完成\n\n前 <span style="color:red">红</span> &copy; 后\n'
    expect(sourceBodyOf(`---\nke_version: 1\n---\n\n${body}`)).toBe(body)
  })
})

describe('③ 字符串直存载荷（§6.2-1/3 + §6.2.1）', () => {
  it('P1 原 frontmatter 逐字节 + ke_version 恰一次 + 用户正文逐字节', () => {
    const raw = '---\ntitle: 我的文档\ntags:\n  - a\nke_version: 1\n---\n\n旧正文'
    const edited = '- [x] 新正文\n\n<span style="color:red">红</span> &copy;\n'
    const out = buildSourceSavePayload(raw, edited)
    expect(out).toBe('---\ntitle: 我的文档\ntags:\n  - a\nke_version: 1\n---\n\n' + edited)
    expect(out.match(/ke_version/g)).toHaveLength(1)
  })

  it('P2 无 frontmatter：补一个 ke_version 区块（恰一次）', () => {
    const out = buildSourceSavePayload('# 正文\n', '# 正文\n')
    expect(out).toBe('---\nke_version: 1\n---\n\n# 正文\n')
    expect(out.match(/ke_version/g)).toHaveLength(1)
  })

  it('P3 CRLF 文档：textarea 的 LF 正文按 traits 还原为 CRLF，非换行字节不变（设计 §10）', () => {
    const raw = '---\r\nke_version: 1\r\n---\r\n\r\nA\r\nB\r\n'
    const editedLf = 'A\nB\nC\n' // DOM textarea 会把换行规范化为 LF
    const out = buildSourceSavePayload(raw, editedLf)
    // ① 换行按 traits 还原
    expect(out).not.toMatch(/(^|[^\r])\n/)
    // ② 非换行字节不变
    expect(out.replace(/\r\n/g, '\n')).toBe('---\nke_version: 1\n---\n\nA\nB\nC\n')
  })

  it('P4 LF 文档不得被改成 CRLF', () => {
    const raw = '---\nke_version: 1\n---\n\nA\nB\n'
    const out = buildSourceSavePayload(raw, 'A\nB\nC\n')
    expect(out).not.toContain('\r')
  })

  it('P5 BOM 文档保留 BOM；无 BOM 文档不新增', () => {
    expect(buildSourceSavePayload(`${BOM}---\nke_version: 1\n---\n\n正文\n`, '正文\n').startsWith(BOM)).toBe(true)
    expect(buildSourceSavePayload('---\nke_version: 1\n---\n\n正文\n', '正文\n').startsWith(BOM)).toBe(false)
  })

  it('P6 §6.2.1：用户真写的 U+200B 不被剥除（零编辑路径）', () => {
    const raw = `---\nke_version: 1\n---\n\n前${ZWSP}后\n`
    expect(buildSourceSavePayload(raw, `前${ZWSP}后\n`)).toBe(raw)
  })

  it('P7 零编辑 = 恒等映射（最敏感样本，逐字节）', () => {
    const samples = [
      '---\nke_version: 1\n---\n\n- [x] 完成\n',
      '---\nke_version: 1\n---\n\n前 <span style="color:red">红</span> 后\n',
      '---\nke_version: 1\n---\n\n&copy; 2026\n',
      `${BOM}---\r\nke_version: 1\r\n---\r\n\r\n- [x] 完成\r\n`,
      '---\ntitle: x\nke_version: 1\n---\n\n<!-- ke-note: {"kind":"note","id":"n1"} -->\n',
      '---\nke_version: 1\n---\n\n<!-- ke-unknown: {"a":1} --> 与损坏 <!-- ke-note: {oops}\n',
    ]
    for (const raw of samples) {
      expect(buildSourceSavePayload(raw, sourceBodyOf(raw)), raw).toBe(raw)
    }
  })

  it('P8 幂等：以载荷为新原文再走一次，结果不变', () => {
    const raw = `${BOM}---\r\nke_version: 1\r\n---\r\n\r\nA\r\nB\r\n`
    const once = buildSourceSavePayload(raw, 'A\nB\nC\n')
    const twice = buildSourceSavePayload(once, sourceBodyOf(once))
    expect(twice).toBe(once)
  })
})

describe('④ 恢复点草稿（内部数据：LF / 无 BOM / 内容同源）', () => {
  it('D1 草稿恒 LF、无 BOM，且保留用户 U+200B', () => {
    const raw = `${BOM}---\r\nke_version: 1\r\n---\r\n\r\n前${ZWSP}后\r\n`
    const draft = buildSourceDraft(raw, `前${ZWSP}后\n`)
    expect(draft.startsWith(BOM)).toBe(false)
    expect(draft).not.toContain('\r')
    expect(draft).toContain(`前${ZWSP}后`)
    expect(draft).toContain('ke_version: 1')
  })
})

describe('⑤ 未知/损坏 ke-* 扫描与 diff（§6.2-4 提示依据）', () => {
  it('K1 合法 ke-* 记 known；未知 kind / JSON 损坏 / 未闭合 记 unknown', () => {
    const src = [
      '<!-- ke-note: {"kind":"note","id":"n1","content":"x"} -->',
      '<!-- ke-unknown: {"a":1} -->',
      '<!-- ke-note: {oops} -->',
      '<!-- ke-module: {"kind":"module"',
    ].join('\n')
    const scan = scanKeMarkers(src)
    expect(scan.known).toBe(1)
    expect(scan.unknown).toHaveLength(3)
  })

  it('K2 普通注释/正文里的 ke- 词不误报', () => {
    const scan = scanKeMarkers('<!-- 普通注释 -->\n\nke-abc123 在正文里\n')
    expect(scan).toEqual({ known: 0, unknown: [] })
  })

  it('K3 改动/删除未知标记 → 检测为 changed；仅改普通正文 → 不提示', () => {
    const before = '<!-- ke-note: {"kind":"note","id":"n1"} -->\n\n正文'
    expect(unknownMarkersChanged(before, before.replace('正文', '正文改'))).toBe(false)
    expect(unknownMarkersChanged(before, '')).toBe(false) // 原本就没有未知标记
    const withUnknown = '<!-- ke-unknown: {"a":1} -->\n\n正文'
    expect(unknownMarkersChanged(withUnknown, '<!-- ke-unknown: {"a":2} -->\n\n正文')).toBe(true)
    expect(unknownMarkersChanged(withUnknown, '正文')).toBe(true) // 删除
    expect(unknownMarkersChanged('正文', `${withUnknown}`)).toBe(true) // 新增
  })

  it('K4 hasUnknownKeMarkers 决定「切回正文」是否提示', () => {
    expect(hasUnknownKeMarkers('<!-- ke-note: {"kind":"note"} -->')).toBe(false)
    expect(hasUnknownKeMarkers('<!-- ke-unknown: {"a":1} -->')).toBe(true)
  })
})
