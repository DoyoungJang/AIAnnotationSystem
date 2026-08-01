import { beforeEach, describe, expect, it } from 'vitest'
import { useAnnotationStore } from './annotationStore'
import type { Annotation } from '../types'

const annotation: Annotation = {
  id: 'one',
  annotation_type: 'bbox',
  label_id: 'HEAD',
  geometry_json: { x: 1, y: 2, width: 3, height: 4 },
  attributes_json: {},
  frame_index: 0,
  source: 'human',
  model_version: null,
  confidence: null,
  current_version: 1,
}

describe('annotation history', () => {
  beforeEach(() => useAnnotationStore.getState().load([]))

  it('undoes and redoes a creation', () => {
    useAnnotationStore.getState().add(annotation)
    expect(useAnnotationStore.getState().annotations).toHaveLength(1)
    useAnnotationStore.getState().undo()
    expect(useAnnotationStore.getState().annotations).toHaveLength(0)
    useAnnotationStore.getState().redo()
    expect(useAnnotationStore.getState().annotations).toHaveLength(1)
  })

  it('tracks deletion of an annotation loaded from the server', () => {
    useAnnotationStore.getState().load([annotation])
    useAnnotationStore.getState().remove(annotation.id)
    expect(useAnnotationStore.getState().deletedAnnotationIds).toEqual(['one'])

    useAnnotationStore.getState().undo()
    expect(useAnnotationStore.getState().deletedAnnotationIds).toEqual([])
    useAnnotationStore.getState().redo()
    expect(useAnnotationStore.getState().deletedAnnotationIds).toEqual(['one'])
  })

  it('does not send a never-saved annotation as deleted', () => {
    useAnnotationStore.getState().add(annotation)
    useAnnotationStore.getState().remove(annotation.id)
    expect(useAnnotationStore.getState().deletedAnnotationIds).toEqual([])
  })

  it('clears deletion tracking after a successful save', () => {
    useAnnotationStore.getState().load([annotation])
    useAnnotationStore.getState().remove(annotation.id)
    useAnnotationStore.getState().markSaved()
    expect(useAnnotationStore.getState().persistedIds).toEqual([])
    expect(useAnnotationStore.getState().deletedAnnotationIds).toEqual([])
    expect(useAnnotationStore.getState().dirty).toBe(false)
  })

  it('keeps newer edits dirty when an older save finishes', () => {
    const second = { ...annotation, id: 'two' }
    useAnnotationStore.getState().load([annotation])
    useAnnotationStore.getState().add(second)

    useAnnotationStore.getState().markSaved(['one'])

    expect(useAnnotationStore.getState().persistedIds).toEqual(['one'])
    expect(useAnnotationStore.getState().annotations.map(item => item.id)).toEqual(['one', 'two'])
    expect(useAnnotationStore.getState().dirty).toBe(true)
  })

  it('keeps a deletion dirty when an earlier save completes', () => {
    useAnnotationStore.getState().load([annotation])
    useAnnotationStore.getState().remove('one')
    useAnnotationStore.getState().markSaved(['one'])

    expect(useAnnotationStore.getState().deletedAnnotationIds).toEqual(['one'])
    expect(useAnnotationStore.getState().dirty).toBe(true)
  })
})
