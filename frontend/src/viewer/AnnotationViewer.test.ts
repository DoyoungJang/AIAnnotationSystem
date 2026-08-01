import { describe, expect, it } from 'vitest'
import { eraseBrushAnnotations, hitTestAnnotation, imageDisplayFilter, rectangleFromPoints } from './AnnotationViewer'
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

describe('live drawing geometry', () => {
  it('normalizes a bounding box while dragging in any direction', () => {
    expect(rectangleFromPoints({ x: 70, y: 50 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 30,
    })
  })

  it('builds a display-only brightness and contrast filter', () => {
    expect(imageDisplayFilter(135, 80)).toBe('brightness(135%) contrast(80%)')
  })
})

describe('partial brush erasing', () => {
  it('keeps the original stroke and records an exact-size eraser mask', () => {
    const annotation = makeAnnotation('brush', {
      strokes: [{ size: 10, points: [{ x: 0, y: 20 }, { x: 100, y: 20 }] }],
    })

    const result = eraseBrushAnnotations([annotation], { x: 50, y: 20 }, 10)
    const strokes = result[0].geometry_json.strokes as { size: number; points: { x: number; y: number }[] }[]
    const erasures = result[0].geometry_json.erasures as { size: number; points: { x: number; y: number }[] }[]

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(annotation.id)
    expect(strokes).toEqual(annotation.geometry_json.strokes)
    expect(erasures).toEqual([{ size: 20, points: [{ x: 50, y: 20 }] }])
  })

  it('returns the same snapshot when the eraser does not touch a stroke', () => {
    const annotations = [makeAnnotation('brush', {
      strokes: [{ size: 10, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }],
    })]

    expect(eraseBrushAnnotations(annotations, { x: 100, y: 100 }, 10)).toBe(annotations)
  })

  it('does not delete the full brush width when the eraser only clips an edge', () => {
    const annotation = makeAnnotation('brush', {
      strokes: [{ size: 20, points: [{ x: 0, y: 20 }, { x: 100, y: 20 }] }],
    })

    const [result] = eraseBrushAnnotations([annotation], { x: 50, y: 8 }, 4)

    expect(result.geometry_json.strokes).toEqual(annotation.geometry_json.strokes)
    expect(result.geometry_json.erasures).toEqual([{ size: 8, points: [{ x: 50, y: 8 }] }])
  })

  it('does not alter non-brush annotations', () => {
    const annotation = makeAnnotation('bbox', { x: 10, y: 10, width: 30, height: 30 })
    const annotations = [annotation]

    expect(eraseBrushAnnotations(annotations, { x: 20, y: 20 }, 10)).toBe(annotations)
  })
})
