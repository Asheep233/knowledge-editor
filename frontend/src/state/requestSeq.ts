/**
 * 请求序号管理（P1-7：保存/打开响应无请求序号，跨文档/跨工作区串写）。
 *
 * - openArticle 发起时拿到一个序号；响应回来时若序号已不是最新（期间又点了别的文档），
 *   丢弃该响应，避免「快速点 A→B，A 的响应后到」导致最终显示 A。
 * - handleSaved 校验返回的 doc.id 是否仍等于当前文档 id（经 ref 读最新 id），
 *   否则不 setArticle，避免旧文档的保存串写新文档。
 */
import type { LatestRef } from './fsEvent'

export interface RequestSeq {
  next(): number
  isLatest(seq: number): boolean
}

export function createRequestSeq(): RequestSeq {
  let current = 0
  return {
    next(): number {
      current += 1
      return current
    },
    isLatest(seq: number): boolean {
      return seq === current
    },
  }
}

export interface OpenApplyOptions<T> {
  fetchFn: (id: string) => Promise<T>
  seq: RequestSeq
  apply: (value: T) => void
  /** 当响应已过期（期间又发起新请求）时回调 */
  onStale?: () => void
}

/**
 * 带序号的异步打开：发起请求前分配序号，响应回来时若序号已过期则丢弃。
 * 用于 openArticle，防止旧响应覆盖后发起的请求。
 * @returns 若本请求是「最新」且未被过期，返回 true。
 */
export async function openWithSeq<T>(id: string, opts: OpenApplyOptions<T>): Promise<boolean> {
  const mySeq = opts.seq.next()
  const value = await opts.fetchFn(id)
  if (!opts.seq.isLatest(mySeq)) {
    opts.onStale?.()
    return false
  }
  opts.apply(value)
  return true
}

/**
 * 保存完成回调的前置校验：仅当该保存对应的 doc.id 仍等于「当前打开文档」时才应用。
 * 当前打开文档经 ref 读取，避免闭包吞掉最新 id。
 */
export function shouldAcceptSave(docId: string, currentIdRef: LatestRef<string | null>): boolean {
  return docId === currentIdRef.current
}
