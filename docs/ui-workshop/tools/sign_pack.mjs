#!/usr/bin/env node
/**
 * UI 工坊 P4-T24 打包器签名工具（ed25519）。
 *
 * 用法：
 *   node docs/ui-workshop/tools/sign_pack.mjs --self-test
 *   node docs/ui-workshop/tools/sign_pack.mjs --generate-key <out.pem>
 *   node docs/ui-workshop/tools/sign_pack.mjs --dir <packdir> --key <private.pem> --keyid <id> [--write]
 *
 * canonical 载荷必须与 `frontend/src/core/packs/signature.ts` 的 canonicalManifestPayload 以及
 * 产品 Rust `pack_store::canonical_manifest_payload` **逐字节一致**（本工具 --self-test 用同一字面量校验）。
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function canonicalManifestPayload(manifest) {
  const canonical = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    capabilities: [...(manifest.capabilities ?? [])],
    entry: { html: manifest.entry?.html ?? '', sdk: manifest.entry?.sdk ?? null },
    commands: (manifest.commands ?? []).map((c) => ({ name: c.name, handler: c.handler })),
    assets: (manifest.assets ?? []).map((a) => ({ path: a.path, sha256: a.sha256, size: a.size ?? null })),
  }
  return Buffer.from(JSON.stringify(canonical), 'utf8')
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback
}

function has(name) {
  return process.argv.includes(name)
}

const FIXTURE_MANIFEST = {
  id: 'com.demo.signed',
  name: 'Signed Pack',
  version: '1.0.0',
  apiVersion: 1,
  capabilities: ['ui.shell'],
  entry: { html: 'index.html' },
  commands: [{ name: 'demo.hello', handler: 'hello' }],
  assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
}

const FIXTURE_LITERAL =
  '{"id":"com.demo.signed","name":"Signed Pack","version":"1.0.0","apiVersion":1,' +
  '"capabilities":["ui.shell"],"entry":{"html":"index.html","sdk":null},' +
  '"commands":[{"name":"demo.hello","handler":"hello"}],' +
  '"assets":[{"path":"index.html","sha256":"' + 'a'.repeat(64) + '","size":null}]}'

function selfTest() {
  const checks = []
  const check = (name, ok, detail = '') => {
    checks.push({ name, pass: !!ok, detail })
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''))
  }
  // 1) canonical 载荷与 TS/Rust 字面量一致（三语言 parity）
  const payload = canonicalManifestPayload(FIXTURE_MANIFEST)
  check('canonical payload 与 TS/Rust 字面量逐字节一致', payload.toString('utf8') === FIXTURE_LITERAL)

  // 2) 生成密钥 → 签名 → 验签
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const sig = sign(null, payload, privateKey)
  check('ed25519 签名可被标准实现验证', verify(null, payload, publicKey, sig) === true)

  // 3) 篡改载荷后验签失败
  const tampered = Buffer.from(payload.toString('utf8').replace('"version":"1.0.0"', '"version":"9.9.9"'))
  check('篡改清单后验签失败', verify(null, tampered, publicKey, sig) === false)

  // 4) 私钥 PEM 可复用于签名（工具链跨进程）
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' })
  const reloaded = createPrivateKey(pem)
  const sig2 = sign(null, payload, reloaded)
  check('私钥 PEM 重新导入后签名一致（确定性签名）', Buffer.compare(sig, sig2) === 0)

  // 5) 公钥 hex（raw 32B）可导出（与 Rust/TS 配置一致）
  const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')
  check('公钥 raw hex 为 64 hex chars', /^[0-9a-f]{64}$/.test(rawPub), rawPub)

  const passed = checks.filter((c) => c.pass).length
  console.log(`\nSUMMARY ${passed}/${checks.length} PASS`)
  return { checks, passed, total: checks.length, payload: payload.toString('utf8') }
}

function main() {
  if (has('--self-test')) {
    const result = selfTest()
    writeFileSync(
      'docs/ui-workshop/evidence/T24-sign-tool-selftest.json',
      JSON.stringify({ generatedAt: new Date().toISOString(), via: 'docs/ui-workshop/tools/sign_pack.mjs --self-test', ...result }, null, 2),
    )
    process.exit(result.passed === result.total ? 0 : 1)
  }
  if (has('--generate-key')) {
    const out = arg('--generate-key')
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    writeFileSync(out, privateKey.export({ format: 'pem', type: 'pkcs8' }))
    const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')
    console.log(JSON.stringify({ privateKeyPath: out, publicKeyHex: rawPub }, null, 2))
    return
  }
  const dir = arg('--dir')
  const keyPath = arg('--key')
  const keyId = arg('--keyid')
  if (!dir || !keyPath || !keyId) {
    console.error('用法：--dir <packdir> --key <private.pem> --keyid <id> [--write]（或 --self-test / --generate-key <pem>）')
    process.exit(2)
  }
  const manifestPath = join(dir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const payload = canonicalManifestPayload(manifest)
  const privateKey = createPrivateKey(readFileSync(keyPath))
  const signature = sign(null, payload, privateKey).toString('hex')
  manifest.signature = { alg: 'ed25519', keyId, signature }
  if (has('--write')) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    console.log(`signed: ${manifestPath} (keyId=${keyId})`)
  } else {
    console.log(JSON.stringify(manifest.signature, null, 2))
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('sign_pack.mjs')) {
  main()
}
