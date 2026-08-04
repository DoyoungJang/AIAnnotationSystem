import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { adjacentTasksInSameFolder, buildTaskProjectTrees, collectFolderTasks, filterLabelingTasks, labelingTaskFilter, nextTaskInSameFolder } from './Tasks'

describe('annotator task folder tree', () => {
  it('separates work before and after submission', () => {
    const before = ['ASSIGNED', 'IN_PROGRESS', 'DRAFT', 'CHANGES_REQUESTED'].map((status, index) => ({ id: `before-${index}`, status }) as Task)
    const submitted = ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'].map((status, index) => ({ id: `submitted-${index}`, status }) as Task)
    const tasks = [...before, ...submitted]

    expect(labelingTaskFilter(before[0])).toBe('BEFORE_SUBMIT')
    expect(labelingTaskFilter(submitted[0])).toBe('SUBMITTED')
    expect(filterLabelingTasks(tasks, 'BEFORE_SUBMIT')).toEqual(before)
    expect(filterLabelingTasks(tasks, 'SUBMITTED')).toEqual(submitted)
    expect(filterLabelingTasks(tasks, 'ALL')).toBe(tasks)
  })

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

  it('selects the next unfinished task only from the same folder and assignee', () => {
    const base = { project_id: 'project', assigned_to: 'annotator', status: 'ASSIGNED', media_asset_id: 'asset' } as Task
    const current = { ...base, id: 'a', media_asset_relative_path: 'patient-1/a.png' }
    const submitted = { ...base, id: 'b', status: 'SUBMITTED', media_asset_relative_path: 'patient-1/b.png' } as Task
    const next = { ...base, id: 'c', media_asset_relative_path: 'patient-1/c.png' }
    const otherFolder = { ...base, id: 'd', media_asset_relative_path: 'patient-2/d.png' }
    const otherAssignee = { ...base, id: 'e', assigned_to: 'other', media_asset_relative_path: 'patient-1/e.png' }

    expect(nextTaskInSameFolder([otherFolder, otherAssignee, next, submitted, current], current)).toBe(next)
    expect(nextTaskInSameFolder([current, submitted, otherFolder], current)).toBeUndefined()
    expect(adjacentTasksInSameFolder([next, submitted, current], next)).toEqual({ previous: submitted, next: undefined })
  })
})
