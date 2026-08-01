// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from '../api/client'
import type { Annotation } from '../types'
import { useAutoSave } from './useAutoSave'

vi.mock('../api/client', () => ({ request: vi.fn() }))

const mockedRequest = vi.mocked(request)
const annotation: Annotation = {
  id: 'brush-one',
  annotation_type: 'brush',
  label_id: 'MASK',
  geometry_json: { strokes: [{ size: 10, points: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }] },
  attributes_json: { image_width: 100, image_height: 80 },
  frame_index: 0,
  source: 'human',
  model_version: null,
  confidence: null,
  current_version: 1,
}

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockedRequest.mockReset()
    localStorage.clear()
  })

  afterEach(() => vi.useRealTimers())

  it('reacquires an expired task lock and retries once', async () => {
    mockedRequest
      .mockRejectedValueOnce(Object.assign(new Error('잠금 없음'), { status: 423 }))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ aggregate_version: 2 })
    const onVersion = vi.fn()
    const onSaved = vi.fn()
    const { result } = renderHook(() => useAutoSave('task-one', [annotation], [], true, 1, onVersion, onSaved))

    await act(async () => expect(await result.current.save()).toBe(true))

    expect(mockedRequest.mock.calls.map(call => [call[0], call[1]?.method])).toEqual([
      ['/tasks/task-one/annotations', 'PUT'],
      ['/tasks/task-one/lock', 'POST'],
      ['/tasks/task-one/annotations', 'PUT'],
    ])
    expect(onVersion).toHaveBeenCalledWith(2)
    expect(onSaved).toHaveBeenCalledWith(['brush-one'])
    expect(result.current.state).toBe('saved')
  })

  it('serializes overlapping save calls', async () => {
    let resolveSave!: (value: { aggregate_version: number }) => void
    mockedRequest.mockReturnValueOnce(new Promise(resolve => { resolveSave = resolve }))
    const { result } = renderHook(() => useAutoSave('task-one', [annotation], [], true, 1, vi.fn(), vi.fn()))

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = result.current.save()
      second = result.current.save()
    })
    expect(mockedRequest).toHaveBeenCalledTimes(1)

    resolveSave({ aggregate_version: 2 })
    await act(async () => { await Promise.all([first, second]) })
    expect(mockedRequest).toHaveBeenCalledTimes(1)
  })

  it('does not mark newer edits as saved by an older request', async () => {
    let resolveSave!: (value: { aggregate_version: number }) => void
    mockedRequest.mockReturnValueOnce(new Promise(resolve => { resolveSave = resolve }))
    const onSaved = vi.fn()
    const { result, rerender } = renderHook(
      ({ items }) => useAutoSave('task-one', items, [], true, 1, vi.fn(), onSaved),
      { initialProps: { items: [annotation] } },
    )

    let save!: Promise<boolean>
    act(() => { save = result.current.save() })
    rerender({ items: [{ ...annotation, geometry_json: { ...annotation.geometry_json, erasures: [{ size: 8, points: [{ x: 5, y: 5 }] }] } }] })
    resolveSave({ aggregate_version: 2 })
    await act(async () => { await save })

    expect(onSaved).not.toHaveBeenCalled()
    expect(result.current.state).toBe('saving')
  })
})
