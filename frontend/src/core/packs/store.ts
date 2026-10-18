/**
 * UI 工坊 P3-T17：包存储与安装事务（无 UI / 无 Tauri 依赖）。
 *
 * 语义（对应 S5 原型与 T17 完成定义）：
 * - 包目录**不可变**：`packs/<id>/<version>/` 只写一次；安装先写 staging 再 rename；
 * - **单提交点**：`state.json`（active/previous）经 tmp+rename 一次提交；journal 记录事务；
 * - 失败/崩溃无损：staging/journal 由 recover() 清理，state 不变化，旧版本保持可用；
 * - 升级保留 previous；回滚交换 active/previous；激活/回滚前校验资产哈希（损坏拒绝）；
 * - 扫描候选时任何清单/路径/能力/哈希错误都无损拒绝（PackValidationError）。
 *
 * 存储通过注入 `PackFileSystem`（生产为 Tauri fs，测试为 memory）。无 DOM/Node 直接依赖。
 */
import { validateManifest, type PackManifest } from './manifest'

export interface PackFileSystem {
  readBytes(path: string): Promise<Uint8Array | null>
  writeBytes(path: string, bytes: Uint8Array): Promise<void>
  deleteFile(path: string): Promise<void>
  deleteDir(path: string): Promise<void>
  listDir(path: string): Promise<string[]>
  rename(from: string, to: string): Promise<void>
  exists(path: string): Promise<boolean>
}

export type PackHasher = (bytes: Uint8Array) => Promise<string>

/** 默认 hasher：WebCrypto sha256（Node ≥20 与浏览器均有）。测试可注入。 */
export const webCryptoSha256: PackHasher = async (bytes) => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface PackState {
  active: string | null
  previous: string | null
  updatedAt: string
}

interface Txn {
  op: 'install' | 'activate' | 'rollback'
  id: string
  version?: string
  staging?: string
  before: PackState
}

const ROOT = 'packs'

function statePath(id: string): string { return `${ROOT}/${id}/state.json` }
function txnPath(id: string): string { return `${ROOT}/${id}/txn.json` }
function packDir(id: string, version: string): string { return `${ROOT}/${id}/${version}` }

async function readJson<T>(fs: PackFileSystem, path: string): Promise<T | null> {
  const bytes = await fs.readBytes(path)
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}

async function writeJson(fs: PackFileSystem, path: string, value: unknown): Promise<void> {
  await fs.writeBytes(path, new TextEncoder().encode(JSON.stringify(value)))
}

export class PackStore {
  private readonly fs: PackFileSystem
  private readonly hash: PackHasher

  constructor(fs: PackFileSystem, hash: PackHasher = webCryptoSha256) {
    this.fs = fs
    this.hash = hash
  }

  async state(id: string): Promise<PackState> {
    const st = await readJson<PackState>(this.fs, statePath(id))
    return st ?? { active: null, previous: null, updatedAt: new Date(0).toISOString() }
  }

  /** 安装（或升级）包：校验清单/哈希 → staging → rename → state 单提交点。 */
  async install(manifest: PackManifest, files: Record<string, Uint8Array>): Promise<PackState> {
    const id = manifest.id
    const version = manifest.version
    const dir = packDir(id, version)
    if (await this.fs.exists(dir)) throw new Error(`E_DUPLICATE: 版本已安装 ${id}@${version}`)
    // 校验每个资产存在且哈希匹配（无损拒绝：此处失败不写任何东西）
    for (const asset of manifest.assets) {
      const bytes = files[asset.path]
      if (!bytes) throw new Error(`E_HASH: 缺少资产 ${asset.path}`)
      const digest = await this.hash(bytes)
      if (digest !== asset.sha256) throw new Error(`E_HASH: 资产哈希不匹配 ${asset.path}`)
    }
    const before = await this.state(id)
    if (await this.fs.exists(txnPath(id))) throw new Error('E_TXN: 存在未完成事务，请先 recover()')
    const staging = `${ROOT}/${id}/.staging-${version}-${Math.random().toString(36).slice(2, 8)}`
    const txn: Txn = { op: 'install', id, version, staging, before }
    await writeJson(this.fs, txnPath(id), txn)
    try {
      for (const asset of manifest.assets) {
        await this.fs.writeBytes(`${staging}/${asset.path}`, files[asset.path])
      }
      await writeJson(this.fs, `${staging}/manifest.json`, manifest)
      await this.fs.rename(staging, dir)
      const next: PackState = { active: version, previous: before.active && before.active !== version ? before.active : before.previous, updatedAt: new Date().toISOString() }
      await this.commitState(id, next)
      await this.fs.deleteFile(txnPath(id))
      return next
    } catch (e) {
      // 失败回滚：删除未被 state 引用的半成品版本目录（rename 可能已发生）+ staging + journal
      if (await this.fs.exists(dir)) await this.fs.deleteDir(dir)
      await this.cleanupStaging(staging)
      await this.fs.deleteFile(txnPath(id))
      throw e
    }
  }

  /** 激活已安装版本（校验完整性）；失败保持旧 state。 */
  async activate(id: string, version: string): Promise<PackState> {
    const ok = await this.verify(id, version)
    if (!ok) throw new Error(`E_HASH: 版本完整性校验失败 ${id}@${version}`)
    const before = await this.state(id)
    if (before.active === version) return before
    const txn: Txn = { op: 'activate', id, version, before }
    await writeJson(this.fs, txnPath(id), txn)
    const next: PackState = { active: version, previous: before.active, updatedAt: new Date().toISOString() }
    await this.commitState(id, next)
    await this.fs.deleteFile(txnPath(id))
    return next
  }

  /** 回滚到 previous（校验后交换）；无 previous → 报错。 */
  async rollback(id: string): Promise<PackState> {
    const before = await this.state(id)
    if (!before.previous) throw new Error(`E_ROLLBACK: 没有可回滚的 previous 版本 ${id}`)
    if (!(await this.verify(id, before.previous))) throw new Error(`E_HASH: previous 版本已损坏，拒绝回滚 ${id}@${before.previous}`)
    const txn: Txn = { op: 'rollback', id, version: before.previous, before }
    await writeJson(this.fs, txnPath(id), txn)
    const next: PackState = { active: before.previous, previous: before.active, updatedAt: new Date().toISOString() }
    await this.commitState(id, next)
    await this.fs.deleteFile(txnPath(id))
    return next
  }

  /** 完整性校验：清单可解析 + 每个资产哈希匹配。 */
  async verify(id: string, version: string): Promise<boolean> {
    const dir = packDir(id, version)
    const rawManifest = await readJson<unknown>(this.fs, `${dir}/manifest.json`)
    if (!rawManifest) return false
    let manifest: PackManifest
    try {
      manifest = validateManifest(rawManifest)
    } catch {
      return false
    }
    for (const asset of manifest.assets) {
      const bytes = await this.fs.readBytes(`${dir}/${asset.path}`)
      if (!bytes || (await this.hash(bytes)) !== asset.sha256) return false
    }
    return true
  }

  /**
   * 崩溃/失败恢复：清理 staging 与 journal；若 active 损坏且有可用 previous → 自动回滚。
   * 返回恢复结果（供 Rust 原生恢复/诊断上报）。
   */
  async recover(id: string): Promise<{ recovered: boolean; action: string; state: PackState }> {
    const txn = await readJson<Txn>(this.fs, txnPath(id))
    const stateBefore = await this.state(id)
    // 未提交的 install 半成品版本目录（rename 已发生但 state 未提交）→ 删除
    if (txn?.op === 'install' && txn.version && stateBefore.active !== txn.version && stateBefore.previous !== txn.version) {
      await this.fs.deleteDir(packDir(id, txn.version))
    }
    if (txn?.staging) await this.cleanupStaging(txn.staging)
    if (txn) await this.fs.deleteFile(txnPath(id))
    let state = await this.state(id)
    if (state.active && !(await this.verify(id, state.active))) {
      if (state.previous && (await this.verify(id, state.previous))) {
        state = { active: state.previous, previous: state.active, updatedAt: new Date().toISOString() }
        await this.commitState(id, state)
        return { recovered: true, action: 'rollback-corrupt-active', state }
      }
      return { recovered: false, action: 'corrupt-no-fallback', state }
    }
    return { recovered: !!txn, action: txn ? 'cleanup-journal' : 'clean', state }
  }

  private async commitState(id: string, next: PackState): Promise<void> {
    const tmp = `${statePath(id)}.tmp-${Math.random().toString(36).slice(2, 8)}`
    await writeJson(this.fs, tmp, next)
    await this.fs.rename(tmp, statePath(id))
  }

  private async cleanupStaging(staging: string): Promise<void> {
    try {
      await this.fs.deleteDir(staging)
    } catch {
      /* 可能已不存在 */
    }
  }
}

/** 内存文件系统（测试/端口模拟；目录用前缀模拟）。 */
export class MemoryPackFs implements PackFileSystem {
  files = new Map<string, Uint8Array>()
  failOnRename?: (from: string, to: string) => boolean

  normalise(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    return this.files.get(this.normalise(path)) ?? null
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(this.normalise(path), bytes)
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(this.normalise(path))
  }

  async deleteDir(path: string): Promise<void> {
    const p = this.normalise(path)
    for (const key of [...this.files.keys()]) if (key === p || key.startsWith(`${p}/`)) this.files.delete(key)
  }

  async listDir(path: string): Promise<string[]> {
    const p = this.normalise(path)
    const out = new Set<string>()
    for (const key of this.files.keys()) {
      if (!key.startsWith(`${p}/`)) continue
      out.add(key.slice(p.length + 1).split('/')[0])
    }
    return [...out]
  }

  async rename(from: string, to: string): Promise<void> {
    const f = this.normalise(from)
    const t = this.normalise(to)
    if (this.failOnRename?.(f, t)) throw new Error('E_IO: 模拟 rename 失败')
    const moved: Array<[string, Uint8Array]> = []
    const sources: string[] = []
    for (const [key, value] of this.files) {
      if (key === f) {
        sources.push(key)
        moved.push([t, value])
      } else if (key.startsWith(`${f}/`)) {
        sources.push(key)
        moved.push([`${t}/${key.slice(f.length + 1)}`, value])
      }
    }
    if (moved.length === 0) throw new Error(`E_IO: rename 源不存在 ${f}`)
    for (const key of sources) this.files.delete(key)
    for (const [key, value] of moved) this.files.set(key, value)
  }

  async exists(path: string): Promise<boolean> {
    const p = this.normalise(path)
    if (this.files.has(p)) return true
    for (const key of this.files.keys()) if (key.startsWith(`${p}/`)) return true
    return false
  }
}
