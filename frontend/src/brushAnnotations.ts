import type { Annotation, Point } from './types'

interface BrushStroke {
  size: number
  points: Point[]
}

interface BrushGeometry {
  strokes?: BrushStroke[]
  erasures?: BrushStroke[]
}

const EPSILON = 1e-9

function geometry(annotation: Annotation): BrushGeometry {
  return annotation.geometry_json as BrushGeometry
}

function strokes(annotation: Annotation): BrushStroke[] {
  return geometry(annotation).strokes ?? []
}

function erasures(annotation: Annotation): BrushStroke[] {
  return geometry(annotation).erasures ?? []
}

function cross(origin: Point, first: Point, second: Point): number {
  return (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
}

function between(value: number, first: number, second: number): boolean {
  return value >= Math.min(first, second) - EPSILON && value <= Math.max(first, second) + EPSILON
}

function onSegment(point: Point, start: Point, end: Point): boolean {
  return Math.abs(cross(start, end, point)) <= EPSILON && between(point.x, start.x, end.x) && between(point.y, start.y, end.y)
}

function segmentsIntersect(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): boolean {
  const firstSideStart = cross(firstStart, firstEnd, secondStart)
  const firstSideEnd = cross(firstStart, firstEnd, secondEnd)
  const secondSideStart = cross(secondStart, secondEnd, firstStart)
  const secondSideEnd = cross(secondStart, secondEnd, firstEnd)
  if (((firstSideStart > EPSILON && firstSideEnd < -EPSILON) || (firstSideStart < -EPSILON && firstSideEnd > EPSILON))
    && ((secondSideStart > EPSILON && secondSideEnd < -EPSILON) || (secondSideStart < -EPSILON && secondSideEnd > EPSILON))) return true
  return onSegment(secondStart, firstStart, firstEnd)
    || onSegment(secondEnd, firstStart, firstEnd)
    || onSegment(firstStart, secondStart, secondEnd)
    || onSegment(firstEnd, secondStart, secondEnd)
}

function pointSegmentDistanceSquared(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)))
  const nearest = { x: start.x + ratio * dx, y: start.y + ratio * dy }
  return (point.x - nearest.x) ** 2 + (point.y - nearest.y) ** 2
}

function segmentDistanceSquared(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): number {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return 0
  return Math.min(
    pointSegmentDistanceSquared(firstStart, secondStart, secondEnd),
    pointSegmentDistanceSquared(firstEnd, secondStart, secondEnd),
    pointSegmentDistanceSquared(secondStart, firstStart, firstEnd),
    pointSegmentDistanceSquared(secondEnd, firstStart, firstEnd),
  )
}

function strokeBounds(stroke: BrushStroke) {
  const radius = Math.max(0, Number(stroke.size)) / 2
  const xs = stroke.points.map(point => point.x)
  const ys = stroke.points.map(point => point.y)
  return {
    left: Math.min(...xs) - radius,
    right: Math.max(...xs) + radius,
    top: Math.min(...ys) - radius,
    bottom: Math.max(...ys) + radius,
  }
}

function strokesOverlap(first: BrushStroke, second: BrushStroke): boolean {
  if (!first.points.length || !second.points.length) return false
  const firstBounds = strokeBounds(first)
  const secondBounds = strokeBounds(second)
  if (firstBounds.right < secondBounds.left || secondBounds.right < firstBounds.left || firstBounds.bottom < secondBounds.top || secondBounds.bottom < firstBounds.top) return false
  const threshold = Math.max(0, Number(first.size)) / 2 + Math.max(0, Number(second.size)) / 2
  const firstSegments = first.points.length === 1 ? [[first.points[0], first.points[0]]] : first.points.slice(1).map((point, index) => [first.points[index], point])
  const secondSegments = second.points.length === 1 ? [[second.points[0], second.points[0]]] : second.points.slice(1).map((point, index) => [second.points[index], point])
  return firstSegments.some(([firstStart, firstEnd]) => secondSegments.some(([secondStart, secondEnd]) =>
    segmentDistanceSquared(firstStart, firstEnd, secondStart, secondEnd) <= threshold ** 2 + EPSILON,
  ))
}

function strokeSetsOverlap(first: BrushStroke[], second: BrushStroke[]): boolean {
  return first.some(firstStroke => second.some(secondStroke => strokesOverlap(firstStroke, secondStroke)))
}

function sameBrushGroup(annotation: Annotation, incoming: Annotation): boolean {
  return annotation.annotation_type === 'brush'
    && annotation.label_id === incoming.label_id
    && annotation.frame_index === incoming.frame_index
}

export function addOrMergeBrushAnnotation(annotations: Annotation[], incoming: Annotation): Annotation[] {
  if (incoming.annotation_type !== 'brush' || !strokes(incoming).length) return [...annotations, incoming]
  const connected = new Set<number>()
  const connectedStrokes = [...strokes(incoming)]
  let foundConnection = true
  while (foundConnection) {
    foundConnection = false
    annotations.forEach((annotation, index) => {
      if (connected.has(index) || !sameBrushGroup(annotation, incoming) || !strokeSetsOverlap(strokes(annotation), connectedStrokes)) return
      connected.add(index)
      connectedStrokes.push(...strokes(annotation))
      foundConnection = true
    })
  }
  if (!connected.size) return [...annotations, incoming]

  const connectedIndexes = [...connected].sort((left, right) => left - right)
  const baseIndex = connectedIndexes[0]
  const base = annotations[baseIndex]
  const mergedStrokes = connectedIndexes.flatMap(index => strokes(annotations[index])).concat(strokes(incoming))
  const mergedErasures = connectedIndexes.flatMap(index => erasures(annotations[index])).concat(erasures(incoming))
  const mergedGeometry: Record<string, unknown> = { ...base.geometry_json, strokes: mergedStrokes }
  if (mergedErasures.length) mergedGeometry.erasures = mergedErasures
  else delete mergedGeometry.erasures
  const merged = { ...base, geometry_json: mergedGeometry }

  return annotations.flatMap((annotation, index) => {
    if (index === baseIndex) return [merged]
    return connected.has(index) ? [] : [annotation]
  })
}
