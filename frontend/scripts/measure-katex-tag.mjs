#!/usr/bin/env node
/**
 * task-60：`\tag` 标签与公式本体是否重叠 —— **真实 Chromium 布局**测量脚本。
 *
 * 为什么不用 jsdom：jsdom 不做布局，所有 rect 恒为 0，无法判定相交。
 * 本脚本用 Playwright 缓存里的 Chromium（`--dump-dom`）真实排版，页面里用
 * `getBoundingClientRect()` 量 `.katex-tag` 与公式本体 `.katex-base` 的矩形并判定相交。
 *
 * 用法：
 *   node scripts/measure-katex-tag.mjs            # 打印表格；有相交则 exit 1
 *   KE_CHROME=/path/to/chrome node scripts/...    # 指定浏览器
 *
 * 场景：列表项内（用户现场）/ 顶层块级 / 引用块内 / 表格单元格内 /
 *       行内 `\tag` / `align` 多 tag / 超长公式。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const katex = require('katex')

const ROOT = resolve(import.meta.dirname, '..')
const CHROME =
  process.env.KE_CHROME ||
  join(process.env.HOME ?? '/root', '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')

const indexCss = readFileSync(join(ROOT, 'src/index.css'), 'utf8')

/** KaTeX 字体内联为 data URL：既避免 file:// 字体路径问题，也让 Windows Chrome 能正确排版 */
function inlinedKatexCss() {
  const raw = readFileSync(join(ROOT, 'node_modules/katex/dist/katex.min.css'), 'utf8')
  const fontDir = join(ROOT, 'node_modules/katex/dist/fonts')
  return raw.replace(/url\(fonts\/([^)]+)\)/g, (_m, name) => {
    const f = join(fontDir, name)
    if (!existsSync(f)) return `url(fonts/${name})`
    const b64 = readFileSync(f).toString('base64')
    const mime = name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.woff') ? 'font/woff' : 'font/ttf'
    return `url(data:${mime};base64,${b64})`
  })
}
const katexCss = inlinedKatexCss()

/** 浏览器解析：Linux Chromium（若系统库齐全）→ 否则 Windows Chrome/Edge（WSL 场景） */
function resolveBrowser() {
  const linux = process.env.KE_CHROME
  if (linux && existsSync(linux)) {
    try {
      execFileSync(linux, ['--version'], { stdio: 'pipe' })
      return { bin: linux, windows: false }
    } catch {
      /* 缺共享库 → 走 Windows 回退 */
    }
  }
  const win = [
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((p2) => existsSync(p2))
  if (win) return { bin: win, windows: true }
  return { bin: linux ?? '', windows: false }
}
const BROWSER = resolveBrowser()

/** Windows Chrome 需要 Windows 可读路径（\\wsl$ 有时不可用）→ 落 C:\Users\<u>\AppData\Local\Temp */
function pageDir() {
  if (!BROWSER.windows) return mkdtempSync(join(tmpdir(), 'ke-tag-'))
  const user = process.env.KE_WIN_USER || 'Asheep233'
  const winTmp = `/mnt/c/Users/${user}/AppData/Local/Temp`
  if (existsSync(winTmp)) return mkdtempSync(join(winTmp, 'ke-tag-'))
  return mkdtempSync(join(tmpdir(), 'ke-tag-'))
}

const LONG = 'a_0x^n+a_1x^{n-1}+\\cdots+a_{n-1}x+a_n=0 \\tag{2.2.2.1}'
const VERY_LONG =
  '\\sum_{i=1}^{n}\\lambda_i x_i + \\int_0^1 f(x)\\,dx + \\prod_{k=1}^{m}\\left(1+\\frac{1}{k}\\right) + \\lim_{n\\to\\infty}\\frac{1}{n}\\sum_{j=1}^{n}a_j = \\Phi \\tag{2.2.2.2}'

/** 复刻 MathNodeView 的 DOM：`.ke-math.ke-math--block > span.ke-math-render`(+ `.ke-math-tools`) */
function blockMath(latexHtml) {
  return `<span class="ke-math ke-math--block"><span class="ke-math-render">${latexHtml}</span><span class="ke-math-tools" data-ke-math-tools=""></span></span>`
}
function inlineMath(latexHtml) {
  return `<span class="ke-math ke-math--inline"><span class="ke-math-render">${latexHtml}</span></span>`
}
function render(latex, display) {
  return katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: false })
}

const scenarios = [
  {
    id: 'list-item',
    label: '列表项内块级公式（用户现场）',
    html: `<ol><li><p>如果复数 $x$ 满足多项式方程：</p>${blockMath(render(LONG, true))}</li></ol>`,
  },
  {
    id: 'top-level',
    label: '顶层块级公式（对照）',
    html: `<p>正文</p>${blockMath(render(LONG, true))}`,
  },
  {
    id: 'blockquote',
    label: '引用块内块级公式',
    html: `<blockquote><p>引理</p>${blockMath(render(LONG, true))}</blockquote>`,
  },
  {
    id: 'table-cell',
    label: '表格单元格内块级公式',
    html: `<table><tbody><tr><td>${blockMath(render(LONG, true))}</td></tr></tbody></table>`,
  },
  {
    id: 'inline-tag',
    label: '行内公式写 \\tag（边界）',
    html: `<p>正文 ${inlineMath(render('a=b \\tag{1}', false))} 结尾</p>`,
  },
  {
    id: 'align-multi',
    label: 'align 多 tag',
    html: `<p>正文</p>${blockMath(render('\\begin{aligned}a &= b \\tag{1}\\\\ c &= d \\tag{2}\\end{aligned}', true))}`,
  },
  {
    id: 'overflow',
    label: '超长公式（真溢出）',
    html: `<ol><li>${blockMath(render(VERY_LONG, true))}</li></ol>`,
  },
  // 窄容器：模拟真实编辑器在「右侧面板展开 / 窗口较窄 / 多级列表缩进」下的可用宽度
  ...([200, 280, 360, 460].map((w) => ({
    id: `narrow-${w}`,
    label: `列表项内 ${w}px 窄容器（用户现场等价）`,
    html: `<div style="width:${w}px"><ol><li><p>如果复数 $x$ 满足：</p>${blockMath(render(LONG, true))}</li></ol></div>`,
  }))),
  {
    // 公式编辑弹窗预览：`.ke-math-preview-body { overflow-x: auto }` → 宽度被约束，
    // 而 .katex-display > .katex 是 nowrap → 字形溢出盒子，tag 绝对定位 right:0 = 压在溢出字形上
    id: 'preview-modal',
    label: '公式弹窗预览（overflow-x:auto 约束宽度）',
    html: `<div style="display:flex;width:520px"><div class="ke-math-preview-body">${render(LONG, true)}</div></div>`,
  },
  {
    id: 'preview-modal-narrow',
    label: '公式弹窗预览 + 300px 容器',
    html: `<div style="display:flex;width:300px"><div class="ke-math-preview-body">${render(LONG, true)}</div></div>`,
  },
  {
    id: 'narrow-nested',
    label: '两级嵌套列表 + 300px 容器',
    html: `<div style="width:300px"><ol><li><p>外层</p><ol><li>${blockMath(render(LONG, true))}</li></ol></li></ol></div>`,
  },
]

const page = `<!doctype html><html><head><meta charset="utf-8">
<style>${katexCss}</style>
<style>${indexCss}</style>
<style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;width:760px}</style>
</head><body>
${scenarios.map((s) => `<div data-scenario="${s.id}">${s.html}</div>`).join('\n')}
<pre id="ke-result"></pre>
<script>
function rect(el){const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}
/**
 * 公式本体的视觉范围：KaTeX 0.18 把公式拆成多个 .katex-base 片段（每个顶层 atom 一个盒子），
 * querySelector 只取到第一个 → 必须取全部片段的并集。
 * 同时排除 .katex-tag（标签自身）与 .katex-mathml（隐藏 MathML 副本，1px 且位置无关）。
 */
function formulaExtent(box){
  const parts=[...box.querySelectorAll('.katex-base')];
  if(!parts.length) return null;
  let l=Infinity,rr=-Infinity,t=Infinity,b=-Infinity,found=0;
  for(const p of parts){
    if(p.closest('.katex-tag')) continue;
    for(const el of [p,...p.querySelectorAll('*')]){
      if(el.closest('.katex-tag')||el.closest('.katex-mathml')) continue;
      const q=el.getBoundingClientRect();
      if(q.width<=0&&q.height<=0) continue;
      l=Math.min(l,q.left);rr=Math.max(rr,q.right);t=Math.min(t,q.top);b=Math.max(b,q.bottom);found++;
    }
  }
  return found?{left:l,right:rr,top:t,bottom:b,width:rr-l,height:b-t,parts:parts.length,boxes:found}:null;
}
const out=[];
try {
for (const box of document.querySelectorAll('[data-scenario]')) {
  const tag=box.querySelector('.katex-tag');
  const body=box.querySelector('.katex-base')||box.querySelector('.katex-html');
  const render=box.querySelector('.ke-math-render');
  const wrap=box.querySelector('.ke-math');
  const r={id:box.dataset.scenario};
  if(!body){r.error='no .katex-base';out.push(r);continue}
  const vis=formulaExtent(box);
  r.body=vis||rect(body); r.bodyBox=rect(body); r.render=render?rect(render):null; r.wrap=wrap?rect(wrap):null;
  const disp=box.querySelector('.katex-display'), kx=box.querySelector('.katex'), htm=box.querySelector('.katex-html'), li=box.closest('li');
  r.chain={display:disp?rect(disp):null,katex:kx?rect(kx):null,html:htm?rect(htm):null,li:li?rect(li):null};
  if(tag){
    r.tag=rect(tag);
    r.tagPosition=getComputedStyle(tag).position;
    const a=r.tag,b=r.body;
    r.overlap=!(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);
    r.overlapX=Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left));
    r.gap=a.left-b.right;
    r.overlapY=Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    r.bodyOverflow=r.render? r.body.right>r.render.right+0.5 : null;
    r.tagOutsideRender=r.render? r.tag.right>r.render.right+0.5 : null;
  } else { r.tag=null; r.overlap=false }
  out.push(r);
}
} catch (e) { out.push({id:'__error__', error: String(e && e.stack || e)}) }
document.getElementById('ke-result').textContent=JSON.stringify(out);
</script></body></html>`

const dir = pageDir()
const file = join(dir, 'measure.html')
writeFileSync(file, page, 'utf8')

let url = `file://${file}`
if (BROWSER.windows) {
  // /mnt/c/Users/x/... → file:///C:/Users/x/...
  url = `file:///${file.replace(/^\/mnt\//, '').replace(/^([a-z])\//i, (_m, d) => `${d.toUpperCase()}:/`)}`
}
const dom = execFileSync(
  BROWSER.bin,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--virtual-time-budget=5000', '--dump-dom', url],
  { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
)

const m = /<pre id="ke-result">([\s\S]*?)<\/pre>/.exec(dom)
if (!m) {
  console.error('未能从 DOM 中取到测量结果（浏览器执行失败？）')
  process.exit(2)
}
const results = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))

console.log(`浏览器: ${BROWSER.bin}${BROWSER.windows ? '（Windows 回退）' : ''}`)
console.log('场景'.padEnd(30), 'tag.left', 'body.right(视觉)', 'tag-body 间距', '相交', 'X 重叠', 'Y 重叠')
let bad = 0
for (const r of results) {
  const label = (scenarios.find((s) => s.id === r.id)?.label ?? r.id).padEnd(28)
  if (r.error) {
    console.log(`${label} ERROR ${r.error}`)
    continue
  }
  if (r.overlap) bad += 1
  const f = (v) => (v === null || v === undefined ? '—' : v.toFixed(1))
  console.log(
    `${label} ${f(r.tag?.left).padStart(8)} ${f(r.body?.right).padStart(14)} ${f(r.gap).padStart(13)} ` +
      `${r.overlap ? ' ⚠ 是 ' : ' 否 '} ${f(r.overlapX).padStart(7)} ${f(r.overlapY).padStart(7)}`,
  )
}
if (process.env.KE_VERBOSE) {
  for (const r of results) {
    if (!r.chain) continue
    const g = (x) => (x ? `${x.left.toFixed(0)}..${x.right.toFixed(0)}(w${x.width.toFixed(0)})` : '—')
    console.log(`  [${r.id}] li=${g(r.chain.li)} display=${g(r.chain.display)} katex=${g(r.chain.katex)} html=${g(r.chain.html)} base=${g(r.body)} render=${g(r.render)} tag=${g(r.tag)}`)
  }
}
console.log(bad === 0 ? '\n✅ 全部场景 tag 与公式本体不相交' : `\n❌ ${bad} 个场景 tag 与公式本体重叠`)
process.exit(bad === 0 ? 0 : 1)
