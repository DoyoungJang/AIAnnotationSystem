import { useEffect, useMemo, useState } from 'react'
import { FileImage, Plus, ShieldAlert, Upload, UserCog } from 'lucide-react'
import { ApiError, request } from '../api/client'
import type { Asset, Dataset, Project, ProjectMember, User } from '../types'

export function Projects({ actor, projects, users, onRefresh }: { actor: User; projects: Project[]; users: User[]; onRefresh: () => void }) {
  const [selectedId, setSelectedId] = useState(projects[0]?.id ?? '')
  const [created, setCreated] = useState<Project[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [memberId, setMemberId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loadingAssets, setLoadingAssets] = useState(false)
  const visibleProjects = useMemo(() => [...projects, ...created.filter(item => !projects.some(project => project.id === item.id))], [projects, created])
  const selected = visibleProjects.find(project => project.id === selectedId) ?? visibleProjects[0]

  useEffect(() => { if (!selectedId && visibleProjects[0]) setSelectedId(visibleProjects[0].id) }, [selectedId, visibleProjects])
  useEffect(() => {
    if (!selected) { setAssets([]); setMembers([]); return }
    let active = true
    setLoadingAssets(true)
    setError('')
    Promise.all([
      request<Dataset[]>(`/projects/${selected.id}/datasets`).then(async datasets => (await Promise.all(datasets.map(dataset => request<Asset[]>(`/datasets/${dataset.id}/assets`)))).flat()),
      request<ProjectMember[]>(`/projects/${selected.id}/members`),
    ]).then(([nextAssets, nextMembers]) => {
      if (active) { setAssets(nextAssets); setMembers(nextMembers) }
    }).catch(cause => { if (active) setError(errorText(cause, '프로젝트 정보를 불러오지 못했습니다.')) })
      .finally(() => { if (active) setLoadingAssets(false) })
    return () => { active = false }
  }, [selected?.id])

  const createProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); clearNotices()
    const form = event.currentTarget; const data = new FormData(form)
    try {
      const project = await request<Project>('/projects', { method: 'POST', body: JSON.stringify({ name: data.get('name'), description: data.get('description'), task_types: ['classification', 'bbox', 'polygon', 'brush'] }) })
      setCreated(items => [project, ...items]); setSelectedId(project.id); form.reset(); setMessage('프로젝트를 생성했습니다.'); onRefresh()
    } catch (cause) { setError(errorText(cause, '프로젝트를 생성하지 못했습니다.')) }
  }
  const addSchema = async () => {
    if (!selected) return; clearNotices()
    try {
      await request(`/projects/${selected.id}/label-schemas`, { method: 'POST', body: JSON.stringify({ status: 'PUBLISHED', labels: [
        { label_code: 'FETAL_HEAD', label_name: '태아 머리', annotation_type: 'polygon', color: '#36d6c2', required: true, shortcut: '1' },
        { label_code: 'STANDARD_PLANE', label_name: '표준 단면', annotation_type: 'classification', color: '#6ea8fe', required: false, shortcut: '2' },
        { label_code: 'ANATOMY_ROI', label_name: '해부학 ROI', annotation_type: 'bbox', color: '#f5b84b', required: false, shortcut: '3' },
        { label_code: 'SEGMENTATION', label_name: '분할 영역', annotation_type: 'brush', color: '#ef6f91', required: false, shortcut: '4' },
      ] }) })
      setMessage('라벨 스키마의 새 버전을 게시했습니다.')
    } catch (cause) { setError(errorText(cause, '라벨 스키마를 만들지 못했습니다.')) }
  }
  const upload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return; clearNotices()
    const form = event.currentTarget
    try {
      const result = await request<{ assets: Asset[]; duplicate_count: number }>(`/projects/${selected.id}/datasets/import`, { method: 'POST', body: new FormData(form) })
      setAssets(current => [...result.assets, ...current.filter(item => !result.assets.some(added => added.id === item.id))])
      setMessage(`${result.assets.length}개 영상 등록, 중복 ${result.duplicate_count}개 제외`); form.reset()
    } catch (cause) { setError(errorText(cause, '데이터를 등록하지 못했습니다.')) }
  }
  const addMember = async () => {
    if (!selected || !memberId) return; clearNotices()
    try {
      const member = await request<ProjectMember>(`/projects/${selected.id}/members`, { method: 'POST', body: JSON.stringify({ user_id: memberId }) })
      setMembers(current => [...current.filter(item => item.user_id !== member.user_id), member]); setMemberId(''); setMessage(`${member.display_name}님을 프로젝트 멤버로 추가했습니다.`)
    } catch (cause) { setError(errorText(cause, '프로젝트 멤버를 추가하지 못했습니다.')) }
  }
  const assign = async (asset: Asset, assignee: string, reviewer: string) => {
    if (!selected) return; clearNotices()
    try {
      await request(`/projects/${selected.id}/tasks`, { method: 'POST', body: JSON.stringify({ media_asset_id: asset.id, assigned_to: assignee || null, reviewer_id: reviewer || null, priority: 50 }) })
      setMessage(`${asset.original_filename} 작업을 배정했습니다.`); onRefresh()
    } catch (cause) { setError(errorText(cause, '작업을 배정하지 못했습니다.')) }
  }
  function clearNotices() { setMessage(''); setError('') }

  const availableMembers = users.filter(user => user.role !== 'ADMINISTRATOR' && !members.some(member => member.user_id === user.id))
  return <>
    {message && <div className="success-banner">{message}</div>}{error && <div className="error-banner">{error}</div>}
    <div className="project-layout">
      <section className="panel project-list"><div className="panel-heading"><h2>프로젝트</h2></div>
        {visibleProjects.map(project => <button className={selected?.id === project.id ? 'project-item active' : 'project-item'} onClick={() => setSelectedId(project.id)} key={project.id}><span className="project-dot" /><div><strong>{project.name}</strong><small>{project.description || '설명 없음'}</small></div></button>)}
        <form className="inline-form" onSubmit={createProject}><input name="name" placeholder="새 프로젝트 이름" required /><input name="description" placeholder="설명" /><button className="primary"><Plus /> 생성</button></form>
      </section>
      <div className="project-details">{selected ? <>
        <section className="panel"><div className="panel-heading"><div><span className="eyebrow">LABEL SCHEMA</span><h2>{selected.name}</h2></div><button onClick={addSchema}>기본 스키마 게시</button></div><p className="muted">게시 후에는 내용을 덮어쓰지 않고 새 버전을 생성합니다.</p></section>
        <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PROJECT ACCESS</span><h2>프로젝트 멤버</h2></div><span>{members.length}명</span></div>
          <div className="member-chips">{members.map(member => <span key={member.id}>{member.display_name}<small>{member.project_role}</small></span>)}</div>
          <div className="member-assign"><select value={memberId} onChange={event => setMemberId(event.target.value)}><option value="">추가할 멤버 선택</option>{availableMembers.map(user => <option key={user.id} value={user.id}>{user.display_name} (@{user.username}) · {roleName(user.role)}</option>)}</select><button onClick={addMember} disabled={!memberId}><UserCog /> 멤버 추가</button></div>
          {availableMembers.length === 0 && <small className="muted">추가할 수 있는 사용자가 없습니다. {actor.role === 'ADMINISTRATOR' ? '사용자 관리에서 계정을 먼저 생성하세요.' : 'Sudo 관리자에게 계정 생성을 요청하세요.'}</small>}
        </section>
        <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PROTECTED IMPORT</span><h2>초음파 영상 등록</h2></div></div><form className="upload-box" onSubmit={upload}><Upload /><strong>PNG, JPG, TIFF, DICOM</strong><span>원본은 변경하지 않고 보호 저장소에 보관합니다.</span><input name="dataset_name" defaultValue="MVP Dataset" required /><input name="files" type="file" multiple accept=".png,.jpg,.jpeg,.bmp,.tif,.tiff,.dcm,.dicom" required /><button className="primary">데이터 등록</button></form></section>
        <section className="panel"><div className="panel-heading"><h2>등록 영상 및 작업 배정</h2><span>{assets.length}개</span></div>{loadingAssets ? <div className="empty">영상을 불러오는 중입니다.</div> : assets.length ? <div className="asset-grid">{assets.map(asset => <AssetCard key={asset.id} asset={asset} users={users} onAssign={assign} />)}</div> : <div className="empty">등록된 영상이 없습니다.</div>}</section>
      </> : <div className="empty panel">프로젝트를 생성하거나 선택하세요.</div>}</div>
    </div>
  </>
}

function AssetCard({ asset, users, onAssign }: { asset: Asset; users: User[]; onAssign: (asset: Asset, assignee: string, reviewer: string) => void }) {
  const [assignee, setAssignee] = useState(''); const [reviewer, setReviewer] = useState('')
  return <article className="asset-card"><div className="asset-preview"><FileImage />{asset.phi_suspected && <span title="DICOM 개인정보 태그 의심"><ShieldAlert /></span>}</div><strong>{asset.original_filename}</strong><small>{asset.width} × {asset.height} · {asset.frame_count} frame</small><select value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">라벨러 선택</option>{users.filter(user => user.role === 'ANNOTATOR' || user.role === 'ADMINISTRATOR').map(user => <option value={user.id} key={user.id}>{user.display_name}</option>)}</select><select value={reviewer} onChange={event => setReviewer(event.target.value)}><option value="">검수자 선택</option>{users.filter(user => user.role === 'REVIEWER' || user.role === 'ADMINISTRATOR').map(user => <option value={user.id} key={user.id}>{user.display_name}</option>)}</select><button onClick={() => onAssign(asset, assignee, reviewer)} disabled={!assignee}>배정</button></article>
}

function errorText(cause: unknown, fallback: string) { return cause instanceof ApiError ? String(cause.detail) : fallback }

function roleName(role: User['role']) {
  return { ADMINISTRATOR: 'Sudo 관리자', PROJECT_MANAGER: '프로젝트 관리자', ANNOTATOR: '라벨러', REVIEWER: '검수자', OBSERVER: '관찰자' }[role]
}
