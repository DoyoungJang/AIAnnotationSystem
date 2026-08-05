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

  it('records an eraser drag as one undo operation', () => {
    const original = { ...annotation, annotation_type: 'brush' as const, geometry_json: {
      strokes: [{ size: 10, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }],
    } }
    const firstPreview = { ...original, geometry_json: {
      strokes: [{ size: 10, points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] }],
    } }
    const finalPreview = { ...original, geometry_json: {
      strokes: [{ size: 10, points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] }],
    } }
    useAnnotationStore.getState().load([original])

    useAnnotationStore.getState().previewReplace([firstPreview])
    useAnnotationStore.getState().previewReplace([finalPreview])
    useAnnotationStore.getState().commitPreview([original])

    expect(useAnnotationStore.getState().history).toHaveLength(1)
    useAnnotationStore.getState().undo()
    expect(useAnnotationStore.getState().annotations).toEqual([original])
  })

  it('merges overlapping brush strokes with the same label into one annotation', () => {
    const first = { ...annotation, id: 'brush-a', annotation_type: 'brush' as const, label_id: 'LESION', geometry_json: {
      strokes: [{ size: 10, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }],
    } }
    const overlapping = { ...first, id: 'brush-b', geometry_json: {
      strokes: [{ size: 10, points: [{ x: 24, y: 0 }, { x: 40, y: 0 }] }],
    } }

    useAnnotationStore.getState().add(first)
    useAnnotationStore.getState().add(overlapping)

    const [merged] = useAnnotationStore.getState().annotations
    expect(useAnnotationStore.getState().annotations).toHaveLength(1)
    expect(merged.id).toBe('brush-a')
    expect(merged.geometry_json.strokes).toEqual([
      ...first.geometry_json.strokes,
      ...overlapping.geometry_json.strokes,
    ])
  })

  it('keeps overlapping brush strokes separate when their label ids differ', () => {
    const first = { ...annotation, id: 'brush-a', annotation_type: 'brush' as const, label_id: 'LESION', geometry_json: {
      strokes: [{ size: 10, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }],
    } }
    const otherLabel = { ...first, id: 'brush-b', label_id: 'VESSEL' }

    useAnnotationStore.getState().add(first)
    useAnnotationStore.getState().add(otherLabel)

    expect(useAnnotationStore.getState().annotations).toHaveLength(2)
  })

  it('keeps separate same-label brush regions when they do not overlap', () => {
    const first = { ...annotation, id: 'brush-a', annotation_type: 'brush' as const, label_id: 'LESION', geometry_json: {
      strokes: [{ size: 10, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }],
    } }
    const separated = { ...first, id: 'brush-b', geometry_json: {
      strokes: [{ size: 10, points: [{ x: 50, y: 0 }, { x: 70, y: 0 }] }],
    } }

    useAnnotationStore.getState().add(first)
    useAnnotationStore.getState().add(separated)

    expect(useAnnotationStore.getState().annotations).toHaveLength(2)
  })

  it('merges every same-label region connected by a new brush stroke', () => {
    const first = { ...annotation, id: 'brush-a', annotation_type: 'brush' as const, label_id: 'LESION', geometry_json: {
      strokes: [{ size: 10, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
    } }
    const second = { ...first, id: 'brush-b', geometry_json: {
      strokes: [{ size: 10, points: [{ x: 30, y: 0 }, { x: 40, y: 0 }] }],
    } }
    const bridge = { ...first, id: 'brush-c', geometry_json: {
      strokes: [{ size: 10, points: [{ x: 10, y: 0 }, { x: 30, y: 0 }] }],
    } }
    useAnnotationStore.getState().load([first, second])

    useAnnotationStore.getState().add(bridge)

    expect(useAnnotationStore.getState().annotations).toHaveLength(1)
    expect(useAnnotationStore.getState().annotations[0].id).toBe('brush-a')
    expect(useAnnotationStore.getState().deletedAnnotationIds).toEqual(['brush-b'])
    expect(useAnnotationStore.getState().annotations[0].geometry_json.strokes).toHaveLength(3)
  })
})
