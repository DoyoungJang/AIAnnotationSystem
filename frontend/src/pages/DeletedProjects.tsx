import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react'
import { ApiError, request } from '../api/client'
import type { Project } from '../types'

interface PurgeResult {
  project_id: string
  deleted_assets: number
  deleted_tasks: number
  deleted_files: number
}

export function DeletedProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [confirmingId, setConfirmingId] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const [deleteError, setDeleteError] = useState('')

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      setProjects(await request<Project[]>('/projects/deleted'))
    } catch (cause) {
      setLoadError(cause instanceof ApiError ? String(cause.detail) : '삭제된 프로젝트 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const openConfirmation = (projectId: string) => {
    setConfirmingId(projectId)
    setConfirmation('')
    setMessage('')
    setDeleteError('')
  }

  const purge = async (project: Project) => {
    if (confirmation !== project.name || deleting) return
    setDeleting(true)
    setDeleteError('')
    setMessage('')
    try {
      const result = await request<PurgeResult>(`/projects/deleted/${project.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ project_name: confirmation }),
      })
      setProjects(current => current.filter(item => item.id !== project.id))
      setConfirmingId('')
      setConfirmation('')
      setMessage(`${project.name} 프로젝트를 완전히 삭제했습니다. 영상 ${result.deleted_assets}개, 작업 ${result.deleted_tasks}개, 파일 ${result.deleted_files}개를 정리했습니다.`)
    } catch (cause) {
      setDeleteError(cause instanceof ApiError ? String(cause.detail) : '프로젝트를 완전히 삭제하지 못했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  return <section className="panel deleted-projects-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">RECYCLE BIN · SUDO ONLY</span><h2>삭제된 프로젝트</h2></div>
      <button onClick={() => void load()} disabled={loading}><RefreshCw /> 새로고침</button>
    </div>
    <div className="permanent-delete-warning"><AlertTriangle /><div><strong>완전 삭제는 되돌릴 수 없습니다.</strong><span>논리 삭제된 프로젝트만 표시됩니다. 프로젝트 기록, 라벨, 작업, 영상 파일과 내보내기 파일이 함께 삭제됩니다.</span></div></div>
    {message && <div className="success-banner">{message}</div>}
    {loadError && <div className="error-banner">{loadError}</div>}
    {loading ? <div className="deleted-projects-empty">삭제된 프로젝트를 불러오는 중입니다.</div> : projects.length === 0 ? <div className="deleted-projects-empty"><Trash2 /><strong>논리 삭제된 프로젝트가 없습니다.</strong></div> : <div className="deleted-project-list">
      {projects.map(project => <article key={project.id} className="deleted-project-card">
        <div className="deleted-project-summary">
          <span className="project-dot" />
          <div><strong>{project.name}</strong><small>{project.folder_path || '최상위 폴더'} · 삭제 처리 {new Date(project.updated_at).toLocaleString('ko-KR')}</small></div>
          <button className="danger" onClick={() => confirmingId === project.id ? setConfirmingId('') : openConfirmation(project.id)}><Trash2 /> 완전 삭제</button>
        </div>
        {confirmingId === project.id && <div className="permanent-delete-confirm">
          <strong>확인하려면 프로젝트 이름을 정확히 입력하세요.</strong>
          <code>{project.name}</code>
          <input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="프로젝트 이름 입력" autoFocus />
          <button className="danger" disabled={confirmation !== project.name || deleting} onClick={() => void purge(project)}>{deleting ? '삭제 중…' : '영구적으로 삭제'}</button>
          {deleteError && <div className="error-banner">{deleteError}</div>}
        </div>}
      </article>)}
    </div>}
  </section>
}
