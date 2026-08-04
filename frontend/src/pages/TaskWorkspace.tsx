import { useEffect, useState } from 'react'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleAlert, Save, Send, X } from 'lucide-react'
import { imageUrl as getImageUrl, request } from '../api/client'
import { AnnotationViewer } from '../viewer/AnnotationViewer'
import { useAnnotationStore } from '../stores/annotationStore'
import { useAutoSave } from '../hooks/useAutoSave'
import type { AnnotationResponse, Asset, Label, Schema, Task, User } from '../types'
import { Status } from './Dashboard'

const pendingLockReleases = new Map<string, number>()

interface Props {
  initialTask: Task
  previousTask?: Task
  nextTask?: Task
  user: User
  onClose: () => void
  onNavigate: (task: Task) => void
  onChanged: () => void
}

const EDITABLE_TASK_STATUSES = new Set<Task['status']>(['ASSIGNED', 'IN_PROGRESS', 'DRAFT', 'CHANGES_REQUESTED'])

export function isTaskReadOnly(task: Task, user: User): boolean {
  return user.role === 'OBSERVER' || !EDITABLE_TASK_STATUSES.has(task.status)
}

export function TaskWorkspace({ initialTask, previousTask, nextTask, user, onClose, onNavigate, onChanged }: Props) {
  const [task, setTask] = useState(initialTask)
  const [asset, setAsset] = useState<Asset>()
  const [url, setUrl] = useState('')
  const [labels, setLabels] = useState<Label[]>([])
  const [version, setVersion] = useState(task.aggregate_version)
  const [error, setError] = useState('')
  const [navigating, setNavigating] = useState(false)
  const {
    annotations, deletedAnnotationIds, load, add, remove, selectedLabel, setLabel,
    dirty, markSaved, tool, setTool,
  } = useAnnotationStore()
  const readOnly = isTaskReadOnly(task, user)
  const auto = useAutoSave(task.id, annotations, deletedAnnotationIds, dirty, version, setVersion, markSaved)
  const classification = labels.filter(label => label.annotation_type === 'classification')

  const navigate = async (target: Task | undefined) => {
    if (!target || navigating) return
    setNavigating(true)
    setError('')
    if (!dirty || await auto.save()) onNavigate(target)
    else setNavigating(false)
  }

  const submit = async () => {
    if (!await auto.save()) return
    try {
      const updated = await request<Task>(`/tasks/${task.id}/submit`, { method: 'POST' })
      setTask(updated)
      onChanged()
      if (nextTask) onNavigate(nextTask)
    } catch (cause: any) {
      setError(cause.message)
    }
  }

  const decide = async (decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED') => {
    const comment = decision === 'APPROVED' ? '검수 승인' : prompt('검수 의견을 입력하세요.') ?? ''
    try {
      const updated = await request<Task>(`/tasks/${task.id}/review`, { method: 'POST', body: JSON.stringify({ decision, comment }) })
      setTask(updated)
      onChanged()
    } catch (cause: any) {
      setError(cause.message)
    }
  }

  const toggleClass = (label: Label) => {
    const existing = annotations.find(annotation => annotation.annotation_type === 'classification' && annotation.label_id === label.label_code)
    if (existing) {
      remove(existing.id)
      return
    }
    add({
      id: crypto.randomUUID(), annotation_type: 'classification', label_id: label.label_code,
      geometry_json: {}, attributes_json: { image_width: asset?.width, image_height: asset?.height },
      frame_index: 0, source: 'human', model_version: null, confidence: null, current_version: 1,
    })
  }

  useEffect(() => {
    const pending = pendingLockReleases.get(task.id)
    if (pending !== undefined) {
      window.clearTimeout(pending)
      pendingLockReleases.delete(task.id)
    }
    let objectUrl = ''
    let cancelled = false
    void (async () => {
      try {
        if (!readOnly) await request<Task>(`/tasks/${task.id}/lock`, { method: 'POST' })
        const [assetData, annotationData, schemas] = await Promise.all([
          request<Asset>(`/assets/${task.media_asset_id}`),
          request<AnnotationResponse>(`/tasks/${task.id}/annotations`),
          request<Schema[]>(`/projects/${task.project_id}/label-schemas`),
        ])
        const fetchedUrl = await getImageUrl(task.media_asset_id)
        if (cancelled) {
          URL.revokeObjectURL(fetchedUrl)
          return
        }
        objectUrl = fetchedUrl
        setAsset(assetData)
        setVersion(annotationData.aggregate_version)
        load(annotationData.annotations)
        setLabels(schemas[0]?.schema_json.labels ?? [])
        setUrl(fetchedUrl)
      } catch (cause: any) {
        if (!cancelled) setError(cause.message)
      }
    })()
    const heartbeat = window.setInterval(() => {
      if (!readOnly) void request(`/tasks/${task.id}/heartbeat`, { method: 'POST' }).catch(() => setError('작업 잠금 연결이 끊어졌습니다.'))
    }, 45_000)
    return () => {
      cancelled = true
      window.clearInterval(heartbeat)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (!readOnly) {
        const timer = window.setTimeout(() => {
          pendingLockReleases.delete(task.id)
          void request(`/tasks/${task.id}/lock`, { method: 'DELETE' })
        }, 0)
        pendingLockReleases.set(task.id, timer)
      }
    }
  }, [task.id])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void auto.save()
      } else if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault()
        void submit()
      } else if (event.key.toLowerCase() === 'w') setTool('bbox')
      else if (event.key.toLowerCase() === 'p') setTool('polygon')
      else if (event.key.toLowerCase() === 'b') setTool('brush')
      else if (event.key.toLowerCase() === 'm') setTool('pan')
      else if (/^[1-9]$/.test(event.key) && labels[Number(event.key) - 1]) setLabel(labels[Number(event.key) - 1].label_code)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [labels, auto.save])

  return <div className="workspace-page">
    <header className="workspace-header">
      <button onClick={onClose}><ArrowLeft /> 작업 목록</button>
      <div><span className="mono">TASK {task.id.slice(0, 8)}</span><Status status={task.status} /></div>
      <button title="현재 초안을 저장하고 같은 폴더의 이전 영상으로 이동" onClick={() => void navigate(previousTask)} disabled={!previousTask || navigating}><ChevronLeft /> 이전</button>
      <button title="현재 초안을 저장하고 같은 폴더의 다음 영상으로 이동" onClick={() => void navigate(nextTask)} disabled={!nextTask || navigating}>다음 <ChevronRight /></button>
      <div className={`save-state ${auto.state}`} title={auto.message}><span />{({ idle: '변경 없음', saving: '저장 중…', saved: '저장됨', offline: '오프라인 임시 저장', conflict: '버전 충돌', error: '저장 실패' } as const)[auto.state]}</div>
      <button onClick={() => void auto.save()} disabled={!dirty || readOnly}><Save /> 저장</button>
      {!readOnly && <button className="primary" onClick={() => void submit()}><Send /> 제출</button>}
      {user.role === 'REVIEWER' && task.status === 'SUBMITTED' && <>
        <button className="danger" onClick={() => void decide('CHANGES_REQUESTED')}><X /> 수정 요청</button>
        <button className="primary" onClick={() => void decide('APPROVED')}><Check /> 승인</button>
      </>}
    </header>
    {(error || auto.message) && <div className="error-banner workspace-error"><CircleAlert />{error || auto.message}</div>}
    <div className="workspace-grid">
      <aside className="asset-strip"><span className="eyebrow">SERIES</span><button className="thumbnail active">{url && <img src={url} />}<small>Frame 1</small></button></aside>
      <section className="viewer-area">{asset && url ? <AnnotationViewer asset={asset} imageUrl={url} labels={labels} readOnly={readOnly} /> : <div className="viewer-loading">영상을 안전하게 불러오는 중…</div>}</section>
      <aside className="label-panel">
        <span className="eyebrow">LABELS</span><h3>라벨 체계</h3>
        {labels.filter(label => label.annotation_type !== 'classification').map((label, index) => <button className={selectedLabel === label.label_code ? 'label-item active' : 'label-item'} onClick={() => { setLabel(label.label_code); setTool(label.annotation_type === 'bbox' ? 'bbox' : label.annotation_type === 'brush' ? 'brush' : 'polygon') }} key={label.label_code}><span style={{ background: label.color }} /><div><strong>{label.label_name}</strong><small>{label.annotation_type}</small></div><kbd>{label.shortcut ?? index + 1}</kbd></button>)}
        {classification.length > 0 && <><span className="eyebrow section-label">CLASSIFICATION</span>{classification.map(label => <label className="classification" key={label.label_code}><input type="checkbox" checked={annotations.some(annotation => annotation.annotation_type === 'classification' && annotation.label_id === label.label_code)} onChange={() => toggleClass(label)} disabled={readOnly} /><span style={{ '--label-color': label.color } as React.CSSProperties}>{label.label_name}</span></label>)}</>}
        <div className="annotation-list"><span className="eyebrow">ANNOTATIONS · {annotations.length}</span>{annotations.filter(annotation => annotation.annotation_type !== 'classification').map(annotation => <div key={annotation.id}><span style={{ background: labels.find(label => label.label_code === annotation.label_id)?.color }} /><span>{labels.find(label => label.label_code === annotation.label_id)?.label_name ?? annotation.label_id}<small>{annotation.annotation_type}</small></span>{!readOnly && <button onClick={() => remove(annotation.id)}>×</button>}</div>)}</div>
      </aside>
    </div>
  </div>
}
