/**
 * task-29（v1.2.0-pre.1 项①）：设置页「快捷键」区 —— 动作列表 + 录制/解绑/恢复默认。
 *
 * 行为契约：
 *  - 默认空映射 = 全部沿用既有内置键位（本组件不写入任何键位，除非用户主动录制）；
 *  - 录制：capture 阶段捕获键盘，**Esc 取消并提示**；纯修饰键/输入法组合/字母数字单键被拒绝；
 *  - 冲突：配置期由 `validateBinding` 拒绝（保留键 / 已被其它动作占用）并给出原因；
 *    覆盖内置键位属「允许但告警」；
 *  - 解绑写入墓碑值 `'none'`；「恢复默认」写入 `''`（清除自定义）——两者语义不同，见 state/shortcuts.ts。
 *  - 即改即生效：保存后 `settings.ts` 的分发器每次按键都读最新缓存，无需重启。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ACTIONS,
  RESERVED_KEYS,
  SHORTCUT_RESET,
  SHORTCUT_UNBOUND,
  actionById,
  effectiveBinding,
  keySpecFromEvent,
  setShortcutRecording,
  validateBinding,
  type ShortcutActionDef,
} from '../../state/shortcuts'

export interface ShortcutsSectionProps {
  /** 当前自定义绑定（actionId → 规范串 / 'none' / ''） */
  bindings: Record<string, string>
  /** 保存单个动作的绑定值（'' = 恢复默认；'none' = 解绑；其它 = 自定义键位） */
  onBind: (actionId: string, spec: string) => void | Promise<void>
}

interface RecordState {
  actionId: string
  message: string
  level: 'info' | 'warn' | 'error'
}

export default function ShortcutsSection({ bindings, onBind }: ShortcutsSectionProps) {
  const [recording, setRecording] = useState<RecordState | null>(null)
  /** 每个动作最近一次操作的反馈（成功/告警/拒绝） */
  const [feedback, setFeedback] = useState<Record<string, { text: string; level: 'ok' | 'warn' | 'error' }>>({})

  const editingActions = useMemo(() => ACTIONS.filter((a) => a.group === 'editor'), [])
  const appActions = useMemo(() => ACTIONS.filter((a) => a.group === 'app'), [])

  // 录制期间让全局分发器让路（否则会立刻触发该键位已绑定的动作）
  useEffect(() => {
    setShortcutRecording(recording !== null)
    return () => setShortcutRecording(false)
  }, [recording])

  /** 录制中的按键处理 */
  const handleCapture = useCallback(
    (action: ShortcutActionDef) => (e: KeyboardEvent) => {
      // Esc = 取消录制（并提示）
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setRecording(null)
        setFeedback((f) => ({ ...f, [action.id]: { text: '已取消录制（Esc）', level: 'warn' } }))
        return
      }
      const parsed = keySpecFromEvent(e)
      if (!parsed.ok || !parsed.canonical) {
        e.preventDefault()
        e.stopPropagation()
        setFeedback((f) => ({ ...f, [action.id]: { text: parsed.error ?? '该按键不可绑定', level: 'error' } }))
        return
      }
      const check = validateBinding({ actionId: action.id, spec: parsed.canonical, bindings })
      e.preventDefault()
      e.stopPropagation()
      if (!check.ok) {
        // 配置期拒绝：保留录制态？—— 直接结束录制并提示原因，避免用户以为已生效
        setRecording(null)
        setFeedback((f) => ({ ...f, [action.id]: { text: check.message, level: 'error' } }))
        return
      }
      setRecording(null)
      void onBind(action.id, check.canonical ?? parsed.canonical)
      setFeedback((f) => ({
        ...f,
        [action.id]: {
          text: check.level === 'warn' ? `已绑定 ${check.canonical}（${check.message}）` : `已绑定 ${check.canonical}`,
          level: check.level === 'warn' ? 'warn' : 'ok',
        },
      }))
    },
    [bindings, onBind],
  )

  // 录制态：在 window 上挂 capture 监听（早于 PM 的 DOM handler）
  useEffect(() => {
    if (!recording) return
    const action = actionById(recording.actionId)
    if (!action) return
    const handler = handleCapture(action)
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [recording, handleCapture])

  const startRecording = (action: ShortcutActionDef) => {
    setFeedback((f) => ({ ...f, [action.id]: { text: '', level: 'ok' } }))
    setRecording({ actionId: action.id, message: '请按下新的组合键（Esc 取消）', level: 'info' })
  }

  const unbind = (action: ShortcutActionDef) => {
    void onBind(action.id, SHORTCUT_UNBOUND)
    setFeedback((f) => ({
      ...f,
      [action.id]: {
        text: action.defaultKey
          ? `已解绑（内置键位 ${action.defaultKey} 一并屏蔽）`
          : '已解绑（该动作不再有快捷键）',
        level: 'ok',
      },
    }))
  }

  const reset = (action: ShortcutActionDef) => {
    void onBind(action.id, SHORTCUT_RESET)
    setFeedback((f) => ({ ...f, [action.id]: { text: '已恢复内置默认键位', level: 'ok' } }))
  }

  return (
    <div className="flex flex-col gap-7" data-testid="shortcuts-section">
      {/* 保留键说明 */}
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
        <p className="text-[12px] leading-5 text-muted-foreground">
          自定义键位只覆盖你自己的动作，<strong className="font-medium text-foreground">既有快捷键默认保持不变</strong>
          （留空即为内置键位）。以下按键由系统或原生菜单占用，<strong className="font-medium text-foreground">不可绑定</strong>：
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {RESERVED_KEYS.slice(0, 6).map((r) => (
            <span
              key={r.canonical}
              title={r.reason}
              data-testid="reserved-key"
              className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-[1px] font-mono text-[11px] text-amber-700"
            >
              {r.canonical}
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
          已知冲突：<code className="font-mono">Ctrl+N</code> 同时是原生菜单「新建文档」与编辑器「插入行内公式」——
          按「既有快捷键不变动」，当前由菜单接管，本设置不做改动。
          <br />
          「改键 / 解绑」会屏蔽该动作的<strong className="font-medium text-foreground">内置键位</strong>（否则旧键位仍生效、
          自定义等于没生效）；「恢复默认」则把内置键位还原。
        </p>
      </div>

      <Group title="编辑器" actions={editingActions} {...{ bindings, recording, feedback, startRecording, unbind, reset }} />
      <Group title="应用" actions={appActions} {...{ bindings, recording, feedback, startRecording, unbind, reset }} />
    </div>
  )
}

function Group({
  title,
  actions,
  bindings,
  recording,
  feedback,
  startRecording,
  unbind,
  reset,
}: {
  title: string
  actions: ShortcutActionDef[]
  bindings: Record<string, string>
  recording: RecordState | null
  feedback: Record<string, { text: string; level: 'ok' | 'warn' | 'error' }>
  startRecording: (a: ShortcutActionDef) => void
  unbind: (a: ShortcutActionDef) => void
  reset: (a: ShortcutActionDef) => void
}) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      <div className="mt-2 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-col divide-y divide-border">
          {actions.map((a) => (
            <ShortcutRow
              key={a.id}
              action={a}
              bindings={bindings}
              recording={recording}
              feedback={feedback[a.id]}
              startRecording={startRecording}
              unbind={unbind}
              reset={reset}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ShortcutRow({
  action,
  bindings,
  recording,
  feedback,
  startRecording,
  unbind,
  reset,
}: {
  action: ShortcutActionDef
  bindings: Record<string, string>
  recording: RecordState | null
  feedback?: { text: string; level: 'ok' | 'warn' | 'error' }
  startRecording: (a: ShortcutActionDef) => void
  unbind: (a: ShortcutActionDef) => void
  reset: (a: ShortcutActionDef) => void
}) {
  const eff = effectiveBinding(action.id, bindings)
  const isRecording = recording?.actionId === action.id
  const isCustom = eff.source === 'custom'
  const isUnbound = eff.source === 'unbound'
  const sourceLabel = isCustom ? '自定义' : isUnbound ? '已解绑' : eff.source === 'default' ? '内置默认' : '未绑定'
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3" data-testid={`shortcut-row-${action.id}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium leading-5 text-foreground">{action.label}</p>
        <p className="mt-0.5 truncate font-mono text-[11px] leading-4 text-muted-foreground" title={action.id}>
          {action.id}
          {action.note ? <span className="ml-2 font-sans text-amber-600">{action.note}</span> : null}
        </p>
        {feedback?.text ? (
          <p
            className={[
              'mt-0.5 text-[11px] leading-4',
              feedback.level === 'error' ? 'text-rose-600' : feedback.level === 'warn' ? 'text-amber-600' : 'text-emerald-600',
            ].join(' ')}
            data-testid={`shortcut-feedback-${action.id}`}
          >
            {feedback.text}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className={[
            'inline-flex min-w-[76px] items-center justify-center gap-1 rounded border px-2 py-1 font-mono text-[11px]',
            isRecording
              ? 'border-primary/60 bg-primary/10 text-foreground'
              : isCustom
                ? 'border-border bg-secondary text-secondary-foreground'
                : 'border-border bg-muted/40 text-muted-foreground',
          ].join(' ')}
          data-testid={`shortcut-binding-${action.id}`}
          title={`${sourceLabel}${eff.warning ? ` · ${eff.warning}` : ''}`}
        >
          {isRecording ? '按下新键…' : isUnbound ? '（已解绑）' : (eff.canonical ?? '（无）')}
        </span>
        <button
          type="button"
          onClick={() => startRecording(action)}
          aria-label={`录制 ${action.label} 的快捷键`}
          data-testid={`shortcut-record-${action.id}`}
          className="h-7 rounded border border-border bg-card px-2 text-[12px] text-foreground/80 transition-colors hover:bg-muted"
        >
          {isRecording ? '录制中…' : '改键'}
        </button>
        <button
          type="button"
          onClick={() => unbind(action)}
          disabled={isUnbound}
          aria-label={`解绑 ${action.label} 的快捷键`}
          data-testid={`shortcut-unbind-${action.id}`}
          className="h-7 rounded border border-border bg-card px-2 text-[12px] text-foreground/80 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          解绑
        </button>
        <button
          type="button"
          onClick={() => reset(action)}
          disabled={!isCustom && !isUnbound}
          aria-label={`恢复 ${action.label} 的默认快捷键`}
          data-testid={`shortcut-reset-${action.id}`}
          className="h-7 rounded border border-border bg-card px-2 text-[12px] text-foreground/80 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          恢复默认
        </button>
      </div>
    </div>
  )
}
