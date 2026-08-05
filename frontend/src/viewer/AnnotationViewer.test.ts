import { describe, expect, it } from 'vitest'
import { annotationOpacityRatio, brushRenderGroups, drawBrushLayer, eraseBrushAnnotations, hitTestAnnotation, imageDisplayFilter, panTransform, rectangleFromPoints } from './AnnotationViewer'
import type { Annotation, Label } from '../types'

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

const labels: Label[] = [
  { label_code: 'LABEL', label_name: 'Label', annotation_type: 'brush', color: '#ff0000', required: false },
  { label_code: 'OTHER', label_name: 'Other', annotation_type: 'brush', color: '#00ff00', required: false },
]

function fakeContext(drawAlphas: number[] = []) {
  let globalAlpha = 1
  const context = {
    canvas: { clientWidth: 100, clientHeight: 80 },
    clearRect() {}, save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {},
    drawImage() { drawAlphas.push(globalAlpha) },
    get globalAlpha() { return globalAlpha },
    set globalAlpha(value: number) { globalAlpha = value },
    globalCompositeOperation: 'source-over', strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
  }
  return context as unknown as CanvasRenderingContext2D
}

function fakeCanvas(context: CanvasRenderingContext2D) {
  return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement
}

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

  it('converts and clamps the label opacity percentage', () => {
    expect(annotationOpacityRatio(80)).toBe(.8)
    expect(annotationOpacityRatio(-10)).toBe(0)
    expect(annotationOpacityRatio(150)).toBe(1)
  })

  it('pans the image by the pointer drag distance without changing zoom', () => {
    expect(panTransform(
      { scale: 2, offsetX: 40, offsetY: -10 },
      { x: 100, y: 80 },
      { x: 135, y: 55 },
    )).toEqual({ scale: 2, offsetX: 75, offsetY: -35 })
  })
})

describe('brush rendering', () => {
  const first = makeAnnotation('brush', { strokes: [{ size: 10, points: [{ x: 0, y: 10 }, { x: 30, y: 10 }] }] })
  const overlapping = { ...first, id: 'overlapping', geometry_json: { strokes: [{ size: 10, points: [{ x: 20, y: 10 }, { x: 50, y: 10 }] }] } }

  it('combines every same-label stroke into one render group', () => {
    const groups = brushRenderGroups([first, overlapping], labels)

    expect(groups).toHaveLength(1)
    expect(groups[0].labelId).toBe('LABEL')
    expect(groups[0].strokes).toHaveLength(2)
  })

  it('applies opacity once to a same-label brush group', () => {
    const drawAlphas: number[] = []
    const mainContext = fakeContext()
    const layerContext = fakeContext(drawAlphas)
    const groupContext = fakeContext()

    drawBrushLayer(mainContext, fakeCanvas(layerContext), fakeCanvas(groupContext), [first, overlapping], labels, { scale: 1, offsetX: 0, offsetY: 0 }, .45)

    expect(drawAlphas).toEqual([.45])
  })

  it('keeps different labels as separate visual layers', () => {
    const other = { ...overlapping, id: 'other', label_id: 'OTHER' }
    expect(brushRenderGroups([first, other], labels)).toHaveLength(2)
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
