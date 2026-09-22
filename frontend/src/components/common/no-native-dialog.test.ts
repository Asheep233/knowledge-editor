/**
 * 回归守卫：**禁止在源码中使用原生 `window.confirm` / `window.prompt`**。
 *
 * 根因（2026-09-15 实测查明）：
 * - `window.confirm`：Tauri v2 把它替换成 async 函数
 *   `async function(i){ return await invoke("plugin:dialog|confirm", {...}) }`
 *   → **恒返回 Promise（truthy）**，而原写法 `if (!window.confirm(...)) return` 判定永为假
 *   → **确认被静默绕过**（删文档/删文件夹/彻底删除/清空/丢弃未保存修改都不问就执行）。
 *   叠加 `capabilities/default.json` 的 `dialog:default` 不含 `allow-confirm`
 *   （实测只授予 allow-message / allow-save / allow-open）→ 返回 rejected Promise，
 *   **仍是 truthy**，同样被绕过。
 * - `window.prompt`：WebView2 下为原生实现，输入值不返回（v1.1.1「新建文件夹」曾因此"点了没反应"）。
 *
 * 统一改用 `components/common/PromptDialog` 的 `askConfirm` / `askPrompt`（自绘、Promise、可测）。
 * 本测试在 CI 即拦截回退。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..')

/** 去掉块注释与行注释，避免把说明文字里的 window.confirm 误判 */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

describe('不得使用原生对话框（Tauri/WebView2 下行为不可靠）', () => {
  // 2026-09-22（verifier 上报的门禁敏感点）：原实现每个用例都对 136 个文件**同步读盘**，
  // 高负载下实测 9.8s > vitest 默认 5s 超时 → 假红（判据本身没问题）。
  // 改为「一次收集 + 每文件只读一次盘并缓存」+ 显式 20s 超时。
  const files = walk(SRC).filter((f) => !/\.test\.(ts|tsx)$/.test(f))
  const FILE_CACHE = new Map<string, string>()
  const readSource = (f: string): string => {
    let cached = FILE_CACHE.get(f)
    if (cached === undefined) {
      cached = stripComments(readFileSync(f, 'utf-8'))
      FILE_CACHE.set(f, cached)
    }
    return cached
  }

  it('源码中不得出现 window.confirm（改用 askConfirm + await）', () => {
    const hits: string[] = []
    for (const f of files) {
      const code = readSource(f)
      if (/window\.confirm\s*\(/.test(code)) hits.push(f.replace(SRC, 'src'))
    }
    expect(hits, '发现原生 window.confirm —— Tauri 下恒返回 Promise(truthy)，确认会被静默绕过；请改用 askConfirm').toEqual([])
  }, 20000)

  it('源码中不得出现 window.prompt（改用 askPrompt + await）', () => {
    const hits: string[] = []
    for (const f of files) {
      const code = readSource(f)
      if (/window\.prompt\s*\(/.test(code)) hits.push(f.replace(SRC, 'src'))
    }
    expect(hits, '发现原生 window.prompt —— WebView2 下输入值不返回；请改用 askPrompt').toEqual([])
  }, 20000)

  it('不得把 Promise 当布尔用（必须 await 后再取反/赋值）', () => {
    // 真正的回归风险是「把返回的 Promise 当布尔用」：
    //   if (!askConfirm(...))       ← Promise 恒真，确认被绕过
    //   const ok = askConfirm(...)  ← 同上
    // 而 `return askConfirm(...)`（async 函数内）+ 调用方 await 是正确写法，不拦。
    const hits: string[] = []
    for (const f of files) {
      const code = readSource(f)
      for (const re of [/!\s*(?:\(\s*)?ask(?:Confirm|Prompt)\s*\(/g, /=\s*ask(?:Confirm|Prompt)\s*\(/g]) {
        for (const m of code.matchAll(re)) {
          hits.push(`${f.replace(SRC, 'src')} :: ...${m[0]}`)
        }
      }
    }
    expect(hits, 'askConfirm/askPrompt 的返回值被当布尔用（Promise 恒真）—— 必须 await').toEqual([])
  }, 20000)
})
