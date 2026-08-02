import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { buildTaskProjectTrees, collectFolderTasks } from './Tasks'

describe('annotator task folder tree', () => {
  it('groups assigned tasks by project and preserves nested upload folders', () => {
    const tasks = [
      { id: 'b', project_id: 'breast', project_name: 'Breast QA', media_asset_id: 'asset-b', media_asset_relative_path: 'Breast cancer/malignant/b.png' },
      { id: 'a', project_id: 'breast', project_name: 'Breast QA', media_asset_id: 'asset-a', media_asset_relative_path: 'Breast cancer/benign/a.png' },
      { id: 'f', project_id: 'fetal', project_name: 'Fetal QA', media_asset_id: 'asset-f', media_asset_relative_path: 'trimester1/f.png' },
    ] as Task[]
    const trees = buildTaskProjectTrees(tasks)
    expect(trees.map(tree => tree.name)).toEqual(['Breast QA', 'Fetal QA'])
    const breast = trees[0]
    expect(breast.children[0].name).toBe('Breast cancer')
    expect(breast.children[0].children.map(folder => folder.name)).toEqual(['benign', 'malignant'])
    expect(collectFolderTasks(breast).map(task => task.id)).toEqual(['a', 'b'])
  })

  it('keeps legacy tasks without a relative folder at the project root', () => {
    const task = { id: 'legacy', project_id: 'project', project_name: 'Legacy', media_asset_id: 'asset', media_asset_original_filename: 'legacy.png' } as Task
    const root = buildTaskProjectTrees([task])[0]
    expect(root.tasks).toEqual([task])
    expect(root.children).toEqual([])
  })
})
