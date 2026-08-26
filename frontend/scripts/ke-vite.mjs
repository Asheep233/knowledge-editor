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
//
// P1-16/F): 原实现硬编码 win32-x64 的 esbuild.exe，导致 Linux/macOS CI 上构建必失败。
//           现按 process.platform + process.arch + endianness 动态选择对应平台二进制包：
//           仅 Windows 用 esbuild.exe，Unix 系列用 bin/esbuild。副本名按平台带/不带后缀。
//           该脚本仍走「改名副本 + ESBUILD_BINARY_PATH」机制（保留安全软件绕过），
//           Vite 内部仍使用 esbuild 的 JS API，因此跨平台。
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { platform, arch, endianness } from 'node:os'

// 脚本位于 frontend/scripts/ 下，项目根为上一级
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 平台二进制映射（与 esbuild 内部 known*Packages 一致）
const platformKey = `${platform()} ${arch()} ${endianness()}`
const WINDOWS_BINARIES = {
  'win32 arm64 LE': ['@esbuild/win32-arm64', 'esbuild.exe'],
  'win32 ia32 LE': ['@esbuild/win32-ia32', 'esbuild.exe'],
  'win32 x64 LE': ['@esbuild/win32-x64', 'esbuild.exe'],
}
const UNIX_BINARIES = {
  'darwin arm64 LE': ['@esbuild/darwin-arm64', 'bin/esbuild'],
  'darwin x64 LE': ['@esbuild/darwin-x64', 'bin/esbuild'],
  'freebsd arm64 LE': ['@esbuild/freebsd-arm64', 'bin/esbuild'],
  'freebsd x64 LE': ['@esbuild/freebsd-x64', 'bin/esbuild'],
  'linux arm64 LE': ['@esbuild/linux-arm64', 'bin/esbuild'],
  'linux arm LE': ['@esbuild/linux-arm', 'bin/esbuild'],
  'linux ia32 LE': ['@esbuild/linux-ia32', 'bin/esbuild'],
  'linux ppc64 LE': ['@esbuild/linux-ppc64', 'bin/esbuild'],
  'linux riscv64 LE': ['@esbuild/linux-riscv64', 'bin/esbuild'],
  'linux x64 LE': ['@esbuild/linux-x64', 'bin/esbuild'],
  'netbsd arm64 LE': ['@esbuild/netbsd-arm64', 'bin/esbuild'],
  'netbsd x64 LE': ['@esbuild/netbsd-x64', 'bin/esbuild'],
  'openbsd arm64 LE': ['@esbuild/openbsd-arm64', 'bin/esbuild'],
  'openbsd x64 LE': ['@esbuild/openbsd-x64', 'bin/esbuild'],
  'sunos x64 LE': ['@esbuild/sunos-x64', 'bin/esbuild'],
}
const BINARIES = { ...WINDOWS_BINARIES, ...UNIX_BINARIES }

const selected = BINARIES[platformKey]
if (!selected) {
  console.error(`[ke-vite] 不支持的平台组合: ${platformKey}`)
  process.exit(1)
}
const [esbuildPkgName, esbuildSubpath] = selected
const isWindows = platform() === 'win32'
const esbuildPkg = join(rootDir, 'node_modules', esbuildPkgName, esbuildSubpath)
const esbuildCopyDir = join(rootDir, '.esbuild')
// 副本基名沿用原名（Windows 需保留 .exe 后缀以便被作为可执行文件执行）
const esbuildCopy = join(esbuildCopyDir, `esbuild-renamed${isWindows ? '.exe' : ''}`)

if (!process.env.ESBUILD_BINARY_PATH) {
  if (!existsSync(esbuildPkg)) {
    console.error('[ke-vite] 未找到 esbuild 二进制:', esbuildPkg, `(平台 ${platformKey})`)
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
console.log(`[ke-vite] platform=${platformKey} ESBUILD_BINARY_PATH=${process.env.ESBUILD_BINARY_PATH}`)
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
