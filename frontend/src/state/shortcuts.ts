/**
 * task-29（v1.2.0-pre.1 项①）：自定义快捷键 —— 动作目录 / 归一化 / 冲突检测 / 分派 / 全局分发器。
 *
 * 设计依据：`docs/analysis-1.1.10/shortcuts.md`（B 档：全局 capture 阶段 keydown 分发器）。
 *
 * 三条硬约束（主理人 2026-09-18 拍板）：
 *  1. **既有快捷键不变动** —— 本模块只消费「用户自定义绑定」命中的按键；没有任何自定义绑定时，
 *     分发器对事件零副作用（既有 Tiptap 键位、窗口级 Ctrl+S / Ctrl+K、原生菜单加速键全部照旧）。
 *     动作目录里的 `defaultKey` 只用于展示与告警，不参与分派、也不改任何既有绑定。
 *  2. **作用域全局** —— capture 阶段挂在 window 上，先于 ProseMirror 的 DOM handler，
 *     因此自定义绑定既能覆盖内置键位，也能 `preventDefault` 浏览器默认行为。
 *  3. **解绑用墓碑** —— 设置里 `'none'` = 显式解绑（不消费任何键）；`''`/缺失 = 未自定义（沿用内置默认）。
 *     （Rust `merge_value` 是深合并，删键删不掉，所以必须用墓碑值表达「解绑」。）
 *
 * 本文件分三层，全部可单测：
 *  ① 纯函数：键位解析/归一化/匹配、保留键表、冲突校验、绑定表解析；
 *  ② 动作目录：稳定 action id + 内置默认键位（仅展示/告警）+ 预留状态；
 *  ③ 运行时：handler 注册表（App / EditorArea 注册**真实闭包**）→ 全局分发器。
 *     task-35（ADP-1 收口）：DOM 过渡适配层已删除 —— 动作执行只走 handler；
 *     未注册 handler 时安全降级（不抛错、不改状态，仅 warnOnce）。
 */

/** 墓碑值：显式解绑（该动作不再有任何快捷键） */
export const SHORTCUT_UNBOUND = 'none'
/** 空串：清除自定义，回退内置默认（与 accentColor 的「空串 = 清除」先例一致） */
export const SHORTCUT_RESET = ''

// ---------------------------------------------------------------------------
// ② 动作目录（稳定 action id）
// ---------------------------------------------------------------------------

export interface ShortcutActionDef {
  id: string
  label: string
  group: 'editor' | 'app'
  desc?: string
  /** 内置默认键位（仅展示/告警用；**不参与分派**，本批次不改动既有绑定） */
  defaultKey: string | null
  /** 已知冲突/注意事项 */
  note?: string
}

export const SHORTCUT_ACTIONS: ShortcutActionDef[] = [
  // —— 编辑器：格式与插入（对应 EditorToolbar.tsx 的 ToolIcon 入口）
  { id: 'editor.bold', label: '加粗', group: 'editor', defaultKey: 'Mod+B' },
  { id: 'editor.italic', label: '斜体', group: 'editor', defaultKey: 'Mod+I' },
  { id: 'editor.underline', label: '下划线', group: 'editor', defaultKey: 'Mod+U' },
  { id: 'editor.strike', label: '删除线', group: 'editor', defaultKey: 'Mod+Shift+S' },
  { id: 'editor.heading.1', label: '标题 1', group: 'editor', defaultKey: 'Mod+Alt+1' },
  { id: 'editor.heading.2', label: '标题 2', group: 'editor', defaultKey: 'Mod+Alt+2' },
  { id: 'editor.heading.3', label: '标题 3', group: 'editor', defaultKey: 'Mod+Alt+3' },
  { id: 'editor.list.bullet', label: '无序列表', group: 'editor', defaultKey: 'Mod+Shift+8' },
  { id: 'editor.list.ordered', label: '有序列表', group: 'editor', defaultKey: 'Mod+Shift+7' },
  { id: 'editor.blockquote', label: '引用', group: 'editor', defaultKey: 'Mod+Shift+B' },
  { id: 'editor.code.inline', label: '行内代码', group: 'editor', defaultKey: 'Mod+E' },
  { id: 'editor.codeBlock', label: '代码块', group: 'editor', defaultKey: 'Mod+Alt+C' },
  { id: 'editor.link.insert', label: '插入链接', group: 'editor', defaultKey: null, desc: '打开链接地址输入框' },
  { id: 'editor.image.insert', label: '插入图片', group: 'editor', defaultKey: null, desc: '打开文件选择' },
  {
    id: 'editor.math.inline',
    label: '插入行内公式',
    group: 'editor',
    defaultKey: 'Mod+N',
    note: '与原生菜单「新建文档」（Ctrl+N）已知冲突：实际由菜单接管，此处仅登记',
  },
  { id: 'editor.math.block', label: '插入块级公式', group: 'editor', defaultKey: 'Mod+M' },
  { id: 'editor.module.insert', label: '插入模块', group: 'editor', defaultKey: null, desc: '打开模块选择器' },
  { id: 'editor.footnote.insert', label: '插入注释（脚注）', group: 'editor', defaultKey: null },
  { id: 'editor.note.insert', label: '插入信息块', group: 'editor', defaultKey: null },
  { id: 'editor.table.insert', label: '插入表格', group: 'editor', defaultKey: null, desc: '打开行列选择器' },
  { id: 'editor.undo', label: '撤销', group: 'editor', defaultKey: 'Mod+Z' },
  { id: 'editor.redo', label: '重做', group: 'editor', defaultKey: 'Mod+Y' },
  // —— 应用级
  { id: 'doc.save', label: '保存文档', group: 'app', defaultKey: 'Mod+S' },
  {
    id: 'doc.new',
    label: '新建文档',
    group: 'app',
    defaultKey: 'Mod+N',
    note: '原生菜单加速键（Ctrl+N）已接管，属保留键',
  },
  { id: 'doc.next', label: '下一篇文档', group: 'app', defaultKey: null, desc: '按标签顺序切换到下一篇' },
  { id: 'doc.prev', label: '上一篇文档', group: 'app', defaultKey: null, desc: '按标签顺序切换到上一篇' },
  {
    id: 'doc.close',
    label: '关闭当前文档',
    group: 'app',
    defaultKey: null,
    desc: '关闭激活标签（有未保存修改时先确认）',
    note: '默认不绑定：Ctrl+W 属系统级保留键',
  },
  { id: 'app.search.focus', label: '聚焦搜索', group: 'app', defaultKey: 'Mod+K' },
  { id: 'app.settings.open', label: '打开设置', group: 'app', defaultKey: 'Mod+,', note: '原生菜单加速键（Ctrl+,）已接管，属保留键' },
  { id: 'app.history.open', label: '查看历史快照', group: 'app', defaultKey: null },
  { id: 'app.trash.open', label: '打开回收站', group: 'app', defaultKey: null },
  { id: 'app.panel.right.toggle', label: '切换右侧面板', group: 'app', defaultKey: null },
  { id: 'app.workspace.open', label: '打开工作区', group: 'app', defaultKey: 'Mod+O', note: '原生菜单加速键（Ctrl+O）已接管，属保留键' },
]

// ---------------------------------------------------------------------------
// ① 纯函数：键位解析 / 归一化 / 匹配
// ---------------------------------------------------------------------------

/** 解析后的键位（修饰键 + 单键） */
export interface KeySpec {
  /** 归一化键名：单字符大写（`B`/`1`/`,`），具名键用 DOM `KeyboardEvent.key` 拼写（`Escape`/`F2`/`ArrowUp`） */
  key: string
  /** `Mod` = macOS 的 ⌘ / 其它平台 Ctrl（与 Tiptap 的 `Mod-` 语义对齐） */
  mod: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

export interface ParsedKeySpec {
  ok: boolean
  spec?: KeySpec
  /** 归一化后的规范串（`Ctrl+Shift+K`），用于展示与持久化比对 */
  canonical?: string
  /** 失败原因（用户可见） */
  error?: string
}

/** 具名键别名 → DOM `KeyboardEvent.key` 拼写 */
const NAMED_KEYS: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  space: ' ',
  spacebar: ' ',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  del: 'Delete',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  comma: ',',
  period: '.',
  dot: '.',
  slash: '/',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  minus: '-',
  equal: '=',
  plus: '=',
  bracketleft: '[',
  bracketright: ']',
  backslash: '\\',
}

const MODIFIER_TOKENS = new Set([
  'mod',
  'ctrl',
  'control',
  'shift',
  'alt',
  'option',
  'meta',
  'cmd',
  'command',
  'super',
  'win',
])

/** 归一化单个键名（修饰键以外）。未知/不可绑定键名返回 null。 */
export function normalizeKeyName(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (t === ' ') return ' '
  if (t.length === 1) return t.toUpperCase()
  const named = NAMED_KEYS[t.toLowerCase()]
  if (named) return named
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(t)) return `F${t.slice(1)}`
  const arrow = /^(arrow)?(up|down|left|right)$/i.exec(t)
  if (arrow) {
    const dir = arrow[2].toLowerCase()
    return `Arrow${dir[0].toUpperCase()}${dir.slice(1)}`
  }
  // 其它多字符键名（IME 组合键、Dead、Unidentified…）不作为可绑定键
  return null
}

/**
 * 解析键位串（如 `Ctrl+Shift+K` / `Mod+B` / `F2` / `Escape`）。
 * - 修饰键顺序无关，输出按 `Mod`/`Ctrl`/`Alt`/`Shift`/`Meta` 固定顺序规范化；
 * - 只允许一个非修饰键；纯修饰键串视为非法（无法作为触发键）。
 */
export function parseKeySpec(raw: string): ParsedKeySpec {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: '键位为空' }
  const tokens = raw
    .split('+')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return { ok: false, error: '键位为空' }

  const spec: KeySpec = { key: '', mod: false, ctrl: false, shift: false, alt: false, meta: false }
  let keySeen: string | null = null
  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (MODIFIER_TOKENS.has(lower)) {
      if (lower === 'mod') spec.mod = true
      else if (lower === 'ctrl' || lower === 'control') spec.ctrl = true
      else if (lower === 'shift') spec.shift = true
      else if (lower === 'alt' || lower === 'option') spec.alt = true
      else spec.meta = true // meta / cmd / command / super / win
      continue
    }
    if (keySeen !== null) return { ok: false, error: `只能绑定一个按键（收到 ${keySeen} 与 ${token}）` }
    const key = normalizeKeyName(token)
    if (key === null) return { ok: false, error: `无法识别的按键：${token}` }
    keySeen = key
  }
  if (keySeen === null) return { ok: false, error: '需要同时按下一个非修饰键' }
  if (keySeen === ' ') return { ok: false, error: '空格键需要与修饰键组合使用（建议 Ctrl+Space）' }
  spec.key = keySeen
  return { ok: true, spec, canonical: formatKeySpec(spec) }
}

/** 规范串：`Mod`+`Ctrl`+`Alt`+`Shift`+`Meta`+键 固定顺序（便于展示与去重） */
export function formatKeySpec(spec: KeySpec): string {
  const parts: string[] = []
  if (spec.mod) parts.push('Mod')
  if (spec.ctrl) parts.push('Ctrl')
  if (spec.alt) parts.push('Alt')
  if (spec.shift) parts.push('Shift')
  if (spec.meta) parts.push('Meta')
  parts.push(spec.key)
  return parts.join('+')
}

/**
 * 平台等价形式（**仅用于冲突比较，不是存储格式**）：把 `Mod` 展开为平台真实修饰键
 * （macOS → `Meta`，其它平台 → `Ctrl`）。
 * 用途：用户录制的 `Ctrl+B` 与动作目录里的平台中立默认键位 `Mod+B`，在 Windows 上是同一个键 ——
 * 冲突检测/保留键判定必须按平台形式比较，否则会漏判（重复绑定、可绕过保留键）。
 */
export function platformCanonical(canonical: string, mac: boolean = isMacPlatform()): string {
  const parsed = parseKeySpec(canonical)
  if (!parsed.ok || !parsed.spec) return canonical
  const spec: KeySpec = { ...parsed.spec, mod: false }
  if (parsed.spec.mod) {
    if (mac) spec.meta = true
    else spec.ctrl = true
  }
  return formatKeySpec(spec)
}

/** 事件形状（真实 `KeyboardEvent` 与测试替身均可） */
export interface KeyEventLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  /** 部分输入法给出 229（composition） */
  keyCode?: number
  /** 修饰键自身按下时的 key（用于录制拒绝） */
  repeat?: boolean
}

/** 输入法组合中 / 无可绑定键的事件应被忽略（避让输入法，见分析文档 §1.4） */
export function shouldIgnoreKeyEvent(e: KeyEventLike): boolean {
  if (e.isComposing === true || e.keyCode === 229) return true
  if (!e.key) return true
  return e.key === 'Dead' || e.key === 'Unidentified'
}

const MODIFIER_KEY_NAMES = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])

/** 平台是否为 macOS（`Mod` 的展开依据） */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = (nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? '').toString()
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** 事件 → 规范键位串（录制用）。`ok:false` 表示该事件不可作为绑定。 */
export function keySpecFromEvent(e: KeyEventLike): ParsedKeySpec {
  if (shouldIgnoreKeyEvent(e)) return { ok: false, error: '组合输入中或无法识别的按键，请重试' }
  if (MODIFIER_KEY_NAMES.has(e.key)) return { ok: false, error: '需要同时按下一个非修饰键' }
  const key = normalizeKeyName(e.key)
  if (key === null) return { ok: false, error: `无法识别的按键：${e.key}` }
  if (key === ' ') {
    // 空格单独按下不可绑定（会与输入冲突）
    return { ok: false, error: '空格键需要与修饰键组合使用' }
  }
  const spec: KeySpec = {
    key,
    mod: false,
    ctrl: !!e.ctrlKey,
    shift: !!e.shiftKey,
    alt: !!e.altKey,
    meta: !!e.metaKey,
  }
  if (!(spec.ctrl || spec.alt || spec.meta || spec.shift) && /^[A-Z0-9]$/.test(key)) {
    return { ok: false, error: '字母/数字键需要搭配修饰键（Ctrl / Alt / Shift / ⌘）' }
  }
  return { ok: true, spec, canonical: formatKeySpec(spec) }
}

/**
 * 事件是否命中该键位（**严格匹配**：未声明的修饰键必须处于未按下状态）。
 * `Mod` 在 macOS 展开为 ⌘、其它平台展开为 Ctrl。
 */
export function matchesKeySpec(spec: KeySpec, e: KeyEventLike, mac: boolean = isMacPlatform()): boolean {
  const key = normalizeKeyName(e.key)
  if (key === null || key !== spec.key) return false
  const wantCtrl = spec.ctrl || (spec.mod && !mac)
  const wantMeta = spec.meta || (spec.mod && mac)
  if (!!e.ctrlKey !== wantCtrl) return false
  if (!!e.metaKey !== wantMeta) return false
  if (!!e.shiftKey !== spec.shift) return false
  if (!!e.altKey !== spec.alt) return false
  return true
}

// ---------------------------------------------------------------------------
// ① 保留键（不可绑定）与内置默认键位冲突
// ---------------------------------------------------------------------------

export interface ReservedKey {
  /** 规范串 */
  canonical: string
  reason: string
}

/**
 * 不可绑定的按键（配置期直接拒绝）：
 *  - 原生菜单加速键（`menu.rs:40-87`）：Ctrl+N / Ctrl+O / Ctrl+, / Ctrl+Q / Ctrl+R / F12。
 *    ⚠️ 这些由 Rust 侧窗口加速键表处理，JS 拦不住也抢不过（分析文档 §1.2.3）。
 *    `Ctrl+N` 同时是编辑器 `Mod+N`（插入行内公式）与菜单「新建文档」的已知冲突 —— 按主理人
 *    「既有快捷键不变动」，此处仅登记为保留键，不改任何既有绑定。
 *  - 系统/浏览器级：剪贴板与全选、打印、刷新、开发者工具、窗口/标签页操作（JS 无法可靠拦截）。
 */
export const RESERVED_KEYS: ReservedKey[] = [
  { canonical: 'Ctrl+N', reason: '原生菜单「新建文档」（menu.rs:40）；且与编辑器 Mod+N 插入行内公式存在已知冲突' },
  { canonical: 'Ctrl+O', reason: '原生菜单「打开 Workspace…」（menu.rs:41）' },
  { canonical: 'Ctrl+,', reason: '原生菜单「设置…」（menu.rs:49）' },
  { canonical: 'Ctrl+Q', reason: '原生菜单「退出」（menu.rs:51）' },
  { canonical: 'Ctrl+R', reason: '原生菜单「重新加载」（menu.rs:76/87）' },
  { canonical: 'F12', reason: '原生菜单「开发者工具」（menu.rs:78，debug 构建）' },
  { canonical: 'Ctrl+C', reason: '系统复制（WebView2 剪贴板，JS 无法可靠覆盖）' },
  { canonical: 'Ctrl+V', reason: '系统粘贴（含图片/文件粘贴链路）' },
  { canonical: 'Ctrl+X', reason: '系统剪切' },
  { canonical: 'Ctrl+A', reason: '全选（编辑器与系统一致语义）' },
  { canonical: 'Ctrl+P', reason: '浏览器打印' },
  { canonical: 'Ctrl+W', reason: '窗口/标签页关闭' },
  { canonical: 'Ctrl+Shift+I', reason: 'WebView2 开发者工具' },
  { canonical: 'Ctrl+Shift+J', reason: 'WebView2 开发者工具（控制台）' },
  { canonical: 'Ctrl+Shift+C', reason: 'WebView2 元素检查' },
  { canonical: 'Alt+F4', reason: '系统关闭窗口' },
  { canonical: 'F5', reason: '浏览器刷新' },
  { canonical: 'Ctrl+Tab', reason: '标签页切换（系统级）' },
  { canonical: 'Ctrl+Shift+Tab', reason: '标签页切换（系统级）' },
  // macOS 系统级（`Mod` 在 mac 展开为 ⌘，若允许绑定会与系统剪贴板/退出冲突）
  { canonical: 'Meta+C', reason: 'macOS 系统复制' },
  { canonical: 'Meta+V', reason: 'macOS 系统粘贴' },
  { canonical: 'Meta+X', reason: 'macOS 系统剪切' },
  { canonical: 'Meta+A', reason: 'macOS 全选' },
  { canonical: 'Meta+Q', reason: 'macOS 退出应用' },
  { canonical: 'Meta+W', reason: 'macOS 关闭窗口' },
]

/** 可用但需提示（覆盖内置键位/既有绑定） */
export const CAUTION_KEYS: ReservedKey[] = [
  { canonical: 'Ctrl+S', reason: '浏览器「保存网页」；当前为「保存文档」的内置键位' },
  { canonical: 'Ctrl+Z', reason: '编辑器撤销的内置键位' },
  { canonical: 'Ctrl+Y', reason: '编辑器重做的内置键位' },
  { canonical: 'Ctrl+F', reason: '浏览器查找' },
  { canonical: 'Ctrl+K', reason: '当前「聚焦搜索」的既有绑定' },
]

const RESERVED_BY_CANONICAL = new Map(RESERVED_KEYS.map((r) => [r.canonical, r]))
const CAUTION_BY_CANONICAL = new Map(CAUTION_KEYS.map((r) => [r.canonical, r]))

export function findReservedKey(canonical: string): ReservedKey | undefined {
  return RESERVED_BY_CANONICAL.get(canonical)
}

/** 校验结果：`reject` = 拒绝保存；`warn` = 可保存但提示（覆盖内置键位等） */
export interface BindingValidation {
  ok: boolean
  level: 'ok' | 'warn' | 'reject'
  canonical: string | null
  message: string
}

/**
 * 配置期冲突校验（纯函数）：
 *  1. 键位语法非法 → 拒绝；
 *  2. 保留键（原生菜单/系统） → 拒绝；
 *  3. 与其它动作的**自定义绑定**重复 → 拒绝（不允许抢键）；
 *  4. 与其它动作的**内置默认键位**相同 → 允许但告警（自定义绑定会覆盖该内置键位）。
 */
export function validateBinding({
  actionId,
  spec,
  bindings,
  mac = isMacPlatform(),
}: {
  actionId: string
  spec: string
  bindings: Record<string, string>
  /** 平台（默认探测；测试可注入）。`Mod` 按平台展开后比较冲突。 */
  mac?: boolean
}): BindingValidation {
  const parsed = parseKeySpec(spec)
  if (!parsed.ok || !parsed.canonical) {
    return { ok: false, level: 'reject', canonical: null, message: parsed.error ?? '键位非法' }
  }
  const canonical = parsed.canonical
  // 平台等价形式：`Ctrl+B` 与 `Mod+B` 在 Windows 上是同一个键（避免漏判）
  const target = platformCanonical(canonical, mac)

  const reserved = findReservedKey(target)
  if (reserved) {
    return { ok: false, level: 'reject', canonical, message: `保留键不可绑定：${reserved.reason}` }
  }

  // 与其它动作的自定义绑定重复 → 拒绝
  for (const [otherId, value] of Object.entries(bindings)) {
    if (otherId === actionId) continue
    if (!value || value === SHORTCUT_UNBOUND) continue
    const other = parseKeySpec(value)
    if (other.ok && other.canonical && platformCanonical(other.canonical, mac) === target) {
      return { ok: false, level: 'reject', canonical, message: `该键位已被「${actionLabel(otherId)}」占用` }
    }
  }

  // 覆盖内置默认键位 → 告警（允许）
  const overridden = SHORTCUT_ACTIONS.filter(
    (a) => a.id !== actionId && a.defaultKey !== null && platformCanonical(a.defaultKey, mac) === target,
  )
  if (overridden.length > 0) {
    const names = overridden.map((a) => a.label).join('、')
    return { ok: true, level: 'warn', canonical, message: `将覆盖内置键位：${names}` }
  }
  const caution = CAUTION_BY_CANONICAL.get(target)
  if (caution) {
    return { ok: true, level: 'warn', canonical, message: caution.reason }
  }
  return { ok: true, level: 'ok', canonical, message: '' }
}

// ---------------------------------------------------------------------------
// ① 动作查询与绑定解析
// ---------------------------------------------------------------------------

export const ACTIONS: ShortcutActionDef[] = SHORTCUT_ACTIONS

const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]))

export function actionById(id: string): ShortcutActionDef | undefined {
  return ACTION_BY_ID.get(id)
}

export function actionLabel(id: string): string {
  return ACTION_BY_ID.get(id)?.label ?? id
}

/** 绑定来源（设置页展示用） */
export type BindingSource = 'custom' | 'unbound' | 'default' | 'none'

export interface EffectiveBinding {
  actionId: string
  source: BindingSource
  canonical: string | null
  /** 内置默认键位（仅展示；不参与分派） */
  defaultKey: string | null
  /** 覆盖/告警提示 */
  warning?: string
}

/** 某动作当前生效的绑定（含来源与提示） */
export function effectiveBinding(actionId: string, bindings: Record<string, string>): EffectiveBinding {
  const def = ACTION_BY_ID.get(actionId)
  const value = bindings[actionId]
  if (value === SHORTCUT_UNBOUND) {
    return { actionId, source: 'unbound', canonical: null, defaultKey: def?.defaultKey ?? null }
  }
  const parsed = value ? parseKeySpec(value) : null
  if (parsed?.ok && parsed.canonical) {
    const check = validateBinding({ actionId, spec: parsed.canonical, bindings })
    return {
      actionId,
      source: 'custom',
      canonical: parsed.canonical,
      defaultKey: def?.defaultKey ?? null,
      warning: check.level === 'warn' ? check.message : undefined,
    }
  }
  if (def?.defaultKey) {
    return { actionId, source: 'default', canonical: def.defaultKey, defaultKey: def.defaultKey }
  }
  return { actionId, source: 'none', canonical: null, defaultKey: null }
}

/**
 * 解析设置里的自定义映射 → 「规范键位 → actionId」表。
 * - 跳过 `''`（回退默认）与 `'none'`（解绑）与非法值（回退默认，不阻塞其它动作）；
 * - 未知 action id 一并跳过（保留在存储里，便于降级不丢配置）。
 */
export function resolveBindings(bindings: Record<string, string>, mac: boolean = isMacPlatform()): Map<string, string> {
  const out = new Map<string, string>()
  // 按 action id 排序保证确定性（同一键位被两条记录命中时结论稳定）
  const entries = Object.entries(bindings).sort(([a], [b]) => a.localeCompare(b))
  for (const [actionId, value] of entries) {
    if (!value || value === SHORTCUT_UNBOUND) continue
    if (!ACTION_BY_ID.has(actionId)) continue
    const parsed = parseKeySpec(value)
    if (!parsed.ok || !parsed.canonical) continue
    // 平台等价去重：`Ctrl+B` 与 `Mod+B` 在 Windows 是同一个键（配置期已拒绝，这里兜底防串扰）
    const key = platformCanonical(parsed.canonical, mac)
    // 保留键即使被历史配置写入也不分派（原生菜单/系统键抢不过，消费它反而会吞掉菜单行为）
    if (findReservedKey(key)) continue
    if (out.has(key)) continue
    out.set(key, actionId)
  }
  return out
}

/** 事件命中的动作 id（null = 无自定义绑定命中 → 分发器零副作用） */
export function resolveActionId(
  bindings: Record<string, string>,
  e: KeyEventLike,
  mac: boolean = isMacPlatform(),
): string | null {
  if (shouldIgnoreKeyEvent(e)) return null
  for (const [canonical, actionId] of resolveBindings(bindings, mac)) {
    const parsed = parseKeySpec(canonical)
    if (parsed.ok && parsed.spec && matchesKeySpec(parsed.spec, e, mac)) return actionId
  }
  return null
}

/**
 * 「改键 / 解绑」时必须屏蔽的**内置默认键位**（平台等价形式）。
 *
 * 为什么需要：内置键位并不都由本模块实现 —— `doc.save` 的 Ctrl+S 在 `EditorArea` 的
 * window 监听里、`app.search.focus` 的 Ctrl+K 在 `LeftSidebar` 里、编辑器格式键在
 * ProseMirror 的 keymap 里。若只写设置而不屏蔽，用户「改键/解绑」后旧键位依旧生效，
 * 自定义就等于没生效（且与设置页展示不符）。
 *
 * 边界（「既有快捷键不变动」硬裁决）：**只有用户显式改过/解绑过的动作**才进入本表；
 * 空映射（默认）→ 空表 → 分发器对这些键零副作用，既有键位行为完全不变。
 */
export function resolveSuppressedKeys(bindings: Record<string, string>, mac: boolean = isMacPlatform()): Set<string> {
  const out = new Set<string>()
  for (const [actionId, value] of Object.entries(bindings)) {
    // '' / 缺省 = 未自定义（沿用内置键位）→ 不屏蔽
    if (!value) continue
    const def = ACTION_BY_ID.get(actionId)
    if (!def?.defaultKey) continue
    if (value !== SHORTCUT_UNBOUND) {
      // 自定义键位：只有键位合法才算「已改键」（非法值等同未自定义 → 内置键位照旧）
      const parsed = parseKeySpec(value)
      if (!parsed.ok) continue
    }
    out.add(platformCanonical(def.defaultKey, mac))
  }
  return out
}

/** 事件是否命中「应被屏蔽的内置键位」 */
export function isSuppressedBuiltin(
  bindings: Record<string, string>,
  e: KeyEventLike,
  mac: boolean = isMacPlatform(),
): boolean {
  if (shouldIgnoreKeyEvent(e)) return false
  for (const canonical of resolveSuppressedKeys(bindings, mac)) {
    const parsed = parseKeySpec(canonical)
    if (parsed.ok && parsed.spec && matchesKeySpec(parsed.spec, e, mac)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// ③ 运行时：handler 注册表 → DOM 适配层 → 全局分发器
// ---------------------------------------------------------------------------

export type ActionHandler = () => void

const handlers = new Map<string, ActionHandler>()

/**
 * 注册动作处理器（EditorArea / App 解冻后应在此注册真实闭包；本批次先由 DOM 适配层兜底）。
 * 返回注销函数。
 */
export function registerActionHandler(actionId: string, fn: ActionHandler): () => void {
  handlers.set(actionId, fn)
  return () => {
    if (handlers.get(actionId) === fn) handlers.delete(actionId)
  }
}

export function hasActionHandler(actionId: string): boolean {
  return handlers.has(actionId)
}

/** 仅测试用：清空注册表 */
export function __clearActionHandlers(): void {
  handlers.clear()
}

/**
 * 批量注册动作处理器（App / EditorArea 用）：
 * 只接受**动作表里存在**的 id（拼错直接忽略并 warn，避免「注册了但永远不生效」的静默失败）；
 * 返回统一注销函数（组件卸载 / 依赖变化时调用，避免闭包过期）。
 */
export function registerActionHandlers(map: Record<string, ActionHandler>): () => void {
  const offs: Array<() => void> = []
  for (const [actionId, fn] of Object.entries(map)) {
    if (!ACTION_BY_ID.has(actionId)) {
      warnOnce(`unknown:${actionId}`, `[shortcuts] 忽略未定义的动作 id：${actionId}`)
      continue
    }
    offs.push(registerActionHandler(actionId, fn))
  }
  return () => offs.forEach((off) => off())
}

export interface RunResult {
  ran: boolean
  via: 'handler' | 'none'
}

/**
 * 执行动作 —— task-35（ADP-1 收口）：**只走真实 handler**，DOM 过渡适配层已删除。
 * - 已注册 handler → 调用（`via: 'handler'`）；
 * - 未注册 handler → **安全降级**：不抛错、不改状态，仅 warnOnce（`via: 'none'`）。
 *   典型场景：无标签页时 App 不注册 `doc.next/prev/close`；对应 UI 未挂载等。
 */
export function runAction(actionId: string): RunResult {
  const handler = handlers.get(actionId)
  if (handler) {
    handler()
    return { ran: true, via: 'handler' }
  }
  const def = ACTION_BY_ID.get(actionId)
  warnOnce(actionId, `[shortcuts] 动作「${def?.label ?? actionId}」尚未注册 handler，本次不分派（安全降级）`)
  return { ran: false, via: 'none' }
}

const warned = new Set<string>()
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  // 运行期 warn（配置期已由 validateBinding 拒绝冲突）
  console.warn(message)
}

/** 测试用：重置 warn 去重表 */
export function __resetWarnings(): void {
  warned.clear()
}

// ---- 录制状态：录制期间全局分发器让路（Esc 由设置页处理为「取消录制」） ----

let recording = false

export function isShortcutRecording(): boolean {
  return recording
}

export function setShortcutRecording(active: boolean): void {
  recording = active
}

export interface DispatcherOptions {
  /** 读取当前自定义绑定（每次按键时读取 → 即改即生效） */
  getBindings: () => Record<string, string>
  /** 命中后如何执行（默认 `runAction`；测试可注入 spy） */
  run?: (actionId: string) => void
  /** 平台（默认探测；测试可注入） */
  mac?: boolean
  /** 事件目标（默认 window；测试可注入替身，避免污染真实全局） */
  target?: {
    addEventListener: (type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => void
    removeEventListener: (type: string, listener: EventListener, options?: boolean | EventListenerOptions) => void
  }
}

export interface HandledKey {
  /** 命中并执行的动作 id（null = 本次只是屏蔽内置键位） */
  actionId: string | null
  /** true = 该键位是被「改键/解绑」屏蔽掉的内置键位（未执行任何动作） */
  suppressed: boolean
  prevented: boolean
}

/**
 * 处理一次 keydown（纯逻辑 + 事件副作用，可单测）：
 * - 录制中 → 不消费；
 * - 命中自定义绑定 → `preventDefault` + `stopPropagation`（capture 阶段抢在 ProseMirror 的
 *   DOM handler 与窗口级 Ctrl+S/Ctrl+K 之前），然后执行动作；
 * - 命中「被改键/解绑动作的内置键位」→ 同样消费但不执行动作（否则旧键位仍然生效，
 *   自定义就等于没生效）；
 * - **以上都不命中 → 零副作用**（默认空映射时既有快捷键行为完全不变）。
 */
export function handleShortcutKeydown(
  e: KeyEventLike & { preventDefault?: () => void; stopPropagation?: () => void },
  opts: DispatcherOptions,
): HandledKey | null {
  if (recording) return null
  const bindings = opts.getBindings()
  const actionId = resolveActionId(bindings, e, opts.mac)
  if (actionId) {
    e.preventDefault?.()
    e.stopPropagation?.()
    const run = opts.run ?? ((id: string) => void runAction(id))
    run(actionId)
    return { actionId, suppressed: false, prevented: true }
  }
  if (isSuppressedBuiltin(bindings, e, opts.mac)) {
    e.preventDefault?.()
    e.stopPropagation?.()
    return { actionId: null, suppressed: true, prevented: true }
  }
  return null
}

let installed = false

/**
 * 安装全局分发器（幂等）。capture 阶段挂在 window 上 → 先于 ProseMirror 的 DOM handler。
 * 返回值 = 卸载函数（应用生命周期内一般不调用；测试用）。
 */
export function installShortcutDispatcher(opts: DispatcherOptions): () => void {
  if (installed) return () => undefined
  const win = opts.target ?? (typeof window !== 'undefined' ? window : null)
  if (!win) return () => undefined
  installed = true
  const listener = (e: Event) => {
    handleShortcutKeydown(e as unknown as KeyEventLike, {
      getBindings: opts.getBindings,
      run: opts.run,
      mac: opts.mac,
    })
  }
  win.addEventListener('keydown', listener as EventListener, true)
  return () => {
    win.removeEventListener('keydown', listener as EventListener, true)
    installed = false
  }
}

export function isShortcutDispatcherInstalled(): boolean {
  return installed
}
