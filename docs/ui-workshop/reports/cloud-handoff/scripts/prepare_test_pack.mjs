#!/usr/bin/env node
// Creates an isolated test-only signed reference guest; never exports its private key.
import { createHash, generateKeyPairSync, createPublicKey, verify } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? fallback : process.argv[i + 1]
}
if (process.argv.includes('--help')) {
  console.log('node prepare_test_pack.mjs --repo <candidate repo> [--out <new output directory>]')
  process.exit(0)
}
const repo = resolve(arg('--repo', join(here, '..', 'repo')))
const out = resolve(arg('--out', join(here, '..', 'test-pack')))
const pack = join(out, 'pack')
if (existsSync(pack) || existsSync(join(out, 'pubkeys.json'))) throw new Error('Refusing to overwrite an existing test pack; use a fresh --out directory')
const tools = join(repo, 'docs', 'ui-workshop', 'tools')
const source = join(repo, 'docs', 'ui-workshop', 'packs', 'pack-a')
const temp = mkdtempSync(join(tmpdir(), 'ke-cloud-sign-'))
const log = []
try {
  mkdirSync(out, { recursive: true })
  // Start with the package scaffold specified by TASKS, then use the candidate's
  // reference guest implementation for the real protocol/heartbeat handshake.
  log.push(execFileSync(process.execPath, [join(tools, 'create_pack.mjs'), '--dir', pack,
    '--id', 'com.astranota.cloud.smoke', '--name', 'Cloud VM Smoke', '--version', '1.0.0', '--capability', 'ui.shell'], { encoding: 'utf8' }))
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
  manifest.id = 'com.astranota.cloud.smoke'
  manifest.name = 'Cloud VM Smoke (test only)'
  delete manifest.signature
  for (const asset of manifest.assets) {
    const dst = join(pack, asset.path)
    mkdirSync(dirname(dst), { recursive: true })
    cpSync(join(source, asset.path), dst)
    if (asset.path === 'pack.js') {
      const js = readFileSync(dst, 'utf8')
      if (!js.includes('com.astranota.examples.pack-a')) throw new Error('Reference guest identity changed; inspect before regenerating')
      writeFileSync(dst, js.replaceAll('com.astranota.examples.pack-a', manifest.id))
    }
    const bytes = readFileSync(dst)
    asset.sha256 = createHash('sha256').update(bytes).digest('hex')
    asset.size = bytes.length
  }
  writeFileSync(join(pack, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const keyPath = join(temp, 'test-only.pem')
  writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
  const keyId = 'cloud-vm-test-only'
  log.push(execFileSync(process.execPath, [join(tools, 'sign_pack.mjs'), '--dir', pack, '--key', keyPath, '--keyid', keyId, '--write'], { encoding: 'utf8' }))
  const { canonicalManifestPayload } = await import(pathToFileURL(join(tools, 'sign_pack.mjs')).href)
  const signed = JSON.parse(readFileSync(join(pack, 'manifest.json'), 'utf8'))
  const payload = canonicalManifestPayload(signed)
  const sig = Buffer.from(signed.signature.signature, 'hex')
  if (!verify(null, payload, publicKey, sig)) throw new Error('Generated signature verification failed')
  if (verify(null, Buffer.concat([payload, Buffer.from('tamper')]), publicKey, sig)) throw new Error('Tampered signature unexpectedly verified')
  const hex = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')
  writeFileSync(join(out, 'pubkeys.json'), JSON.stringify({ [keyId]: { key: hex } }, null, 2) + '\n')
  writeFileSync(join(out, 'verification.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), packId: signed.id, keyId, testOnly: true,
    assetHashesMatch: signed.assets.every(a => createHash('sha256').update(readFileSync(join(pack, a.path))).digest('hex') === a.sha256),
    signatureValid: true, tamperRejected: true, privateKeyIncluded: false,
    installedWindowsSmoke: 'NOT_RUN',
  }, null, 2) + '\n')
  writeFileSync(join(out, 'prepare.log'), log.join('\n'))
  console.log(JSON.stringify({ pack, pubkeys: join(out, 'pubkeys.json'), verified: true }))
} finally {
  rmSync(temp, { recursive: true, force: true })
}
