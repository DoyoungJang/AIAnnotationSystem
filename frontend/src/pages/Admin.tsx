import { useState } from 'react'
import { FolderKanban, UserPlus, Users } from 'lucide-react'
import { ApiError, request } from '../api/client'
import type { Project, Role, User } from '../types'
import { Projects } from './Projects'

const roleNames: Record<Role, string> = {
  ADMINISTRATOR: 'Sudo 관리자',
  PROJECT_MANAGER: '프로젝트 관리자',
  ANNOTATOR: '라벨러',
  REVIEWER: '검수자',
  OBSERVER: '관찰자',
}

export function Admin({ actor, projects, users, onRefresh }: {
  actor: User
  projects: Project[]
  users: User[]
  onRefresh: () => void
}) {
  const [section, setSection] = useState<'projects' | 'users'>('projects')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const createUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      const created = await request<User>('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: data.get('username'),
          display_name: data.get('display_name'),
          role: data.get('role'),
          password: data.get('password'),
        }),
      })
      form.reset()
      setMessage(`${created.display_name} 계정을 생성했습니다.`)
      onRefresh()
    } catch (cause) {
      setError(cause instanceof ApiError ? String(cause.detail) : '사용자를 생성하지 못했습니다.')
    }
  }

  return <>
    <header className="page-header">
      <div><span className="eyebrow">ADMINISTRATION</span><h1>관리자 페이지</h1><p>사용자에게 필요한 기능만 노출하고 프로젝트와 작업 배정을 안전하게 관리합니다.</p></div>
      <span className="secure-badge">{roleNames[actor.role]}</span>
    </header>
    <div className="admin-tabs">
      <button className={section === 'projects' ? 'active' : ''} onClick={() => setSection('projects')}><FolderKanban /> 프로젝트 관리</button>
      {actor.role === 'ADMINISTRATOR' && <button className={section === 'users' ? 'active' : ''} onClick={() => setSection('users')}><Users /> 사용자 관리</button>}
    </div>
    {section === 'projects' && <Projects actor={actor} projects={projects} users={users} onRefresh={onRefresh} />}
    {section === 'users' && actor.role === 'ADMINISTRATOR' && <div className="admin-user-layout">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">ACCOUNT CREATION</span><h2>사용자 생성</h2></div><UserPlus /></div>
        {message && <div className="success-banner">{message}</div>}
        {error && <div className="error-banner">{error}</div>}
        <form className="admin-form" onSubmit={createUser}>
          <label>로그인 아이디<input name="username" pattern="[a-zA-Z0-9_.-]+" maxLength={80} required /></label>
          <label>표시 이름<input name="display_name" maxLength={120} required /></label>
          <label>역할<select name="role" defaultValue="ANNOTATOR">{Object.entries(roleNames).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
          <label>초기 비밀번호<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
          <small className="muted">비밀번호는 12자 이상이어야 합니다. Sudo 관리자만 계정을 만들 수 있습니다.</small>
          <button className="primary"><UserPlus /> 계정 생성</button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">USERS</span><h2>등록된 사용자</h2></div><span>{users.length}명</span></div>
        <div className="user-list">{users.map(user => <div key={user.id} className="user-row"><span className="avatar">{user.display_name.slice(0, 1)}</span><div><strong>{user.display_name}</strong><small>@{user.username}</small></div><span className={`role-badge role-${user.role.toLowerCase()}`}>{roleNames[user.role]}</span></div>)}</div>
      </section>
    </div>}
  </>
}
