import { describe, expect, it } from 'vitest'
import { APPEARANCE_CONTRACT, EXAMPLE_APPEARANCE, validateAppearance } from './model'

const base = { schemaVersion: 1, appearanceApi: 1, id: 'test-theme', name: 'Test theme', version: '1.0.0' }

describe('appearance package contract', () => {
  it('accepts a minimal package and normalizes colors without mutating input', () => {
    const input = { ...base, tokens: { light: { primary: '#AbC' }, dark: { background: '#123ABC' } } }
    const result = validateAppearance(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.package.tokens).toEqual({ light: { primary: '#aabbcc' }, dark: { background: '#123abc' } })
    expect(input.tokens.light.primary).toBe('#AbC')
    expect(validateAppearance(JSON.stringify(base))).toEqual({ ok: true, package: base })
  })

  it('rejects arbitrary CSS, scripts, unknown tokens and nested fields atomically', () => {
    for (const patch of [
      { css: 'button{display:none}' },
      { script: 'window.alert(1)' },
      { tokens: { light: { primary: 'red;display:none' } } },
      { tokens: { light: { primary: 'var(--x)' } } },
      { tokens: { light: { primary: '#11223344' } } },
      { tokens: { light: { display: '#ffffff' } } },
      { tokens: { light: { primary: { css: '#fff' } } } },
      { metrics: { sidebarWidth: '280px' } },
      { layout: { navigationSide: 'right', hidden: true } },
      { font: 'url(https://example.com/font)' },
    ]) {
      const result = validateAppearance({ ...base, ...patch })
      expect(result.ok, JSON.stringify(patch)).toBe(false)
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
    }
    expect(validateAppearance('{"schemaVersion":1,"appearanceApi":1,"id":"a","name":"a","version":"1.0.0","__proto__":{"css":"x"}}').ok).toBe(false)
  })

  it('does not execute accessors or silently discard functions', () => {
    let accessed = false
    const input = { ...base, get css() { accessed = true; return '' } }
    expect(validateAppearance(input).ok).toBe(false)
    expect(accessed).toBe(false)
    expect(validateAppearance({ ...base, css: () => 'anything' }).ok).toBe(false)
    const cyclic: Record<string, unknown> = { ...base }
    cyclic.child = cyclic
    expect(validateAppearance(cyclic).ok).toBe(false)
  })

  it('requires supported API/schema versions and bounded metadata', () => {
    for (const patch of [
      { schemaVersion: 2 }, { appearanceApi: 2 }, { id: '<script>' },
      { id: 'UPPERCASE' }, { name: ' ' }, { name: 'x'.repeat(81) },
      { name: 'line\nbreak' }, { version: 'latest' }, { version: '1.2' },
    ]) expect(validateAppearance({ ...base, ...patch }).ok).toBe(false)
    expect(validateAppearance({ ...base, version: '1.2.3-beta.1+build.2' }).ok).toBe(true)
  })

  it('bounds every metric and rejects non-finite numbers', () => {
    for (const [key, bounds] of Object.entries(APPEARANCE_CONTRACT.bounds)) {
      for (const value of [bounds.min, bounds.max]) {
        expect(validateAppearance({ ...base, metrics: { [key]: value } }).ok).toBe(true)
      }
      for (const value of [bounds.min - 0.1, bounds.max + 0.1, NaN, Infinity, -Infinity, null]) {
        expect(validateAppearance({ ...base, metrics: { [key]: value } }).ok).toBe(false)
      }
    }
  })

  it('measures the 64 KiB limit as UTF-8 bytes and reports malformed JSON', () => {
    expect(validateAppearance(' '.repeat(APPEARANCE_CONTRACT.maxBytes) + '{}').ok).toBe(false)
    expect(validateAppearance({ ...base, name: '中'.repeat(22000) }).ok).toBe(false)
    expect(validateAppearance('{').ok).toBe(false)
    expect(validateAppearance('[]').ok).toBe(false)
    expect(validateAppearance(null).ok).toBe(false)
  })

  it('ships a valid example covering all documented palette tokens in both modes', () => {
    expect(validateAppearance(EXAMPLE_APPEARANCE).ok).toBe(true)
    expect(Object.keys(EXAMPLE_APPEARANCE.tokens!.light!).sort()).toEqual([...APPEARANCE_CONTRACT.tokens].sort())
    expect(Object.keys(EXAMPLE_APPEARANCE.tokens!.dark!).sort()).toEqual([...APPEARANCE_CONTRACT.tokens].sort())
  })
})
