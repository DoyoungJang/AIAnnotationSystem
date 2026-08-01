import { describe, expect, it } from 'vitest'
import { hitTestAnnotation } from './AnnotationViewer'
import type { Annotation } from '../types'

const makeAnnotation = (annotation_type: Annotation['annotation_type'], geometry_json: Record<string, unknown>): Annotation => ({
  id: annotation_type,
  annotation_type,
  label_id: 'LABEL',
  geometry_json,
  attributes_json: {},
  frame_index: 0,
  source: 'human',
  model_version: null,
  confidence: null,
  current_version: 1,
})

describe('eraser hit testing', () => {
  it('finds a point inside a bounding box', () => {
    const annotation = makeAnnotation('bbox', { x: 10, y: 20, width: 40, height: 30 })
    expect(hitTestAnnotation(annotation, { x: 30, y: 35 })).toBe(true)
    expect(hitTestAnnotation(annotation, { x: 60, y: 35 })).toBe(false)
  })

  it('finds a point inside a polygon', () => {
    const annotation = makeAnnotation('polygon', { points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 50 }] })
    expect(hitTestAnnotation(annotation, { x: 25, y: 20 })).toBe(true)
    expect(hitTestAnnotation(annotation, { x: 45, y: 45 })).toBe(false)
  })

  it('finds a point close to a brush stroke', () => {
    const annotation = makeAnnotation('brush', { strokes: [{ size: 10, points: [{ x: 10, y: 10 }, { x: 50, y: 10 }] }] })
    expect(hitTestAnnotation(annotation, { x: 30, y: 14 })).toBe(true)
    expect(hitTestAnnotation(annotation, { x: 30, y: 20 })).toBe(false)
  })

  it('does not erase classification labels from the canvas', () => {
    expect(hitTestAnnotation(makeAnnotation('classification', {}), { x: 0, y: 0 })).toBe(false)
  })
})
