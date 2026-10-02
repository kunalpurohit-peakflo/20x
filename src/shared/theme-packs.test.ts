import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_PACK, THEME_PACKS, isThemePackId } from './theme-packs'

const css = readFileSync(resolve(__dirname, '../renderer/src/styles/theme-packs.css'), 'utf8')

describe('theme packages', () => {
  it('keeps Legacy as the default', () => {
    expect(DEFAULT_THEME_PACK).toBe('legacy')
    expect(THEME_PACKS[0].id).toBe('legacy')
  })

  it('recognises only known packages', () => {
    expect(isThemePackId('calm')).toBe(true)
    expect(isThemePackId('legacy')).toBe(true)
    expect(isThemePackId('neon')).toBe(false)
    expect(isThemePackId(null)).toBe(false)
  })

  it('gives every package except Legacy a light and a dark block in the stylesheet', () => {
    for (const pack of THEME_PACKS.filter((p) => p.id !== 'legacy')) {
      expect(css).toContain(`:root[data-theme-pack="${pack.id}"] {`)
      expect(css).toContain(`:root.dark[data-theme-pack="${pack.id}"] {`)
    }
    expect(css).not.toContain('data-theme-pack="legacy"')
  })
})
