#!/usr/bin/env node
/**
 * UI 工坊 G7：参考包 A/B 构建 + 签名 + 打包工具。
 *
 * 做什么：
 *   1. 扫描 `docs/ui-workshop/packs/pack-a`、`pack-b` 源目录，按 manifest.assets 声明
 *      计算每个资产的 **sha256 + 字节数**，写回源 manifest（源 manifest 保持合法 schema、可 diff）；
 *   2. 同步 vendored SDK：`<pack>/vendor/guest-sdk.js` ← `docs/ui-workshop/sdk/dist/guest-sdk.js`
 *      （参考包内联发布 SDK 的 iife 产物，全局 `KeWorkshopSDK`；sdk dist 变更时本工具刷新副本）；
 *   3. 复制到 `docs/ui-workshop/packs/dist/<pack>/`，用与 `tools/sign_pack.mjs` **同一
 *      `canonicalManifestPayload`** 计算 ed25519 签名并写入 dist manifest（源 manifest 不含签名）；
 *      签名后立刻用公钥验签（失败即退出非 0）；
 *   4. 生成 zip 离线包（zip 根 = manifest.json + 资产，与产品 W01 `workshop_pack_stage_zip` 兼容）
 *      与 `dist/build-info.json`（大小/哈希/公钥/zip sha256，供证据引用）。
 *
 * 密钥纪律：测试用自签密钥**不入仓**。`--key <pem>` 显式传入（探针用隔离目录里的临时密钥）；
 * 不传时在 dist 内生成/复用 `dist/.test-signing-key.pem`（dist 已 gitignore）并告警；工具拒绝
 * 使用仓库内非 dist 路径的私钥文件。
 *
 * 用法：
 *   node docs/ui-workshop/tools/build_reference_packs.mjs [--key <private.pem>] [--keyid k1]
 *        [--packs <dir>] [--out <dir>] [--json-out <file>] [--check]
 *
 * 退出码：0 成功 / 1 校验或构建失败 / 2 参数错误。
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

import { canonicalManifestPayload } from './sign_pack.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKSHOP_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(WORKSHOP_ROOT, '..', '..')
const DEFAULT_PACKS_DIR = join(WORKSHOP_ROOT, 'packs')
const DEFAULT_OUT_DIR = join(DEFAULT_PACKS_DIR, 'dist')
const SDK_DIST = join(WORKSHOP_ROOT, 'sdk', 'dist', 'guest-sdk.js')

/** 与 `frontend/src/core/packs/manifest.ts` ALLOWED_CAPABILITIES 保持一致（构建期早失败）。 */
const ALLOWED_CAPABILITIES = [
  'ui.shell',
  'panel.sidebar',
  'panel.dock',
  'editor.commands.readonly',
  'context.read',
  'context.write',
  'print.request',
]
const PACK_API_VERSION = 1
const ID_RE = /^[a-z0-9][a-z0-9.-]{1,80}$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const SHA256_RE = /^[a-f0-9]{64}$/
const COMMAND_RE = /^[a-z][a-z0-9.-]{1,80}$/
const HANDLER_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/
/** 需要从仓库内其它发布产物同步进包的 vendored 资产（path → 源文件）。 */
const VENDOR_SOURCES = {
  'vendor/guest-sdk.js': SDK_DIST,
}

function fail(message) {
  console.error(`[build_reference_packs] FAIL: ${message}`)
  process.exit(1)
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback
}
function has(name) {
  return process.argv.includes(name)
}

function sha256Buf(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function safeRelPath(path) {
  const raw = String(path ?? '').replace(/\\/g, '/')
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw new Error(`E_PATH: 绝对路径不允许: ${path}`)
  const parts = raw.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new Error(`E_PATH: 非法路径: ${path}`)
  if (parts[0].startsWith('.')) throw new Error(`E_PATH: 隐藏路径不允许: ${path}`)
  return parts.join('/')
}

/** 构建期 manifest 校验：镜像前端 validateManifest 的关键规则（无损拒绝）。 */
function validateSourceManifest(raw, packDir) {
  const errors = []
  if (!raw || typeof raw !== 'object') throw new Error(`E_MANIFEST: ${packDir} manifest 必须是对象`)
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) errors.push(`非法包 id: ${String(raw.id)}`)
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('包名不能为空')
  if (typeof raw.version !== 'string' || !VERSION_RE.test(raw.version)) errors.push(`非法版本: ${String(raw.version)}`)
  if (raw.apiVersion !== PACK_API_VERSION) errors.push(`apiVersion 必须为 ${PACK_API_VERSION}（实际 ${String(raw.apiVersion)}）`)
  if (!Array.isArray(raw.capabilities) || raw.capabilities.length === 0) errors.push('capabilities 必须是非空数组')
  const seenCaps = new Set()
  for (const cap of raw.capabilities ?? []) {
    if (!ALLOWED_CAPABILITIES.includes(cap)) errors.push(`能力不在 allowlist: ${String(cap)}`)
    if (seenCaps.has(cap)) errors.push(`能力重复: ${String(cap)}`)
    seenCaps.add(cap)
  }
  if (!raw.entry || typeof raw.entry !== 'object' || !raw.entry.html) errors.push('缺少 entry.html')
  if (!Array.isArray(raw.assets) || raw.assets.length === 0) errors.push('assets 不能为空')
  const seenPaths = new Set()
  const assetPaths = []
  for (const a of raw.assets ?? []) {
    try {
      const p = safeRelPath(a?.path)
      if (seenPaths.has(p)) errors.push(`资产重复: ${p}`)
      seenPaths.add(p)
      assetPaths.push(p)
      if (!existsSync(join(packDir, p.split('/').join(sep)))) errors.push(`资产文件不存在: ${p}`)
    } catch (e) {
      errors.push((e && e.message) || String(e))
    }
  }
  const entryHtml = raw.entry?.html ? safeRelPath(raw.entry.html) : null
  if (entryHtml && !seenPaths.has(entryHtml)) errors.push(`entry.html 不在 assets 内: ${entryHtml}`)
  if (raw.entry?.sdk) {
    const sdkPath = safeRelPath(raw.entry.sdk)
    if (!seenPaths.has(sdkPath)) errors.push(`entry.sdk 不在 assets 内: ${sdkPath}`)
  }
  if (raw.commands !== undefined) {
    if (!Array.isArray(raw.commands)) errors.push('commands 必须是数组')
    const names = new Set()
    for (const c of raw.commands ?? []) {
      if (!c || typeof c.name !== 'string' || !COMMAND_RE.test(c.name)) errors.push(`非法命令名: ${String(c?.name)}`)
      else if (names.has(c.name)) errors.push(`命令重复: ${c.name}`)
      if (c && typeof c.name === 'string') names.add(c.name)
      if (!c || typeof c.handler !== 'string' || !HANDLER_RE.test(c.handler)) errors.push(`非法 handler: ${String(c?.handler)}`)
    }
  }
  if (errors.length) throw new Error(`E_MANIFEST: ${relative(REPO_ROOT, packDir)} 校验失败:\n  - ${errors.join('\n  - ')}`)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}
function fileSha256(path) {
  return sha256Buf(readFileSync(path))
}
function listFilesRecursive(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/** 进程内签名（canonical 载荷复用 sign_pack.mjs；ed25519）。 */
function signManifest(manifest, privateKey, keyId) {
  const payload = canonicalManifestPayload(manifest)
  const signature = sign(null, payload, privateKey).toString('hex')
  return { alg: 'ed25519', keyId, signature }
}
function verifyManifestSignature(signedManifest, publicKey) {
  const sig = signedManifest?.signature
  if (!sig || sig.alg !== 'ed25519' || !/^[0-9a-f]{128}$/.test(String(sig.signature))) return false
  const payload = canonicalManifestPayload(signedManifest)
  return verify(null, payload, publicKey, Buffer.from(sig.signature, 'hex')) === true
}

function rawPubHex(publicKey) {
  return publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')
}

function isInside(child, parent) {
  const rel = relative(parent, child)
  if (!rel) return true
  // 跨盘符时 node:path.relative 返回绝对路径（不是相对路径）→ 视为不在父目录内
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return false
  return !rel.startsWith('..') && !rel.split(sep).includes('..')
}

/** 解析/生成签名密钥。返回 { privateKey, publicKey, keyPath, keySource, publicKeyHex }。 */
function resolveKey(outDir) {
  const explicit = arg('--key') ?? process.env.KE_PACK_SIGNING_KEY ?? null
  if (explicit) {
    const keyPath = resolve(explicit)
    if (!existsSync(keyPath)) fail(`密钥文件不存在: ${keyPath}`)
    // 仓库内私钥（dist 之外）一律拒绝，避免测试密钥误入仓
    if (isInside(keyPath, REPO_ROOT) && !isInside(keyPath, outDir)) {
      fail(`拒绝使用仓库内私钥（key 必须位于 gitignore 的 dist 或仓库外）: ${relative(REPO_ROOT, keyPath)}`)
    }
    const pem = readFileSync(keyPath)
    const privateKey = createPrivateKey(pem)
    const publicKey = createPublicKey(privateKey)
    if (!SHA256_RE.test(rawPubHex(publicKey))) fail('无法导出合法 ed25519 公钥（hex 64）')
    return { privateKey, publicKey, keyPath, keySource: 'provided', publicKeyHex: rawPubHex(publicKey) }
  }
  const keyPath = join(outDir, '.test-signing-key.pem')
  if (existsSync(keyPath)) {
    const privateKey = createPrivateKey(readFileSync(keyPath))
    const publicKey = createPublicKey(privateKey)
    return { privateKey, publicKey, keyPath, keySource: 'generated-test(reused)', publicKeyHex: rawPubHex(publicKey) }
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
  console.warn(`[build_reference_packs] WARN: 未提供 --key，已生成测试自签密钥（不入仓，仅本地测试）: ${keyPath}`)
  return { privateKey, publicKey, keyPath, keySource: 'generated-test(new)', publicKeyHex: rawPubHex(publicKey) }
}

function buildPack(packDir, outDir, privateKey, publicKey, keyId, checkMode) {
  const manifestPath = join(packDir, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`缺少 manifest.json: ${packDir}`)
  const sourceManifest = readJson(manifestPath)

  // 1) 先同步 vendored 发布 SDK（文件可能尚未落到源目录；随后再做完整 manifest 校验）
  const synced = []
  for (const [assetPath, sourcePath] of Object.entries(VENDOR_SOURCES)) {
    const declared = (sourceManifest.assets ?? []).some((a) => safeRelPath(a.path) === assetPath)
    if (!declared) continue
    if (!existsSync(sourcePath)) throw new Error(`缺少 vendored SDK 源文件: ${sourcePath}（先构建 sdk/dist）`)
    const srcBuf = readFileSync(sourcePath)
    const target = join(packDir, assetPath.split('/').join(sep))
    const srcSha = sha256Buf(srcBuf)
    const prevSha = existsSync(target) ? fileSha256(target) : null
    if (prevSha !== srcSha) {
      if (!checkMode) {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, srcBuf)
      }
      synced.push({ path: assetPath, from: relative(REPO_ROOT, sourcePath), sha256: srcSha, action: prevSha ? 'updated' : 'created' })
    }
    if (checkMode && prevSha !== srcSha) {
      throw new Error(`E_CHECK: vendored SDK 未同步（${assetPath} 需为 ${srcSha}）；重新运行构建并提交`)
    }
  }

  // 1b) 同步完成后再做完整 manifest 校验（文件存在/能力 allowlist/命令名/路径安全）
  validateSourceManifest(sourceManifest, packDir)

  // 2) 资产 sha256/size 计算 + 写回源 manifest（幂等；签名只在 dist）
  const assetsOut = []
  const assetHashesBefore = JSON.stringify((sourceManifest.assets ?? []).map((a) => [a.path, a.sha256, a.size ?? null]))
  for (const asset of sourceManifest.assets) {
    const relPath = safeRelPath(asset.path)
    const full = join(packDir, relPath.split('/').join(sep))
    const buf = readFileSync(full)
    const sha = sha256Buf(buf)
    assetsOut.push({ path: relPath, sha256: sha, size: buf.length })
  }
  const hashesAfter = JSON.stringify(assetsOut.map((a) => [a.path, a.sha256, a.size]))
  const manifestNeedsUpdate = assetHashesBefore !== hashesAfter
  if (manifestNeedsUpdate && checkMode) {
    throw new Error(`E_CHECK: ${relative(REPO_ROOT, manifestPath)} 的 assets sha256/size 过期，需重新构建并提交`)
  }
  const updatedManifest = { ...sourceManifest, assets: assetsOut }
  if (manifestNeedsUpdate && !checkMode) writeJson(manifestPath, updatedManifest)

  // 3) dist 暂存（只含 manifest + 声明资产；README 等开发文档不随包分发）
  const packOutDir = join(outDir, sourceManifest.id)
  if (!checkMode) {
    rmSync(packOutDir, { recursive: true, force: true })
    mkdirSync(packOutDir, { recursive: true })
    for (const asset of assetsOut) {
      const relPath = asset.path.split('/').join(sep)
      const dst = join(packOutDir, relPath)
      mkdirSync(dirname(dst), { recursive: true })
      cpSync(join(packDir, relPath), dst)
    }
  }

  // 4) 签名 + 验签（canonical 载荷与宿主 Rust/TS 逐字节一致；签名不写回源 manifest）
  const signedManifest = { ...updatedManifest, signature: signManifest(updatedManifest, privateKey, keyId) }
  if (!verifyManifestSignature(signedManifest, publicKey)) {
    throw new Error(`E_SIGNATURE: ${sourceManifest.id} 签名自验签失败`)
  }
  if (!checkMode) writeJson(join(packOutDir, 'manifest.json'), signedManifest)

  return {
    id: sourceManifest.id,
    name: sourceManifest.name,
    version: sourceManifest.version,
    apiVersion: sourceManifest.apiVersion,
    capabilities: sourceManifest.capabilities,
    commands: sourceManifest.commands ?? [],
    entry: sourceManifest.entry,
    assets: assetsOut,
    sourceDir: relative(REPO_ROOT, packDir),
    distDir: relative(REPO_ROOT, packOutDir),
    manifestUpdated: manifestNeedsUpdate,
    syncedAssets: synced,
    signature: { alg: signedManifest.signature.alg, keyId: signedManifest.signature.keyId, signature: signedManifest.signature.signature },
    manifestFileSha256: checkMode ? null : fileSha256(join(packOutDir, 'manifest.json')),
  }
}

/** 生成 zip（根 = manifest.json + 资产；使用系统 tar 的 zip 能力不保证 → 用 node 自实现 store/deflate）。 */
function writeZip(zipPath, rootDir, files) {
  const chunks = []
  const central = []
  let offset = 0
  for (const rel of files) {
    const nameBuf = Buffer.from(rel.replace(/\\/g, '/'), 'utf8')
    const data = readFileSync(join(rootDir, rel.split('/').join(sep)))
    const compressed = deflateRawSync(data, { level: 9 })
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 name flag
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0, 12) // date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBuf, compressed)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(compressed.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, nameBuf]))
    offset += local.length + nameBuf.length + compressed.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  mkdirSync(dirname(zipPath), { recursive: true })
  writeFileSync(zipPath, Buffer.concat([...chunks, centralBuf, end]))
  return { path: zipPath, sha256: fileSha256(zipPath), size: statSync(zipPath).size }
}


let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function main() {
  const packsDir = resolve(arg('--packs', DEFAULT_PACKS_DIR))
  const outDir = resolve(arg('--out', DEFAULT_OUT_DIR))
  const jsonOut = arg('--json-out')
  const keyId = arg('--keyid', 'k1')
  const checkMode = has('--check')
  const generatedAt = new Date().toISOString()

  if (!existsSync(join(packsDir, 'pack-a', 'manifest.json'))) {
    console.error(`[build_reference_packs] 未找到 pack-a（--packs 指向: ${packsDir}）`)
    process.exit(2)
  }
  if (!existsSync(SDK_DIST)) {
    console.error(`[build_reference_packs] 缺少发布 SDK 产物: ${SDK_DIST}（先运行 node docs/ui-workshop/sdk/build.mjs）`)
    process.exit(2)
  }
  const sdkSha = fileSha256(SDK_DIST)

  const key = resolveKey(outDir)
  const packs = []
  for (const dirName of readdirSync(packsDir).sort()) {
    const packDir = join(packsDir, dirName)
    if (!existsSync(join(packDir, 'manifest.json'))) continue
    if (dirName === 'dist' || dirName.startsWith('.')) continue
    try {
      packs.push(buildPack(packDir, outDir, key.privateKey, key.publicKey, keyId, checkMode))
    } catch (e) {
      fail(`构建 ${dirName} 失败: ${(e && e.message) || e}`)
    }
  }
  if (packs.length < 2) fail(`期望至少 pack-a/pack-b 两个包，实际构建 ${packs.length} 个`)

  const summary = {
    generatedAt,
    mode: checkMode ? 'check' : 'build',
    via: 'docs/ui-workshop/tools/build_reference_packs.mjs',
    repoRoot: REPO_ROOT,
    packsDir: relative(REPO_ROOT, packsDir),
    outDir: relative(REPO_ROOT, outDir),
    sdk: { path: relative(REPO_ROOT, SDK_DIST), sha256: sdkSha },
    signing: {
      alg: 'ed25519',
      keyId,
      publicKeyHex: key.publicKeyHex,
      keySource: key.keySource,
      keyPath: key.keyPath,
      keyInRepo: isInside(resolve(key.keyPath), REPO_ROOT),
      keyInGitignoredDist: isInside(resolve(key.keyPath), outDir),
      note: '测试自签密钥；不入仓（dist/ 已 gitignore）；宿主通过 KE_WORKSHOP_PUBKEYS 注入公钥',
    },
    canonicalPayloadSource: 'docs/ui-workshop/tools/sign_pack.mjs#canonicalManifestPayload（与 Rust/TS 逐字节一致）',
    packs,
    // zip 在 dist 根：<id>-<version>.zip
    zips: [],
  }

  if (!checkMode) {
    for (const pack of packs) {
      const packOutDir = join(outDir, pack.id)
      const files = listFilesRecursive(packOutDir)
        .map((f) => relative(packOutDir, f))
        .sort()
      const zip = writeZip(join(outDir, `${pack.id}-${pack.version}.zip`), packOutDir, files)
      summary.zips.push({ packId: pack.id, ...zip, path: relative(REPO_ROOT, zip.path), files })
    }
    summary.distBuildInfo = relative(REPO_ROOT, join(outDir, 'build-info.json'))
    writeJson(join(outDir, 'build-info.json'), summary)
  }

  if (jsonOut) writeJson(resolve(jsonOut), summary)
  console.log(JSON.stringify(summary, null, 2))
  const updated = packs.filter((p) => p.manifestUpdated)
  const syncedCount = packs.reduce((n, p) => n + p.syncedAssets.length, 0)
  console.error(
    `[build_reference_packs] ${checkMode ? 'CHECK' : 'BUILD'} OK: ${packs.length} packs · ` +
      `manifest 更新 ${updated.length} · vendored SDK 同步 ${syncedCount} · ` +
      `签名 ed25519 keyId=${keyId} pub=${key.publicKeyHex.slice(0, 16)}…（${key.keySource}）`,
  )
  return 0
}

try {
  process.exit(main())
} catch (e) {
  console.error(`[build_reference_packs] FATAL: ${(e && e.stack) || e}`)
  process.exit(1)
}
