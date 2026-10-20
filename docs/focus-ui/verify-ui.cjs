#!/usr/bin/env node
/**
 * AstraNota Focus · 视觉验收截图流水线（task-4 交付 · QA 只读工具）
 * ==========================================================================
 * 一键复跑（从仓库根）：
 *
 *     node docs/focus-ui/verify-ui.cjs
 *
 * 产物：
 *   /tmp/focus-shots/01-editor-light-1440x900.png
 *   /tmp/focus-shots/02-editor-collapsed-sidebar-1440x900.png
 *   /tmp/focus-shots/03-editor-inspector-sheet-1440x900.png
 *   /tmp/focus-shots/04-editor-dark-1440x900.png
 *   /tmp/focus-shots/05-launcher-1440x900.png
 *   /tmp/focus-shots/06-settings-1440x900.png
 *   /tmp/focus-shots/07-editor-drawer-1024x800.png
 *   /tmp/focus-shots/08-editor-narrow-800x900.png
 *   /tmp/focus-shots/metrics.json      ← 布局/令牌实测值 + 断言结果（机器可读证据）
 *   /tmp/focus-shots/summary.md        ← 本次运行的 PASS/DIFF 摘要（人可读证据）
 *   /tmp/focus-shots/run-meta.json     ← 运行环境（URL/端口/git/控制台错误/请求失败）
 *
 * 设计约束（遵守 task-4 红线）：
 *   - 只读产品代码（不写 frontend/src），只写 docs/focus-ui/ 与 /tmp/focus-shots/。
 *   - 失败要"清晰"：前置服务起不来 / 浏览器起不来 / 页面打不开 → 打印可照做的命令与日志路径。
 *
 * 环境变量（都可选）：
 *   KE_SHOTS_DIR        截图输出目录（默认 /tmp/focus-shots）
 *   KE_BASE_URL         直接指定前端 URL（跳过 vite 自动管理；完全信任该实例内容）
 *   KE_REUSE_VITE=1     复用已在跑的 5273 实例（默认不复用：WSL drvfs 下它可能服务陈旧模块）
 *   KE_VITE_PORT        首选 vite 端口（默认 5273）
 *   KE_BACKEND_URL      后端 URL（默认 http://127.0.0.1:8000）
 *   KE_WORKSPACE        后端工作区目录（默认 /tmp/focus-ws，仅自动拉起后端时使用）
 *   KE_APP_CONFIG       后端配置文件（默认 /tmp/focus-test/app_config.json，仅自动拉起时使用）
 *   KE_PLAYWRIGHT_CORE  playwright-core 包目录（默认本机 npx 缓存路径）
 *   KE_CHROME_PATH      Chromium 可执行文件（默认扫 ~/.cache/ms-playwright 下的 chromium-* 目录）
 *   KE_KEEP_VITE=1      脚本自己拉起的 vite 实例保留（默认跑完关闭）
 *   KE_STRICT=1         布局断言有 FAIL 时退出码 1（默认只报告不判死；用于最终验收）
 *
 * 实现备注（为什么默认自己起 vite，而不复用已跑的 5273）：
 *   本机仓库位于 WSL 的 /mnt/f（drvfs）。实测 vite dev server 的 watcher 会漏事件：
 *   `frontend/src` 改了之后，5273 端口仍在服务**旧模块**（curl /src/App.tsx 缺新标识符；
 *   带 ?t=<ts> 的请求才会重新 transform）。复用它会得到"与磁盘代码不一致"的假证据。
 *   因此脚本默认另起一个**全新进程**的 vite（新进程按请求时磁盘内容 transform），
 *   跑完自动关闭；需要快速复用可显式 KE_REUSE_VITE=1。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const http = require('http')
const net = require('net')
const { spawn } = require('child_process')
const { execSync } = require('child_process')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend')
const BACKEND_DIR = path.join(REPO_ROOT, 'backend')

const SHOTS_DIR = process.env.KE_SHOTS_DIR || '/tmp/focus-shots'
const BACKEND_URL = (process.env.KE_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const PREFERRED_VITE_PORT = Number(process.env.KE_VITE_PORT || 5273)
const WORKSPACE_DIR = process.env.KE_WORKSPACE || '/tmp/focus-ws'
const APP_CONFIG = process.env.KE_APP_CONFIG || '/tmp/focus-test/app_config.json'
const KEEP_VITE = process.env.KE_KEEP_VITE === '1'
const STRICT = process.env.KE_STRICT === '1'

const PW_CANDIDATES = [
  process.env.KE_PLAYWRIGHT_CORE,
  '/mnt/f/Work/Dev/npm/_npx/e41f203b7505f1fb/node_modules/playwright-core',
  path.join(FRONTEND_DIR, 'node_modules', 'playwright-core'),
].filter(Boolean)
const CHROME_CANDIDATES = [process.env.KE_CHROME_PATH].filter(Boolean)
const LD_PATHS = [
  '/tmp/chromedeps/root/usr/lib/x86_64-linux-gnu',
  path.join(process.env.HOME || '', '.local', 'mvlibs', 'usr', 'lib', 'x86_64-linux-gnu'),
  path.join(process.env.HOME || '', '.local', 'mvlibs', 'usr', 'lib', 'aarch64-linux-gnu'),
]

const T = {
  sidebarW: 256,
  sideMargin: 10,
  sideReserve: 280,
  paperW: 860,
  readW: 680,
  barH: 46,
  barTop: 12,
  paperTop: 68,
  radiusPanel: 18,
  radiusBar: 13,
  radiusControl: 8,
  radiusMenu: 12,
  radiusDialog: 24,
}

const SELECTORS = {
  shell: '.focus-shell',
  bodyRow: '.focus-body-row',
  sidebar: '.focus-files-bar',
  reopen: '.focus-sidebar-reopen',
  paper: '.focus-paper',
  prose: '.ke-editor-prose',
  title: '.focus-paper [data-ke-doc-header] input[aria-label="文档标题"]',
  docHeader: '.focus-paper [data-ke-doc-header]',
  meta: '.focus-paper [data-ke-doc-header] > div:first-child',
  h2: '.ke-editor-prose h2',
  scroll: '.ke-scroll',
  bar: '[data-ke-toolbar] > div',
  barRoot: '[data-ke-toolbar]',
  tabStrip: '[data-testid="tab-strip"]',
  statusHidden: '.focus-status-hidden',
  collapseBtn: '[aria-label="收起文件侧栏"]',
  reopenBtn: '[aria-label="展开文件侧栏"]',
  drawerBtn: '[data-testid="open-file-drawer"]',
  inspectorBtn: '[data-testid="open-inspector"]',
  moreBtn: '[aria-label="更多"]',
  focusModeBtn: 'button:has-text("专注模式")',
  inspectorSheet: '.focus-inspector-sheet',
  inspectorScrim: '.focus-inspector-scrim',
  drawerScrim: '.focus-drawer-scrim',
  settingsBtn: '[aria-label="打开设置"]',
  settingsRoot: '[data-ke-slot="settings"]',
  settingsClose: '[data-action="close-settings"]',
  saveBtn: '[data-ke-toolbar] [aria-label="保存"]',
}

const LIGHT_TOKENS = {
  '--background': '#f5f5f7',
  '--card': '#ffffff',
  '--foreground': '#1d1d1f',
  '--border': '#e8e8ed',
  '--primary': '#0071e3',
  '--text-2': '#6e6e73',
  '--text-3': '#8e8e93',
  '--line-2': '#d2d2d7',
  '--radius-panel': '18px',
  '--radius-bar': '13px',
  '--radius-control': '8px',
  '--radius-menu': '12px',
  '--radius-dialog': '24px',
  '--focus-sidebar-w': '256px',
  '--focus-side-reserve': '280px',
  '--focus-paper-w': '860px',
  '--focus-read-w': '680px',
  '--focus-bar-h': '46px',
  '--focus-bar-top': '12px',
  '--focus-paper-top': '68px',
  '--focus-paper-pad-top': '100px',
}
const DARK_TOKENS = {
  '--background': '#000000',
  '--card': '#0e0e10',
  '--foreground': '#f5f5f7',
  '--border': '#232325',
  '--primary': '#0a84ff',
  '--text-2': '#a1a1a6',
  '--text-3': '#6e6e73',
  '--line-2': '#333336',
}
const FONT_TOKENS = {
  '--font-family-sans': ['Inter', 'Noto Sans SC'],
  '--font-family-display': ['Inter Tight', 'Inter'],
  '--font-family-mono': ['IBM Plex Mono'],
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
const t0 = Date.now()
const failures = [] // 收集失败的阶段（截图没产出）
const checks = [] // 布局/令牌断言
const captured = [] // 已产出的截图
let pageDiagnostics = [] // {shot, consoleErrors, pageErrors, requestFailures}
let currentShot = 'preflight'

function log(msg) {
  console.log(`[verify-ui +${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`)
}
function recordFailure(stage, err) {
  failures.push({ stage, message: (err && err.message ? err.message : String(err)).slice(0, 1000) })
  log(`FAIL ${stage}: ${failures[failures.length - 1].message}`)
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
function round1(n) {
  return Math.round(n * 10) / 10
}
function rectFromEl(el, win) {
  const b = el.getBoundingClientRect()
  return {
    x: round1(b.x),
    y: round1(b.y),
    w: round1(b.width),
    h: round1(b.height),
    cx: round1(b.x + b.width / 2),
    cy: round1(b.y + b.height / 2),
    vw: win.innerWidth,
    vh: win.innerHeight,
  }
}

// 断言：数值近似
function near(shot, name, actual, expected, tol, note) {
  const ok = typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= tol
  checks.push({ shot, name, ok, expected: `${expected} ±${tol}`, actual: actual === undefined || actual === null ? String(actual) : round1(actual), note: note || '' })
  return ok
}
// 断言：相等（字符串/布尔）
function eq(shot, name, actual, expected, note) {
  const ok = actual === expected
  checks.push({ shot, name, ok, expected: String(expected), actual: actual === undefined || actual === null ? String(actual) : String(actual).slice(0, 200), note: note || '' })
  return ok
}
// 断言：软性（只记录，不参与 strict 是否判红 —— 用 note 标注）
function soft(shot, name, ok, expected, actual, note) {
  checks.push({ shot, name, ok, expected, actual: actual === undefined || actual === null ? String(actual) : String(actual).slice(0, 300), note: note || '' })
  return ok
}
// 断言：必须为 true
function must(shot, name, ok, expected, actual, note) {
  return eq(shot, name, !!ok, true, note || `期望：${expected}；实际：${actual}`)
}

// ---------------------------------------------------------------------------
// HTTP 预检
// ---------------------------------------------------------------------------
function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }))
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, body: '', headers: {} })
    })
    req.on('error', () => resolve({ status: 0, body: '', headers: {} }))
  })
}

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await httpGet(url, 2000)
    if (r.status >= 200 && r.status < 500) return r
    await sleep(500)
  }
  throw new Error(`${label} 在 ${Math.round(timeoutMs / 1000)}s 内未就绪：${url}`)
}

function tailFile(file, lines = 15) {
  try {
    const text = fs.readFileSync(file, 'utf8').trim().split('\n')
    return text.slice(-lines).join('\n')
  } catch {
    return '(无日志)'
  }
}

function openLog(dir, name) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  const fd = fs.openSync(file, 'a')
  fs.writeSync(fd, `\n===== ${new Date().toISOString()} =====\n`)
  return { file, fd }
}

function spawnDetached(cmd, args, opts, logFile) {
  const fd = fs.openSync(logFile, 'a')
  const child = spawn(cmd, args, {
    ...opts,
    detached: true,
    stdio: ['ignore', fd, fd],
  })
  child.unref()
  return child
}

// ---------------------------------------------------------------------------
// 后端：确保可用（健康检查 → 需要时自动拉起）
// ---------------------------------------------------------------------------
async function ensureBackend() {
  currentShot = 'preflight-backend'
  const base = BACKEND_URL
  const health = base + '/api/health'
  const r = await httpGet(health, 2000)
  if (r.status === 200) {
    log(`后端已就绪：${health}`)
    return { started: false }
  }
  log(`后端不可用（${health} 无响应），尝试自动拉起 …`)
  const port = Number(new URL(base).port || 80)
  const host = new URL(base).hostname
  if (!fs.existsSync(path.join(BACKEND_DIR, 'app', 'main.py'))) {
    throw new Error(`后端目录不完整：${path.join(BACKEND_DIR, 'app', 'main.py')} 不存在；请手动启动：cd backend && KE_APP_CONFIG=${APP_CONFIG} KE_WORKSPACE=${WORKSPACE_DIR} python3 -m uvicorn app.main:app --host ${host} --port ${port}`)
  }
  const logFile = path.join(SHOTS_DIR, 'backend.log')
  spawnDetached('python3', ['-m', 'uvicorn', 'app.main:app', '--host', host, '--port', String(port)], {
    cwd: BACKEND_DIR,
    env: { ...process.env, KE_APP_CONFIG: APP_CONFIG, KE_WORKSPACE: WORKSPACE_DIR, KE_HOST: host, KE_PORT: String(port) },
  }, logFile)
  try {
    await waitForHttp(health, 90000, '后端')
  } catch (e) {
    throw new Error(`${e.message}\n  日志：${logFile}\n  最近输出：\n${tailFile(logFile, 20)}\n  手动启动命令：\n  cd backend && KE_APP_CONFIG=${APP_CONFIG} KE_WORKSPACE=${WORKSPACE_DIR} python3 -m uvicorn app.main:app --host ${host} --port ${port}`)
  }
  log(`后端已自动拉起：${health}（日志：${logFile}）`)
  return { started: true }
}

// ---------------------------------------------------------------------------
// Vite：确保有一个"读磁盘当前内容"的 dev server
//
// 为什么默认不复用已在跑的 5273？
//   本机仓库位于 WSL 的 /mnt/f（drvfs）。实测：已运行的 vite dev server 会漏掉文件
//   变更事件，继续返回**陈旧模块**（改了 frontend/src 之后 curl /src/App.tsx 仍是旧
//   代码；带 ?t=<ts> 才重新 transform）。用它截图会得到"与磁盘代码不一致"的假证据。
//   因此默认另起一个**全新 vite 进程**（新进程按请求时的磁盘内容 transform）：
//     - 5273 空闲  → 直接用 5273 起自己的实例（符合环境约定）
//     - 5273 被占用 → 在 5274+ 找空闲端口起独立实例（不动别人跑着的 server）
//   若你确认现有实例是新鲜的，可显式 KE_REUSE_VITE=1 复用它（快，但风险自负）。
// ---------------------------------------------------------------------------
function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

async function ensureVite() {
  currentShot = 'preflight-vite'
  // 1) 显式指定 → 信任并只做可达性检查
  if (process.env.KE_BASE_URL) {
    const baseUrl = process.env.KE_BASE_URL.replace(/\/$/, '')
    await waitForHttp(baseUrl + '/', 20000, '前端（KE_BASE_URL）')
    log(`使用显式指定的前端：${baseUrl}`)
    return { baseUrl, started: false, reused: true }
  }
  const preferredUrl = `http://127.0.0.1:${PREFERRED_VITE_PORT}`
  // 2) 显式要求复用现有实例
  if (process.env.KE_REUSE_VITE === '1') {
    await waitForHttp(preferredUrl + '/', 20000, '现有前端 dev server')
    log(`KE_REUSE_VITE=1：复用现有 dev server ${preferredUrl}（注意：WSL drvfs 下它可能服务陈旧模块，截图可能滞后于磁盘代码）`)
    return { baseUrl: preferredUrl, started: false, reused: true }
  }
  // 3) 起一个全新进程的 vite
  let port = 0
  const taken = (await httpGet(preferredUrl + '/', 1500)).status === 200
  if (!taken && (await portFree(PREFERRED_VITE_PORT))) {
    port = PREFERRED_VITE_PORT
  } else {
    for (let p = PREFERRED_VITE_PORT + 1; p <= PREFERRED_VITE_PORT + 25; p++) {
      if (await portFree(p)) {
        port = p
        break
      }
    }
  }
  if (!port) throw new Error(`找不到可用端口（尝试 ${PREFERRED_VITE_PORT}..${PREFERRED_VITE_PORT + 25}）`)
  const logFile = path.join(SHOTS_DIR, `vite-${port}.log`)
  if (taken) log(`端口 ${PREFERRED_VITE_PORT} 已有 dev server 在跑（可能是陈旧实例，不复用）；另起全新实例。`)
  log(`启动独立 vite：http://127.0.0.1:${port}（日志：${logFile}）`)
  const child = spawnDetached(process.execPath, ['scripts/ke-vite.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: FRONTEND_DIR,
    env: process.env,
  }, logFile)
  const baseUrl = `http://127.0.0.1:${port}`
  try {
    await waitForHttp(baseUrl + '/', 90000, '前端 vite')
  } catch (e) {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* ignore */ }
    throw new Error(`${e.message}\n  日志：${logFile}\n  最近输出：\n${tailFile(logFile, 20)}\n  手动启动命令：\n  cd frontend && node scripts/ke-vite.mjs --host 0.0.0.0 --port ${PREFERRED_VITE_PORT}`)
  }
  log(`独立 vite 就绪（全新进程，模块来自磁盘当前内容）：${baseUrl}`)
  return { baseUrl, started: true, reused: false, pid: child.pid, port }
}

function stopVite(vite) {
  if (!vite || !vite.started || KEEP_VITE) {
    if (vite && vite.started && KEEP_VITE) log(`保留独立 vite（KE_KEEP_VITE=1）：${vite.baseUrl} pid=${vite.pid}`)
    return
  }
  try {
    process.kill(-vite.pid, 'SIGTERM')
    log(`已关闭独立 vite 实例（pid=${vite.pid}）`)
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------------------
// Playwright / Chromium 定位
// ---------------------------------------------------------------------------
function loadPlaywrightCore() {
  const errors = []
  for (const p of PW_CANDIDATES) {
    try {
      const mod = require(p)
      if (mod && mod.chromium) return { mod, from: p }
    } catch (e) {
      errors.push(`${p}: ${e.message.split('\n')[0]}`)
    }
  }
  try {
    const mod = require('playwright-core')
    if (mod && mod.chromium) return { mod, from: 'require(playwright-core)' }
  } catch (e) {
    errors.push(`require(playwright-core): ${e.message.split('\n')[0]}`)
  }
  throw new Error(`找不到 playwright-core。尝试过：\n  ${errors.join('\n  ')}\n请设置 KE_PLAYWRIGHT_CORE=<playwright-core 包目录>`)
}

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (fs.existsSync(c)) return c
  }
  const root = path.join(process.env.HOME || '', '.cache', 'ms-playwright')
  let entries = []
  try {
    entries = fs.readdirSync(root)
  } catch {
    entries = []
  }
  const versions = entries.filter((n) => /^chromium-/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const v of versions) {
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = path.join(root, v, rel)
      if (fs.existsSync(p)) return p
    }
  }
  throw new Error(`找不到 Chromium 可执行文件（扫描 ${root}/chromium-*）。请设置 KE_CHROME_PATH=<chrome 路径>`)
}

function ensureChromiumLibs() {
  const existing = (process.env.LD_LIBRARY_PATH || '').split(':').filter(Boolean)
  for (const p of LD_PATHS) {
    if (fs.existsSync(p) && !existing.includes(p)) existing.push(p)
  }
  process.env.LD_LIBRARY_PATH = existing.join(':')
}

// ---------------------------------------------------------------------------
// 浏览器交互
// ---------------------------------------------------------------------------
const ARTICLE_MARK = '碰撞动力学'
const ARTICLE_ID = 'Articles/碰撞动力学-质心系与动量.md'

function attachDiagnostics(page, shotId) {
  const diag = { shot: shotId, consoleErrors: [], pageErrors: [], requestFailures: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') diag.consoleErrors.push(m.text().slice(0, 300))
  })
  page.on('pageerror', (e) => diag.pageErrors.push(String(e.message).slice(0, 300)))
  page.on('response', (r) => {
    if (r.status() >= 400) diag.requestFailures.push(`${r.status()} ${r.url()}`)
  })
  pageDiagnostics.push(diag)
  return diag
}

function seededContextOptions(extra = {}) {
  return {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    ...extra,
  }
}

/** 让页面带着"上次打开的文档"启动（窄屏侧栏默认收起时也能直接进编辑器）。 */
async function seedLastArticle(page) {
  await page.addInitScript((id) => {
    try {
      localStorage.setItem('ke.lastArticleId', id)
    } catch {
      /* ignore */
    }
  }, ARTICLE_ID)
}

async function seedTheme(page, theme) {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem(
        'ke.settings.v1',
        JSON.stringify({
          schemaVersion: 1,
          startup: { restoreLastState: true, autoOpenRecentWorkspace: false },
          editor: { autosaveIntervalMs: 3000, historyRetentionCount: 30, display: {} },
          ui: { theme: t, displayPreference: {} },
          maintenance: {},
        }),
      )
    } catch {
      /* ignore */
    }
  }, theme)
}

const DEFAULT_TIMEOUTS = { nav: 90000, selector: 60000, click: 45000 }

async function gotoApp(page, baseUrl) {
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUTS.nav })
  await page.waitForSelector(SELECTORS.shell, { timeout: DEFAULT_TIMEOUTS.selector })
  await page.waitForTimeout(600)
}

async function ensureDrawerOpen(page) {
  if ((await page.locator(SELECTORS.sidebar).count()) > 0) return
  await page.keyboard.press('Control+\\')
  await page.waitForSelector(SELECTORS.sidebar, { timeout: 15000 })
  await page.waitForTimeout(400)
}

/** 打开文章：优先靠 lastArticleId 自动恢复；失败则（必要时打开抽屉）点文件树。 */
async function openArticle(page, baseUrl, { expectAutoRestore = true } = {}) {
  await gotoApp(page, baseUrl)
  if (expectAutoRestore) {
    try {
      await page.waitForSelector(SELECTORS.prose, { timeout: 15000 })
    } catch {
      /* fallback below */
    }
  }
  if ((await page.locator(SELECTORS.prose).count()) === 0) {
    await ensureDrawerOpen(page)
    const item = page.locator(`text=${ARTICLE_MARK}`).first()
    await item.click({ timeout: DEFAULT_TIMEOUTS.click })
    await page.waitForSelector(SELECTORS.prose, { timeout: DEFAULT_TIMEOUTS.selector })
  }
  await page.waitForTimeout(1000)
}

async function shot(page, name) {
  currentShot = name
  const file = path.join(SHOTS_DIR, `${name}.png`)
  await page.screenshot({ path: file, animations: 'disabled', timeout: 30000 })
  captured.push({ name, file, viewport: page.viewportSize() })
  log(`截图 ${file}`)
  return file
}

/** 页面内测量：返回布局矩形 / 排版 / 令牌的原始证据。 */
async function measure(page) {
  const config = { selectors: SELECTORS, articleMark: ARTICLE_MARK }
  return page.evaluate(({ selectors, articleMark }) => {
    const rect = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const b = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        x: Math.round(b.x * 10) / 10,
        y: Math.round(b.y * 10) / 10,
        w: Math.round(b.width * 10) / 10,
        h: Math.round(b.height * 10) / 10,
        cx: Math.round((b.x + b.width / 2) * 10) / 10,
        radius: cs.borderTopLeftRadius,
        borderWidth: cs.borderTopWidth,
        borderStyle: cs.borderTopStyle,
        borderColor: cs.borderTopColor,
        bg: cs.backgroundColor,
        color: cs.color,
        display: cs.display,
        boxShadow: cs.boxShadow,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        fontWeight: cs.fontWeight,
        paddingTop: cs.paddingTop,
        paddingLeft: cs.paddingLeft,
        paddingRight: cs.paddingRight,
        textOverflow: cs.textOverflow,
        overflowX: cs.overflowX,
      }
    }
    const tokens = (keys) => {
      const cs = getComputedStyle(document.documentElement)
      const out = {}
      for (const k of keys) out[k] = cs.getPropertyValue(k).trim()
      return out
    }
    const allTokens = {} // 需要全量时再由脚本侧过滤
    const csRoot = getComputedStyle(document.documentElement)
    for (const sheet of [csRoot]) {
      for (const name of [
        '--background', '--card', '--foreground', '--border', '--primary',
        '--text-2', '--text-3', '--line-2', '--radius-panel', '--radius-bar', '--radius-control',
        '--radius-menu', '--radius-dialog', '--focus-sidebar-w', '--focus-side-reserve',
        '--focus-paper-w', '--focus-read-w', '--focus-bar-h', '--focus-bar-top',
        '--focus-paper-top', '--focus-paper-pad-top', '--font-family-sans',
        '--font-family-display', '--font-family-mono', '--elev-sm', '--elev-md', '--elev-lg',
      ]) {
        allTokens[name] = sheet.getPropertyValue(name).trim()
      }
    }
    const barButtons = [...document.querySelectorAll('[data-ke-toolbar] button')].map((b) => {
      const bb = b.getBoundingClientRect()
      const s = getComputedStyle(b)
      return {
        label: (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().slice(0, 20),
        w: Math.round(bb.width),
        h: Math.round(bb.height),
        bg: s.backgroundColor,
        borderWidth: s.borderTopWidth,
      }
    })
    const sidebarFileText = (() => {
      const aside = document.querySelector(selectors.sidebar)
      if (!aside) return null
      const els = [...aside.querySelectorAll('button, .truncate, [title]')]
      const hit = els.find((e) => (e.textContent || '').includes(articleMark))
      if (!hit) return null
      const s = getComputedStyle(hit)
      return { text: (hit.textContent || '').trim().slice(0, 80), textOverflow: s.textOverflow, whiteSpace: s.whiteSpace }
    })()
    const fileDrawer = (() => {
      const el = document.querySelector(selectors.drawerBtn)
      if (!el) return null
      const b = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return { display: s.display, visibility: s.visibility, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
    })()
    const saveBtn = (() => {
      const el = document.querySelector(selectors.saveBtn)
      if (!el) return null
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, borderWidth: s.borderTopWidth, borderColor: s.borderTopColor, label: el.getAttribute('aria-label') }
    })()
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      theme: document.documentElement.dataset.theme || null,
      shell: rect(selectors.shell),
      bodyRow: rect(selectors.bodyRow),
      bodyRowPadding: (() => {
        const el = document.querySelector(selectors.bodyRow)
        if (!el) return null
        const s = getComputedStyle(el)
        return { left: s.paddingLeft, right: s.paddingRight }
      })(),
      sidebar: rect(selectors.sidebar),
      reopen: rect(selectors.reopen),
      paper: rect(selectors.paper),
      prose: rect(selectors.prose),
      title: rect(selectors.title),
      docHeader: rect(selectors.docHeader),
      h2: rect(selectors.h2),
      bar: rect(selectors.bar),
      tabStrip: rect(selectors.tabStrip),
      statusHidden: rect(selectors.statusHidden),
      inspectorSheet: rect(selectors.inspectorSheet),
      inspectorScrim: rect(selectors.inspectorScrim),
      drawerScrim: rect(selectors.drawerScrim),
      settingsRoot: rect(selectors.settingsRoot),
      hasSidebar: !!document.querySelector(selectors.sidebar),
      hasInspector: !!document.querySelector(selectors.inspectorSheet),
      hasLauncherHero: [...document.querySelectorAll('h1')].some((e) => (e.textContent || '').includes('让写作回到本地')),
      launcher: (() => {
        const h1 = [...document.querySelectorAll('h1')].find((e) => (e.textContent || '').includes('让写作回到本地'))
        if (!h1) return null
        const hb = h1.getBoundingClientRect()
        const s = getComputedStyle(h1)
        const card = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('打开已有工作区'))
        const cb = card ? card.getBoundingClientRect() : null
        const cardStyle = card ? getComputedStyle(card) : null
        const container = h1.closest('[class*="w-[720px]"]')
        return {
          h1: {
            x: Math.round(hb.x),
            y: Math.round(hb.y),
            w: Math.round(hb.width),
            h: Math.round(hb.height),
            fontSize: s.fontSize,
            fontWeight: s.fontWeight,
            letterSpacing: s.letterSpacing,
          },
          primaryCard: cb
            ? { x: Math.round(cb.x), y: Math.round(cb.y), w: Math.round(cb.width), h: Math.round(cb.height), bg: cardStyle.backgroundColor, radius: cardStyle.borderRadius }
            : null,
          containerW: container ? Math.round(container.getBoundingClientRect().width) : null,
          text: (document.body.innerText || '').slice(0, 500),
        }
      })(),
      tokens: allTokens,
      barButtons,
      sidebarFileText,
      fileDrawer,
      saveBtn,
      settingsText: (() => {
        const root = document.querySelector(selectors.settingsRoot)
        return root ? (root.innerText || '').slice(0, 400) : null
      })(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      fontSizes: {
        body: getComputedStyle(document.body).fontSize,
      },
    }
  }, config)
}

// ---------------------------------------------------------------------------
// 断言组
// ---------------------------------------------------------------------------
function assertTokens(shot, tokens, expected, label) {
  for (const [k, v] of Object.entries(expected)) {
    const actual = (tokens[k] || '').toLowerCase().replace(/\s+/g, ' ').trim()
    eq(shot, `${label} 令牌 ${k}`, actual, v.toLowerCase(), `期望 ${v}`)
  }
}

function assertFontTokens(shot, tokens) {
  for (const [k, parts] of Object.entries(FONT_TOKENS)) {
    const actual = tokens[k] || ''
    for (const part of parts) {
      soft(shot, `字体栈 ${k} 含「${part}」`, actual.includes(part), `包含 ${part}`, actual.slice(0, 120), '字体加载需人工确认实际字形（可能回退系统字体）')
    }
  }
}

function assertDesktopGeometry(shot, m, viewportW, viewportH) {
  // 壳层：无顶栏；侧栏从 10,10 开始
  if (m.sidebar) {
    near(shot, '侧栏宽 256', m.sidebar.w, T.sidebarW, 1)
    near(shot, '侧栏左间距 10', m.sidebar.x, 10, 1)
    near(shot, '侧栏上间距 10（无顶栏）', m.sidebar.y, 10, 1)
    near(shot, '侧栏下间距 10', viewportH - (m.sidebar.y + m.sidebar.h), 10, 1)
    eq(shot, '侧栏圆角 18', m.sidebar.radius, '18px')
    near(shot, '左右对称留白 280', parseFloat(m.bodyRowPadding?.left || 'NaN'), T.sideReserve, 1)
    near(shot, '右侧留白 280', parseFloat(m.bodyRowPadding?.right || 'NaN'), T.sideReserve, 1)
  }
  // 纸面
  if (m.paper) {
    near(shot, '纸面宽 860', m.paper.w, T.paperW, 1.5)
    near(shot, '纸面上边距 68（命令条下方）', m.paper.y, T.paperTop, 2)
    eq(shot, '纸面圆角 18', m.paper.radius, '18px')
    eq(shot, '纸面 1px 边框', m.paper.borderWidth, '1px')
    eq(shot, '纸面底色 = --card', m.paper.bg, 'rgb(255, 255, 255)')
    near(shot, '纸面水平居中（中心=窗口中心）', m.paper.cx, viewportW / 2, 2)
    if (m.bodyRowPadding && parseFloat(m.bodyRowPadding.left) > 200) {
      // 侧栏展开时：纸面左边缘 = 280 + (880-860)/2 = 290
      near(shot, '纸面左边缘 = 290（280 留白 + 10）', m.paper.x, 290, 2)
    }
  }
  // 阅读列
  if (m.prose) {
    near(shot, '阅读列宽 680', m.prose.w, T.readW, 3, '实测受 padding clamp 上限影响可能为 678（-2px，视觉不可辨）')
    near(shot, '阅读列居中（x = 纸面内）', m.prose.cx, m.paper ? m.paper.cx : viewportW / 2, 2)
    eq(shot, '正文 17px', m.prose.fontSize, '17px')
    near(shot, '正文行高 1.8（30.6px）', parseFloat(m.prose.lineHeight), 30.6, 0.6)
  }
  // 标题排版
  if (m.title) {
    eq(shot, '标题 42px', m.title.fontSize, '42px')
    near(shot, '标题行高 1.1（46.2px）', parseFloat(m.title.lineHeight), 46.2, 0.8)
    near(shot, '标题字距 -0.045em（-1.89px）', parseFloat(m.title.letterSpacing), -1.89, 0.35)
    eq(shot, '标题字重 650', m.title.fontWeight, '650')
  }
  if (m.h2) eq(shot, 'H2 28px', m.h2.fontSize, '28px')
  // 命令条
  if (m.bar) {
    near(shot, '命令条高 46', m.bar.h, T.barH, 1)
    near(shot, '命令条顶部 12', m.bar.y, T.barTop, 1)
    eq(shot, '命令条圆角 13', m.bar.radius, '13px')
    eq(shot, '命令条 1px 边框', m.bar.borderWidth, '1px')
    if (m.paper) {
      near(shot, '命令条与纸面等宽（860）', m.bar.w, m.paper.w, 1.5)
      near(shot, '命令条与纸面对齐（x 相同）', m.bar.x, m.paper.x, 2)
    }
  }
  // 禁止回退项
  eq(shot, '禁止回退：无常驻标签栏（tab-strip display:none）', m.tabStrip ? m.tabStrip.display : 'missing', 'none')
  eq(shot, '禁止回退：无常驻状态条（display:none）', m.statusHidden ? m.statusHidden.display : 'missing', 'none')
  eq(shot, '禁止回退：无常驻右侧信息栏（inspector 默认关闭）', m.hasInspector, false)
  soft(shot, '禁止回退：文件名不省略号截断', m.sidebarFileText ? m.sidebarFileText.textOverflow !== 'ellipsis' : 'not-measured', 'textOverflow !== ellipsis', m.sidebarFileText ? JSON.stringify(m.sidebarFileText).slice(0, 200) : '未找到文件名元素', '文件名应可见完整内容或可横向滚动')
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  log(`仓库：${REPO_ROOT}`)
  log(`截图输出：${SHOTS_DIR}`)

  // 0) 环境信息
  let git = {}
  try {
    git = {
      branch: execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
      head: execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
      dirty: execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean).length,
    }
  } catch {
    /* ignore */
  }
  log(`git: ${git.branch || '?'} @ ${git.head || '?'}（脏文件 ${git.dirty ?? '?'} 个）`)

  // 1) 后端 + 前端
  const backend = await ensureBackend()
  const vite = await ensureVite()

  // 2) 浏览器
  ensureChromiumLibs()
  const { mod: pw, from: pwFrom } = loadPlaywrightCore()
  const chromePath = findChrome()
  log(`playwright-core: ${pwFrom}`)
  log(`chromium: ${chromePath}`)
  let browser
  try {
    browser = await pw.chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
      timeout: 60000,
    })
  } catch (e) {
    throw new Error(`Chromium 启动失败：${e.message}\n  提示：确认 LD_LIBRARY_PATH 已包含本地 sysroot（脚本已尝试加入 ${LD_PATHS.join(' / ')}）。`)
  }
  const baseUrl = vite.baseUrl

  const newContext = async (shotId, opts) => {
    const context = await browser.newContext(opts)
    const page = await context.newPage()
    attachDiagnostics(page, shotId)
    return { context, page }
  }

  try {
    // 2.5) 预热（fresh vite 首次编译 + 可能的 deps optimize 全量刷新）
    currentShot = 'warmup'
    {
      const warm = await newContext('warmup', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
      await seedLastArticle(warm.page)
      log('预热页面（首次编译可能较慢）…')
      await openArticle(warm.page, baseUrl)
      await warm.page.waitForTimeout(800)
      await warm.page.reload({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUTS.nav })
      await warm.page.waitForTimeout(1200)
      await warm.context.close()
      log('预热完成')
    }

    // ---------- A. 1440×900 浅色：编辑器 / 收起侧栏 / 文档信息浮层 / 设置 ----------
    currentShot = 'A-1440-light'
    {
      const { context, page } = await newContext('A-1440-light', seededContextOptions())
      await seedLastArticle(page)
      await openArticle(page, baseUrl)
      let m = await measure(page)
      assertTokens('01-editor-light', m.tokens, LIGHT_TOKENS, '浅色')
      assertFontTokens('01-editor-light', m.tokens)
      assertDesktopGeometry('01-editor-light', m, 1440, 900)
      eq('01-editor-light', '页面主题 = light', m.theme, 'light')
      soft('01-editor-light', '保存按钮有浅底（非透明）', m.saveBtn ? m.saveBtn.bg !== 'rgba(0, 0, 0, 0)' : 'not-measured', '非透明背景', m.saveBtn ? JSON.stringify(m.saveBtn) : '未找到保存按钮')
      // Focus 保真：侧栏 5 导航 + footer 三段（设计 .fb-nav / .fb-foot）
      const sideText = await page.evaluate(() => {
        const bar = document.querySelector('.focus-files-bar')
        return bar ? (bar.textContent || '') : ''
      })
      const navChecks = ['知识库', '搜索', '模块', '资料', '回收站']
      const footChecks = ['设置', '专注模式', '切换外观']
      for (const label of [...navChecks, ...footChecks]) {
        soft('01-editor-light', `侧栏含「${label}」`, sideText.includes(label), `包含「${label}」`, sideText.slice(0, 200))
      }
      await shot(page, '01-editor-light-1440x900')
      const paperCenterLight = m.paper ? m.paper.cx : null

      // 收起侧栏
      currentShot = 'A-collapsed'
      await page.click(SELECTORS.collapseBtn, { timeout: DEFAULT_TIMEOUTS.click })
      await page.waitForTimeout(800)
      m = await measure(page)
      eq('02-collapsed', '侧栏已收起（DOM 无 .focus-files-bar）', m.hasSidebar, false)
      if (m.reopen) {
        near('02-collapsed', '展开浮块（»）34×38', m.reopen.w, 34, 1)
        near('02-collapsed', '展开浮块高 38', m.reopen.h, 38, 1)
        near('02-collapsed', '展开浮块位置 left:10 top:10', m.reopen.x, 10, 1)
        near('02-collapsed', '展开浮块位置 top:10', m.reopen.y, 10, 1)
      } else {
        eq('02-collapsed', '收起后出现「»」重新展开浮块', false, true)
      }
      near('02-collapsed', '收起后左右留白归零', parseFloat(m.bodyRowPadding?.left || 'NaN'), 0, 0.5)
      near('02-collapsed', '禁止回退：开合侧栏纸面中心不动', m.paper ? m.paper.cx : NaN, paperCenterLight, 1)
      near('02-collapsed', '收起后纸面宽仍 860', m.paper ? m.paper.w : NaN, T.paperW, 1.5)
      await shot(page, '02-editor-collapsed-sidebar-1440x900')

      // 展开侧栏 → 文档信息浮层
      currentShot = 'A-inspector'
      await page.click(SELECTORS.reopenBtn, { timeout: DEFAULT_TIMEOUTS.click })
      await page.waitForTimeout(600)
      // Focus 保真：文档信息入口移入命令条「⋯ 更多」菜单
      await page.click(SELECTORS.moreBtn, { timeout: DEFAULT_TIMEOUTS.click })
      await page.waitForTimeout(400)
      await page.click(SELECTORS.inspectorBtn, { timeout: DEFAULT_TIMEOUTS.click })
      await page.waitForTimeout(800)
      m = await measure(page)
      eq('03-inspector', '文档信息浮层已渲染', m.hasInspector, true)
      if (m.inspectorSheet) {
        near('03-inspector', '浮层宽 380', m.inspectorSheet.w, 380, 2)
        near('03-inspector', '浮层右间距 10', 1440 - (m.inspectorSheet.x + m.inspectorSheet.w), 10, 1)
        near('03-inspector', '浮层上间距 10', m.inspectorSheet.y, 10, 1)
        eq('03-inspector', '浮层圆角 18', m.inspectorSheet.radius, '18px')
      }
      near('03-inspector', '浮层不挤占布局：纸面中心不动', m.paper ? m.paper.cx : NaN, paperCenterLight, 1)
      await shot(page, '03-editor-inspector-sheet-1440x900')

      // 关闭浮层 → 设置
      currentShot = 'A-settings'
      await page.click(SELECTORS.inspectorScrim, { timeout: DEFAULT_TIMEOUTS.click })
      await page.waitForTimeout(500)
      await page.click(SELECTORS.settingsBtn, { timeout: DEFAULT_TIMEOUTS.click })
      await page.waitForTimeout(1200)
      m = await measure(page)
      eq('06-settings', '设置页已渲染（[data-ke-slot="settings"]）', !!m.settingsRoot, true)
      if (m.settingsRoot) {
        near('06-settings', '设置页覆盖整个视口（宽）', m.settingsRoot.w, 1440, 1)
        near('06-settings', '设置页覆盖整个视口（高）', m.settingsRoot.h, 900, 1)
      } else {
        eq('06-settings', '设置页覆盖整个视口（宽）', false, true)
      }
      soft('06-settings', '设置页含「设置」标题', m.settingsText ? m.settingsText.includes('设置') : false, '包含「设置」', m.settingsText ? m.settingsText.slice(0, 120) : 'missing')
      await shot(page, '06-settings-1440x900')
      // 清理：关闭设置（失败则 Esc / 直接关 context）
      try {
        await page.click(SELECTORS.settingsClose, { timeout: 5000 })
      } catch {
        await page.keyboard.press('Escape').catch(() => {})
      }

      // ---------- Focus 保真：专注模式（侧栏隐藏 / 命令条沉底 / Esc 退出）----------
      currentShot = 'G-focus-mode'
      await page.waitForTimeout(600)
      const sideText2 = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('专注模式'))
        ;btn && btn.click()
        return btn ? 'clicked' : 'missing'
      })
      soft('09-focus', '侧栏 footer「专注模式」可点击', sideText2 === 'clicked', 'clicked', sideText2)
      await page.waitForTimeout(700)
      const fm = await page.evaluate(() => {
        const bar = document.querySelector('[data-ke-toolbar] > div')
        const paper = document.querySelector('.focus-paper')
        const sidebar = document.querySelector('.focus-files-bar')
        const shell = document.querySelector('.focus-shell')
        const b = bar ? bar.getBoundingClientRect() : null
        const p = paper ? getComputedStyle(paper) : null
        const pb = paper ? paper.getBoundingClientRect() : null
        return {
          mode: shell ? shell.getAttribute('data-focus-mode') : null,
          sidebarVisible: !!(sidebar && getComputedStyle(sidebar).display !== 'none'),
          bar: b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), bottomGap: Math.round(window.innerHeight - b.bottom) } : null,
          paperBorder: p ? p.borderTopWidth : null,
          paperShadow: p ? p.boxShadow : null,
          paperWidth: pb ? Math.round(pb.width) : null,
        }
      })
      eq('09-focus', '专注模式激活（data-focus-mode=1）', fm.mode, '1')
      eq('09-focus', '专注模式隐藏侧栏', fm.sidebarVisible, false)
      near('09-focus', '命令条沉到窗口底部（距底 16）', fm.bar ? fm.bar.bottomGap : NaN, 16, 3)
      near('09-focus', '命令条宽度 720 上限', fm.bar ? fm.bar.w : NaN, 720, 3)
      eq('09-focus', '专注模式纸面去边框', fm.paperBorder, '0px')
      eq('09-focus', '专注模式纸面无阴影', fm.paperShadow, 'none')
      // 参考稿 focus：顶栏 = ← 文档标题 | 保存态 + 主题切换
      const focusTop = await page.evaluate(() => {
        const bar = document.querySelector('.focus-exit-bar')
        const btn = bar ? bar.querySelector('button') : null
        const b = bar ? bar.getBoundingClientRect() : null
        return { exists: !!bar, h: b ? Math.round(b.height) : null, title: btn ? (btn.textContent || '').trim() : '' }
      })
      eq('09-focus', '专注模式顶栏存在', focusTop.exists, true)
      near('09-focus', '专注模式顶栏高 44', focusTop.h, 44, 2)
      soft('09-focus', '专注模式顶栏含文档标题', focusTop.title.includes('碰撞动力学'), '包含标题', focusTop.title)
      await shot(page, '09-focus-mode-1440x900')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
      const fmExit = await page.evaluate(() => {
        const shell = document.querySelector('.focus-shell')
        return shell ? shell.getAttribute('data-focus-mode') : 'missing'
      })
      eq('09-focus', 'Esc 退出专注模式', fmExit, null)

      // ---------- H. 主画布页面（知识库/搜索/模块/资料/回收站）+ ⌘K 面板 + 设置页 ----------
      currentShot = 'H-pages'
      const clickNav = (label) =>
        page.evaluate((t) => {
          const nav = document.querySelector('[aria-label="主导航"]')
          const btn = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === t) : null
          if (btn) btn.click()
          return !!btn
        }, label)
      const clickFooter = (label) =>
        page.evaluate((t) => {
          const bar = document.querySelector('.focus-files-bar')
          const btn = bar ? [...bar.querySelectorAll('button')].find((b) => (b.textContent || '').trim().includes(t)) : null
          if (btn) btn.click()
          return !!btn
        }, label)
      const pageInfo = () =>
        page.evaluate(() => {
          const layer = document.querySelector('.focus-page-layer')
          const title = layer ? layer.querySelector('.focus-page-title') : null
          const toolbar = document.querySelector('[data-ke-toolbar]')
          return {
            active: !!layer,
            page: layer ? layer.getAttribute('data-page') : null,
            title: title ? (title.textContent || '').trim() : null,
            titleSize: title ? getComputedStyle(title).fontSize : null,
            toolbarHidden: toolbar ? getComputedStyle(toolbar).display === 'none' : false,
          }
        })
      const PAGES = [
        ['知识库', '10-library-page-1440x900', '知识库'],
        ['搜索', '11-search-page-1440x900', '搜索'],
        ['模块', '12-modules-page-1440x900', '模块'],
        ['资料', '13-assets-page-1440x900', '资料'],
        ['回收站', '14-trash-page-1440x900', '回收站'],
      ]
      for (const [label, shotName, expectTitle] of PAGES) {
        await clickNav(label)
        await page.waitForTimeout(900)
        const info = await pageInfo()
        eq('10-pages', `${label} 页面已渲染（.focus-page-layer）`, info.active, true)
        eq('10-pages', `${label} 页面标题`, info.title, expectTitle)
        near('10-pages', `${label} 页面标题 40px`, parseFloat(info.titleSize || 'NaN'), 40, 1)
        eq('10-pages', `${label} 页激活时隐藏命令条`, info.toolbarHidden, true)
        await shot(page, shotName)
      }

      // 命令面板（⌘K）
      await clickNav('知识库')
      await page.waitForTimeout(500)
      await page.keyboard.press('Control+k')
      await page.waitForTimeout(800)
      const palette = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"][aria-label="命令面板"]')
        const active = document.activeElement
        return {
          open: !!dlg,
          text: dlg ? (dlg.textContent || '') : '',
          inputFocused: !!active && active.tagName === 'INPUT',
        }
      })
      eq('15-palette', '⌘K 打开命令面板', palette.open, true)
      soft('15-palette', '面板含「最近文档」分组', palette.text.includes('最近文档'), '包含', palette.text.slice(0, 120))
      soft('15-palette', '面板含「命令」分组', palette.text.includes('命令'), '包含', '')
      soft('15-palette', '面板含「打开的文档」分组', palette.text.includes('打开的文档'), '包含', '')
      soft('15-palette', '面板输入框自动聚焦', palette.inputFocused, true, String(palette.inputFocused))
      await shot(page, '15-command-palette-1440x900')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)

      // 设置页（独立页形态，参考稿 settings.png）
      await clickFooter('设置')
      await page.waitForTimeout(900)
      const settingsInfo = await page.evaluate(() => {
        const root = document.querySelector('[data-ke-slot="settings"]')
        const title = root ? root.querySelector('.focus-page-title') : null
        const b = root ? root.getBoundingClientRect() : null
        return {
          exists: !!root,
          w: b ? Math.round(b.width) : null,
          h: b ? Math.round(b.height) : null,
          title: title ? (title.textContent || '').trim() : null,
          titleSize: title ? getComputedStyle(title).fontSize : null,
        }
      })
      eq('16-settings-page', '设置页渲染', settingsInfo.exists, true)
      near('16-settings-page', '设置页全屏（宽）', settingsInfo.w, 1440, 1)
      near('16-settings-page', '设置页全屏（高）', settingsInfo.h, 900, 1)
      eq('16-settings-page', '设置页标题', settingsInfo.title, '设置')
      near('16-settings-page', '设置页标题 40px', parseFloat(settingsInfo.titleSize || 'NaN'), 40, 1)
      await shot(page, '16-settings-page-1440x900')
      await page.evaluate(() => {
        const btn = document.querySelector('[data-action="close-settings"]')
        if (btn) btn.click()
      })
      await page.waitForTimeout(400)
      await context.close()
    }

    // ---------- B. 1440×900 深色 ----------
    currentShot = 'B-dark'
    {
      const { context, page } = await newContext('B-dark', seededContextOptions())
      await seedTheme(page, 'dark')
      await seedLastArticle(page)
      await openArticle(page, baseUrl)
      const m = await measure(page)
      eq('04-dark', '页面主题 = dark', m.theme, 'dark')
      assertTokens('04-dark', m.tokens, DARK_TOKENS, '深色')
      eq('04-dark', '深色底层背景 #000', m.bodyBg, 'rgb(0, 0, 0)')
      if (m.paper) {
        eq('04-dark', '深色纸面 = --card #0e0e10', m.paper.bg, 'rgb(14, 14, 16)')
        near('04-dark', '深色布局仍居中', m.paper.cx, 720, 2)
        near('04-dark', '深色纸面宽 860', m.paper.w, T.paperW, 1.5)
      }
      if (m.sidebar) {
        eq('04-dark', '深色侧栏 = --card #0e0e10', m.sidebar.bg, 'rgb(14, 14, 16)')
        near('04-dark', '深色侧栏宽 256', m.sidebar.w, T.sidebarW, 1)
      }
      if (m.title) eq('04-dark', '深色标题文字 #f5f5f7', m.title.color, 'rgb(245, 245, 247)')
      soft('04-dark', '深色阴影独立（--elev-sm 与浅色不同）', (m.tokens['--elev-sm'] || '').includes('rgba(0, 0, 0'), '深色阴影 rgba(0,0,0,...)', (m.tokens['--elev-sm'] || '').slice(0, 120))
      await shot(page, '04-editor-dark-1440x900')
      await context.close()
    }

    // ---------- C. 1440×900 启动器（拦截 workspace/current 视为未打开） ----------
    currentShot = 'C-launcher'
    {
      const { context, page } = await newContext('C-launcher', seededContextOptions())
      await page.route('**/api/workspace/current', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ open: false }) }),
      )
      await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUTS.nav })
      await page.waitForFunction(
        () => !!document.querySelector('.focus-shell') || (document.body && document.body.innerText.includes('打开已有工作区')),
        { timeout: DEFAULT_TIMEOUTS.selector },
      )
      await page.waitForTimeout(1200)
      const m = await measure(page)
      eq('05-launcher', '启动器页已渲染（无编辑器壳）', m.hasLauncherHero, true)
      eq('05-launcher', '启动器页不是编辑器（无 .focus-shell）', !!m.shell, false)
      if (m.launcher) {
        near('05-launcher', '启动器 hero 标题 46px（设计 launcher-hero）', parseFloat(m.launcher.h1.fontSize), 46, 1)
        near('05-launcher', '启动器内容列宽 720（设计 launcher-card）', m.launcher.containerW ?? NaN, 720, 2)
        soft('05-launcher', '主操作卡为蓝底（--primary #0071e3）', m.launcher.primaryCard ? m.launcher.primaryCard.bg === 'rgb(0, 113, 227)' : false, 'rgb(0, 113, 227)', m.launcher.primaryCard ? m.launcher.primaryCard.bg : 'missing')
        soft('05-launcher', '启动器含「打开已有工作区 / 创建新工作区」', m.launcher.text.includes('打开已有工作区') && m.launcher.text.includes('创建新工作区'), '两操作卡可见', m.launcher.text.slice(0, 160))
      }
      await shot(page, '05-launcher-1440x900')
      await context.close()
    }

    // ---------- D. 1024×800：侧栏抽屉 ----------
    currentShot = 'D-1024'
    {
      const { context, page } = await newContext('D-1024', { viewport: { width: 1024, height: 800 }, deviceScaleFactor: 1 })
      await seedLastArticle(page)
      await openArticle(page, baseUrl)
      let m = await measure(page)
      eq('07-drawer', '<1280 默认侧栏收起（抽屉）', m.hasSidebar, false)
      const drawerBefore = m.fileDrawer
      soft('07-drawer', '命令条「文件与导航」按钮可见（display:grid）', drawerBefore ? drawerBefore.display === 'grid' : false, 'display: grid', drawerBefore ? JSON.stringify(drawerBefore) : 'missing')
      const paperCenterBefore = m.paper ? m.paper.cx : null
      if (m.paper) {
        near('07-drawer', '1024 纸面仍居中（中心=512）', m.paper.cx, 512, 2)
        near('07-drawer', '1024 纸面宽 860', m.paper.w, T.paperW, 1.5)
      }
      near('07-drawer', '抽屉模式下主体区无左右留白', parseFloat(m.bodyRowPadding?.left || 'NaN'), 0, 0.5)
      if (drawerBefore) {
        await page.click(SELECTORS.drawerBtn, { timeout: DEFAULT_TIMEOUTS.click })
        await page.waitForTimeout(800)
      } else {
        // 兜底：用快捷键开抽屉
        await ensureDrawerOpen(page)
      }
      m = await measure(page)
      if (m.sidebar) {
        near('07-drawer', '抽屉浮层宽 256', m.sidebar.w, T.sidebarW, 1)
        near('07-drawer', '抽屉浮层 left:10', m.sidebar.x, 10, 1)
        eq('07-drawer', '抽屉浮层圆角 18', m.sidebar.radius, '18px')
        soft('07-drawer', '抽屉遮罩可见', m.drawerScrim ? m.drawerScrim.display !== 'none' : false, '遮罩存在', m.drawerScrim ? JSON.stringify(m.drawerScrim) : 'missing')
        near('07-drawer', '禁止回退：抽屉开合纸面中心不动', m.paper ? m.paper.cx : NaN, paperCenterBefore, 1)
      } else {
        eq('07-drawer', '抽屉已打开（.focus-files-bar 可见）', false, true)
      }
      await shot(page, '07-editor-drawer-1024x800')
      await context.close()
    }

    // ---------- E. 800×900 窄屏 ----------
    currentShot = 'E-800'
    {
      const { context, page } = await newContext('E-800', { viewport: { width: 800, height: 900 }, deviceScaleFactor: 1 })
      await seedLastArticle(page)
      await openArticle(page, baseUrl)
      const m = await measure(page)
      if (m.paper) {
        near('08-narrow', '800 纸面 = min(860,100%) = 800', m.paper.w, 800, 2)
        near('08-narrow', '800 纸面居中（中心=400）', m.paper.cx, 400, 2)
        soft('08-narrow', '800 > 760：纸面仍保留圆角（≤760 才去圆角，HANDOFF §2.3）', m.paper.radius === '18px', '18px（800 档）', m.paper.radius)
      }
      if (m.bar) near('08-narrow', '≤960：命令条宽 = 100%-20px = 780', m.bar.w, 780, 2)
      eq('08-narrow', '<1280：默认侧栏收起', m.hasSidebar, false)
      if (m.fileDrawer) eq('08-narrow', '窄屏命令条出现文件抽屉按钮', m.fileDrawer.display, 'grid')
      soft('08-narrow', '窄屏正文可读（阅读列 ≤ 窗口宽）', m.prose ? m.prose.w <= 800 : false, '≤800', m.prose ? m.prose.w : 'missing')
      await shot(page, '08-editor-narrow-800x900')
      await context.close()
    }
  } finally {
    await browser.close().catch(() => {})
    stopVite(vite)
  }

  // ---------------------------------------------------------------------------
  // 证据落盘
  // ---------------------------------------------------------------------------
  const checkPass = checks.filter((c) => c.ok).length
  const checkFail = checks.filter((c) => !c.ok)
  const meta = {
    generatedAt: new Date().toISOString(),
    durationSec: round1((Date.now() - t0) / 1000),
    repo: REPO_ROOT,
    git,
    baseUrl,
    backend: { url: BACKEND_URL, started: backend.started },
    vite: { url: baseUrl, started: vite.started, reused: vite.reused, port: vite.port || PREFERRED_VITE_PORT },
    playwrightCore: pwFrom,
    chromium: chromePath,
    ldLibraryPath: process.env.LD_LIBRARY_PATH,
    shots: captured,
    failures,
    diagnostics: pageDiagnostics,
  }
  const metrics = {
    generatedAt: meta.generatedAt,
    thresholds: T,
    checks,
    summary: { total: checks.length, pass: checkPass, fail: checkFail.length },
  }
  fs.writeFileSync(path.join(SHOTS_DIR, 'run-meta.json'), JSON.stringify(meta, null, 2))
  fs.writeFileSync(path.join(SHOTS_DIR, 'metrics.json'), JSON.stringify(metrics, null, 2))

  const lines = []
  lines.push('# Focus 视觉验收 · 运行摘要（verify-ui.cjs 自动生成）')
  lines.push('')
  lines.push(`- 时间：${meta.generatedAt}（耗时 ${meta.durationSec}s）`)
  lines.push(`- 仓库：${meta.repo}`)
  lines.push(`- git：${git.branch || '?'} @ ${git.head || '?'}（脏文件 ${git.dirty ?? '?'} 个）`)
  lines.push(`- 前端：${baseUrl}（${vite.started ? `脚本独立拉起 pid=${vite.pid}` : '复用现有 dev server'}）`)
  lines.push(`- 后端：${BACKEND_URL}（${backend.started ? '脚本自动拉起' : '复用现有'}）`)
  lines.push(`- 截图：${captured.length} 张 → ${SHOTS_DIR}/`)
  lines.push('')
  lines.push(`## 断言：${checkPass}/${checks.length} PASS，${checkFail.length} DIFF`)
  lines.push('')
  if (checkFail.length) {
    lines.push('| 截图 | 断言 | 期望 | 实际 | 备注 |')
    lines.push('|---|---|---|---|---|')
    for (const c of checkFail) lines.push(`| ${c.shot} | ${c.name} | ${c.expected} | ${c.actual} | ${(c.note || '').replace(/\|/g, '/')} |`)
    lines.push('')
  }
  lines.push('## 截图清单')
  lines.push('')
  for (const s of captured) lines.push(`- \`${s.file}\`（${s.viewport.width}×${s.viewport.height}）`)
  lines.push('')
  if (failures.length) {
    lines.push('## 失败阶段')
    lines.push('')
    for (const f of failures) lines.push(`- **${f.stage}**：${f.message}`)
    lines.push('')
  }
  const consoleErrors = pageDiagnostics.flatMap((d) => d.consoleErrors)
  const uniqConsole = [...new Set(consoleErrors)].slice(0, 15)
  if (uniqConsole.length) {
    lines.push('## 控制台错误（去重前 15 条，环境噪声也可能包含在内）')
    lines.push('')
    for (const e of uniqConsole) lines.push(`- ${String(e).replace(/\n/g, ' ').slice(0, 240)}`)
    lines.push('')
  }
  const reqFails = [...new Set(pageDiagnostics.flatMap((d) => d.requestFailures))].slice(0, 15)
  if (reqFails.length) {
    lines.push('## 请求失败（4xx/5xx，去重前 15 条）')
    lines.push('')
    for (const e of reqFails) lines.push(`- ${e}`)
    lines.push('')
  }
  fs.writeFileSync(path.join(SHOTS_DIR, 'summary.md'), lines.join('\n'))

  console.log('')
  console.log('==================== 结果 ====================')
  console.log(`截图：${captured.length} 张 → ${SHOTS_DIR}/`)
  console.log(`断言：${checkPass}/${checks.length} PASS，${checkFail.length} DIFF`)
  if (checkFail.length) {
    console.log('DIFF 明细（默认不改变退出码；设 KE_STRICT=1 可让 DIFF 判红）：')
    for (const c of checkFail.slice(0, 40)) console.log(`  - [${c.shot}] ${c.name}: 期望 ${c.expected} / 实际 ${c.actual}`)
  }
  if (failures.length) {
    console.log(`失败阶段 ${failures.length} 个：`)
    for (const f of failures) console.log(`  - ${f.stage}: ${f.message}`)
  }
  console.log(`证据：${path.join(SHOTS_DIR, 'summary.md')} · ${path.join(SHOTS_DIR, 'metrics.json')} · ${path.join(SHOTS_DIR, 'run-meta.json')}`)
  const exitBad = failures.length > 0 || (STRICT && checkFail.length > 0)
  if (exitBad) {
    console.log(`退出码 1（${failures.length ? '有截图阶段失败' : ''}${STRICT && checkFail.length ? ' KE_STRICT 下存在 DIFF' : ''}）`)
    process.exitCode = 1
  } else {
    console.log('退出码 0（截图全部产出）')
  }
}

main().catch((e) => {
  console.error('')
  console.error('==================== 致命错误 ====================')
  console.error(e && e.stack ? e.stack : String(e))
  console.error(`复跑：从仓库根执行  node docs/focus-ui/verify-ui.cjs`)
  console.error(`日志目录：${SHOTS_DIR}`)
  process.exit(1)
})
