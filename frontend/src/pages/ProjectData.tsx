import { useEffect, useMemo, useState } from 'react'
import { Archive, CheckSquare2, Eye, FolderTree, RefreshCw, Search, ShieldAlert, Square } from 'lucide-react'
import { ApiError, downloadExport, imageUrl, request } from '../api/client'
import { useAnnotationStore } from '../stores/annotationStore'
import type { AnnotationResponse, Asset, ExportJob, Label, Project, ProjectDataItem, Schema, TaskStatus, User } from '../types'
import { AnnotationViewer } from '../viewer/AnnotationViewer'

export type ProjectDataFilter = 'ALL' | 'UNWORKED' | 'SUBMITTED' | 'REVIEWED'
type ProjectDataSort = 'PATH_ASC' | 'PATH_DESC' | 'STATUS'

const exportableStatuses = new Set<TaskStatus>(['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'])
const submittedStatuses = new Set<TaskStatus>(['SUBMITTED', 'IN_REVIEW'])
const reviewedStatuses = new Set<TaskStatus>(['APPROVED', 'REJECTED'])
const statusOrder: Record<string, number> = { APPROVED: 0, REJECTED: 1, IN_REVIEW: 2, SUBMITTED: 3, DRAFT: 4, IN_PROGRESS: 5, ASSIGNED: 6, UNASSIGNED: 7 }

export function projectDataState(item: ProjectDataItem): Exclude<ProjectDataFilter, 'ALL'> {
  if (item.task_status && reviewedStatuses.has(item.task_status)) return 'REVIEWED'
  if (item.task_status && submittedStatuses.has(item.task_status)) return 'SUBMITTED'
  return 'UNWORKED'
}

export function isProjectDataExportable(item: ProjectDataItem): boolean {
  return item.task_status !== null && exportableStatuses.has(item.task_status)
}

export function filterProjectData(items: ProjectDataItem[], filter: ProjectDataFilter, search: string): ProjectDataItem[] {
  const term = search.trim().toLocaleLowerCase()
  return items.filter(item => (filter === 'ALL' || projectDataState(item) === filter)
    && (!term || `${item.relative_path} ${item.dataset_name} ${item.original_filename}`.toLocaleLowerCase().includes(term)))
}

const statusNames: Record<string, string> = {
  UNASSIGNED: '미배정', ASSIGNED: '배정됨', IN_PROGRESS: '작업 중', DRAFT: '임시 저장', SUBMITTED: '제출',
  IN_REVIEW: '검수 중', CHANGES_REQUESTED: '수정 요청', APPROVED: '검수 완료', REJECTED: '반려', LOCKED: '잠김',
}

export function ProjectData({ projects, users }: { projects: Project[]; users: User[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [items, setItems] = useState<ProjectDataItem[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [filter, setFilter] = useState<ProjectDataFilter>('ALL')
  const [sort, setSort] = useState<ProjectDataSort>('PATH_ASC')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<ProjectDataItem>()
  const [previewUrl, setPreviewUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const { annotations, load } = useAnnotationStore()
  const userNames = useMemo(() => Object.fromEntries(users.map(user => [user.id, user.display_name])), [users])

  const refresh = async () => {
    if (!projectId) return
    setLoading(true); setError('')
    try {
      const [data, schemas] = await Promise.all([
        request<ProjectDataItem[]>(`/projects/${projectId}/data-items`),
        request<Schema[]>(`/projects/${projectId}/label-schemas`),
      ])
      setItems(data)
      setLabels(schemas[0]?.schema_json.labels ?? [])
      setSelected(current => new Set([...current].filter(id => data.some(item => item.asset_id === id && isProjectDataExportable(item)))))
      setActive(current => current ? data.find(item => item.asset_id === current.asset_id) : undefined)
    } catch (cause) {
      setError(errorText(cause, '프로젝트 데이터를 불러오지 못했습니다.'))
    } finally { setLoading(false) }
  }

  useEffect(() => { setItems([]); setSelected(new Set()); setActive(undefined); setFilter('ALL'); void refresh() }, [projectId])

  useEffect(() => {
    let disposed = false
    let objectUrl = ''
    setPreviewUrl(''); load([])
    if (!active) return
    setPreviewLoading(true); setError('')
    void (async () => {
      try {
        const [url, response] = await Promise.all([
          imageUrl(active.asset_id),
          active.task_id ? request<AnnotationResponse>(`/tasks/${active.task_id}/annotations`) : Promise.resolve({ aggregate_version: 0, annotations: [] }),
        ])
        objectUrl = url
        if (disposed) { URL.revokeObjectURL(url); return }
        setPreviewUrl(url); load(response.annotations)
      } catch (cause) {
        if (!disposed) setError(errorText(cause, '영상과 라벨링 결과를 불러오지 못했습니다.'))
      } finally { if (!disposed) setPreviewLoading(false) }
    })()
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [active?.asset_id, active?.task_id, load])

  const visible = useMemo(() => {
    const result = filterProjectData(items, filter, search)
    return result.sort((left, right) => sort === 'STATUS'
      ? (statusOrder[left.task_status ?? 'UNASSIGNED'] ?? 99) - (statusOrder[right.task_status ?? 'UNASSIGNED'] ?? 99) || left.relative_path.localeCompare(right.relative_path)
      : left.relative_path.localeCompare(right.relative_path) * (sort === 'PATH_DESC' ? -1 : 1))
  }, [items, filter, search, sort])
  const selectableVisible = visible.filter(isProjectDataExportable)
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every(item => selected.has(item.asset_id))

  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next
  })
  const toggleVisible = () => setSelected(current => {
    const next = new Set(current)
    selectableVisible.forEach(item => allVisibleSelected ? next.delete(item.asset_id) : next.add(item.asset_id))
    return next
  })
  const createArchive = async () => {
    if (!projectId || !selected.size) return
    setExporting(true); setError(''); setMessage('')
    try {
      const job = await request<ExportJob>(`/projects/${projectId}/data-export`, { method: 'POST', body: JSON.stringify({ asset_ids: [...selected] }) })
      const filename = job.storage_key?.split(/[\\/]/).at(-1) ?? `project-data-${job.id}.7z`
      await downloadExport(job.id, filename)
      setMessage(`${selected.size}개 영상을 폴더 구조 그대로 7z로 저장했습니다.`)
    } catch (cause) {
      setError(errorText(cause, '7z 파일을 만들거나 내려받지 못했습니다.'))
    } finally { setExporting(false) }
  }

  const previewAsset: Asset | undefined = active ? {
    id: active.asset_id, dataset_id: active.dataset_id, series_id: '', media_type: active.media_type,
    original_filename: active.original_filename, relative_path: active.relative_path, width: active.width, height: active.height,
    frame_count: active.frame_count, checksum: '', quality_status: '', phi_suspected: active.phi_suspected,
  } : undefined

  return <section className="project-data-page">
    <div className="project-data-controls panel">
      <div className="panel-heading"><div><span className="eyebrow">PROJECT DATA ARCHIVE</span><h2>프로젝트 데이터</h2></div><FolderTree /></div>
      <div className="project-data-control-grid">
        <label>프로젝트<select value={projectId} onChange={event => setProjectId(event.target.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="project-data-search">경로 검색<span><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="폴더, 파일, 데이터셋" /></span></label>
        <label>상태 필터<select value={filter} onChange={event => setFilter(event.target.value as ProjectDataFilter)}><option value="ALL">전체</option><option value="UNWORKED">미작업</option><option value="SUBMITTED">제출됨</option><option value="REVIEWED">검수 완료</option></select></label>
        <label>정렬<select value={sort} onChange={event => setSort(event.target.value as ProjectDataSort)}><option value="PATH_ASC">경로 오름차순</option><option value="PATH_DESC">경로 내림차순</option><option value="STATUS">상태별</option></select></label>
        <button onClick={() => void refresh()} disabled={loading}><RefreshCw /> 새로고침</button>
      </div>
      <div className="project-data-summary"><span>전체 <strong>{items.length}</strong></span><span>미작업 <strong>{items.filter(item => projectDataState(item) === 'UNWORKED').length}</strong></span><span>제출됨 <strong>{items.filter(item => projectDataState(item) === 'SUBMITTED').length}</strong></span><span>검수 완료 <strong>{items.filter(item => projectDataState(item) === 'REVIEWED').length}</strong></span></div>
      <div className="project-data-exportbar">
        <button onClick={toggleVisible} disabled={!selectableVisible.length}>{allVisibleSelected ? <CheckSquare2 /> : <Square />} 현재 목록의 저장 가능 영상 선택</button>
        <span>{selected.size}개 선택 · 제출/검수 상태만 저장 가능</span>
        <button className="primary" onClick={() => void createArchive()} disabled={!selected.size || exporting}><Archive /> {exporting ? '7z 생성 중…' : '선택 영상 7z 저장'}</button>
      </div>
      {message && <div className="success-banner project-data-notice">{message}</div>}
      {error && <div className="error-banner project-data-notice">{error}</div>}
    </div>

    <div className="project-data-layout">
      <section className="panel project-data-list-panel">
        <div className="project-data-table project-data-head"><span>선택</span><span>폴더 / 파일</span><span>상태</span><span>라벨</span><span>담당</span><span>보기</span></div>
        <div className="project-data-rows">
          {visible.map(item => <div key={item.asset_id} className={`project-data-table project-data-row ${active?.asset_id === item.asset_id ? 'active' : ''}`}>
            <span><input type="checkbox" aria-label={`${item.relative_path} 저장 선택`} checked={selected.has(item.asset_id)} disabled={!isProjectDataExportable(item)} onChange={() => toggle(item.asset_id)} /></span>
            <button className="project-data-path" title={item.relative_path} onClick={() => setActive(item)}><strong>{item.original_filename}</strong><small>{item.relative_path}<br />{item.dataset_name} · {item.width}×{item.height} · {item.frame_count} frame</small></button>
            <span><span className={`status status-${(item.task_status ?? 'UNASSIGNED').toLowerCase()}`}>{statusNames[item.task_status ?? 'UNASSIGNED']}</span></span>
            <span>{item.annotation_count}개</span>
            <span className="project-data-people"><small>{item.assigned_to ? userNames[item.assigned_to] ?? '알 수 없음' : '미지정'}</small><small>{item.reviewer_id ? `검수 ${userNames[item.reviewer_id] ?? '알 수 없음'}` : '검수자 없음'}</small></span>
            <button className="project-data-eye" onClick={() => setActive(item)} aria-label={`${item.original_filename} 보기`}><Eye /></button>
          </div>)}
          {!loading && !visible.length && <div className="empty">조건에 맞는 영상이 없습니다.</div>}
          {loading && <div className="empty">프로젝트 데이터를 불러오는 중입니다…</div>}
        </div>
      </section>

      <aside className="panel project-data-preview">
        <div className="panel-heading"><div><span className="eyebrow">READ-ONLY PREVIEW</span><h2>영상과 라벨링</h2></div>{active?.phi_suspected && <span title="개인정보 태그 의심"><ShieldAlert /></span>}</div>
        {!active && <div className="project-data-preview-empty"><Eye /><span>목록에서 영상을 선택하세요.</span></div>}
        {active && <>
          <div className="project-data-preview-meta"><strong>{active.original_filename}</strong><small title={active.relative_path}>{active.relative_path}</small><span>{statusNames[active.task_status ?? 'UNASSIGNED']} · 라벨 {active.annotation_count}개</span></div>
          <div className="project-data-viewer">{previewLoading && <div className="viewer-loading">미리보기를 불러오는 중입니다…</div>}{!previewLoading && previewAsset && previewUrl && <AnnotationViewer asset={previewAsset} imageUrl={previewUrl} labels={labels} readOnly />}</div>
          <div className="project-data-labels"><span className="eyebrow">ANNOTATIONS</span>{annotations.length ? annotations.map(annotation => {
            const label = labels.find(item => item.label_code === annotation.label_id)
            return <span key={annotation.id}><i style={{ background: label?.color ?? '#8298a5' }} />{label?.label_name ?? annotation.label_id}<small>{annotation.annotation_type} · frame {annotation.frame_index}</small></span>
          }) : <small>저장된 라벨링이 없습니다.</small>}</div>
        </>}
      </aside>
    </div>
  </section>
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? String(cause.detail) : cause instanceof Error ? cause.message : fallback
}
