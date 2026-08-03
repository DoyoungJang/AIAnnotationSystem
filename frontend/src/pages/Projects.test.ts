import { describe, expect, it } from 'vitest'
import type { Asset, LabelPresetNode } from '../types'
import { buildAssetFolderTree, buildAssignmentBatches, buildUploadBatches, canDeletePresetNode, childrenInPresetFolder, collectFolderAssets, groupAssetsByFolder, normalizeLabelCode, presetDescendantIds, presetFolderTrail, safeExportFolderName, selectAssetIds, toggleFolderAssetSelection } from './Projects'

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

  it('removes duplicate asset ids before applying odd-position selection', () => {
    expect(selectAssetIds([assets[0], assets[1], assets[0], assets[2]], 'odd')).toEqual(['one', 'three'])
  })

  it('deduplicates and splits large assignments to the API limit', () => {
    expect(buildAssignmentBatches(['one', 'two', 'one', 'three', 'four'], 2)).toEqual([['one', 'two'], ['three', 'four']])
  })
})

describe('folder-preserving asset display', () => {
  it('groups and sorts assets by their imported relative folder path', () => {
    const nested = [
      { id: 'two', original_filename: 'b.png', relative_path: 'Breast cancer/malignant/b.png' },
      { id: 'one', original_filename: 'a.png', relative_path: 'Breast cancer/benign/a.png' },
      { id: 'root', original_filename: 'root.png', relative_path: 'root.png' },
    ] as Asset[]
    expect(groupAssetsByFolder(nested).map(group => [group.path, group.assets.map(asset => asset.id)])).toEqual([
      ['최상위 폴더', ['root']],
      ['Breast cancer/benign', ['one']],
      ['Breast cancer/malignant', ['two']],
    ])
  })

  it('builds a navigable hierarchy and selects every available descendant', () => {
    const nested = [
      { id: 'benign', original_filename: 'a.png', relative_path: 'Breast cancer/benign/a.png' },
      { id: 'malignant', original_filename: 'b.png', relative_path: 'Breast cancer/malignant/b.png' },
      { id: 'assigned', original_filename: 'c.png', relative_path: 'Breast cancer/malignant/c.png' },
    ] as Asset[]
    const root = buildAssetFolderTree(nested)
    const breast = root.children[0]
    expect(breast.name).toBe('Breast cancer')
    expect(breast.children.map(child => child.name)).toEqual(['benign', 'malignant'])
    expect(collectFolderAssets(breast).map(asset => asset.id)).toEqual(['benign', 'malignant', 'assigned'])
    expect(toggleFolderAssetSelection([], breast, new Set(['assigned']))).toEqual(['benign', 'malignant'])
    expect(toggleFolderAssetSelection(['benign', 'malignant'], breast, new Set(['assigned']))).toEqual([])
  })
})

describe('folder upload batching', () => {
  it('splits a folder larger than the multipart parser file limit', () => {
    const files = Array.from({ length: 1578 }, () => ({ size: 1 }))
    expect(buildUploadBatches(files).map(batch => batch.length)).toEqual([200, 200, 200, 200, 200, 200, 200, 178])
  })

  it('keeps requests below the configured byte limit while allowing one oversized file', () => {
    const files = [{ size: 40 }, { size: 30 }, { size: 120 }, { size: 10 }]
    expect(buildUploadBatches(files, 10, 64).map(batch => batch.map(file => file.size))).toEqual([[40], [30], [120], [10]])
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

describe('export folder defaults', () => {
  it('keeps a readable project folder name while replacing unsafe path characters', () => {
    expect(safeExportFolderName(' 유방/초음파:2026 ')).toBe('유방_초음파_2026')
  })

  it('uses a fallback when the project name cannot form a folder', () => {
    expect(safeExportFolderName('...')).toBe('project-export')
  })
})
