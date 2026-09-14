#!/usr/bin/env node
/**
 * 版本 bump（v1.1.8 起统一入口）——只改「项目自身」的版本字段，绝不触碰第三方包。
 *
 * 背景（事故）：早期手工用正则 `"version": "1\.1\.\d[^"]*"` 全局替换 lock 文件，
 * 把版本号为 1.1.x 的第三方包（picocolors 1.1.1/1.1.2、@standard-schema/spec 1.1.0…）
 * 一并改写成了应用版本，导致 `npm ci` 永久失败（上游无该版本）。
 *
 * 正确做法：JSON 解析后**只写**以下位置：
 *   frontend/package.json            → version
 *   frontend/package-lock.json       → version（顶层）+ packages[""].version
 *   desktop/package.json             → version
 *   desktop/package-lock.json        → version（顶层）+ packages[""].version
 *   frontend/src/version.ts          → APP_VERSION
 *   backend/app/__init__.py          → __version__
 *   desktop/src-tauri/Cargo.toml     → 第一个 version = "..."（package 段）
 *   desktop/src-tauri/Cargo.lock     → name = "knowledgeeditor" 紧随的 version
 *   desktop/src-tauri/tauri.conf.json→ version
 *
 * 用法： node scripts/bump-version.mjs 1.1.8-pre.2
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const next = process.argv[2]
if (!next || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) {
  console.error('用法: node scripts/bump-version.mjs <版本>（如 1.1.8-pre.2 / 1.1.8）')
  process.exit(1)
}

const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))
const writeJson = (p, v) => writeFileSync(join(root, p), JSON.stringify(v, null, 2) + '\n', 'utf8')

/** 只改根版本（顶层 + packages[""]），第三方条目一字不动 */
function bumpLock(rel) {
  const d = readJson(rel)
  const before = d.version
  d.version = next
  if (d.packages && d.packages['']) d.packages[''].version = next
  writeJson(rel, d)
  return `${rel}: ${before} → ${next}`
}

const results = []

for (const p of ['frontend/package.json', 'desktop/package.json', 'desktop/src-tauri/tauri.conf.json']) {
  const d = readJson(p)
  const before = d.version
  d.version = next
  writeJson(p, d)
  results.push(`${p}: ${before} → ${next}`)
}
for (const p of ['frontend/package-lock.json', 'desktop/package-lock.json']) {
  results.push(bumpLock(p))
}

// version.ts
{
  const p = 'frontend/src/version.ts'
  const s = readFileSync(join(root, p), 'utf8')
  if (!/APP_VERSION\s*=\s*'[^']*'/.test(s)) throw new Error(`${p}: 未找到 APP_VERSION`)
  writeFileSync(join(root, p), s.replace(/APP_VERSION\s*=\s*'[^']*'/, `APP_VERSION = '${next}'`), 'utf8')
  results.push(`${p}: APP_VERSION → ${next}`)
}

// backend __version__
{
  const p = 'backend/app/__init__.py'
  const s = readFileSync(join(root, p), 'utf8')
  if (!/__version__\s*=\s*['"][^'"]*['"]/.test(s)) throw new Error(`${p}: 未找到 __version__`)
  writeFileSync(join(root, p), s.replace(/__version__\s*=\s*['"][^'"]*['"]/, `__version__ = '${next}'`), 'utf8')
  results.push(`${p}: __version__ → ${next}`)
}

// Cargo.toml（仅第一个 version = 行 = [package] 段）
{
  const p = 'desktop/src-tauri/Cargo.toml'
  const s = readFileSync(join(root, p), 'utf8')
  let done = false
  const out = s.replace(/^version\s*=\s*"[^"]*"/m, (m) => {
    done = true
    return `version = "${next}"`
  })
  if (!done) throw new Error(`${p}: 未找到 version 行`)
  writeFileSync(join(root, p), out, 'utf8')
  results.push(`${p}: version → ${next}`)
}

// Cargo.lock（仅 knowledgeeditor 块）
{
  const p = 'desktop/src-tauri/Cargo.lock'
  const lines = readFileSync(join(root, p), 'utf8').split('\n')
  let hit = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'name = "knowledgeeditor"') {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j].startsWith('version = ')) {
          lines[j] = `version = "${next}"`
          hit = true
          break
        }
      }
      break
    }
  }
  if (!hit) throw new Error(`${p}: 未找到 knowledgeeditor 包块`)
  writeFileSync(join(root, p), lines.join('\n'), 'utf8')
  results.push(`${p}: knowledgeeditor → ${next}`)
}

console.log(`版本已更新为 ${next}：`)
for (const r of results) console.log('  •', r)
console.log('\n下一步：cd frontend && npm run build（必须在 bump 之后）→ 核对 dist-build 内版本号')
