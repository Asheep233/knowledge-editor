/**
 * 项① 自定义快捷键 —— 独立对抗验证套件（task-33 · verifier-attach）
 *
 * 硬裁决（docs/design-1.2.0-plan.md §2 第 1 条 + 第 6 条）：
 *   **已有的快捷键不变动**；新增自定义功能（默认映射为空，行为零变化）；作用域全局。
 *
 * ⚠ 架构变化留痕：本套件最初针对冻结版 `78fa80db…`（含 DOM 过渡适配层 `runActionViaDom`）。
 *   该版本在冻结后被改为 **handler-only（ADP-1 收口）**：移除 DOM 适配层、`runAction(actionId)` 单参、
 *   新增 `registerActionHandlers` 与 `doc.close` 动作定义。本文件已同步到 handler-only 架构；
 *   原「DOM 过渡层」用例（含 disabled 无响应的已知限制）随之作废（该限制随过渡层移除而消失）。
 *
 * 分两层：
 *  ① **「既有默认键位不变动」源码级快照**（本文件顶部 6 条）——任何既有默认绑定被改动即 FAIL；
 *  ② **运行期对抗断言**：纯函数 / 平台等价比较 / 保留键 / 墓碑与三处同步 / 分派与 DOM 过渡适配层。
 *
 * 写入边界（task-33）：本文件 + `TabBar.verify.test.tsx` + `docs/verification-shortcuts-tabs.md` 为
 * verifier 产物；不得修改任何源码。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as sc from './shortcuts'
import { DEFAULT_SETTINGS, getCachedSettings, mergeSettings, normalizeSettings, saveSettings } from '../settings'

// 相对本文件：frontend/src/state/ → ../ = src，../../ = frontend，../../../ = 仓库根
const readSrc = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// ============================================================================
// 第一层：既有默认键位快照（源码级；任何改动即 FAIL）
// ============================================================================
describe('S-0 既有默认键位不变动（硬裁决 · 源码级快照）', () => {
  it('MathShortcuts 仍是 Mod-n（行内公式）/ Mod-m（块级公式），且未新增其它 Mod-* 绑定', () => {
    const src = readSrc('../editor/index.ts')

    expect(src, 'MathShortcuts 的 Mod-n 绑定丢失/改名').toMatch(/['"]Mod-n['"]\s*:/)
    expect(src, 'Mod-n 不再插入行内公式').toMatch(/type:\s*['"]math['"]/)
    expect(src, 'MathShortcuts 的 Mod-m 绑定丢失/改名').toMatch(/['"]Mod-m['"]\s*:/)
    expect(src, 'Mod-m 不再插入块级公式').toMatch(/type:\s*['"]mathBlock['"]/)

    const modBindings = [...src.matchAll(/['"](Mod-[\w-]+)['"]\s*:/g)].map((m) => m[1]).sort()
    expect(modBindings, 'editor/index.ts 的 Mod-* 绑定集合发生变化（硬裁决禁止改动既有键位）').toEqual([
      'Mod-m',
      'Mod-n',
    ])
  })

  it('List / Note 的 Enter 行为仍在（不得被新分发器改绑或抢走）', () => {
    const list = readSrc('../editor/extensions/ListExtension.ts')
    expect(list, 'ListExtension 高优先级丢失（Enter 行为可能被 StarterKit 抢先）').toMatch(/priority:\s*1000/)
    expect(list, 'ListExtension 的 Enter 绑定丢失').toMatch(/Enter:\s*\(\)\s*=>/)

    const note = readSrc('../editor/extensions/NoteExtension.ts')
    expect(note, 'NoteExtension 的 Enter 绑定丢失').toMatch(/Enter:\s*\(\)\s*=>/)
    expect(note, 'NoteExtension 空信息块退出语义丢失').toMatch(/type\.name\s*===\s*['"]note['"]/)
  })

  it('原生菜单加速键快照：menu.rs 仍为 Ctrl+N / Ctrl+O / Ctrl+, / Ctrl+Q / Ctrl+R / F12（逐项绑定）', () => {
    const pairs = menuAccelerators(readSrc('../../../desktop/src-tauri/src/menu.rs'))

    expect(pairs, 'menu.rs 原生加速键逐项绑定发生变化（硬裁决禁止改动既有键位，且会改变保留键清单）').toEqual([
      'MID_DEVTOOLS=F12',
      'MID_EXIT=Ctrl+Q',
      'MID_NEW=Ctrl+N',
      'MID_OPEN_WS=Ctrl+O',
      'MID_RELOAD=Ctrl+R',
      'MID_SETTINGS=Ctrl+,',
    ])
  })

  it('既有 window keydown 绑定快照：Ctrl+S / Ctrl+K / Escape 三处仍在', () => {
    const editorArea = readSrc('../components/layout/EditorArea.tsx')
    expect(editorArea, 'Ctrl+S 的修饰键判定丢失').toMatch(/e\.ctrlKey\s*\|\|\s*e\.metaKey/)
    expect(editorArea, 'Ctrl+S 绑定丢失/改键').toMatch(/key\.toLowerCase\(\)\s*===\s*['"]s['"]/)
    expect(editorArea, 'Ctrl+S 不再 preventDefault').toMatch(/e\.preventDefault\(\)/)

    const sidebar = readSrc('../components/layout/LeftSidebar.tsx')
    expect(sidebar, 'Ctrl+K 绑定丢失/改键').toMatch(/key\.toLowerCase\(\)\s*===\s*['"]k['"]/)

    const lightbox = readSrc('../components/editor/nodeviews/ImageLightbox.tsx')
    expect(lightbox, 'ImageLightbox Escape 关闭丢失').toMatch(/e\.key\s*===\s*['"]Escape['"]/)
  })

  it('Tiptap 内置键位来源版本快照（依赖升级必须重新核对内置键位）', () => {
    // 分析文档 docs/analysis-1.1.10/shortcuts.md §1.2.1 记录的是 3.29.2，而安装版本为 3.31.3
    // （已记入验证报告）；本用例锁定「实际安装版本」，使任何 tiptap 升级都会红，强制重新核对
    // Mod-b/i/u/Mod-z 等内置键位。
    const core = JSON.parse(readSrc('../../node_modules/@tiptap/core/package.json')) as { version: string }
    const kit = JSON.parse(readSrc('../../node_modules/@tiptap/starter-kit/package.json')) as { version: string }

    expect(core.version, '@tiptap/core 版本变化 → 必须重新核对内置键位清单').toBe('3.31.3')
    expect(kit.version, '@tiptap/starter-kit 版本变化 → 必须重新核对内置键位清单').toBe('3.31.3')
  })
})

// ============================================================================
// 辅助
// ============================================================================
/** menu.rs 的 `MID_*=加速键` 逐项清单（去重：reload 在 debug/release 各出现一次） */
function menuAccelerators(src: string): string[] {
  return [
    ...new Set(
      [...src.matchAll(
        /MenuItem::with_id\(\s*app,\s*(MID_\w+),\s*"[^"]*",\s*(?:true|false),\s*(?:Some\("([^"]+)"\)|None::<&str>)/g,
      )]
        .filter((m) => m[2] !== undefined)
        .map((m) => `${m[1]}=${m[2]}`),
    ),
  ].sort()
}

type VoidSpy = ReturnType<typeof vi.fn<() => void>>

interface FakeEvent {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  keyCode?: number
  preventDefault: VoidSpy
  stopPropagation: VoidSpy
}

function evt(o: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  keyCode?: number
}): FakeEvent {
  return { ...o, preventDefault: vi.fn<() => void>(), stopPropagation: vi.fn<() => void>() }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 对象叶子路径（空对象视为叶子 —— 与 Rust 白名单的 `Value` 字段对齐） */
function objectPaths(value: unknown, prefix = ''): string[] {
  if (!isPlainObject(value)) return []
  const out: string[] = []
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (isPlainObject(v) && Object.keys(v).length > 0) out.push(...objectPaths(v, path))
    else out.push(path)
  }
  return out.sort()
}

/** settings.rs `from_value_lenient` 的白名单字段路径（顶层 + 一层子键） */
function rustWhitelistPaths(src: string, leavesOnly = true): string[] {
  const start = src.indexOf('fn from_value_lenient')
  const body = src.slice(start, src.indexOf('\n}\n', start))
  const paths: string[] = []
  let top: string | null = null
  for (const line of body.split('\n')) {
    const t = /obj\.get\("(\w+)"\)/.exec(line)
    if (t) {
      top = t[1]
      paths.push(top)
      continue
    }
    const s = /\b[a-z_]+\.get\("(\w+)"\)/.exec(line)
    if (s && top) paths.push(`${top}.${s[1]}`)
  }
  const unique = [...new Set(paths)].sort()
  // 去掉纯父路径（其子键已单列）→ 与 TS objectPaths 的叶子语义可比
  return leavesOnly ? unique.filter((p) => !unique.some((q) => q.startsWith(`${p}.`))) : unique
}

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  sc.__clearActionHandlers()
  sc.__resetWarnings()
  sc.setShortcutRecording(false)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  sc.setShortcutRecording(false)
  sc.__clearActionHandlers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

// ============================================================================
// S-1 键位归一化与解析（纯函数）
// ============================================================================
describe('S-1 键位归一化与解析', () => {
  it('normalizeKeyName：单字符大写 / 别名 / F 键 / 方向键；Dead、Unidentified、超范围 F 键 → null', () => {
    expect(sc.normalizeKeyName('b')).toBe('B')
    expect(sc.normalizeKeyName('1')).toBe('1')
    // 实测：trim() 先执行 → ' ' 变 '' → 返回 null；源码里 `if (t === ' ')` 分支不可达（死代码）
    expect(sc.normalizeKeyName(' ')).toBeNull()
    expect(sc.normalizeKeyName('esc')).toBe('Escape')
    expect(sc.normalizeKeyName('Escape')).toBe('Escape')
    expect(sc.normalizeKeyName('up')).toBe('ArrowUp')
    expect(sc.normalizeKeyName('arrowdown')).toBe('ArrowDown')
    expect(sc.normalizeKeyName('f12')).toBe('F12')
    expect(sc.normalizeKeyName('comma')).toBe(',')
    expect(sc.normalizeKeyName('=')).toBe('=')

    expect(sc.normalizeKeyName('Dead'), 'Dead 键不应可绑定').toBeNull()
    expect(sc.normalizeKeyName('Unidentified')).toBeNull()
    expect(sc.normalizeKeyName('F25'), 'F25 超范围').toBeNull()
    expect(sc.normalizeKeyName('')).toBeNull()
    expect(sc.normalizeKeyName('   ')).toBeNull()
  })

  it('parseKeySpec：修饰键顺序无关、重复修饰键去重、输出固定规范顺序', () => {
    expect(sc.parseKeySpec('shift+ctrl+k').canonical).toBe('Ctrl+Shift+K')
    expect(sc.parseKeySpec('CTRL+Shift+K').canonical).toBe('Ctrl+Shift+K')
    expect(sc.parseKeySpec('Ctrl+Ctrl+K').canonical).toBe('Ctrl+K')
    expect(sc.parseKeySpec('Alt+Mod+Shift+Ctrl+B').canonical).toBe('Mod+Ctrl+Alt+Shift+B')
    expect(sc.parseKeySpec('cmd+b').canonical, 'cmd 是 Meta 的别名').toBe('Meta+B')
  })

  it('parseKeySpec 拒绝：空串 / 纯修饰键 / 两个非修饰键 / 未知按键', () => {
    for (const bad of ['', '   ', 'Ctrl', 'Ctrl+Shift', 'Ctrl+K+J', 'Ctrl+Foobar', 'Ctrl+Dead']) {
      expect(sc.parseKeySpec(bad).ok, `应拒绝：${JSON.stringify(bad)}`).toBe(false)
    }
    const r = sc.parseKeySpec('')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('空白键语义：独立空格被拒；错误文案建议 Ctrl+Space 但该组合同样被拒（已知文案/行为不一致）', () => {
    const bare = sc.parseKeySpec('Space')
    expect(bare.ok, '独立空格不可绑定').toBe(false)
    expect(bare.error, '错误文案仍建议 Ctrl+Space').toContain('Ctrl+Space')

    const withCtrl = sc.parseKeySpec('Ctrl+Space')
    // 实测：key === ' ' 被**无条件**拒绝 → 与错误文案「建议 Ctrl+Space」矛盾。
    // 记录为已知文案/行为不一致（非硬裁决项，见报告「归因/已知限制」）。
    expect(withCtrl.ok, '实测 Ctrl+Space 也被拒绝（错误文案却建议它）').toBe(false)
  })

  it('parse → format → parse 往返稳定（别名 / 大小写 / 顺序变体）', () => {
    for (const raw of ['ctrl+shift+k', 'Mod+B', 'alt+F4', 'cmd+Shift+8', 'Ctrl+comma', 'F12']) {
      const first = sc.parseKeySpec(raw)
      expect(first.ok, `应可解析：${raw}`).toBe(true)
      const second = sc.parseKeySpec(first.canonical!)
      expect(second.ok).toBe(true)
      expect(second.canonical, `往返不稳定：${raw}`).toBe(first.canonical)
    }
  })
})

// ============================================================================
// S-2 键盘事件语义（IME / 平台 / 严格匹配）
// ============================================================================
describe('S-2 键盘事件语义', () => {
  it('输入法组合键一律忽略：isComposing / keyCode 229 / Dead / Unidentified / 空 key', () => {
    expect(sc.shouldIgnoreKeyEvent(evt({ key: 'a', isComposing: true }))).toBe(true)
    expect(sc.shouldIgnoreKeyEvent(evt({ key: 'a', keyCode: 229 }))).toBe(true)
    expect(sc.shouldIgnoreKeyEvent(evt({ key: 'Dead' }))).toBe(true)
    expect(sc.shouldIgnoreKeyEvent(evt({ key: 'Unidentified' }))).toBe(true)
    expect(sc.shouldIgnoreKeyEvent(evt({ key: '' }))).toBe(true)
    expect(sc.shouldIgnoreKeyEvent(evt({ key: 'b', ctrlKey: true }))).toBe(false)
  })

  it('录制：修饰键自身 / 裸字母数字 / 裸空格 不可绑定；组合键与功能键可绑定', () => {
    expect(sc.keySpecFromEvent(evt({ key: 'Control' })).ok).toBe(false)
    expect(sc.keySpecFromEvent(evt({ key: 'Shift' })).ok).toBe(false)
    expect(sc.keySpecFromEvent(evt({ key: 'b' })).ok, '裸字母不可绑定').toBe(false)
    expect(sc.keySpecFromEvent(evt({ key: '1' })).ok).toBe(false)
    expect(sc.keySpecFromEvent(evt({ key: ' ' })).ok).toBe(false)
    expect(sc.keySpecFromEvent(evt({ key: 'a', ctrlKey: true, isComposing: true })).ok, '组合中输入法让路').toBe(false)

    expect(sc.keySpecFromEvent(evt({ key: 'b', ctrlKey: true })).canonical).toBe('Ctrl+B')
    expect(sc.keySpecFromEvent(evt({ key: 'F2' })).canonical, '功能键可裸绑定').toBe('F2')
    expect(sc.keySpecFromEvent(evt({ key: 'Escape' })).canonical).toBe('Escape')
  })

  it('matchesKeySpec 严格匹配：未声明的修饰键按下即不命中；Mod 按平台展开', () => {
    const spec = sc.parseKeySpec('Ctrl+B').spec!
    expect(sc.matchesKeySpec(spec, evt({ key: 'b', ctrlKey: true }), false)).toBe(true)
    expect(sc.matchesKeySpec(spec, evt({ key: 'b', ctrlKey: true, shiftKey: true }), false), '多余修饰键不得命中').toBe(false)
    expect(sc.matchesKeySpec(spec, evt({ key: 'b', ctrlKey: true, metaKey: true }), false)).toBe(false)
    expect(sc.matchesKeySpec(spec, evt({ key: 'j', ctrlKey: true }), false), '键不符不得命中').toBe(false)

    const modSpec = sc.parseKeySpec('Mod+B').spec!
    expect(sc.matchesKeySpec(modSpec, evt({ key: 'b', ctrlKey: true }), false), 'Windows：Mod=Ctrl').toBe(true)
    expect(sc.matchesKeySpec(modSpec, evt({ key: 'b', metaKey: true }), false)).toBe(false)
    expect(sc.matchesKeySpec(modSpec, evt({ key: 'b', metaKey: true }), true), 'macOS：Mod=⌘').toBe(true)
    expect(sc.matchesKeySpec(modSpec, evt({ key: 'b', ctrlKey: true }), true)).toBe(false)
  })

  it('platformCanonical：Mod 展开为平台修饰键（Ctrl / Meta），非 Mod 串保持不变', () => {
    expect(sc.platformCanonical('Mod+B', false)).toBe('Ctrl+B')
    expect(sc.platformCanonical('Mod+B', true)).toBe('Meta+B')
    expect(sc.platformCanonical('Ctrl+B', true)).toBe('Ctrl+B')
    expect(sc.platformCanonical('Cmd+B', false), 'Cmd 解析为 Meta，与平台无关').toBe('Meta+B')
    expect(sc.platformCanonical('Alt+F4', false)).toBe('Alt+F4')
  })
})

// ============================================================================
// S-3 保留键与冲突（配置期）
// ============================================================================
describe('S-3 保留键与冲突', () => {
  it('RESERVED_KEYS 覆盖 menu.rs 实测的 6 个原生加速键（防清单漂移）', () => {
    const canon = new Set(sc.RESERVED_KEYS.map((r) => r.canonical))
    for (const pair of menuAccelerators(readSrc('../../../desktop/src-tauri/src/menu.rs'))) {
      const acc = pair.split('=')[1]
      expect(canon.has(acc), `menu.rs 加速键 ${acc} 未进入保留键清单`).toBe(true)
    }
    expect(canon.has('F12')).toBe(true)
    expect(canon.has('Ctrl+Shift+I'), 'WebView2 开发者工具应保留').toBe(true)
    expect(canon.has('Meta+C'), 'macOS 剪贴板应保留').toBe(true)
  })

  it('CAUTION_KEYS 覆盖既有绑定/浏览器键：Ctrl+S / Ctrl+Z / Ctrl+Y / Ctrl+F / Ctrl+K', () => {
    const canon = new Set(sc.CAUTION_KEYS.map((r) => r.canonical))
    for (const k of ['Ctrl+S', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+F', 'Ctrl+K']) {
      expect(canon.has(k), `${k} 未进入告警清单`).toBe(true)
    }
  })

  it('validateBinding：保留键拒绝，Ctrl+N 说明「已知冲突」；Mod+N 在 Windows 同键也拒绝、在 mac 放行', () => {
    const winBare = sc.validateBinding({ actionId: 'editor.bold', spec: 'Ctrl+N', bindings: {}, mac: false })
    expect(winBare.ok).toBe(false)
    expect(winBare.level).toBe('reject')
    expect(winBare.message, '应说明 Ctrl+N 的已知冲突').toContain('已知冲突')

    const winMod = sc.validateBinding({ actionId: 'editor.bold', spec: 'Mod+N', bindings: {}, mac: false })
    expect(winMod.ok, 'Windows 上 Mod+N ≡ Ctrl+N → 必须同样拒绝').toBe(false)

    const macMod = sc.validateBinding({ actionId: 'editor.bold', spec: 'Mod+N', bindings: {}, mac: true })
    expect(macMod.ok, 'macOS 上 Mod+N ≡ ⌘+N，不在保留清单 → 允许').toBe(true)
    expect(macMod.level, '与内置默认 Mod+N（新建文档）撞车 → 告警').toBe('warn')
  })

  it('validateBinding 平台等价比较：Ctrl+B / Mod+B 在 Windows 判重、在 macOS 不判重；Cmd+B 仅 mac 判重', () => {
    const bindings = { 'editor.bold': 'Mod+B' }

    const winCtrlB = sc.validateBinding({ actionId: 'editor.italic', spec: 'Ctrl+B', bindings, mac: false })
    expect(winCtrlB.ok, 'Windows：Ctrl+B 与 Mod+B 是同一个键 → 拒绝').toBe(false)
    expect(winCtrlB.message).toContain('加粗')

    const macCtrlB = sc.validateBinding({ actionId: 'editor.italic', spec: 'Ctrl+B', bindings, mac: true })
    expect(macCtrlB.ok, 'macOS：Ctrl+B ≠ ⌘+B → 不视为重复').toBe(true)

    const macCmdB = sc.validateBinding({ actionId: 'editor.italic', spec: 'Cmd+B', bindings, mac: true })
    expect(macCmdB.ok, 'macOS：Cmd+B ≡ ⌘+B = Mod+B → 拒绝').toBe(false)

    const winCmdB = sc.validateBinding({ actionId: 'editor.italic', spec: 'Cmd+B', bindings, mac: false })
    expect(winCmdB.ok, 'Windows：Cmd+B = Meta+B ≠ Ctrl+B → 不重复').toBe(true)
  })

  it('validateBinding：覆盖内置默认 → warn（允许）；caution 键 → warn；全新键 → ok；非法 → reject', () => {
    const override = sc.validateBinding({ actionId: 'editor.italic', spec: 'Mod+B', bindings: {}, mac: false })
    expect(override.ok).toBe(true)
    expect(override.level).toBe('warn')
    expect(override.message).toContain('加粗')

    const caution = sc.validateBinding({ actionId: 'editor.bold', spec: 'Ctrl+F', bindings: {}, mac: false })
    expect(caution.ok).toBe(true)
    expect(caution.level).toBe('warn')

    const clean = sc.validateBinding({ actionId: 'editor.bold', spec: 'Ctrl+Alt+Shift+9', bindings: {}, mac: false })
    expect(clean.level).toBe('ok')

    const invalid = sc.validateBinding({ actionId: 'editor.bold', spec: 'Ctrl', bindings: {}, mac: false })
    expect(invalid.level).toBe('reject')
    expect(invalid.ok).toBe(false)
  })
})

// ============================================================================
// S-4 绑定三态与墓碑语义
// ============================================================================
describe('S-4 三态 / 墓碑 / 屏蔽表', () => {
  it('effectiveBinding 四态：default / custom / unbound / none（未知动作）', () => {
    expect(sc.effectiveBinding('editor.bold', {}).source).toBe('default')
    expect(sc.effectiveBinding('editor.bold', {}).canonical).toBe('Mod+B')
    expect(sc.effectiveBinding('editor.bold', { 'editor.bold': 'Ctrl+Shift+9' }).source).toBe('custom')
    expect(sc.effectiveBinding('editor.bold', { 'editor.bold': sc.SHORTCUT_UNBOUND }).source).toBe('unbound')
    expect(sc.effectiveBinding('editor.bold', { 'editor.bold': sc.SHORTCUT_UNBOUND }).canonical).toBeNull()
    expect(sc.effectiveBinding('不存在的动作', {}).source).toBe('none')
  })

  it('resolveBindings：跳过 ""（回退默认）/ "none"（解绑）/ 未知 action / 非法值 / 保留键（历史配置兜底）', () => {
    const map = sc.resolveBindings(
      {
        'editor.bold': '',
        'editor.italic': sc.SHORTCUT_UNBOUND,
        未知动作: 'Ctrl+Shift+9',
        'editor.strike': 'Ctrl+NotAKey',
        'editor.underline': 'Ctrl+N', // 保留键：即便历史配置写入也不得分派
        'editor.code.inline': 'Ctrl+Shift+9',
      },
      false,
    )

    expect([...map.keys()]).toEqual(['Ctrl+Shift+9'])
    expect(map.get('Ctrl+Shift+9')).toBe('editor.code.inline')
  })

  it('resolveBindings 平台等价去重 + 确定性：同一键两条记录只保留排序最前的一条', () => {
    const map = sc.resolveBindings({ 'editor.bold': 'Ctrl+B', 'editor.italic': 'Mod+B' }, false)
    expect(map.size, 'Windows：Ctrl+B 与 Mod+B 是同一个键 → 只保留一条').toBe(1)
    expect(map.get('Ctrl+B'), '按 action id 排序取最前（editor.bold < editor.italic）').toBe('editor.bold')

    const macMap = sc.resolveBindings({ 'editor.bold': 'Ctrl+B', 'editor.italic': 'Mod+B' }, true)
    expect(macMap.size, 'macOS：Ctrl+B 与 Mod+B 是不同键 → 两条都在').toBe(2)
  })

  it('resolveSuppressedKeys：空映射 → 空表；改键/解绑才屏蔽；非法值与 "" 不屏蔽（内置键位照旧）', () => {
    expect(sc.resolveSuppressedKeys({}, false).size, '默认空映射必须零屏蔽（硬裁决）').toBe(0)

    const unbound = sc.resolveSuppressedKeys({ 'editor.bold': sc.SHORTCUT_UNBOUND }, false)
    expect(unbound.has('Ctrl+B'), '解绑后必须屏蔽其内置键位 Ctrl+B').toBe(true)

    const rebound = sc.resolveSuppressedKeys({ 'editor.bold': 'Ctrl+Shift+9' }, false)
    expect(rebound.has('Ctrl+B')).toBe(true)

    const invalid = sc.resolveSuppressedKeys({ 'editor.bold': 'Ctrl+NotAKey' }, false)
    expect(invalid.size, '非法值等同未自定义 → 不屏蔽（内置键位照旧）').toBe(0)

    const reset = sc.resolveSuppressedKeys({ 'editor.bold': sc.SHORTCUT_RESET }, false)
    expect(reset.size, "'' = 回退默认 → 不屏蔽").toBe(0)
  })

  it('【Lead 关注①】默认空映射：既有键位逐个都不被消费（preventDefault/stopPropagation 全未调用）', () => {
    const battery: Array<[string, { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }]> = [
      ['s', { ctrlKey: true }], // 保存（EditorArea）
      ['k', { ctrlKey: true }], // 聚焦搜索（LeftSidebar）
      ['b', { ctrlKey: true }], // 加粗（ProseMirror 内置）
      ['i', { ctrlKey: true }],
      ['u', { ctrlKey: true }],
      ['z', { ctrlKey: true }],
      ['z', { ctrlKey: true, shiftKey: true }],
      ['y', { ctrlKey: true }],
      ['n', { ctrlKey: true }], // 已知冲突键（编辑器 Mod+N / 菜单 Ctrl+N）
      ['m', { ctrlKey: true }],
      ['8', { ctrlKey: true, shiftKey: true }], // 无序列表内置
      ['1', { ctrlKey: true, altKey: true }], // 标题 1 内置
      ['Escape', {}],
      ['Enter', {}],
      ['F5', {}],
    ]
    for (const [key, mods] of battery) {
      const e = evt({ key, ...mods })
      const res = sc.handleShortcutKeydown(e, { getBindings: () => ({}), mac: false, run: vi.fn() })
      expect(res, `空映射下 ${key}+${JSON.stringify(mods)} 不应被分发器消费`).toBeNull()
      expect(e.preventDefault, `空映射下 ${key} 不得 preventDefault`).not.toHaveBeenCalled()
      expect(e.stopPropagation, `空映射下 ${key} 不得 stopPropagation`).not.toHaveBeenCalled()
    }
  })
})

// ============================================================================
// S-5 设置三处同步（独立门禁）
// ============================================================================
describe('S-5 设置三处同步与墓碑持久化', () => {
  const rustSrc = (): string => readSrc('../../../desktop/src-tauri/src/settings.rs')

  it('前端 DEFAULT_SETTINGS 的每个字段路径都能被 Rust from_value_lenient 白名单读取（防 IPC 静默失效）', () => {
    const ts = objectPaths(DEFAULT_SETTINGS)
    const rust = rustWhitelistPaths(rustSrc())
    const missing = ts.filter((p) => !rust.includes(p))
    expect(missing, `前端字段在 Rust 白名单缺失（IPC 将返回 null，设置静默失效）：${missing.join(', ')}`).toEqual([])

    const rustOnly = rust.filter((p) => !ts.includes(p))
    expect(rustOnly, 'Rust 独有字段发生变化 → 需人工复核是否为合法豁免（主题预设/旧字段）').toEqual([
      'ui.accentColor',
      'ui.dark',
      'ui.light',
    ])
    expect(ts, '快捷键三处同步的核心字段').toContain('editor.shortcuts')
  })

  it('门禁非空性：抹掉 Rust 白名单里的 editor.shortcuts → 门禁必须报缺失（不是永远绿灯）', () => {
    const source = rustSrc()
    const mutated = source.replace('if let Some(sc) = eo.get("shortcuts") {', '')
    expect(mutated, '前置：Rust 源码中应存在 shortcuts 白名单分支').not.toBe(source)

    const rust2 = rustWhitelistPaths(mutated)
    expect(rust2).not.toContain('editor.shortcuts')
    const missing = objectPaths(DEFAULT_SETTINGS).filter((p) => !rust2.includes(p))
    expect(missing, '门禁必须能抓到「只有前端有」的字段').toContain('editor.shortcuts')
  })

  it('墓碑 none 与回退 "" 经 mergeSettings + JSON 往返（模拟 IPC）后语义不变（深合并删不掉）', () => {
    const patch = { editor: { shortcuts: { 'editor.bold': sc.SHORTCUT_UNBOUND, 'editor.italic': sc.SHORTCUT_RESET } } }
    const merged = mergeSettings(DEFAULT_SETTINGS, patch)
    expect((merged.editor.shortcuts ?? {})['editor.bold']).toBe('none')
    expect((merged.editor.shortcuts ?? {})['editor.italic']).toBe('')

    const roundTripped = normalizeSettings(JSON.parse(JSON.stringify(merged)) as unknown)
    expect((roundTripped.editor.shortcuts ?? {})['editor.bold'], 'IPC 往返后墓碑必须保留').toBe('none')
    expect((roundTripped.editor.shortcuts ?? {})['editor.italic']).toBe('')

    const mergedAgain = mergeSettings(merged, patch)
    expect((mergedAgain.editor.shortcuts ?? {})['editor.bold'], '重复合并不得把墓碑合并掉').toBe('none')
  })

  it('mergeSettings 键级合并：单动作 patch 不得丢掉其它动作的绑定（与 Rust 深合并对齐）', () => {
    const base = mergeSettings(DEFAULT_SETTINGS, { editor: { shortcuts: { 'editor.bold': 'Ctrl+Shift+9' } } })
    const next = mergeSettings(base, { editor: { shortcuts: { 'editor.italic': 'Ctrl+Shift+8' } } })
    expect((next.editor.shortcuts ?? {})['editor.bold']).toBe('Ctrl+Shift+9')
    expect((next.editor.shortcuts ?? {})['editor.italic']).toBe('Ctrl+Shift+8')
  })

  it('sanitizeShortcutsMap（经 normalizeSettings）：未知 action 保留、非字符串丢弃、非法键位丢弃、别名归一', () => {
    const normalized = normalizeSettings({
      editor: {
        shortcuts: {
          'editor.bold': 'ctrl+shift+9',
          '未来动作.id': 'Ctrl+Shift+7',
          'editor.italic': 123,
          'editor.strike': 'Ctrl+NotAKey',
          'editor.underline': 'none',
          'editor.code.inline': '',
        },
      },
    })
    const map = normalized.editor.shortcuts ?? {}
    expect(map['editor.bold'], '别名/大小写归一为规范串').toBe('Ctrl+Shift+9')
    expect(map['未来动作.id'], '未知 action id 必须保留（降级不丢配置）').toBe('Ctrl+Shift+7')
    expect('editor.italic' in map, '非字符串值必须丢弃').toBe(false)
    expect('editor.strike' in map, '非法键位必须丢弃').toBe(false)
    expect(map['editor.underline']).toBe('none')
    expect(map['editor.code.inline']).toBe('')
  })
})

// ============================================================================
// S-6 分派 / 动作执行 / DOM 过渡适配层
// ============================================================================
describe('S-6 分派与动作执行', () => {
  it('handleShortcutKeydown：命中自定义 → preventDefault + stopPropagation + 执行一次', () => {
    const run = vi.fn()
    const e = evt({ key: 'k', ctrlKey: true, shiftKey: true })
    const res = sc.handleShortcutKeydown(e, {
      getBindings: () => ({ 'editor.bold': 'Ctrl+Shift+K' }),
      run,
      mac: false,
    })

    expect(res).toEqual({ actionId: 'editor.bold', suppressed: false, prevented: true })
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(e.stopPropagation).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('editor.bold')
  })

  it('录制态：分发器不消费任何按键（返回 null，无 preventDefault）', () => {
    sc.setShortcutRecording(true)
    const run = vi.fn()
    const e = evt({ key: 'k', ctrlKey: true, shiftKey: true })
    const res = sc.handleShortcutKeydown(e, {
      getBindings: () => ({ 'editor.bold': 'Ctrl+Shift+K' }),
      run,
      mac: false,
    })

    expect(res).toBeNull()
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(sc.isShortcutRecording()).toBe(true)
  })

  it('改键/解绑后：旧内置键位被屏蔽（suppressed=true）但不执行动作', () => {
    const run = vi.fn()
    const e = evt({ key: 'b', ctrlKey: true })
    const res = sc.handleShortcutKeydown(e, {
      getBindings: () => ({ 'editor.bold': sc.SHORTCUT_UNBOUND }),
      run,
      mac: false,
    })

    expect(res).toEqual({ actionId: null, suppressed: true, prevented: true })
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })

  it('未命中任何绑定/屏蔽 → null（零副作用，其它键位不受影响）', () => {
    const e = evt({ key: 'q', ctrlKey: true, altKey: true })
    const res = sc.handleShortcutKeydown(e, {
      getBindings: () => ({ 'editor.bold': 'Ctrl+Shift+9' }),
      run: vi.fn(),
      mac: false,
    })
    expect(res).toBeNull()
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('runAction：已注册 handler 优先；注销后 → via=none（安全降级，不抛错）', () => {
    const handler = vi.fn()
    const off = sc.registerActionHandler('doc.next', handler)
    expect(sc.hasActionHandler('doc.next')).toBe(true)
    expect(sc.runAction('doc.next')).toEqual({ ran: true, via: 'handler' })
    expect(handler).toHaveBeenCalledTimes(1)

    off()
    expect(sc.hasActionHandler('doc.next')).toBe(false)
    expect(sc.runAction('doc.next'), '未注册 handler → 安全降级').toEqual({ ran: false, via: 'none' })
  })

  it('源码守卫：DOM 过渡适配层已彻底移除（无 runActionViaDom / querySelector / DomEnv）', () => {
    const src = readSrc('./shortcuts.ts')
    expect(src.includes('runActionViaDom'), 'ADP-1 收口后不得残留 DOM 适配层').toBe(false)
    expect(src.includes('querySelector'), '不得再靠 DOM 查询执行动作').toBe(false)
    expect(src.includes('DomEnv'), 'DomEnv 概念应已删除').toBe(false)
  })

  it('未注册 handler 的动作 → via=none 安全降级（不抛错），同类提示只一次', () => {
    sc.runAction('doc.next')
    sc.runAction('doc.next')
    expect(
      warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('尚未注册')).length,
      '同类提示只一次',
    ).toBe(1)
    expect(sc.runAction('不存在的动作')).toEqual({ ran: false, via: 'none' })
  })

  it('doc.close：已定义、默认不绑定、可绑定，且纳入保留键与冲突检测', () => {
    const def = sc.actionById('doc.close')
    expect(def, 'doc.close 应已定义').toBeTruthy()
    expect(def!.defaultKey, '不得抢走任何既有默认键位').toBeNull()

    expect(
      sc.validateBinding({ actionId: 'doc.close', spec: 'Ctrl+Shift+W', bindings: {}, mac: false }).ok,
      '全新键位可绑定',
    ).toBe(true)
    expect(
      sc.validateBinding({ actionId: 'doc.close', spec: 'Ctrl+Q', bindings: {}, mac: false }).level,
      '保留键仍拒绝',
    ).toBe('reject')
    expect(
      sc.validateBinding({ actionId: 'doc.close', spec: 'Ctrl+B', bindings: { 'editor.bold': 'Mod+B' }, mac: false }).ok,
      '平台等价重复仍拒绝（Ctrl+B ≡ Mod+B on Windows）',
    ).toBe(false)
  })

  it('registerActionHandlers：只接受动作表内的 id；未知 id 忽略并 warn；返回统一注销', () => {
    const a = vi.fn()
    const b = vi.fn()
    const off = sc.registerActionHandlers({ 'doc.next': a, 'doc.close': b, 'not.an.action': vi.fn() })

    expect(sc.hasActionHandler('doc.next')).toBe(true)
    expect(sc.hasActionHandler('doc.close')).toBe(true)
    expect(sc.hasActionHandler('not.an.action'), '未定义动作不得注册（防拼错静默失效）').toBe(false)
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('忽略未定义的动作 id'))).toBe(true)

    sc.runAction('doc.next')
    sc.runAction('doc.close')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    off()
    expect(sc.hasActionHandler('doc.next')).toBe(false)
    expect(sc.hasActionHandler('doc.close')).toBe(false)
  })

  it('doc.close 已进入动作表（原集成缺口已修）：可定义、可绑定、可解析', () => {
    expect(sc.actionById('doc.close'), 'doc.close 应已定义').toBeTruthy()
    const map = sc.resolveBindings({ 'doc.close': 'Ctrl+Shift+W' }, false)
    expect(map.get('Ctrl+Shift+W')).toBe('doc.close')
  })
})

describe('S-6b 生产接线（settings.ts 自动安装的分发器 + handler 注册）', () => {
  it('生产接线：空映射零副作用 / 改键即改即生效 / 单实例不重复执行', async () => {
    // settings.ts 在模块加载时即 installShortcutDispatcher（App 静态导入早于编辑器创建）
    expect(sc.isShortcutDispatcherInstalled(), 'settings.ts 应自动安装全局分发器').toBe(true)

    const handler = vi.fn()
    const off = sc.registerActionHandler('editor.bold', handler)
    try {
      // ① 默认（空映射）：既有键位零副作用
      const e1 = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true })
      window.dispatchEvent(e1)
      expect(e1.defaultPrevented, '空映射下 Ctrl+B 不得被 preventDefault（既有键位不变动）').toBe(false)
      expect(handler).not.toHaveBeenCalled()

      // ② 改键写入设置缓存 → 即改即生效（无需重启、无需重装分发器）
      await saveSettings({ editor: { shortcuts: { 'editor.bold': 'Ctrl+Shift+9' } } })
      expect((getCachedSettings().editor.shortcuts ?? {})['editor.bold']).toBe('Ctrl+Shift+9')

      const e2 = new KeyboardEvent('keydown', { key: '9', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
      window.dispatchEvent(e2)
      expect(e2.defaultPrevented, '改键后新键位应被消费').toBe(true)
      expect(handler, '分发器必须单实例（重复安装 → 动作被重复执行）').toHaveBeenCalledTimes(1)
    } finally {
      off()
      await saveSettings({ editor: { shortcuts: { 'editor.bold': '' } } }) // 还原缓存
    }
  })

  it('ADP-1 收口不变量：真实 handler 注册点存在（App / EditorArea / LeftSidebar 批量注册，非 DOM 兜底）', () => {
    const points = [
      ['../App.tsx', 'App（应用级动作）'],
      ['../components/layout/EditorArea.tsx', 'EditorArea（编辑器动作）'],
      ['../components/layout/LeftSidebar.tsx', 'LeftSidebar（搜索/回收站）'],
    ] as const
    for (const [file, label] of points) {
      expect(
        readSrc(file).includes('registerActionHandlers'),
        `${label} 必须通过 registerActionHandlers 注册真实闭包（不得回退 DOM 兜底）`,
      ).toBe(true)
    }
    const app = readSrc('../App.tsx')
    for (const id of ['doc.next', 'doc.prev', 'doc.close']) {
      expect(app.includes(`'${id}'`), `App 应注册 ${id} 的真实 handler`).toBe(true)
    }
  })

  it('分发器幂等：生产已安装时再次调用返回 noop 且不改变安装状态', () => {
    expect(sc.isShortcutDispatcherInstalled()).toBe(true)
    const noop = sc.installShortcutDispatcher({
      getBindings: () => ({ 'editor.bold': 'Ctrl+Shift+9' }),
      run: vi.fn(),
      mac: false,
    })
    expect(sc.isShortcutDispatcherInstalled()).toBe(true)
    noop()
    expect(sc.isShortcutDispatcherInstalled(), 'noop 卸载不得改变状态').toBe(true)
  })
})
