import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleAlert, Keyboard, Pencil, RotateCcw, Save, Send, X } from 'lucide-react'
import { imageUrl as getImageUrl, request } from '../api/client'
import { AnnotationViewer } from '../viewer/AnnotationViewer'
import { useAnnotationStore } from '../stores/annotationStore'
import { useAutoSave } from '../hooks/useAutoSave'
import { DEFAULT_SHORTCUTS, displayShortcut, labelShortcut, matchesShortcut, resolveShortcuts, shortcutFromEvent } from '../shortcuts'
import type { AnnotationResponse, Asset, Label, Schema, ShortcutSettings, Task, User } from '../types'
import { Status } from './Dashboard'
import '../shortcutStyles.css'

const pendingLockReleases = new Map<string, number>()

interface Props {
  initialTask: Task
  previousTask?: Task
  nextTask?: Task
  user: User
  onClose: () => void
  onNavigate: (task: Task) => void
  onChanged: (task?: Task) => void
  onUserChanged: () => void
}

const EDITABLE_TASK_STATUSES = new Set<Task['status']>(['ASSIGNED', 'IN_PROGRESS', 'DRAFT', 'CHANGES_REQUESTED'])

export function isTaskReadOnly(task: Task, user: User): boolean {
  return user.role === 'OBSERVER' || (user.role === 'REVIEWER' && task.status === 'SUBMITTED') || !EDITABLE_TASK_STATUSES.has(task.status)
}

export function TaskWorkspace({ initialTask, previousTask, nextTask, user, onClose, onNavigate, onChanged, onUserChanged }: Props) {
  const [task, setTask] = useState(initialTask)
  const [asset, setAsset] = useState<Asset>()
  const [url, setUrl] = useState('')
  const [labels, setLabels] = useState<Label[]>([])
  const [version, setVersion] = useState(task.aggregate_version)
  const [error, setError] = useState('')
  const [navigating, setNavigating] = useState(false)
  const [showShortcutSettings, setShowShortcutSettings] = useState(false)
  const [shortcutSettings, setShortcutSettings] = useState<ShortcutSettings>(() => resolveShortcuts(user.shortcut_settings))
  const [shortcutDraft, setShortcutDraft] = useState<ShortcutSettings>(() => resolveShortcuts(user.shortcut_settings))
  const [shortcutSaving, setShortcutSaving] = useState(false)
  const [shortcutError, setShortcutError] = useState('')
  const [revisionStarting, setRevisionStarting] = useState(false)
  const { annotations, deletedAnnotationIds, load, add, remove, selectedLabel, setLabel, dirty, markSaved, setTool } = useAnnotationStore()
  const submittedByAssignee = task.assigned_to === user.id && task.status === 'SUBMITTED'
  const readOnly = isTaskReadOnly(task, user)
  const auto = useAutoSave(task.id, annotations, deletedAnnotationIds, dirty, version, setVersion, markSaved)
  const labelBindings = useMemo(() => labels.map((label, index) => ({ label, shortcut: labelShortcut(label, index) })), [labels])
  const classification = labels.filter(label => label.annotation_type === 'classification')

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
        if (!readOnly) {
          const lockedTask = await request<Task>(`/tasks/${task.id}/lock`, { method: 'POST' })
          if (!cancelled) setTask(lockedTask)
        }
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
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '작업을 불러오지 못했습니다.')
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
  }, [task.id, readOnly])

  const toggleClass = (label: Label) => {
    if (readOnly) return
    const existing = annotations.find(annotation => annotation.annotation_type === 'classification' && annotation.label_id === label.label_code)
    if (existing) {
      remove(existing.id)
      return
    }
    add({
      id: crypto.randomUUID(),
      annotation_type: 'classification',
      label_id: label.label_code,
      geometry_json: {},
      attributes_json: { image_width: asset?.width, image_height: asset?.height },
      frame_index: 0,
      source: 'human',
      model_version: null,
      confidence: null,
      current_version: 1,
    })
  }

  const selectLabel = (label: Label) => {
    if (label.annotation_type === 'classification') {
      toggleClass(label)
      return
    }
    setLabel(label.label_code)
    setTool(label.annotation_type === 'bbox' ? 'bbox' : label.annotation_type === 'brush' ? 'brush' : 'polygon')
  }

  const submit = async () => {
    if (readOnly || !await auto.save()) return
    try {
      const updated = await request<Task>(`/tasks/${task.id}/submit`, { method: 'POST' })
      setTask(updated)
      onChanged(updated)
      if (nextTask) onNavigate(nextTask)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '제출하지 못했습니다.')
    }
  }

  const startRevision = async () => {
    if (!submittedByAssignee || revisionStarting) return
    setRevisionStarting(true)
    setError('')
    try {
      const editableTask = await request<Task>(`/tasks/${task.id}/lock`, { method: 'POST' })
      setTask(editableTask)
      onChanged(editableTask)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '수정 모드로 전환하지 못했습니다.')
    } finally {
      setRevisionStarting(false)
    }
  }

  const navigate = async (target: Task | undefined) => {
    if (!target || navigating) return
    setNavigating(true)
    setError('')
    const saved = !dirty || await auto.save()
    if (!saved) {
      setNavigating(false)
      return
    }
    onNavigate(target)
  }

  const decide = async (decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED') => {
    const comment = decision === 'APPROVED' ? '검수 승인' : prompt('검수 의견을 입력하세요.') ?? ''
    try {
      const updated = await request<Task>(`/tasks/${task.id}/review`, { method: 'POST', body: JSON.stringify({ decision, comment }) })
      setTask(updated)
      onChanged(updated)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '검수 결과를 저장하지 못했습니다.')
    }
  }

  const saveShortcutSettings = async () => {
    if (new Set(Object.values(shortcutDraft)).size !== Object.keys(shortcutDraft).length) {
      setShortcutError('이전, 다음, 제출 단축키는 서로 다르게 지정해 주세요.')
      return
    }
    setShortcutSaving(true)
    setShortcutError('')
    try {
      const updated = await request<User>('/users/me/shortcuts', { method: 'PATCH', body: JSON.stringify(shortcutDraft) })
      const saved = resolveShortcuts(updated.shortcut_settings)
      setShortcutSettings(saved)
      setShortcutDraft(saved)
      setShowShortcutSettings(false)
      onUserChanged()
    } catch (caught) {
      setShortcutError(caught instanceof Error ? caught.message : '단축키를 저장하지 못했습니다.')
    } finally {
      setShortcutSaving(false)
    }
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
      if (showShortcutSettings) {
        if (event.key === 'Escape') setShowShortcutSettings(false)
        return
      }
      if (matchesShortcut(event, shortcutSettings.previous_image)) {
        event.preventDefault()
        if (!event.repeat) void navigate(previousTask)
      } else if (matchesShortcut(event, shortcutSettings.next_image)) {
        event.preventDefault()
        if (!event.repeat) void navigate(nextTask)
      } else if (matchesShortcut(event, shortcutSettings.submit)) {
        event.preventDefault()
        if (!event.repeat && !readOnly) void submit()
      } else if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void auto.save()
      } else {
        const binding = labelBindings.find(candidate => candidate.shortcut && matchesShortcut(event, candidate.shortcut))
        if (binding) {
          event.preventDefault()
          if (!event.repeat) selectLabel(binding.label)
        } else if (event.key.toLowerCase() === 'w') setTool('bbox')
        else if (event.key.toLowerCase() === 'p') setTool('polygon')
        else if (event.key.toLowerCase() === 'b') setTool('brush')
        else if (event.key.toLowerCase() === 'm') setTool('pan')
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [auto.save, labelBindings, nextTask, previousTask, readOnly, shortcutSettings, showShortcutSettings, navigating, annotations, asset, dirty])

  return <div className="workspace-page">
    <header className="workspace-header">
      <button onClick={onClose}><ArrowLeft /> 작업 목록</button>
      <div><span className="mono">TASK {task.id.slice(0, 8)}</span><Status status={task.status} /></div>
      <button title={`현재 초안을 저장하고 같은 폴더의 이전 영상으로 이동 (${displayShortcut(shortcutSettings.previous_image)})`} onClick={() => void navigate(previousTask)} disabled={!previousTask || navigating}><ChevronLeft /> 이전</button>
      <button title={`현재 초안을 저장하고 같은 폴더의 다음 영상으로 이동 (${displayShortcut(shortcutSettings.next_image)})`} onClick={() => void navigate(nextTask)} disabled={!nextTask || navigating}>다음 <ChevronRight /></button>
      <div className={`save-state ${auto.state}`} title={auto.message}><span />{({ idle: '변경 없음', saving: '저장 중…', saved: '저장됨', offline: '오프라인 임시 저장', conflict: '버전 충돌', error: '저장 실패' } as const)[auto.state]}</div>
      <button onClick={() => { setShortcutDraft(shortcutSettings); setShortcutError(''); setShowShortcutSettings(value => !value) }} title="사용자 단축키 설정"><Keyboard /> 단축키</button>
      <button onClick={() => void auto.save()} disabled={!dirty || readOnly}><Save /> 저장</button>
      {submittedByAssignee ? <button className="primary" onClick={() => void startRevision()} disabled={revisionStarting}><Pencil /> {revisionStarting ? '전환 중…' : '수정'}</button> : !readOnly && <button className="primary" onClick={() => void submit()}><Send /> 제출 <kbd>{displayShortcut(shortcutSettings.submit)}</kbd></button>}
      {user.role === 'REVIEWER' && task.status === 'SUBMITTED' && <><button className="danger" onClick={() => void decide('CHANGES_REQUESTED')}><X /> 수정 요청</button><button className="primary" onClick={() => void decide('APPROVED')}><Check /> 승인</button></>}
      {showShortcutSettings && <div className="shortcut-popover">
        <div className="shortcut-heading"><div><span className="eyebrow">MY SHORTCUTS</span><h3>내 단축키 설정</h3></div><button onClick={() => setShowShortcutSettings(false)} aria-label="닫기"><X /></button></div>
        <p>입력칸을 선택한 뒤 원하는 키 또는 키 조합을 누르세요. 설정은 사용자 계정에 저장됩니다.</p>
        <ShortcutInput label="이전 이미지" value={shortcutDraft.previous_image} onChange={value => setShortcutDraft(current => ({ ...current, previous_image: value }))} />
        <ShortcutInput label="다음 이미지" value={shortcutDraft.next_image} onChange={value => setShortcutDraft(current => ({ ...current, next_image: value }))} />
        <ShortcutInput label="라벨링 제출" value={shortcutDraft.submit} onChange={value => setShortcutDraft(current => ({ ...current, submit: value }))} />
        {shortcutError && <div className="shortcut-error">{shortcutError}</div>}
        <footer><button onClick={() => { setShortcutDraft(DEFAULT_SHORTCUTS); setShortcutError('') }}><RotateCcw /> 기본값</button><button className="primary" onClick={() => void saveShortcutSettings()} disabled={shortcutSaving}>{shortcutSaving ? '저장 중…' : '설정 저장'}</button></footer>
      </div>}
    </header>
    {(error || auto.message) && <div className="error-banner workspace-error"><CircleAlert />{error || auto.message}</div>}
    <div className="workspace-grid">
      <aside className="asset-strip">
        <span className="eyebrow">IMAGES</span>
        <div className="image-navigation"><button onClick={() => void navigate(previousTask)} disabled={!previousTask || navigating} title={`이전 이미지 (${displayShortcut(shortcutSettings.previous_image)})`}><ChevronLeft /></button><span>같은 폴더</span><button onClick={() => void navigate(nextTask)} disabled={!nextTask || navigating} title={`다음 이미지 (${displayShortcut(shortcutSettings.next_image)})`}><ChevronRight /></button></div>
        <button className="thumbnail active">{url && <img src={url} alt={asset?.original_filename ?? '현재 이미지'} />}<small>{asset?.original_filename ?? '불러오는 중…'}</small></button>
        <div className="navigation-help"><kbd>{displayShortcut(shortcutSettings.previous_image)}</kbd><kbd>{displayShortcut(shortcutSettings.next_image)}</kbd><small>이미지 이동</small></div>
      </aside>
      <section className="viewer-area">{asset && url ? <AnnotationViewer asset={asset} imageUrl={url} labels={labels} readOnly={readOnly} /> : <div className="viewer-loading">영상을 안전하게 불러오는 중…</div>}</section>
      <aside className="label-panel">
        <span className="eyebrow">LABELS</span><h3>라벨 체계</h3>
        {labelBindings.filter(binding => binding.label.annotation_type !== 'classification').map(({ label, shortcut }) => <button className={selectedLabel === label.label_code ? 'label-item active' : 'label-item'} onClick={() => selectLabel(label)} key={label.label_code}><span style={{ background: label.color }} /><div><strong>{label.label_name}</strong><small>{label.annotation_type}</small></div>{shortcut && <kbd>{displayShortcut(shortcut)}</kbd>}</button>)}
        {classification.length > 0 && <><span className="eyebrow section-label">CLASSIFICATION</span>{labelBindings.filter(binding => binding.label.annotation_type === 'classification').map(({ label, shortcut }) => <label className="classification" key={label.label_code}><input type="checkbox" checked={annotations.some(annotation => annotation.annotation_type === 'classification' && annotation.label_id === label.label_code)} onChange={() => toggleClass(label)} disabled={readOnly} /><span style={{ '--label-color': label.color } as CSSProperties}>{label.label_name}</span>{shortcut && <kbd>{displayShortcut(shortcut)}</kbd>}</label>)}</>}
        <div className="annotation-list"><span className="eyebrow">ANNOTATIONS · {annotations.length}</span>{annotations.filter(annotation => annotation.annotation_type !== 'classification').map(annotation => <div key={annotation.id}><span style={{ background: labels.find(label => label.label_code === annotation.label_id)?.color }} /><span>{labels.find(label => label.label_code === annotation.label_id)?.label_name ?? annotation.label_id}<small>{annotation.annotation_type}</small></span>{!readOnly && <button onClick={() => remove(annotation.id)}>×</button>}</div>)}</div>
      </aside>
    </div>
  </div>
}
function ShortcutInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const capture = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return
    event.preventDefault()
    const shortcut = shortcutFromEvent(event.nativeEvent)
    if (shortcut) onChange(shortcut)
  }
  return <label className="shortcut-field"><span>{label}</span><input value={displayShortcut(value)} onChange={() => undefined} onKeyDown={capture} readOnly aria-label={`${label} 단축키`} /></label>
}
