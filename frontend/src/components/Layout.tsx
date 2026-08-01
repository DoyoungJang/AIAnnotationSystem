import { Activity, LayoutDashboard, ListChecks, LogOut, Settings, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Role, User } from '../types'

export type Page = 'dashboard' | 'admin' | 'tasks' | 'review'

const roleNames: Record<Role, string> = {
  ADMINISTRATOR: 'Sudo 관리자',
  PROJECT_MANAGER: '프로젝트 관리자',
  ANNOTATOR: '라벨러',
  REVIEWER: '검수자',
  OBSERVER: '관찰자',
}

export function Layout({ user, page, onPage, onLogout, children }: {
  user: User
  page: Page
  onPage: (page: Page) => void
  onLogout: () => void
  children: ReactNode
}) {
  const links: Array<[Page, string, ReactNode]> = [['dashboard', '개요', <LayoutDashboard />]]
  if (user.role === 'ADMINISTRATOR' || user.role === 'PROJECT_MANAGER') links.push(['admin', '관리자', <Settings />])
  if (user.role === 'ANNOTATOR' || user.role === 'ADMINISTRATOR') links.push(['tasks', '내 작업', <ListChecks />])
  if (user.role === 'REVIEWER' || user.role === 'ADMINISTRATOR') links.push(['review', '검수', <ShieldCheck />])

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><Activity /><span>SonoLabel</span></div>
      <nav>{links.map(([key, label, icon]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => onPage(key)}>{icon}<span>{label}</span></button>)}</nav>
      <div className="profile">
        <span className="avatar">{user.display_name.slice(0, 1)}</span>
        <div><strong>{user.display_name}</strong><small>{roleNames[user.role]}</small></div>
        <button title="로그아웃" onClick={onLogout}><LogOut /></button>
      </div>
    </aside>
    <main className="main-content">{children}</main>
  </div>
}
