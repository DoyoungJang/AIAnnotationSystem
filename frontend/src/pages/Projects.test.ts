import { describe, expect, it } from 'vitest'
import type { Asset } from '../types'
import { normalizeLabelCode, selectAssetIds } from './Projects'

const assets = ['one', 'two', 'three', 'four', 'five'].map(id => ({ id })) as Asset[]

describe('asset batch selection', () => {
  it('selects every available asset', () => {
    expect(selectAssetIds(assets, 'all')).toEqual(['one', 'two', 'three', 'four', 'five'])
  })

  it('selects alternating odd-positioned assets', () => {
    expect(selectAssetIds(assets, 'odd')).toEqual(['one', 'three', 'five'])
  })

  it('selects alternating even-positioned assets', () => {
    expect(selectAssetIds(assets, 'even')).toEqual(['two', 'four'])
  })

  it('clears the selection', () => {
    expect(selectAssetIds(assets, 'none')).toEqual([])
  })
})

describe('label code normalization', () => {
  it('creates a stable uppercase schema code', () => {
    expect(normalizeLabelCode(' lesion border 2 ')).toBe('LESION_BORDER_2')
  })

  it('keeps supported separators and removes unsupported edges', () => {
    expect(normalizeLabelCode(' -roi.main- ')).toBe('-ROI_MAIN-')
  })
})
