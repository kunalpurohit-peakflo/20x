import { Check } from 'lucide-react'
import { SettingsSection } from '../SettingsSection'
import { useThemeStore, type ThemeMode } from '@/stores/theme-store'
import { THEME_PACKS } from '@shared/theme-packs'
import { cn } from '@/lib/utils'

const MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

export function AppearanceSettings() {
  const pack = useThemeStore((s) => s.pack)
  const setPack = useThemeStore((s) => s.setPack)
  const mode = useThemeStore((s) => s.mode)
  const resolved = useThemeStore((s) => s.resolved)
  const setMode = useThemeStore((s) => s.setMode)

  return (
    <SettingsSection title="Appearance" description="Pick a theme package and whether it shows in light or dark.">
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Theme package" className="grid grid-cols-2 gap-3">
          {THEME_PACKS.map((option) => {
            const selected = option.id === pack
            const [ground, surface, accent] = option.swatches[resolved]
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPack(option.id)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer',
                  selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                )}
              >
                <span aria-hidden="true" className="flex h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border">
                  <span className="flex-1" style={{ background: ground }} />
                  <span className="flex-1" style={{ background: surface }} />
                  <span className="flex-1" style={{ background: accent }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {option.name}
                    {selected && <Check className="h-3.5 w-3.5 text-primary" />}
                  </span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between py-2">
          <span id="appearance-mode-label" className="text-sm font-medium">Mode</span>
          <div
            role="radiogroup"
            aria-labelledby="appearance-mode-label"
            className="inline-flex gap-1 rounded-lg border border-border bg-muted p-1"
          >
            {MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={mode === option.value}
                onClick={() => setMode(option.value)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors cursor-pointer',
                  mode === option.value ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}
