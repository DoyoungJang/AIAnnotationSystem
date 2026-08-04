import { describe, expect, it } from 'vitest'
import { displayShortcut, labelShortcut, matchesShortcut, normalizeShortcut, resolveShortcuts, shortcutFromEvent } from './shortcuts'
import type { Label } from './types'

const event = (code: string, key = code): KeyboardEvent => ({ code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent)

describe('labeling shortcuts', () => {
  it('uses the requested defaults and merges stored user settings', () => {
    expect(resolveShortcuts()).toEqual({ previous_image: 'ArrowLeft', next_image: 'ArrowRight', submit: 'KeyS' })
    expect(resolveShortcuts({ submit: 'Enter' }).submit).toBe('Enter')
  })

  it('captures and displays physical keyboard shortcuts', () => {
    expect(shortcutFromEvent({ code: 'KeyD', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe('Control+KeyD')
    expect(normalizeShortcut('Ctrl+d')).toBe('Control+KeyD')
    expect(displayShortcut('Control+ArrowRight')).toBe('Ctrl + →')
  })

  it('matches arrows, letter shortcuts, space, top-row digits, and numpad digits', () => {
    expect(matchesShortcut(event('ArrowLeft'), 'ArrowLeft')).toBe(true)
    expect(matchesShortcut(event('KeyS', 's'), 'KeyS')).toBe(true)
    expect(matchesShortcut(event('Space', ' '), 'Space')).toBe(true)
    expect(matchesShortcut(event('Digit2', '2'), '2')).toBe(true)
    expect(matchesShortcut(event('Numpad2', '2'), '2')).toBe(true)
  })

  it('assigns numeric fallbacks to classification labels too', () => {
    const classification = { label_code: 'MALIGNANT', label_name: 'Malignant', annotation_type: 'classification', color: '#ff0000', required: false } as Label
    expect(labelShortcut(classification, 2)).toBe('3')
    expect(labelShortcut({ ...classification, shortcut: '7' }, 2)).toBe('7')
  })
})
