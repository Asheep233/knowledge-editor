// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { EXAMPLE_APPEARANCE, type AppearancePackage } from './model'
import { APPEARANCE_STYLE_ID, renderAppearance } from './runtime'

afterEach(() => {
  renderAppearance(null)
  document.body.replaceChildren()
})

function style(): HTMLStyleElement {
  return document.getElementById(APPEARANCE_STYLE_ID) as HTMLStyleElement
}

describe('appearance rendering isolation', () => {
  it('creates one screen-only style and never writes root CSS variables', () => {
    const originalStyle = document.documentElement.getAttribute('style')
    renderAppearance(EXAMPLE_APPEARANCE)
    expect(style().media).toBe('screen')
    expect(document.documentElement.dataset.keAppearanceActive).toBe(EXAMPLE_APPEARANCE.id)
    expect(document.documentElement.getAttribute('style')).toBe(originalStyle)
    const css = style().textContent ?? ''
    expect(css).toContain('[data-theme="light"] [data-ke-appearance-scope="chrome"]')
    expect(css).toContain('[data-theme="dark"] [data-ke-appearance-scope="chrome"]')
    expect(css).not.toMatch(/:root|@import|@page|@font-face|url\(|\.ke-editor-prose|\.katex|\.ke-print-surface/)
    renderAppearance({ ...EXAMPLE_APPEARANCE, id: 'another-theme' })
    expect(document.querySelectorAll(`#${APPEARANCE_STYLE_ID}`)).toHaveLength(1)
    expect(document.documentElement.dataset.keAppearanceActive).toBe('another-theme')
  })

  it('keeps editor nodes, values and event handlers intact when applying, replacing and resetting', () => {
    document.body.innerHTML = '<div data-ke-slot="shell-root"><aside data-ke-slot="shell-navigation" data-ke-appearance-scope="chrome"><button>Save</button></aside><main data-ke-slot="shell-main"><div contenteditable="true" class="ke-editor-prose">Document</div><textarea>Raw markdown</textarea><div class="ke-print-surface">Preview</div></main></div>'
    const editor = document.querySelector('.ke-editor-prose')!
    const source = document.querySelector('textarea')!
    const button = document.querySelector('button')!
    let clicks = 0
    button.addEventListener('click', () => clicks++)
    renderAppearance(EXAMPLE_APPEARANCE)
    renderAppearance({ ...EXAMPLE_APPEARANCE, layout: { navigationSide: 'right' } })
    renderAppearance(null)
    expect(document.querySelector('.ke-editor-prose')).toBe(editor)
    expect(document.querySelector('textarea')).toBe(source)
    expect(editor.textContent).toBe('Document')
    expect(source.value).toBe('Raw markdown')
    button.click()
    expect(clicks).toBe(1)
    expect(style()).toBeNull()
    expect(document.documentElement.hasAttribute('data-ke-appearance-active')).toBe(false)
  })

  it('only emits host-controlled geometry, responsive widths and control typography', () => {
    renderAppearance({ ...EXAMPLE_APPEARANCE, layout: { navigationSide: 'right' } })
    const css = style().textContent ?? ''
    expect(css).toContain('width:min(280px,30vw)')
    expect(css).toContain('width:min(300px,32vw)')
    expect(css).toContain('[data-ke-slot="shell-navigation"][data-ke-appearance-scope="chrome"]{order:3;}')
    expect(css).toContain('border-radius:8px;')
    expect(css).not.toMatch(/display:|visibility:|pointer-events:|z-index:|position:|content:|overflow:/)
    expect(css).not.toMatch(/\*\s*\{/)
  })

  it('applies inspector width only to the expanded panel and preserves the narrow reopen control', () => {
    // AppShell retains its outer aside in both App.rightOpen branches. The
    // collapsed branch is a w-6 div; only RightPanel renders the inner aside.
    document.body.innerHTML = '<div data-ke-slot="shell-body"><main data-ke-slot="shell-main"></main><aside data-ke-slot="shell-inspector" data-ke-appearance-scope="chrome"><div class="flex h-full w-6 shrink-0 flex-col items-center border-l"><button title="展开属性栏">Open</button></div></aside></div>'
    const shellInspector = document.querySelector<HTMLElement>('[data-ke-slot="shell-inspector"]')!
    const reopenControl = shellInspector.querySelector('div')!
    const reopenButton = shellInspector.querySelector('button')!
    let opened = false
    reopenButton.addEventListener('click', () => { opened = true })
    renderAppearance(EXAMPLE_APPEARANCE)
    // Happy DOM drops min() widths when parsing declarations. Match the emitted
    // geometry selectors against the real DOM instead of relying on layout.
    const widthRules = [...(style().textContent ?? '').matchAll(/([^{}]+)\{([^{}]+)\}/g)]
      .filter((match) => /(?:^|;)width:/.test(match[2]))
      .map((match) => ({ selectorText: match[1].trim(), declarations: match[2] }))
    // An accidental comma targeting the outer slot reintroduces the regression.
    const widthsFor = (element: Element) => widthRules.filter((rule) => element.matches(rule.selectorText))
    expect(widthsFor(shellInspector)).toHaveLength(0)
    expect(widthsFor(reopenControl)).toHaveLength(0)
    expect(widthsFor(reopenButton)).toHaveLength(0)
    reopenButton.click()
    expect(opened).toBe(true)
    shellInspector.innerHTML = '<aside class="flex h-full w-[300px] shrink-0 flex-col">Properties</aside>'
    const expandedPanel = shellInspector.firstElementChild!
    expect(widthsFor(expandedPanel)).toHaveLength(1)
    expect(widthsFor(expandedPanel)[0].declarations).toContain('width:min(300px,32vw)')
    expect(widthsFor(shellInspector)).toHaveLength(0)
  })

  it('rejects an unsafe caller and restores baseline rather than rendering injected content', () => {
    renderAppearance(EXAMPLE_APPEARANCE)
    const invalid = { ...EXAMPLE_APPEARANCE, tokens: { light: { primary: '#fff;}body{display:none' } } } as AppearancePackage
    renderAppearance(invalid)
    expect(style()).toBeNull()
    expect(document.documentElement.hasAttribute('data-ke-appearance-active')).toBe(false)
  })
})
