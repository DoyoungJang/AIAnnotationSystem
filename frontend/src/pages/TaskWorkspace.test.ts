import { describe, expect, it } from 'vitest'
import type { Task, User } from '../types'
import { isTaskReadOnly } from './TaskWorkspace'

const annotator = { id: 'annotator', role: 'ANNOTATOR' } as User
const observer = { id: 'observer', role: 'OBSERVER' } as User
const task = (status: Task['status']) => ({ id: status, status } as Task)

describe('task workspace access mode', () => {
  it('lets annotators edit only active labeling states', () => {
    expect(isTaskReadOnly(task('ASSIGNED'), annotator)).toBe(false)
    expect(isTaskReadOnly(task('IN_PROGRESS'), annotator)).toBe(false)
    expect(isTaskReadOnly(task('DRAFT'), annotator)).toBe(false)
    expect(isTaskReadOnly(task('CHANGES_REQUESTED'), annotator)).toBe(false)
  })

  it('opens submitted and reviewed work in read-only mode', () => {
    expect(isTaskReadOnly(task('SUBMITTED'), annotator)).toBe(true)
    expect(isTaskReadOnly(task('IN_REVIEW'), annotator)).toBe(true)
    expect(isTaskReadOnly(task('APPROVED'), annotator)).toBe(true)
    expect(isTaskReadOnly(task('REJECTED'), annotator)).toBe(true)
  })

  it('always keeps observers read-only', () => {
    expect(isTaskReadOnly(task('DRAFT'), observer)).toBe(true)
  })
})
