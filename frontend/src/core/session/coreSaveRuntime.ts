/**
 * UI 工坊 P2-T14（ADR-002 步骤 2）：EditorArea 运行时入口（flag + 桥单例 + 每文档 SaveFn 缓存）。
 *
 * - `coreSaveEnabled()`：`VITE_KE_CORE_SAVE === '1'`（默认关闭 → 旧保存链零行为变化）；
 * - `saveViaCore(relPath, content, signal?)`：每文档缓存产品 SaveFn（内部持有 coordinator+revision），
 *   保存前把最新内容通过 provider 交给 Core；返回 {status, revision}；
 * - 测试注入：`__setCoreBridgeFactoryForTests` / `resetCoreSaveRuntimeForTests`。
 */
import { CoreSaveBridge } from './coreSaveBridge'
import type { ProductSaveFn } from './productAdapter'

interface BridgeLike {
  createSaveFn(relPath: string, getContent: () => string): Promise<ProductSaveFn>
}

/** 产品后端 base URL（main.tsx 在挂载前写入；测试/非桌面为空 → 同源相对路径） */
export function resolveCoreApiBase(): string {
  try {
    const base = (globalThis as { __KE_API_BASE__?: string }).__KE_API_BASE__
    return typeof base === 'string' ? base : ''
  } catch {
    return ''
  }
}

let bridge: BridgeLike | null = null
let bridgeFactory: () => BridgeLike = () => new CoreSaveBridge({ baseUrl: resolveCoreApiBase() })
const contentByRel = new Map<string, string>()
const fnByRel = new Map<string, ProductSaveFn>()

function sharedBridge(): BridgeLike {
  if (!bridge) bridge = bridgeFactory()
  return bridge
}

export function coreSaveEnabled(): boolean {
  try {
    return (import.meta.env?.VITE_KE_CORE_SAVE ?? '') === '1'
  } catch {
    return false
  }
}

export async function saveViaCore(relPath: string, content: string, signal?: AbortSignal): Promise<{ status: string; revision: number }> {
  contentByRel.set(relPath, content)
  let fn = fnByRel.get(relPath)
  if (!fn) {
    fn = await sharedBridge().createSaveFn(relPath, () => contentByRel.get(relPath) ?? '')
    fnByRel.set(relPath, fn)
  }
  return (await fn(signal)) as { status: string; revision: number }
}

/** 测试/切库：清空桥单例与每文档缓存。 */
export function resetCoreSaveRuntimeForTests(): void {
  bridge = null
  bridgeFactory = () => new CoreSaveBridge({ baseUrl: resolveCoreApiBase() })
  contentByRel.clear()
  fnByRel.clear()
}

export function __setCoreBridgeFactoryForTests(factory: () => BridgeLike): void {
  bridge = null
  bridgeFactory = factory
  contentByRel.clear()
  fnByRel.clear()
}
