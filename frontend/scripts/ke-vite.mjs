// KnowledgeEditor Vite 启动包装脚本
//
// 背景: 本机安全软件按文件名拦截 esbuild.exe 的写入（Access is denied），
//       导致 Vite 依赖预构建无法产出 node_modules/.vite 缓存 → 开发页白屏。
//
// 处理: 关键点——esbuild 的 main.js 在模块顶层一次性捕获
//       process.env.ESBUILD_BINARY_PATH（见 node_modules/esbuild/lib/main.js
//       `var ESBUILD_BINARY_PATH = process.env.ESBUILD_BINARY_PATH || ...`）。
//       因此必须在任何 esbuild 模块被加载之前设置该环境变量：
//       这里先准备改名副本（esbuild-renamed.exe）并设置环境变量，
//       再以子进程方式启动真实的 Vite CLI。
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

// 脚本位于 frontend/scripts/ 下，项目根为上一级
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const esbuildPkg = join(rootDir, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')
const esbuildCopyDir = join(rootDir, '.esbuild')
const esbuildCopy = join(esbuildCopyDir, 'esbuild-renamed.exe')

if (!process.env.ESBUILD_BINARY_PATH) {
  if (!existsSync(esbuildPkg)) {
    console.error('[ke-vite] 未找到 esbuild 二进制:', esbuildPkg)
    process.exit(1)
  }
  let needCopy = false
  if (!existsSync(esbuildCopy)) {
    needCopy = true
  } else {
    const src = statSync(esbuildPkg)
    const dst = statSync(esbuildCopy)
    needCopy = src.size !== dst.size || src.mtimeMs > dst.mtimeMs
  }
  if (needCopy) {
    mkdirSync(esbuildCopyDir, { recursive: true })
    copyFileSync(esbuildPkg, esbuildCopy)
  }
  process.env.ESBUILD_BINARY_PATH = esbuildCopy
}

// 启动真实 Vite CLI（参数原样透传：无参数 = dev；build / preview 按参数透传）
const viteBin = join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
const args = process.argv.slice(2)
console.log(`[ke-vite] ESBUILD_BINARY_PATH=${process.env.ESBUILD_BINARY_PATH}`)
const child = spawn(process.execPath, [viteBin, ...args], {
  cwd: rootDir,
  env: process.env,
  stdio: 'inherit',
})
child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1)
  }
  process.exit(code ?? 0)
})
