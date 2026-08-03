import { describe, expect, it } from 'vitest'
import type { ProjectDataItem, TaskStatus } from '../types'
import { filterProjectData, isProjectDataExportable, projectDataState } from './ProjectData'

const item = (task_status: TaskStatus | null, relative_path = 'patient/session/image.png'): ProjectDataItem => ({
  asset_id: crypto.randomUUID(), dataset_id: 'dataset', dataset_name: 'Imported', original_filename: 'image.png',
  relative_path, media_type: 'image/png', width: 100, height: 80, frame_count: 1, phi_suspected: false,
  created_at: new Date().toISOString(), task_id: task_status ? crypto.randomUUID() : null, task_status,
  assigned_to: null, reviewer_id: null, annotation_count: 0,
})

describe('project data filters', () => {
  it('groups unworked, submitted, and reviewed states', () => {
    expect(projectDataState(item(null))).toBe('UNWORKED')
    expect(projectDataState(item('IN_PROGRESS'))).toBe('UNWORKED')
    expect(projectDataState(item('SUBMITTED'))).toBe('SUBMITTED')
    expect(projectDataState(item('IN_REVIEW'))).toBe('SUBMITTED')
    expect(projectDataState(item('APPROVED'))).toBe('REVIEWED')
    expect(projectDataState(item('REJECTED'))).toBe('REVIEWED')
  })

  it('only permits submitted or reviewed data in selected archives', () => {
    expect(isProjectDataExportable(item('SUBMITTED'))).toBe(true)
    expect(isProjectDataExportable(item('APPROVED'))).toBe(true)
    expect(isProjectDataExportable(item('DRAFT'))).toBe(false)
  })

  it('filters by state and preserved relative path', () => {
    const values = [item('SUBMITTED', 'patient-a/day-1/one.png'), item('APPROVED', 'patient-b/day-2/two.png')]
    expect(filterProjectData(values, 'SUBMITTED', '')).toHaveLength(1)
    expect(filterProjectData(values, 'ALL', 'patient-b')).toEqual([values[1]])
  })
})
