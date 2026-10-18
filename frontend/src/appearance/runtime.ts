import { validateAppearance, type AppearanceFont, type AppearancePackage, type TokenName } from './model'

export const APPEARANCE_STYLE_ID = 'ke-appearance-style'
const CHROME = '[data-ke-appearance-scope="chrome"]'
const SLOT = (name: string): string => `[data-ke-slot="${name}"]`
const FONT_STACKS: Record<AppearanceFont, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  sans: '"DM Sans", "Segoe UI", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: '"Noto Serif SC", "Songti SC", "SimSun", Georgia, serif',
  mono: '"Cascadia Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

function paletteRule(mode: 'light' | 'dark', tokens: Partial<Record<TokenName, string>> | undefined): string {
  if (!tokens || !Object.keys(tokens).length) return ''
  const declarations = Object.entries(tokens).map(([name, value]) => `--${name}:${value};`)
  // Derived variables must be resolved in this scope, rather than inherited after root computation.
  if (tokens.primary) declarations.push('--primary-hover:color-mix(in srgb,var(--primary) 86%,#000000);', '--primary-soft:color-mix(in srgb,var(--primary) 12%,var(--background));', '--sidebar-primary:var(--primary);', '--ke-accent:var(--primary);')
  if (tokens['primary-foreground']) declarations.push('--sidebar-primary-foreground:var(--primary-foreground);')
  if (tokens.ring) declarations.push('--sidebar-ring:var(--ring);')
  if (tokens.background) declarations.push('--ke-bg:var(--background);')
  if (tokens.border) declarations.push('--ke-border:var(--border);')
  return `[data-theme="${mode}"] ${CHROME}{${declarations.join('')}}`
}

/** Produce only host-owned rules; no package text is interpreted as a selector or declaration. */
function stylesheet(pkg: AppearancePackage): string {
  const rules = [paletteRule('light', pkg.tokens?.light), paletteRule('dark', pkg.tokens?.dark)]
  const metrics = pkg.metrics
  if (pkg.font) {
    rules.push(`${CHROME}{font-family:${FONT_STACKS[pkg.font]};}`)
    rules.push(`${CHROME} :is(button,input,select,textarea){font-family:inherit;}`)
  }
  if (metrics?.controlRadius !== undefined) {
    rules.push(`${CHROME} :is(button,input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]),select,textarea){border-radius:${metrics.controlRadius}px;}`)
  }
  if (metrics?.uiFontSize !== undefined) {
    const size = metrics.uiFontSize
    const ratio = Number((size / 13).toFixed(6))
    rules.push(`${CHROME}{font-size:${size}px;}`)
    rules.push(`${CHROME} :is(button,input,select,textarea){font-size:inherit;}`)
    // Existing labels use explicit Tailwind sizes. Scale those known typography classes
    // without changing icon dimensions, editable content, line heights or layout boxes.
    for (const px of [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32]) {
      const utility = `.text-\\[${px}px\\]`
      rules.push(`${CHROME}${utility},${CHROME} ${utility}{font-size:calc(${px}px * ${ratio});}`)
    }
    for (const [utility, px] of [['text-xs', 12], ['text-sm', 14], ['text-base', 16], ['text-lg', 18], ['text-xl', 20]] as const) {
      rules.push(`${CHROME}.${utility},${CHROME} .${utility}{font-size:calc(${px}px * ${ratio});}`)
    }
  }
  if (metrics?.sidebarWidth !== undefined) {
    rules.push(`${SLOT('shell-navigation')}${CHROME}{width:min(${metrics.sidebarWidth}px,30vw);min-width:0;}`)
  }
  if (metrics?.inspectorWidth !== undefined) {
    // The same shell slot also hosts the narrow reopen control when collapsed.
    // Only the expanded RightPanel owns an inner <aside>; the outer slot must
    // size from its current contents so collapsing still frees editor space.
    rules.push(`${SLOT('shell-inspector')}${CHROME}>aside{width:min(${metrics.inspectorWidth}px,32vw);min-width:0;}`)
  }
  if (pkg.layout?.navigationSide === 'right') {
    rules.push(`${SLOT('shell-body')}>${SLOT('shell-main')}{order:1;}`)
    rules.push(`${SLOT('shell-body')}>${SLOT('shell-inspector')}${CHROME}{order:2;}`)
    rules.push(`${SLOT('shell-body')}>${SLOT('shell-navigation')}${CHROME}{order:3;}`)
  }
  return rules.filter(Boolean).join('\n')
}

/**
 * Presentation is screen-only and confined to explicitly marked application chrome.
 * No document root variables, editor state, event handlers or DOM structure are changed.
 */
export function renderAppearance(pkg: AppearancePackage | null): void {
  if (typeof document === 'undefined') return
  document.getElementById(APPEARANCE_STYLE_ID)?.remove()
  document.documentElement.removeAttribute('data-ke-appearance-active')
  if (!pkg) return
  const validation = validateAppearance(pkg)
  if (!validation.ok) return
  const style = document.createElement('style')
  style.id = APPEARANCE_STYLE_ID
  style.media = 'screen'
  style.textContent = stylesheet(validation.package)
  document.head.appendChild(style)
  document.documentElement.setAttribute('data-ke-appearance-active', validation.package.id)
}
