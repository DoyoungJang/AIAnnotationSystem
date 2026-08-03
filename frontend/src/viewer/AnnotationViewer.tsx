import { useEffect, useRef, useState } from 'react'
import { Brush, BoxSelect, Contrast, Crosshair, Eraser, Hand, Maximize2, Redo2, RotateCcw, SunMedium, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import type { Annotation, Asset, Label, Point, Tool } from '../types'
import { clampPoint, fitTransform, screenToSource, sourceToScreen, type ViewTransform } from './transforms/coordinates'
import { useAnnotationStore } from '../stores/annotationStore'

interface Props { asset: Asset; imageUrl: string; labels: Label[]; readOnly?: boolean }
interface BrushStroke { size: number; points: Point[] }

const id = () => crypto.randomUUID()

export function AnnotationViewer({ asset, imageUrl, labels, readOnly = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(new Image())
  const eraseBeforeRef = useRef<Annotation[] | null>(null)
  const erasingRef = useRef(false)
  const drawingBrushRef = useRef(false)
  const pointerActiveRef = useRef(false)
  const rightPanRef = useRef<Point | null>(null)
  const draftRef = useRef<Point[]>([])
  const eraserLastPointRef = useRef<Point | null>(null)
  const eraserPointsRef = useRef<Point[]>([])
  const brushLayerRef = useRef<HTMLCanvasElement | null>(null)
  const {
    annotations, add, tool, setTool, selectedLabel, setLabel, undo, redo, history, future,
    previewReplace, commitPreview,
  } = useAnnotationStore()
  const [transform, setTransform] = useState<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 })
  const [draft, setDraft] = useState<Point[]>([])
  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null)
  const [brushSize, setBrushSize] = useState(18)
  const [eraserSize, setEraserSize] = useState(24)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [rightPanning, setRightPanning] = useState(false)
  const activeLabel = labels.find(label => label.label_code === selectedLabel) ?? labels[0]

  useEffect(() => {
    if (!selectedLabel && labels[0]) setLabel(labels[0].label_code)
  }, [labels, selectedLabel, setLabel])

  useEffect(() => {
    if (tool === 'bbox' || tool === 'polygon' || tool === 'brush') {
      const matching = labels.find(label => label.annotation_type === tool)
      if (matching && activeLabel?.annotation_type !== tool) setLabel(matching.label_code)
    }
  }, [tool, labels, activeLabel?.annotation_type, setLabel])

  const fit = () => {
    const canvas = canvasRef.current
    if (canvas) setTransform(fitTransform(asset.width, asset.height, canvas.clientWidth, canvas.clientHeight))
  }

  useEffect(() => {
    const image = imageRef.current
    image.src = imageUrl
    image.onload = () => fit()
    return () => { image.onload = null }
  }, [imageUrl])

  useEffect(() => {
    setBrightness(100)
    setContrast(100)
  }, [asset.id])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => {
      canvas.width = canvas.clientWidth * devicePixelRatio
      canvas.height = canvas.clientHeight * devicePixelRatio
      fit()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [asset.id])

  useEffect(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    context.fillStyle = '#02070b'
    context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    context.save()
    context.filter = imageDisplayFilter(brightness, contrast)
    context.translate(transform.offsetX, transform.offsetY)
    context.scale(transform.scale, transform.scale)
    if (image.complete && image.naturalWidth > 0) context.drawImage(image, 0, 0, asset.width, asset.height)
    context.restore()

    for (const annotation of annotations) {
      if (annotation.annotation_type === 'brush') continue
      const label = labels.find(item => item.label_code === annotation.label_id)
      context.save()
      context.strokeStyle = label?.color ?? '#39d9c5'
      context.fillStyle = `${label?.color ?? '#39d9c5'}33`
      context.lineWidth = 2
      drawGeometry(context, annotation, transform)
      context.restore()
    }
    brushLayerRef.current ??= document.createElement('canvas')
    drawBrushLayer(context, brushLayerRef.current, annotations, labels, transform)

    const draftColor = activeLabel?.color ?? '#39d9c5'
    if (tool === 'bbox' && dragStart && hoverPoint) drawBoundingBoxPreview(context, dragStart, hoverPoint, transform, draftColor)
    if (tool === 'polygon' && draft.length) drawPolygonPreview(context, draft, hoverPoint, transform, draftColor)
    if (tool === 'brush' && draft.length) drawBrushPreview(context, draft, brushSize, transform, draftColor)
    if ((tool === 'brush' || tool === 'eraser') && hoverPoint && !readOnly) {
      drawRoundCursor(context, hoverPoint, tool === 'brush' ? brushSize : eraserSize, transform, tool === 'brush' ? draftColor : '#ff7182')
    }
  }, [annotations, transform, draft, dragStart, hoverPoint, asset, labels, activeLabel, tool, brushSize, eraserSize, brightness, contrast, readOnly])

  const point = (event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return clampPoint(screenToSource({ x: event.clientX - rect.left, y: event.clientY - rect.top }, transform), asset.width, asset.height)
  }
  const metadata = { image_width: asset.width, image_height: asset.height }
  const create = (annotation_type: Annotation['annotation_type'], geometry_json: Record<string, unknown>) => {
    if (!activeLabel) return
    add({ id: id(), annotation_type, label_id: activeLabel.label_code, geometry_json, attributes_json: metadata, frame_index: 0, source: 'human', model_version: null, confidence: null, current_version: 1 })
  }
  const applyEraserPath = (from: Point | null, to: Point) => {
    const path = from ? densifyPoints([from, to], Math.max(1, eraserSize / 4)) : [to]
    eraserPointsRef.current = path.reduce(appendDistinctPoint, eraserPointsRef.current)
    const before = eraseBeforeRef.current
    if (before) previewReplace(eraseBrushAnnotationsWithStroke(before, { size: eraserSize, points: eraserPointsRef.current }))
    eraserLastPointRef.current = to
  }
  const finishEraserGesture = () => {
    if (eraseBeforeRef.current) commitPreview(eraseBeforeRef.current)
    eraseBeforeRef.current = null
    eraserLastPointRef.current = null
    eraserPointsRef.current = []
    erasingRef.current = false
  }
  const chooseTool = (nextTool: Tool) => {
    setTool(nextTool)
    setDraft([])
    draftRef.current = []
    setDragStart(null)
    drawingBrushRef.current = false
    finishEraserGesture()
  }

  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button === 2) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      pointerActiveRef.current = true
      rightPanRef.current = { x: event.clientX, y: event.clientY }
      setRightPanning(true)
      return
    }
    if (event.button !== 0) return
    if (readOnly) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerActiveRef.current = true
    const source = point(event)
    setHoverPoint(source)
    if (tool === 'eraser') {
      eraseBeforeRef.current = structuredClone(useAnnotationStore.getState().annotations)
      eraserPointsRef.current = []
      erasingRef.current = true
      applyEraserPath(null, source)
      return
    }
    if (tool === 'bbox' || tool === 'pan') setDragStart(tool === 'pan' ? { x: event.clientX, y: event.clientY } : source)
    if (tool === 'brush') {
      drawingBrushRef.current = true
      draftRef.current = [source]
      setDraft([source])
    }
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (rightPanRef.current) {
      const previous = rightPanRef.current
      const current = { x: event.clientX, y: event.clientY }
      setTransform(value => panTransform(value, previous, current))
      rightPanRef.current = current
      return
    }
    const source = point(event)
    setHoverPoint(source)
    if (tool === 'pan' && dragStart) {
      setTransform(value => ({ ...value, offsetX: value.offsetX + event.clientX - dragStart.x, offsetY: value.offsetY + event.clientY - dragStart.y }))
      setDragStart({ x: event.clientX, y: event.clientY })
    } else if (tool === 'brush' && drawingBrushRef.current) {
      draftRef.current = appendDistinctPoint(draftRef.current, source)
      setDraft(draftRef.current)
    } else if (tool === 'eraser' && erasingRef.current) {
      applyEraserPath(eraserLastPointRef.current, source)
    }
  }

  const up = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (rightPanRef.current || event.button === 2) {
      event.preventDefault()
      rightPanRef.current = null
      pointerActiveRef.current = false
      setRightPanning(false)
      return
    }
    if (readOnly) return
    const source = point(event)
    setHoverPoint(source)
    if (tool === 'bbox' && dragStart) {
      const geometry = rectangleFromPoints(dragStart, source)
      if (geometry.width > 2 && geometry.height > 2) create('bbox', geometry)
    } else if (tool === 'brush' && drawingBrushRef.current) {
      const points = appendDistinctPoint(draftRef.current, source)
      if (points.length >= 2) create('brush', { strokes: [{ size: brushSize, points }] })
    } else if (tool === 'eraser' && erasingRef.current) {
      applyEraserPath(eraserLastPointRef.current, source)
      finishEraserGesture()
    }
    pointerActiveRef.current = false
    drawingBrushRef.current = false
    setDragStart(null)
    if (tool === 'brush') {
      draftRef.current = []
      setDraft([])
    }
  }

  const cancel = () => {
    pointerActiveRef.current = false
    rightPanRef.current = null
    setRightPanning(false)
    drawingBrushRef.current = false
    setDragStart(null)
    if (tool === 'brush') {
      draftRef.current = []
      setDraft([])
    }
    finishEraserGesture()
  }

  const click = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (readOnly || tool !== 'polygon' || event.detail > 1) return
    // React clears currentTarget after the handler returns, so resolve canvas
    // coordinates before the state updater is evaluated.
    const source = point(event)
    setDraft(value => appendDistinctPoint(value, source))
  }
  const doubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    if (readOnly || tool !== 'polygon') return
    const source = point(event)
    const points = draft.length >= 3 ? draft : appendDistinctPoint(draft, source)
    if (points.length >= 3) create('polygon', { points })
    setDraft([])
  }
  const wheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const source = screenToSource(cursor, transform)
    const scale = Math.max(.1, Math.min(8, transform.scale * (event.deltaY < 0 ? 1.12 : .89)))
    setTransform({ scale, offsetX: cursor.x - source.x * scale, offsetY: cursor.y - source.y * scale })
  }
  const tools: { value: Tool; label: string; icon: React.ReactNode }[] = [
    { value: 'pan', label: '이동 (M)', icon: <Hand /> },
    { value: 'bbox', label: '박스 (W)', icon: <BoxSelect /> },
    { value: 'polygon', label: '폴리곤 (P)', icon: <Crosshair /> },
    { value: 'brush', label: '브러시 (B)', icon: <Brush /> },
    { value: 'eraser', label: '지우개 (E)', icon: <Eraser /> },
  ]

  return <div className="viewer-shell">
    <div className="viewer-toolbar">
      {tools.map(item => <button key={item.value} className={tool === item.value ? 'active' : ''} disabled={readOnly} title={item.label} onClick={() => chooseTool(item.value)}>{item.icon}<span>{item.label.split(' ')[0]}</span></button>)}
      <span className="divider" />
      <button title="확대" onClick={() => setTransform(value => ({ ...value, scale: Math.min(8, value.scale * 1.2) }))}><ZoomIn /></button>
      <button title="축소" onClick={() => setTransform(value => ({ ...value, scale: Math.max(.1, value.scale / 1.2) }))}><ZoomOut /></button>
      <button title="화면 맞춤" onClick={fit}><Maximize2 /></button>
      <span className="divider" />
      <button title="실행 취소" disabled={!history.length || readOnly} onClick={undo}><Undo2 /></button>
      <button title="다시 실행" disabled={!future.length || readOnly} onClick={redo}><Redo2 /></button>
      {tool === 'brush' && <label className="range">브러시 {brushSize}px<input aria-label="브러시 크기" type="range" min="2" max="80" value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} /></label>}
      {tool === 'eraser' && <label className="range">지우개 {eraserSize}px<input aria-label="지우개 크기" type="range" min="4" max="120" value={eraserSize} onChange={event => setEraserSize(Number(event.target.value))} /></label>}
      <div className="image-adjustments" aria-label="영상 표시 조정">
        <label className="image-adjustment" title="현재 작업 화면의 영상 밝기만 조절합니다."><SunMedium /><span>밝기 {brightness}%</span><input aria-label="영상 밝기" type="range" min="40" max="200" step="5" value={brightness} onInput={event => setBrightness(Number(event.currentTarget.value))} /></label>
        <label className="image-adjustment" title="현재 작업 화면의 영상 명암 대비만 조절합니다."><Contrast /><span>명암 {contrast}%</span><input aria-label="영상 명암" type="range" min="40" max="200" step="5" value={contrast} onInput={event => setContrast(Number(event.currentTarget.value))} /></label>
        <button title="영상 표시 초기화" disabled={brightness === 100 && contrast === 100} onClick={() => { setBrightness(100); setContrast(100) }}><RotateCcw /><span>초기화</span></button>
      </div>
    </div>
    <canvas
      ref={canvasRef}
      className={`viewer-canvas tool-${tool}${rightPanning ? ' tool-pan' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onPointerLeave={() => { if (!pointerActiveRef.current) setHoverPoint(null) }}
      onClick={click}
      onDoubleClick={doubleClick}
      onWheel={wheel}
      onContextMenu={event => event.preventDefault()}
    />
    <div className="viewer-status"><span>{asset.original_filename}</span><span>{asset.width} × {asset.height}</span><span>Zoom {Math.round(transform.scale * 100)}%</span><span>{readOnly ? '읽기 전용' : `${toolName(tool)} · 실시간 미리보기`}</span></div>
  </div>
}

export function imageDisplayFilter(brightness: number, contrast: number): string {
  return `brightness(${brightness}%) contrast(${contrast}%)`
}

export function panTransform(transform: ViewTransform, previous: Point, current: Point): ViewTransform {
  return {
    ...transform,
    offsetX: transform.offsetX + current.x - previous.x,
    offsetY: transform.offsetY + current.y - previous.y,
  }
}

function drawGeometry(context: CanvasRenderingContext2D, annotation: Annotation, transform: ViewTransform) {
  const geometry = annotation.geometry_json as any
  if (annotation.annotation_type === 'bbox') {
    const screen = sourceToScreen({ x: geometry.x, y: geometry.y }, transform)
    context.fillRect(screen.x, screen.y, geometry.width * transform.scale, geometry.height * transform.scale)
    context.strokeRect(screen.x, screen.y, geometry.width * transform.scale, geometry.height * transform.scale)
  } else if (annotation.annotation_type === 'polygon') {
    const points = geometry.points ?? []
    if (!points.length) return
    drawScreenPath(context, points, transform, true)
    context.fill()
    context.stroke()
  }
}

function drawBrushLayer(
  context: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  annotations: Annotation[],
  labels: Label[],
  transform: ViewTransform,
) {
  const width = Math.max(1, Math.ceil(context.canvas.clientWidth))
  const height = Math.max(1, Math.ceil(context.canvas.clientHeight))
  if (layer.width !== width) layer.width = width
  if (layer.height !== height) layer.height = height
  const layerContext = layer.getContext('2d')
  if (!layerContext) return
  layerContext.clearRect(0, 0, width, height)

  const erasures: BrushStroke[] = []
  for (const annotation of annotations) {
    if (annotation.annotation_type !== 'brush') continue
    const geometry = annotation.geometry_json as { strokes?: BrushStroke[]; erasures?: BrushStroke[] }
    const color = labels.find(item => item.label_code === annotation.label_id)?.color ?? '#39d9c5'
    for (const stroke of geometry.strokes ?? []) {
      layerContext.save()
      layerContext.strokeStyle = 'rgba(0,0,0,.7)'
      layerContext.fillStyle = 'rgba(0,0,0,.7)'
      layerContext.lineWidth = stroke.size * transform.scale + 3
      drawBrushStroke(layerContext, stroke.points, transform)
      layerContext.strokeStyle = color
      layerContext.fillStyle = color
      layerContext.globalAlpha = .82
      layerContext.lineWidth = stroke.size * transform.scale
      drawBrushStroke(layerContext, stroke.points, transform)
      layerContext.restore()
    }
    erasures.push(...(geometry.erasures ?? []))
  }

  if (erasures.length) {
    layerContext.save()
    layerContext.globalCompositeOperation = 'destination-out'
    layerContext.strokeStyle = '#000'
    layerContext.fillStyle = '#000'
    for (const erasure of erasures) {
      layerContext.lineWidth = erasure.size * transform.scale
      drawBrushStroke(layerContext, erasure.points, transform)
    }
    layerContext.restore()
  }
  context.drawImage(layer, 0, 0)
}

function drawBoundingBoxPreview(context: CanvasRenderingContext2D, start: Point, end: Point, transform: ViewTransform, color: string) {
  const rectangle = rectangleFromPoints(start, end)
  const screen = sourceToScreen({ x: rectangle.x, y: rectangle.y }, transform)
  context.save()
  context.strokeStyle = color
  context.fillStyle = `${color}2e`
  context.lineWidth = 2
  context.setLineDash([7, 4])
  context.fillRect(screen.x, screen.y, rectangle.width * transform.scale, rectangle.height * transform.scale)
  context.strokeRect(screen.x, screen.y, rectangle.width * transform.scale, rectangle.height * transform.scale)
  context.restore()
}

function drawPolygonPreview(context: CanvasRenderingContext2D, points: Point[], hoverPoint: Point | null, transform: ViewTransform, color: string) {
  const preview = hoverPoint ? appendDistinctPoint(points, hoverPoint) : points
  context.save()
  context.strokeStyle = color
  context.fillStyle = `${color}24`
  context.lineWidth = 2
  context.setLineDash([6, 3])
  drawScreenPath(context, preview, transform, preview.length >= 3)
  if (preview.length >= 3) context.fill()
  context.stroke()
  context.setLineDash([])
  context.fillStyle = color
  for (const point of points) {
    const screen = sourceToScreen(point, transform)
    context.beginPath()
    context.arc(screen.x, screen.y, 3.5, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

function drawBrushPreview(context: CanvasRenderingContext2D, points: Point[], size: number, transform: ViewTransform, color: string) {
  context.save()
  context.strokeStyle = color
  context.fillStyle = color
  context.globalAlpha = .78
  context.lineWidth = size * transform.scale
  drawBrushStroke(context, points, transform)
  context.restore()
}

function drawRoundCursor(context: CanvasRenderingContext2D, point: Point, size: number, transform: ViewTransform, color: string) {
  const screen = sourceToScreen(point, transform)
  const radius = Math.max(2, size * transform.scale / 2)
  context.save()
  context.beginPath()
  context.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
  context.fillStyle = `${color}20`
  context.fill()
  context.strokeStyle = '#ffffff'
  context.lineWidth = 3
  context.stroke()
  context.strokeStyle = color
  context.lineWidth = 1.5
  context.stroke()
  context.restore()
}

function drawScreenPath(context: CanvasRenderingContext2D, points: Point[], transform: ViewTransform, close: boolean) {
  context.beginPath()
  points.forEach((point, index) => {
    const screen = sourceToScreen(point, transform)
    if (index) context.lineTo(screen.x, screen.y)
    else context.moveTo(screen.x, screen.y)
  })
  if (close) context.closePath()
}

function drawBrushStroke(context: CanvasRenderingContext2D, points: Point[], transform: ViewTransform) {
  if (!points.length) return
  context.lineCap = 'round'
  context.lineJoin = 'round'
  if (points.length === 1) {
    const screen = sourceToScreen(points[0], transform)
    context.beginPath()
    context.arc(screen.x, screen.y, context.lineWidth / 2, 0, Math.PI * 2)
    context.fill()
    return
  }
  drawScreenPath(context, points, transform, false)
  context.stroke()
}

export function rectangleFromPoints(start: Point, end: Point) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
}

export function eraseBrushAnnotations(annotations: Annotation[], center: Point, eraserRadius: number): Annotation[] {
  return eraseBrushAnnotationsWithStroke(annotations, { size: eraserRadius * 2, points: [center] })
}

export function eraseBrushAnnotationsWithStroke(annotations: Annotation[], eraser: BrushStroke): Annotation[] {
  let changed = false
  const next = annotations.map(annotation => {
    if (annotation.annotation_type !== 'brush') return annotation
    const geometry = annotation.geometry_json as { strokes?: BrushStroke[]; erasures?: BrushStroke[] }
    const touched = (geometry.strokes ?? []).some(stroke => brushStrokeTouchedByEraser(stroke, eraser))
    if (!touched) return annotation
    changed = true
    return {
      ...annotation,
      geometry_json: {
        ...geometry,
        erasures: [...(geometry.erasures ?? []), structuredClone(eraser)],
      },
    }
  })
  return changed ? next : annotations
}

function brushStrokeTouchedByEraser(stroke: BrushStroke, eraser: BrushStroke): boolean {
  const threshold = Math.max(0, Number(stroke.size)) / 2 + Math.max(0, Number(eraser.size)) / 2
  const samples = densifyPoints(eraser.points ?? [], Math.max(1, Number(eraser.size) / 4))
  return samples.some(point => strokeHit(point, stroke.points ?? [], threshold))
}

function densifyPoints(points: Point[], step: number): Point[] {
  if (points.length < 2) return [...points]
  const dense: Point[] = [{ ...points[0] }]
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]
    const end = points[index]
    const segments = Math.max(1, Math.ceil(distance(start, end) / step))
    for (let part = 1; part <= segments; part++) {
      const ratio = part / segments
      dense.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio })
    }
  }
  return dense
}

function appendDistinctPoint(points: Point[], point: Point): Point[] {
  const last = points.at(-1)
  return last && distance(last, point) < .25 ? points : [...points, point]
}

export function hitTestAnnotation(annotation: Annotation, point: Point): boolean {
  const geometry = annotation.geometry_json as any
  if (annotation.annotation_type === 'bbox') return point.x >= geometry.x && point.x <= geometry.x + geometry.width && point.y >= geometry.y && point.y <= geometry.y + geometry.height
  if (annotation.annotation_type === 'polygon') return pointInPolygon(point, geometry.points ?? [])
  if (annotation.annotation_type === 'brush') return (geometry.strokes ?? []).some((stroke: BrushStroke) => strokeHit(point, stroke.points ?? [], Math.max(2, Number(stroke.size) / 2)))
  return false
}

function pointInPolygon(point: Point, points: Point[]): boolean {
  if (points.length < 3) return false
  let inside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const current = points[index]
    const before = points[previous]
    const crosses = (current.y > point.y) !== (before.y > point.y) && point.x < (before.x - current.x) * (point.y - current.y) / (before.y - current.y) + current.x
    if (crosses) inside = !inside
  }
  return inside
}

function strokeHit(point: Point, points: Point[], radius: number): boolean {
  if (!points.length) return false
  if (points.length === 1) return distance(point, points[0]) <= radius
  for (let index = 1; index < points.length; index++) if (distanceToSegment(point, points[index - 1], points[index]) <= radius) return true
  return false
}

function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y) }

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return distance(point, start)
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)))
  return distance(point, { x: start.x + ratio * dx, y: start.y + ratio * dy })
}

function toolName(tool: Tool): string {
  return { pan: '이동', bbox: '박스', polygon: '폴리곤', brush: '브러시', eraser: '지우개' }[tool]
}
