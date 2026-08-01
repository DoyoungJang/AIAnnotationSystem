import { Activity, FolderKanban, LayoutDashboard, ListChecks, LogOut, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import type { User } from '../types'

export type Page='dashboard'|'projects'|'tasks'|'review'
export function Layout({user,page,onPage,onLogout,children}:{user:User;page:Page;onPage:(page:Page)=>void;onLogout:()=>void;children:ReactNode}){const links=[['dashboard','개요',<LayoutDashboard/>],['projects','프로젝트',<FolderKanban/>],['tasks','내 작업',<ListChecks/>],['review','검수',<ShieldCheck/>]] as const;return <div className="app-shell"><aside className="sidebar"><div className="brand"><Activity/><span>SonoLabel</span></div><nav>{links.map(([key,label,icon])=><button key={key} className={page===key?'active':''} onClick={()=>onPage(key)}>{icon}<span>{label}</span></button>)}</nav><div className="profile"><span className="avatar">{user.display_name.slice(0,1)}</span><div><strong>{user.display_name}</strong><small>{user.role.replace('_',' ')}</small></div><button title="로그아웃" onClick={onLogout}><LogOut/></button></div></aside><main className="main-content">{children}</main></div>}
