import type { Label, ShortcutSettings } from './types'

export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  previous_image: 'ArrowLeft',
  next_image: 'ArrowRight',
  submit: 'Space',
}

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'])

function normalizedKey(value: string): string {
  if (value === ' ' || value === 'Spacebar') return 'Space'
  if (/^[a-z]$/i.test(value)) return `Key${value.toUpperCase()}`
  if (/^[0-9]$/.test(value)) return `Digit${value}`
  return value
}

export function normalizeShortcut(value: string): string {
  const parts = value.trim().split('+').filter(Boolean)
  if (!parts.length) return ''
  const key = normalizedKey(parts.pop()!)
  const modifiers = ['Control', 'Alt', 'Shift', 'Meta'].filter(modifier => parts.includes(modifier) || parts.includes(modifier === 'Control' ? 'Ctrl' : modifier))
  return [...modifiers, key].join('+')
}

export function shortcutFromEvent(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null
  const modifiers = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter(Boolean) as string[]
  return [...modifiers, event.code].join('+')
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const expected = normalizeShortcut(shortcut)
  const actual = shortcutFromEvent(event)
  if (!actual) return false
  if (actual === expected) return true
  const digit = expected.match(/^Digit([0-9])$/)
  return !!digit && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.key === digit[1]
}

export function displayShortcut(shortcut: string): string {
  return normalizeShortcut(shortcut).split('+').map(part => {
    if (part === 'Control') return 'Ctrl'
    if (part === 'ArrowLeft') return '←'
    if (part === 'ArrowRight') return '→'
    if (part === 'ArrowUp') return '↑'
    if (part === 'ArrowDown') return '↓'
    if (part === 'Space') return 'Space'
    if (part.startsWith('Key')) return part.slice(3)
    if (part.startsWith('Digit')) return part.slice(5)
    if (part.startsWith('Numpad')) return `Num ${part.slice(6)}`
    return part
  }).join(' + ')
}

export function resolveShortcuts(settings?: Partial<ShortcutSettings>): ShortcutSettings {
  return { ...DEFAULT_SHORTCUTS, ...settings }
}

export function labelShortcut(label: Label, index: number): string {
  return label.shortcut?.trim() || (index < 9 ? String(index + 1) : '')
}
