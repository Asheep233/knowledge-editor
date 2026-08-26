/**
 * 文件系统事件判定纯函数（P1-8 / P3-7）。
 *
 * 把 App 的 handleFsEvent 中「是否关当前文档 / 是否弹窗 / 是否刷新树」的判定抽成
 * 无副作用纯函数，便于单测。读取「当前打开文档 id」统一经由 `LatestRef`，规避
 * 轮询 effect 闭包捕获旧 article 导致的 stale closure（P1-8）。
 */
import type { FsEvent } from '../types'

/** 自身保存写入后，此窗口内收到后端 modified 事件视为「自己写的不算外部修改」 */
export const SELF_WRITE_COOLDOWN_MS = 2500

/** 可变的「最新值」容器（等效 useRef，但可在纯函数里模拟其行为）。 */
export interface LatestRef<T> {
  current: T
}

export function createLatestRef<T>(initial: T): LatestRef<T> {
  return { current: initial }
}

export interface FsEventCtx {
  /** 当前打开文档 id（null = 无文档打开） */
  currentId: string | null
  /** 该 id 最近一次自身保存时间戳（ms，0 = 从未保存） */
  lastSavedAt: number
  /** 判定时刻（ms），用于自写抑制；默认为 Date.now() */
  nowMs?: number
  /** 自写抑制窗口，默认 2500ms */
  selfWriteCooldownMs?: number
}

export interface FsEventDecision {
  /** 是否需要刷新文件树（created/deleted 会影响树结构；modified 不会） */
  refreshTree: boolean
  /** 是否需要向用户提示，以及提示类型 */
  surface: 'none' | 'modified' | 'deleted'
}

export function classifyFsEvent(ev: FsEvent, ctx: FsEventCtx): FsEventDecision {
  const refreshTree = ev.type !== 'modified'
  const matchesCurrent = !!ctx.currentId && ev.rel === ctx.currentId

  if (!matchesCurrent) {
    return { refreshTree, surface: 'none' }
  }

  if (ev.type === 'deleted') {
    // P3-7：外部删除当前文档 → 提示 + 清空当前 article
    return { refreshTree: true, surface: 'deleted' }
  }

  if (ev.type === 'modified') {
    const now = ctx.nowMs ?? Date.now()
    const cooldown = ctx.selfWriteCooldownMs ?? SELF_WRITE_COOLDOWN_MS
    if (now - ctx.lastSavedAt < cooldown) {
      // 自身保存写入被后端/自身标记抑制，再兜底一次：不弹窗
      return { refreshTree: false, surface: 'none' }
    }
    return { refreshTree: false, surface: 'modified' }
  }

  return { refreshTree, surface: 'none' }
}

/** 便捷判定：当前文档是否发生了「需要用户留意」的外部事件（modified 或 deleted）。 */
export function isCurrentDocEvent(ev: FsEvent, ctx: FsEventCtx): boolean {
  return classifyFsEvent(ev, ctx).surface !== 'none'
}

/**
 * 生成一个「始终读最新 currentId」的事件处理器（模拟 handleFsEvent 的 ref 修复）。
 * App 侧把读取到的关当前文档 id 存进 ref，事件回调经由本处理器读 ref 而非闭包捕获值。
 */
export function makeFsEventReader(ref: LatestRef<string | null>) {
  return function readCurrent(): string | null {
    return ref.current
  }
}
