#!/usr/bin/env node
/**
 * W04：外部开发者脚手架 —— 不修改宿主源码，从干净目录生成一个可安装的 UI 包。
 *
 * 用法：
 *   node docs/ui-workshop/tools/create_pack.mjs --dir <out> --id com.demo.hello --name "Hello" \
 *        --version 1.0.0 [--capability ui.shell]... [--with-css]
 *   node docs/ui-workshop/tools/create_pack.mjs --self-test
 *
 * 产物：manifest.json + index.html(+style.css) + README.md（含签名/安装/启用步骤提示）。
 * 注意：manifest 命令名必须符合 `^[a-z][a-z0-9.-]{1,80}$`（小写，例如 article.set-title）。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ALLOWED_CAPS = ['ui.shell', 'panel.sidebar', 'panel.dock', 'editor.commands.readonly', 'context.read', 'print.request']

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback
}
function has(name) {
  return process.argv.includes(name)
}

export function buildManifest({ id, name, version, capabilities, withCss }) {
  if (!/^[a-z][a-z0-9.-]{1,80}$/.test(id)) throw new Error('E_ID: 包 id 需匹配 ^[a-z][a-z0-9.-]{1,80}$')
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('E_VERSION: 版本需 semver，如 1.0.0')
  for (const cap of capabilities) {
    if (!ALLOWED_CAPS.includes(cap)) throw new Error(`E_CAPABILITY: 不支持的能力 ${cap}`)
  }
  const assets = [{ path: 'index.html', sha256: createHash('sha256').update(readEntry(withCss)).digest('hex') }]
  if (withCss) assets.push({ path: 'style.css', sha256: createHash('sha256').update(readCss()).digest('hex') })
  return {
    id,
    name,
    version,
    apiVersion: 1,
    capabilities,
    entry: { html: 'index.html' },
    commands: [],
    assets,
  }
}

function readEntry(withCss) {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    (withCss ? '<link rel="stylesheet" href="style.css">' : '') +
    '</head><body><div id="app">Hello from UI pack</div><script>' +
    "window.parent.postMessage({type:'guest-heartbeat'},'*');" +
    "setInterval(()=>window.parent.postMessage({type:'guest-heartbeat'},'*'),200);" +
    '</script></body></html>'
  )
}
function readCss() {
  return '#app{font:14px system-ui;padding:8px}'
}

function scaffold({ dir, id, name, version, capabilities, withCss }) {
  mkdirSync(dir, { recursive: true })
  const entry = readEntry(withCss)
  writeFileSync(join(dir, 'index.html'), entry)
  if (withCss) writeFileSync(join(dir, 'style.css'), readCss())
  const manifest = buildManifest({ id, name, version, capabilities, withCss })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(
    join(dir, 'README.md'),
    `# ${name} (UI 工坊包)\n\n- id: \`${id}\`\n- version: \`${version}\`\n- capabilities: ${capabilities.join(', ') || '(none)'}\n\n## 流程（无需修改宿主源码）\n\n1. 生成签名密钥：\`node docs/ui-workshop/tools/sign_pack.mjs --generate-key release.pem\`\n2. 签名：\`node docs/ui-workshop/tools/sign_pack.mjs --dir . --key release.pem --keyid k1 --write\`\n3. 打 zip（可选）：\`zip -r ../${id}-${version}.zip .\`\n4. 在工坊 UI「选择包并预览 / 选择 ZIP 离线包」安装；授予 trusted 后启用 guest。\n5. 宿主公钥配置：环境变量 \`KE_WORKSHOP_PUBKEYS\`（生产由构建配置提供）。\n\n> 命令名（manifest.commands）必须为小写：例如 \`article.set-title\`。\n`,
  )
  return manifest
}

export function selfTest() {
  const checks = []
  const check = (name, ok, detail = '') => {
    checks.push({ name, pass: !!ok, detail })
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''))
  }
  const dir = mkdtempSync(join(tmpdir(), 'ke-pack-scaffold-'))
  try {
    const manifest = scaffold({ dir, id: 'com.demo.scaffold', name: 'Scaffold', version: '1.0.0', capabilities: ['ui.shell'], withCss: true })
    check('生成 manifest/index/style/README', ['manifest.json', 'index.html', 'style.css', 'README.md'].every((f) => {
      try { readFileSync(join(dir, f)); return true } catch { return false }
    }))
    const entryHash = createHash('sha256').update(readFileSync(join(dir, 'index.html'))).digest('hex')
    check('manifest 资产 hash 与文件一致', manifest.assets[0].sha256 === entryHash)
    check('manifest schema（id/version/entry/capabilities）', manifest.apiVersion === 1 && manifest.id === 'com.demo.scaffold' && manifest.entry.html === 'index.html')
    let rejected = false
    try { buildManifest({ id: 'Bad ID', name: 'x', version: '1.0.0', capabilities: [], withCss: false }) } catch { rejected = true }
    check('非法 id 被拒绝', rejected)
    let capRejected = false
    try { buildManifest({ id: 'com.demo.a', name: 'x', version: '1.0.0', capabilities: ['bad.cap'], withCss: false }) } catch { capRejected = true }
    check('非法能力被拒绝', capRejected)
    const passed = checks.filter((c) => c.pass).length
    console.log(`\nSUMMARY ${passed}/${checks.length} PASS`)
    return { checks, passed, total: checks.length }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (has('--self-test')) {
  const result = selfTest()
  writeFileSync(
    'docs/ui-workshop/evidence/W04-scaffold-selftest.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), via: 'create_pack.mjs --self-test', ...result }, null, 2),
  )
  process.exit(result.passed === result.total ? 0 : 1)
} else {
  const dir = arg('--dir')
  const id = arg('--id')
  const name = arg('--name', 'Demo Pack')
  const version = arg('--version', '1.0.0')
  const capabilities = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--capability') capabilities.push(process.argv[i + 1])
  }
  if (!dir || !id) {
    console.error('用法：--dir <out> --id <pack.id> [--name ...] [--version ...] [--capability ...] [--with-css]（或 --self-test）')
    process.exit(2)
  }
  const manifest = scaffold({ dir, id, name, version, capabilities, withCss: has('--with-css') })
  console.log(JSON.stringify({ dir, manifest }, null, 2))
}
