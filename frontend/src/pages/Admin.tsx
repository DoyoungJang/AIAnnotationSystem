import { useState } from 'react'
import { Database, FolderKanban, KeyRound, Trash2, UserPlus, Users, X } from 'lucide-react'
import { ApiError, request } from '../api/client'
import { PASSWORD_POLICY_MESSAGE, passwordPairError } from '../passwordPolicy'
import type { Project, Role, Task, User } from '../types'
import { Projects } from './Projects'
import { ProjectData } from './ProjectData'
import { DeletedProjects } from './DeletedProjects'

const roleNames: Record<Role, string> = {
  ADMINISTRATOR: 'Sudo 관리자',
  PROJECT_MANAGER: '프로젝트 관리자',
  ANNOTATOR: '라벨러',
  REVIEWER: '검수자',
  OBSERVER: '관찰자',
}

export function Admin({ actor, projects, tasks, users, onRefresh }: {
  actor: User
  projects: Project[]
  tasks: Task[]
  users: User[]
  onRefresh: () => void
}) {
  const [section, setSection] = useState<'projects' | 'data' | 'deleted_projects' | 'users'>('projects')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [resetUserId, setResetUserId] = useState('')
  const [resetMessage, setResetMessage] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetting, setResetting] = useState(false)

  const createUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')
    const form = event.currentTarget
    const data = new FormData(form)
    const password = String(data.get('password') ?? '')
    const passwordConfirm = String(data.get('password_confirm') ?? '')
    const passwordError = passwordPairError(password, passwordConfirm)
    if (passwordError) { setError(passwordError); return }
    try {
      const created = await request<User>('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: data.get('username'),
          display_name: data.get('display_name'),
          role: data.get('role'),
          password,
          password_confirm: passwordConfirm,
        }),
      })
      form.reset()
      setMessage(`${created.display_name} 계정을 생성했습니다.`)
      onRefresh()
    } catch (cause) {
      setError(cause instanceof ApiError ? String(cause.detail) : '사용자를 생성하지 못했습니다.')
    }
  }

  const resetPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const password = String(data.get('password') ?? '')
    const passwordConfirm = String(data.get('password_confirm') ?? '')
    const passwordError = passwordPairError(password, passwordConfirm)
    setResetMessage(''); setResetError('')
    if (passwordError) { setResetError(passwordError); return }
    const target = users.find(user => user.id === resetUserId)
    if (!target) { setResetError('비밀번호를 변경할 사용자를 찾을 수 없습니다.'); return }
    setResetting(true)
    try {
      await request<User>(`/users/${target.id}/password`, { method: 'PATCH', body: JSON.stringify({ password, password_confirm: passwordConfirm }) })
      form.reset(); setResetUserId(''); setResetMessage(`${target.display_name} 사용자의 비밀번호를 변경했습니다.`); onRefresh()
    } catch (cause) {
      setResetError(cause instanceof ApiError ? String(cause.detail) : '비밀번호를 변경하지 못했습니다.')
    } finally { setResetting(false) }
  }

  return <>
    <header className="page-header">
      <div><span className="eyebrow">ADMINISTRATION</span><h1>관리자 페이지</h1><p>사용자에게 필요한 기능만 노출하고 프로젝트와 작업 배정을 안전하게 관리합니다.</p></div>
      <span className="secure-badge">{roleNames[actor.role]}</span>
    </header>
    <div className="admin-tabs">
      <button className={section === 'projects' ? 'active' : ''} onClick={() => setSection('projects')}><FolderKanban /> 프로젝트 관리</button>
      <button className={section === 'data' ? 'active' : ''} onClick={() => setSection('data')}><Database /> 프로젝트 데이터</button>
      {actor.role === 'ADMINISTRATOR' && <button className={section === 'deleted_projects' ? 'active' : ''} onClick={() => setSection('deleted_projects')}><Trash2 /> 삭제된 프로젝트</button>}
      {actor.role === 'ADMINISTRATOR' && <button className={section === 'users' ? 'active' : ''} onClick={() => setSection('users')}><Users /> 사용자 관리</button>}
    </div>
    {section === 'projects' && <Projects actor={actor} projects={projects} tasks={tasks} users={users} onRefresh={onRefresh} />}
    {section === 'data' && <ProjectData projects={projects} users={users} />}
    {section === 'deleted_projects' && actor.role === 'ADMINISTRATOR' && <DeletedProjects />}
    {section === 'users' && actor.role === 'ADMINISTRATOR' && <div className="admin-user-layout">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">ACCOUNT CREATION</span><h2>사용자 생성</h2></div><UserPlus /></div>
        {message && <div className="success-banner">{message}</div>}
        {error && <div className="error-banner">{error}</div>}
        <form className="admin-form" onSubmit={createUser}>
          <label>로그인 아이디<input name="username" pattern="[a-zA-Z0-9_.-]+" maxLength={80} required /></label>
          <label>표시 이름<input name="display_name" maxLength={120} required /></label>
          <label>역할<select name="role" defaultValue="ANNOTATOR">{Object.entries(roleNames).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
          <label>초기 비밀번호<input name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
          <label>초기 비밀번호 확인<input name="password_confirm" type="password" minLength={8} autoComplete="new-password" required /></label>
          <small className="muted">{PASSWORD_POLICY_MESSAGE} Sudo 관리자만 계정을 만들 수 있습니다.</small>
          <button className="primary"><UserPlus /> 계정 생성</button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">USERS</span><h2>등록된 사용자</h2></div><span>{users.length}명</span></div>
        {resetMessage && <div className="success-banner">{resetMessage}</div>}{resetError && <div className="error-banner">{resetError}</div>}
        <div className="user-list">{users.map(user => <article key={user.id} className="user-account"><div className="user-row"><span className="avatar">{user.display_name.slice(0, 1)}</span><div><strong>{user.display_name}</strong><small>@{user.username}</small></div><span className={`role-badge role-${user.role.toLowerCase()}`}>{roleNames[user.role]}</span><button className="password-reset-toggle" onClick={() => { setResetUserId(current => current === user.id ? '' : user.id); setResetMessage(''); setResetError('') }}>{resetUserId === user.id ? <X /> : <KeyRound />}{resetUserId === user.id ? '취소' : '비밀번호 변경'}</button></div>{resetUserId === user.id && <form className="password-reset-form" onSubmit={resetPassword}><strong>{user.display_name} 새 비밀번호</strong><div><input name="password" type="password" minLength={8} placeholder="새 비밀번호" autoComplete="new-password" autoFocus required /><input name="password_confirm" type="password" minLength={8} placeholder="새 비밀번호 확인" autoComplete="new-password" required /><button className="primary" disabled={resetting}><KeyRound />{resetting ? '변경 중…' : '변경 저장'}</button></div><small>{PASSWORD_POLICY_MESSAGE}</small></form>}</article>)}</div>
      </section>
    </div>}
  </>
}
