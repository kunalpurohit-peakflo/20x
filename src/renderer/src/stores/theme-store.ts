import { create } from 'zustand'
import {
  DEFAULT_THEME_PACK,
  THEME_PACK_STORAGE_KEY,
  isThemePackId,
  type ThemePackId
} from '@shared/theme-packs'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'ui-theme'

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode
}

function applyMode(mode: ThemeMode): 'light' | 'dark' {
  const resolved = resolveMode(mode)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  return resolved
}

/** Legacy carries no attribute, so its tokens are exactly the defaults. */
function applyPack(pack: ThemePackId): void {
  const root = document.documentElement
  if (pack === DEFAULT_THEME_PACK) root.removeAttribute('data-theme-pack')
  else root.setAttribute('data-theme-pack', pack)
}

interface ThemeState {
  /** User preference: explicit light/dark or follow the OS. */
  mode: ThemeMode
  /** The concrete theme currently painted. */
  resolved: 'light' | 'dark'
  /** Which theme package styles the app. */
  pack: ThemePackId
  setMode: (mode: ThemeMode) => void
  /** Flip between light and dark, pinning an explicit preference. */
  toggle: () => void
  setPack: (pack: ThemePackId) => void
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

const initialMode: ThemeMode = (readStorage(STORAGE_KEY) as ThemeMode | null) ?? 'dark'
const storedPack = readStorage(THEME_PACK_STORAGE_KEY)
const initialPack: ThemePackId = isThemePackId(storedPack) ? storedPack : DEFAULT_THEME_PACK

export const useThemeStore = create<ThemeState>((set, get) => {
  // Apply immediately (the index.html pre-paint script already set the class to
  // avoid FOUC — this keeps the store authoritative once JS boots).
  const resolved = applyMode(initialMode)
  applyPack(initialPack)

  // Keep "system" mode reactive to OS-level changes.
  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (get().mode === 'system') {
        set({ resolved: applyMode('system') })
      }
    })
  }

  return {
    mode: initialMode,
    resolved,
    pack: initialPack,
    setMode: (mode) => {
      writeStorage(STORAGE_KEY, mode)
      set({ mode, resolved: applyMode(mode) })
    },
    toggle: () => {
      const next: ThemeMode = get().resolved === 'dark' ? 'light' : 'dark'
      writeStorage(STORAGE_KEY, next)
      set({ mode: next, resolved: applyMode(next) })
    },
    setPack: (pack) => {
      writeStorage(THEME_PACK_STORAGE_KEY, pack)
      applyPack(pack)
      set({ pack })
    }
  }
})
