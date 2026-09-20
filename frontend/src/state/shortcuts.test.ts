/**
 * task-29（v1.2.0-pre.1 项①）：自定义快捷键 —— 纯函数与分发器单测。
 *
 * 覆盖：归一化 / 别名 / 严格匹配 / 输入法避让 / 保留键拒绝 / 冲突（自定义重复 vs 内置覆盖）/
 * 墓碑解绑 / 非法值降级 / 分派决策 / handler 优先 / DOM 适配兜底 / 预留动作 / 全局分发器
 * （capture 阶段、零副作用、即改即生效）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIONS,
  RESERVED_KEYS,
  SHORTCUT_RESET,
  SHORTCUT_UNBOUND,
  __clearActionHandlers,
  __resetWarnings,
  actionById,
  effectiveBinding,
  findReservedKey,
  formatKeySpec,
  handleShortcutKeydown,
  installShortcutDispatcher,
  isShortcutDispatcherInstalled,
  isSuppressedBuiltin,
  keySpecFromEvent,
  matchesKeySpec,
  normalizeKeyName,
  parseKeySpec,
  registerActionHandler,
  registerActionHandlers,
  resolveActionId,
  resolveBindings,
  resolveSuppressedKeys,
  runAction,
  shouldIgnoreKeyEvent,
  validateBinding,
  type KeyEventLike,
} from './shortcuts'

const B = { id: 'editor.bold', label: '加粗' }

/** 造一个可观测的 keydown 替身 */
function ev(over: Partial<KeyEventLike> = {}) {
  const preventDefault = vi.fn()
  const stopPropagation = vi.fn()
  return {
    key: 'k',
    ...over,
    preventDefault,
    stopPropagation,
  }
}

describe('归一化 / 解析（纯函数）', () => {
  it('修饰键顺序与大小写归一化：shift+ctrl+k → Ctrl+Shift+K', () => {
    const r = parseKeySpec('shift+ctrl+k')
    expect(r.ok).toBe(true)
    expect(r.canonical).toBe('Ctrl+Shift+K')
    expect(r.spec).toMatchObject({ key: 'K', ctrl: true, shift: true, mod: false })
  })

  it('别名归一化：Comma / esc / arrowup / F4', () => {
    expect(parseKeySpec('Mod+Comma').canonical).toBe('Mod+,')
    expect(parseKeySpec('esc').canonical).toBe('Escape')
    expect(parseKeySpec('ctrl+arrowup').canonical).toBe('Ctrl+ArrowUp')
    expect(parseKeySpec('F4').canonical).toBe('F4')
    expect(normalizeKeyName('B')).toBe('B')
  })

  it('拒绝：空串 / 纯修饰键 / 两个非修饰键 / 未知按键 / 裸空格', () => {
    expect(parseKeySpec('').ok).toBe(false)
    expect(parseKeySpec('Ctrl+Shift').ok).toBe(false)
    expect(parseKeySpec('Ctrl+A+B').ok).toBe(false)
    expect(parseKeySpec('Ctrl+Foo').ok).toBe(false)
    expect(parseKeySpec(' ').ok).toBe(false)
    expect(parseKeySpec('Ctrl+ ').ok).toBe(false)
  })

  it('formatKeySpec 固定顺序（Mod+Ctrl+Alt+Shift+Meta+键）', () => {
    expect(formatKeySpec(parseKeySpec('alt+ctrl+shift+meta+mod+p').spec!)).toBe('Mod+Ctrl+Alt+Shift+Meta+P')
  })
})

describe('匹配（严格修饰键）', () => {
  it('Mod 在非 mac 展开为 Ctrl，在 mac 展开为 ⌘', () => {
    const spec = parseKeySpec('Mod+B').spec!
    expect(matchesKeySpec(spec, { key: 'b', ctrlKey: true }, false)).toBe(true)
    expect(matchesKeySpec(spec, { key: 'b', metaKey: true }, false)).toBe(false)
    expect(matchesKeySpec(spec, { key: 'b', metaKey: true }, true)).toBe(true)
    expect(matchesKeySpec(spec, { key: 'b', ctrlKey: true }, true)).toBe(false)
  })

  it('严格匹配：未声明的修饰键按下即不命中', () => {
    const modB = parseKeySpec('Mod+B').spec!
    expect(matchesKeySpec(modB, { key: 'b', ctrlKey: true, shiftKey: true }, false)).toBe(false)
    expect(matchesKeySpec(modB, { key: 'b', ctrlKey: true, altKey: true }, false)).toBe(false)
    const ctrlK = parseKeySpec('Ctrl+K').spec!
    expect(matchesKeySpec(ctrlK, { key: 'k', ctrlKey: true }, false)).toBe(true)
    expect(matchesKeySpec(ctrlK, { key: 'k', ctrlKey: true, metaKey: true }, false)).toBe(false)
    const ctrlShiftK = parseKeySpec('Ctrl+Shift+K').spec!
    expect(matchesKeySpec(ctrlShiftK, { key: 'K', ctrlKey: true, shiftKey: true }, false)).toBe(true)
    expect(matchesKeySpec(ctrlShiftK, { key: 'k', ctrlKey: true }, false)).toBe(false)
  })

  it('无修饰键键位（F2）不会被带修饰键的事件命中', () => {
    const spec = parseKeySpec('F2').spec!
    expect(matchesKeySpec(spec, { key: 'F2' }, false)).toBe(true)
    expect(matchesKeySpec(spec, { key: 'F2', ctrlKey: true }, false)).toBe(false)
  })
})

describe('录制与输入法避让', () => {
  it('输入法组合中 / Dead / Unidentified 一律忽略', () => {
    expect(shouldIgnoreKeyEvent({ key: 'a', isComposing: true })).toBe(true)
    expect(shouldIgnoreKeyEvent({ key: 'a', keyCode: 229 })).toBe(true)
    expect(shouldIgnoreKeyEvent({ key: 'Dead' })).toBe(true)
    expect(shouldIgnoreKeyEvent({ key: 'Unidentified' })).toBe(true)
    expect(shouldIgnoreKeyEvent({ key: '' })).toBe(true)
    expect(shouldIgnoreKeyEvent({ key: 'a' })).toBe(false)
  })

  it('录制：修饰键自身 / 裸字母数字 / 裸空格 不可作为绑定', () => {
    expect(keySpecFromEvent({ key: 'Control', ctrlKey: true }).ok).toBe(false)
    expect(keySpecFromEvent({ key: 'a' }).ok).toBe(false)
    expect(keySpecFromEvent({ key: '1' }).ok).toBe(false)
    expect(keySpecFromEvent({ key: ' ' }).ok).toBe(false)
    expect(keySpecFromEvent({ key: 'a', isComposing: true }).ok).toBe(false)
  })

  it('录制：组合键与功能键可绑定，且归一化为规范串', () => {
    expect(keySpecFromEvent({ key: 'k', ctrlKey: true }).canonical).toBe('Ctrl+K')
    expect(keySpecFromEvent({ key: 'b', ctrlKey: true, shiftKey: true }).canonical).toBe('Ctrl+Shift+B')
    expect(keySpecFromEvent({ key: 'F2' }).canonical).toBe('F2')
    expect(keySpecFromEvent({ key: 'Escape' }).canonical).toBe('Escape')
    expect(keySpecFromEvent({ key: ',' , altKey: true }).canonical).toBe('Alt+,')
  })
})

describe('保留键与冲突检测（配置期）', () => {
  it('原生菜单保留键不可绑定（Ctrl+N/O/,/Q/R、F12），并给出原因', () => {
    for (const canonical of ['Ctrl+N', 'Ctrl+O', 'Ctrl+,', 'Ctrl+Q', 'Ctrl+R', 'F12']) {
      expect(findReservedKey(canonical), canonical).toBeTruthy()
    }
    const r = validateBinding({ actionId: B.id, spec: 'Ctrl+N', bindings: {} })
    expect(r.ok).toBe(false)
    expect(r.level).toBe('reject')
    expect(r.message).toContain('保留键不可绑定')
    expect(r.message).toContain('新建文档')
  })

  it('系统级键（剪贴板/全选/F5 等）拒绝；Ctrl+A 也在保留清单', () => {
    for (const canonical of ['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'F5', 'Alt+F4']) {
      expect(validateBinding({ actionId: B.id, spec: canonical, bindings: {} }).ok).toBe(false)
    }
    expect(RESERVED_KEYS.length).toBeGreaterThanOrEqual(15)
  })

  it('与其它动作的自定义绑定重复 → 拒绝并指出占用者', () => {
    const bindings = { 'editor.italic': 'Ctrl+Shift+B' }
    const r = validateBinding({ actionId: B.id, spec: 'Ctrl+Shift+B', bindings })
    expect(r.ok).toBe(false)
    expect(r.level).toBe('reject')
    expect(r.message).toContain('斜体')
  })

  it('覆盖内置默认键位 → 允许但告警（不拒绝）', () => {
    // 把「斜体」绑到加粗的内置键位 Ctrl+B（normalize 后为 Mod+B）
    const r = validateBinding({ actionId: 'editor.italic', spec: 'Mod+B', bindings: {} })
    expect(r.ok).toBe(true)
    expect(r.level).toBe('warn')
    expect(r.message).toContain('覆盖内置键位')
    expect(r.message).toContain('加粗')
  })

  it('非法键位 → 拒绝；全新合法键位（不与任何内置默认撞车）→ ok', () => {
    expect(validateBinding({ actionId: B.id, spec: 'Ctrl+', bindings: {} }).level).toBe('reject')
    const ok = validateBinding({ actionId: B.id, spec: 'Ctrl+Alt+9', bindings: {} })
    expect(ok).toEqual({ ok: true, level: 'ok', canonical: 'Ctrl+Alt+9', message: '' })
    // 反例：Ctrl+Shift+B 在平台语义上等于「引用」的内置键位 Mod+Shift+B → 告警而非 ok
    const clash = validateBinding({ actionId: B.id, spec: 'Ctrl+Shift+B', bindings: {} })
    expect(clash.level).toBe('warn')
    expect(clash.message).toContain('引用')
  })

  it('平台等价：Ctrl+B 会被判定为覆盖内置键位 Mod+B（Windows 上同一个键）', () => {
    const r = validateBinding({ actionId: 'editor.italic', spec: 'Ctrl+B', bindings: {} })
    expect(r.level).toBe('warn')
    expect(r.message).toContain('加粗')
    // 保留键同样按平台形式判定：Mod+N 在 Windows 即 Ctrl+N（原生菜单）
    expect(validateBinding({ actionId: B.id, spec: 'Mod+N', bindings: {}, mac: false }).ok).toBe(false)
  })
})

describe('绑定表解析 / 墓碑解绑 / 非法值降级', () => {
  it("resolveBindings：跳过 ''、'none'、未知 action、非法键位（回退内置默认）", () => {
    const map = resolveBindings({
      'editor.bold': 'Ctrl+Shift+B',
      'editor.italic': SHORTCUT_UNBOUND, // 墓碑
      'editor.strike': SHORTCUT_RESET, // 回退默认
      'editor.unknown': 'Ctrl+Shift+U', // 未知动作
      'editor.undo': 'Ctrl+', // 非法值
    })
    expect([...map.entries()]).toEqual([['Ctrl+Shift+B', 'editor.bold']])
  })

  it('重复绑定兜底：同一键位只保留排序最前的一条', () => {
    const map = resolveBindings({ 'editor.italic': 'Ctrl+Shift+B', 'editor.bold': 'Ctrl+Shift+B' })
    expect([...map.entries()]).toEqual([['Ctrl+Shift+B', 'editor.bold']])
  })

  it('墓碑解绑后，该键位不再命中任何动作（且改为「屏蔽内置键位」语义）', () => {
    const e = ev({ key: 'b', ctrlKey: true, shiftKey: true })
    expect(resolveActionId({ 'editor.bold': 'Ctrl+Shift+B' }, e, false)).toBe('editor.bold')
    // 解绑墓碑 → 不命中任何动作
    expect(resolveActionId({ 'editor.bold': SHORTCUT_UNBOUND }, e, false)).toBeNull()
    // 非法值等同「未自定义」→ 也不命中（既有内置键位不受影响）
    expect(resolveActionId({ 'editor.bold': 'Ctrl+' }, e, false)).toBeNull()
  })

  it('屏蔽表：只有显式改键/解绑的动作才屏蔽其内置键位（默认空映射 → 空表）', () => {
    expect([...resolveSuppressedKeys({}, false)]).toEqual([])
    expect([...resolveSuppressedKeys({ 'editor.bold': '' }, false)]).toEqual([]) // 未自定义
    expect([...resolveSuppressedKeys({ 'editor.bold': 'Ctrl+' }, false)]).toEqual([]) // 非法值 → 等同未自定义
    // 解绑 → 屏蔽其内置键位（Windows 上 Mod+B → Ctrl+B）
    expect([...resolveSuppressedKeys({ 'editor.bold': SHORTCUT_UNBOUND }, false)]).toEqual(['Ctrl+B'])
    // 改键 → 同样屏蔽旧键位
    expect([...resolveSuppressedKeys({ 'doc.save': 'Ctrl+Alt+S' }, false)]).toEqual(['Mod+S'.replace('Mod', 'Ctrl')])
  })

  it('isSuppressedBuiltin：命中内置键位返回 true，未改键的动作不受影响', () => {
    const ctrlB = { key: 'b', ctrlKey: true }
    expect(isSuppressedBuiltin({ 'editor.bold': SHORTCUT_UNBOUND }, ctrlB, false)).toBe(true)
    expect(isSuppressedBuiltin({ 'editor.italic': SHORTCUT_UNBOUND }, ctrlB, false)).toBe(false)
    expect(isSuppressedBuiltin({}, ctrlB, false)).toBe(false)
  })

  it('effectiveBinding 四种来源（custom / unbound / default / none）与告警', () => {
    expect(effectiveBinding('editor.bold', {}).source).toBe('default')
    expect(effectiveBinding('editor.link.insert', {}).source).toBe('none')
    expect(effectiveBinding('editor.bold', { 'editor.bold': SHORTCUT_UNBOUND }).source).toBe('unbound')
    const custom = effectiveBinding('editor.italic', { 'editor.italic': 'Mod+B' })
    expect(custom.source).toBe('custom')
    expect(custom.canonical).toBe('Mod+B')
    expect(custom.warning).toContain('覆盖内置键位')
  })

  it('动作目录：稳定 id、默认键位不改既有绑定（仅元数据）', () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(25)
    expect(ACTIONS.filter((a) => a.group === 'editor').length).toBeGreaterThanOrEqual(18)
    expect(actionById('doc.save')?.defaultKey).toBe('Mod+S')
    // task-35：doc.next/prev/close 均已是真实动作（Tab 栏落地），动作表无预留项
    expect(actionById('doc.next')?.defaultKey).toBeNull()
    expect(actionById('doc.close')?.defaultKey).toBeNull()
    const ids = ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length) // id 唯一
  })
})

describe('分派决策 / handler 优先 / DOM 兜底 / 预留动作', () => {
  beforeEach(() => {
    __clearActionHandlers()
    __resetWarnings()
  })
  afterEach(() => {
    __clearActionHandlers()
    vi.restoreAllMocks()
  })

  it('handler 注册优先于 DOM 适配层', () => {
    const spy = vi.fn()
    registerActionHandler('editor.bold', spy)
    const res = runAction('editor.bold')
    expect(res).toEqual({ ran: true, via: 'handler' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('handler 缺失安全降级：不抛错、不改状态，仅 warnOnce（DOM 适配层已删除）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const res = runAction('editor.bold')
    expect(res).toEqual({ ran: false, via: 'none' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(runAction('editor.bold')).toEqual({ ran: false, via: 'none' })
    expect(warn).toHaveBeenCalledTimes(1) // warnOnce 去重
  })

  it('真实 handler 被调用（非 DOM 点击）：注册表命中即执行闭包', () => {
    const calls: string[] = []
    const off = registerActionHandlers({
      'editor.bold': () => calls.push('bold'),
      'doc.save': () => calls.push('save'),
    })
    expect(runAction('editor.bold')).toEqual({ ran: true, via: 'handler' })
    expect(runAction('doc.save')).toEqual({ ran: true, via: 'handler' })
    expect(calls).toEqual(['bold', 'save'])
    off() // 注销后回到安全降级
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(runAction('editor.bold')).toEqual({ ran: false, via: 'none' })
  })

  it('registerActionHandlers 忽略未定义的动作 id（防拼错后静默不生效）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const spy = vi.fn()
    const off = registerActionHandlers({ 'editor.not.exist': spy })
    expect(spy).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('未定义的动作 id')
    off()
  })

  it('无标签页场景：doc.next 未注册 handler → 安全降级仅提示一次（不吞键、不抛错）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(runAction('doc.next')).toEqual({ ran: false, via: 'none' })
    expect(runAction('doc.next')).toEqual({ ran: false, via: 'none' })
    expect(warn).toHaveBeenCalledTimes(1) // warnOnce 去重
  })
})

describe('全局分发器（capture 阶段 / 零副作用 / 即改即生效）', () => {
  let bindings: Record<string, string> = {}
  const run = vi.fn()
  let order: string[] = []
  let uninstall: (() => void) | null = null

  beforeEach(() => {
    bindings = {}
    run.mockClear()
    order = []
    window.addEventListener('keydown', () => order.push('bubble'))
    // 先安装（模块级单例）：capture 监听挂上后，后续测试直接改 bindings 即验证「即改即生效」
    uninstall = installShortcutDispatcher({
      getBindings: () => bindings,
      run: (id) => {
        order.push('dispatch')
        run(id)
      },
      target: window,
      mac: false,
    })
  })

  afterEach(() => {
    uninstall?.()
    uninstall = null
  })

  function dispatch(init: KeyboardEventInit): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    window.dispatchEvent(e)
    return e
  }

  it('无自定义绑定 → 零副作用（不 preventDefault、不执行动作）', () => {
    const e = dispatch({ key: 'b', ctrlKey: true })
    expect(run).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
    expect(order).toEqual(['bubble']) // 分发器未介入
  })

  it('命中自定义绑定 → capture 阶段先执行（早于 bubble），并 preventDefault', () => {
    bindings = { 'editor.bold': 'Ctrl+Shift+B' }
    const e = dispatch({ key: 'B', ctrlKey: true, shiftKey: true })
    expect(run).toHaveBeenCalledWith('editor.bold')
    expect(e.defaultPrevented).toBe(true)
    expect(order[0]).toBe('dispatch') // capture 先于 bubble
  })

  it('即改即生效：同一次安装的实例在下一次按键就读到新绑定（无需重启）', () => {
    dispatch({ key: 'b', ctrlKey: true, shiftKey: true })
    expect(run).not.toHaveBeenCalled()
    bindings = { 'editor.bold': 'Ctrl+Shift+B' } // 模拟设置页保存后缓存刷新
    dispatch({ key: 'b', ctrlKey: true, shiftKey: true })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('解绑墓碑后不再执行动作，但会屏蔽该动作的内置键位（解绑必须可见）', () => {
    bindings = { 'editor.bold': SHORTCUT_UNBOUND }
    const e = dispatch({ key: 'b', ctrlKey: true })
    expect(run).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(true) // 内置 Ctrl+B 被屏蔽
  })

  it('改键后旧键位被屏蔽、新键位触发动作（改键必须可见）', () => {
    bindings = { 'editor.bold': 'Ctrl+Shift+B' }
    const stale = dispatch({ key: 'b', ctrlKey: true })
    expect(run).not.toHaveBeenCalled()
    expect(stale.defaultPrevented).toBe(true) // 旧键位 Ctrl+B 不再加粗
    const fresh = dispatch({ key: 'b', ctrlKey: true, shiftKey: true })
    expect(run).toHaveBeenCalledWith('editor.bold')
    expect(fresh.defaultPrevented).toBe(true)
  })

  it('installShortcutDispatcher 幂等（重复安装不叠加监听）', () => {
    const second = installShortcutDispatcher({ getBindings: () => bindings, run, target: window })
    expect(isShortcutDispatcherInstalled()).toBe(true)
    bindings = { 'editor.bold': 'Ctrl+Shift+B' }
    dispatch({ key: 'b', ctrlKey: true, shiftKey: true })
    expect(run).toHaveBeenCalledTimes(1) // 只触发一次
    second() // 幂等安装返回的卸载函数是 no-op，不影响首次安装
    expect(isShortcutDispatcherInstalled()).toBe(true)
  })

  it('handleShortcutKeydown 直接调用：命中返回 actionId 并阻止冒泡', () => {
    const e = ev({ key: 'k', ctrlKey: true, shiftKey: true })
    const out = handleShortcutKeydown(e, {
      getBindings: () => ({ 'app.search.focus': 'Ctrl+Shift+K' }),
      run,
      mac: false,
    })
    expect(out).toEqual({ actionId: 'app.search.focus', suppressed: false, prevented: true })
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(e.stopPropagation).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('app.search.focus')
  })

  it('handleShortcutKeydown：命中被屏蔽的内置键位 → suppressed=true 且不执行动作', () => {
    const e = ev({ key: 's', ctrlKey: true })
    const out = handleShortcutKeydown(e, {
      getBindings: () => ({ 'doc.save': SHORTCUT_UNBOUND }),
      run,
      mac: false,
    })
    expect(out).toEqual({ actionId: null, suppressed: true, prevented: true })
    expect(run).not.toHaveBeenCalled()
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('默认空映射：既不改键也不解绑 → 任何按键都不被消费（既有快捷键不变动）', () => {
    for (const init of [
      { key: 'b', ctrlKey: true },
      { key: 's', ctrlKey: true },
      { key: 'k', ctrlKey: true },
      { key: 'z', ctrlKey: true },
    ]) {
      const e = ev(init)
      expect(handleShortcutKeydown(e, { getBindings: () => ({}), run, mac: false })).toBeNull()
      expect(e.preventDefault).not.toHaveBeenCalled()
    }
  })
})

// ---------------------------------------------------------------------------
// task-35（ADP-1 收口）：真实 handler / 无 DOM 适配 / doc.close
// ---------------------------------------------------------------------------
describe('task-35 收口 — 真实 handler 闭包 + doc.close + 无 DOM 兜底', () => {
  beforeEach(() => {
    __clearActionHandlers()
    __resetWarnings()
  })
  afterEach(() => {
    __clearActionHandlers()
    vi.restoreAllMocks()
  })

  it('真实 handler 被调用（非 DOM 点击）：keydown → runAction → 注册的闭包', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const called = vi.fn()
    registerActionHandler('editor.bold', called)
    const e = ev({ key: 'B', ctrlKey: true, shiftKey: true })
    const out = handleShortcutKeydown(e, {
      getBindings: () => ({ 'editor.bold': 'Ctrl+Shift+B' }),
      mac: false,
    })
    expect(out).toEqual({ actionId: 'editor.bold', suppressed: false, prevented: true })
    expect(called).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('收口不回归：shortcuts.ts 不得再出现 DOM 适配代码', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/state/shortcuts.ts'), 'utf8')
    expect(src).not.toContain('runActionViaDom')
    expect(src).not.toContain('querySelector')
  })

  it('doc.close：新增定义、默认不绑定（Ctrl+W 保留）、可绑定且纳入冲突检测', () => {
    const def = actionById('doc.close')
    expect(def).toBeTruthy()
    expect(def!.group).toBe('app')
    expect(def!.defaultKey).toBeNull() // 默认不绑定
    // 可绑定：与内置默认/保留键都不冲突的键位
    expect(validateBinding({ actionId: 'doc.close', spec: 'Ctrl+Alt+W', bindings: {} })).toEqual({
      ok: true,
      level: 'ok',
      canonical: 'Ctrl+Alt+W',
      message: '',
    })
    // 纳入冲突检测：与其它动作自定义绑定重复 → 拒绝；系统保留键 → 拒绝
    expect(
      validateBinding({ actionId: 'doc.close', spec: 'Ctrl+Shift+B', bindings: { 'editor.bold': 'Ctrl+Shift+B' } }).ok,
    ).toBe(false)
    expect(validateBinding({ actionId: 'doc.close', spec: 'Ctrl+W', bindings: {} }).ok).toBe(false)
    // 分派：绑定后按键命中
    expect(resolveActionId({ 'doc.close': 'Ctrl+Alt+W' }, { key: 'w', ctrlKey: true, altKey: true }, false)).toBe('doc.close')
  })

  it('接线守卫：App / EditorArea / LeftSidebar 注册真实闭包（防只改 dispatcher 不接线）', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const editorArea = readFileSync(resolve(process.cwd(), 'src/components/layout/EditorArea.tsx'), 'utf8')
    const leftSidebar = readFileSync(resolve(process.cwd(), 'src/components/layout/LeftSidebar.tsx'), 'utf8')
    expect(app).toMatch(/registerActionHandlers\(/)
    expect(app).toMatch(/registerActionHandler\('doc\.next'/)
    expect(app).toMatch(/registerActionHandler\('doc\.prev'/)
    expect(editorArea).toMatch(/registerActionHandlers\(\{/)
    expect(leftSidebar).toMatch(/'app\.search\.focus'/)
    expect(leftSidebar).toMatch(/'app\.trash\.open'/)
    // K10/K11：两条导出路径都必须把源 frontmatter 区块拼回（zip 路径修前只写 ke_version）
    const pkgStart = editorArea.indexOf('const handleExportPackage')
    expect(pkgStart, 'EditorArea 缺少 handleExportPackage').toBeGreaterThan(0)
    expect(editorArea.slice(pkgStart, pkgStart + 1600), 'zip 导出必须用 frontmatterBlockOf 拼回源 frontmatter').toContain('frontmatterBlockOf')

    // 收口：三处都不得再引用已删除的 DOM 适配层
    for (const [name, src] of [['App', app], ['EditorArea', editorArea], ['LeftSidebar', leftSidebar]] as const) {
      expect(src, `${name} 仍引用 runActionViaDom`).not.toContain('runActionViaDom')
    }
  })

  it('task-35 C + task-44 B4：App 全部「放弃」分支都调用共享 discardPending', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).toContain('discardPending')
    // 5 个调用点（import 行不含括号，故统计 `discardPending(` 即为调用次数）：
    //   ① requestOpenArticle ② closeTabById（task-35 C）
    //   ③ switchWorkspace ④ handleCloseWorkspace ⑤ handleNewArticle（task-44 B4，工作区级三处）
    expect((app.match(/discardPending\(/g) ?? []).length).toBe(5)
    expect(app).toContain("askConfirm('当前有未保存修改，切换将放弃这些修改，是否继续？')")
    expect(app).toContain("askConfirm('当前有未保存修改，关闭标签将放弃这些修改，是否继续？')")
    expect(app).toContain("askConfirm('当前文档有未保存修改，切换工作区将放弃这些修改，是否继续？')")
    expect(app).toContain("askConfirm('当前文档有未保存修改，关闭工作区将放弃这些修改，是否继续？')")
    expect(app).toContain("askConfirm('当前有未保存修改，新建将放弃这些修改，是否继续？')")
  })

  it('动作表完整性：每个 action id 都有真实注册点（App / EditorArea / LeftSidebar）', () => {
    const sources = [
      readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8'),
      readFileSync(resolve(process.cwd(), 'src/components/layout/EditorArea.tsx'), 'utf8'),
      readFileSync(resolve(process.cwd(), 'src/components/layout/LeftSidebar.tsx'), 'utf8'),
    ].join('\n')
    const missing = ACTIONS.map((a) => a.id).filter((id) => !sources.includes(`'${id}'`))
    expect(missing, `以下 action id 没有注册点：${missing.join(', ')}`).toEqual([])
  })
})
