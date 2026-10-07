#!/usr/bin/env node
/**
 * 开发构建版本号（发版策略见 docs/release-policy.md）
 *
 * 用法：
 *   node scripts/dev-version.mjs            → 在当前 patch 上生成/递增 dev 号，如 1.2.9-dev.1
 *   node scripts/dev-version.mjs 1.3.0      → 指定基线，生成 1.3.0-dev.1
 *
 * 规则：内部验证构建**只本地使用**（不打 tag、不发 Release），版本串含 `-dev.N`；
 * 正式发布仍走 `node scripts/bump-version.mjs x.y.z`（纯三段式）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const versionTs = readFileSync(new URL('../frontend/src/version.ts', import.meta.url), 'utf8')
const cur = versionTs.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1]
if (!cur) throw new Error('读不到 frontend/src/version.ts 的 APP_VERSION')

const baseArg = process.argv[2]
let base
if (baseArg) base = baseArg
else {
  const m = cur.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) throw new Error(`当前版本 ${cur} 不是 x.y.z 形式，请显式传入基线`)
  // 已在 dev 号上：沿用同一基线继续 +1
  base = cur.includes('-dev.') ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}
const n = cur.includes('-dev.') && cur.startsWith(base + '-dev.') ? Number(cur.split('-dev.')[1]) + 1 : 1
const next = `${base}-dev.${n}`
execFileSync(process.execPath, [fileURLToPath(new URL('./bump-version.mjs', import.meta.url)), next], { stdio: 'inherit' })
console.log(`\n[dev] 已置为 ${next}（内部验证构建：不打 tag、不发 Release）`)
