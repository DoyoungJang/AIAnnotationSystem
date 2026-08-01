import { describe, expect, it } from 'vitest'
import type { Asset, LabelPresetNode } from '../types'
import { canDeletePresetNode, childrenInPresetFolder, normalizeLabelCode, presetDescendantIds, presetFolderTrail, selectAssetIds } from './Projects'

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

const presetNodes = [
  { id: 'radiology', parent_id: null, node_type: 'FOLDER', name: '영상의학과', labels: [] },
  { id: 'breast', parent_id: 'radiology', node_type: 'FOLDER', name: '유방', labels: [] },
  { id: 'thyroid', parent_id: 'radiology', node_type: 'FOLDER', name: '갑상선', labels: [] },
  { id: 'lesion', parent_id: 'breast', node_type: 'PRESET', name: '병변 기본', labels: [{ label_code: 'LESION', label_name: '병변', annotation_type: 'bbox', color: '#00AEEF', required: true }] },
].map(node => ({ ...node, created_by: 'admin', created_at: '', updated_at: '' })) as LabelPresetNode[]

describe('hierarchical label preset library', () => {
  it('shows only the immediate folders and presets in the selected folder', () => {
    expect(childrenInPresetFolder(presetNodes, 'radiology').folders.map(node => node.id)).toEqual(['thyroid', 'breast'])
    expect(childrenInPresetFolder(presetNodes, 'breast').presets.map(node => node.id)).toEqual(['lesion'])
  })

  it('builds a root-to-current-folder breadcrumb', () => {
    expect(presetFolderTrail(presetNodes, 'breast').map(node => node.id)).toEqual(['radiology', 'breast'])
  })

  it('collects nested items for safe local removal after deleting a folder', () => {
    expect([...presetDescendantIds(presetNodes, 'radiology')].sort()).toEqual(['breast', 'lesion', 'radiology', 'thyroid'])
  })

  it('lets a project manager delete only trees they fully own', () => {
    const manager = { id: 'manager', role: 'PROJECT_MANAGER' } as Parameters<typeof canDeletePresetNode>[0]
    expect(canDeletePresetNode(manager, presetNodes, presetNodes[0])).toBe(false)
    expect(canDeletePresetNode({ ...manager, role: 'ADMINISTRATOR' }, presetNodes, presetNodes[0])).toBe(true)
    expect(canDeletePresetNode(manager, presetNodes.map(node => ({ ...node, created_by: 'manager' })), presetNodes[0])).toBe(true)
  })
})
