import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { request, setToken, token } from './api/client'
import { Login } from './components/Login'
import { Layout, type Page } from './components/Layout'
import { Admin } from './pages/Admin'
import { Dashboard } from './pages/Dashboard'
import { adjacentTasksInSameFolder, Tasks } from './pages/Tasks'
import { TaskWorkspace } from './pages/TaskWorkspace'
import type { Project, Task, User } from './types'

export default function App() {
  const queryClient = useQueryClient()
  const [authenticated, setAuthenticated] = useState(!!token())
  const [page, setPage] = useState<Page>('dashboard')
  const [openTask, setOpenTask] = useState<Task>()
  const { data: user, error } = useQuery({ queryKey: ['me', authenticated], queryFn: () => request<User>('/users/me'), enabled: authenticated, retry: false })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => request<Project[]>('/projects'), enabled: !!user })
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => request<Task[]>('/tasks/my'), enabled: !!user })
  const isManager = !!user && (user.role === 'ADMINISTRATOR' || user.role === 'PROJECT_MANAGER')
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => request<User[]>('/users'), enabled: isManager, retry: false })

  useEffect(() => {
    if (error) {
      setToken(null)
      setAuthenticated(false)
    }
  }, [error])

  if (!authenticated || !user) return <Login onLogin={() => { setPage('dashboard'); setOpenTask(undefined); setAuthenticated(true) }} />
  if (openTask) {
    const adjacentTasks = adjacentTasksInSameFolder(tasks, openTask)
    return <TaskWorkspace key={openTask.id} initialTask={openTask} previousTask={adjacentTasks.previous} nextTask={adjacentTasks.next} user={user} onClose={() => setOpenTask(undefined)} onNavigate={setOpenTask} onChanged={() => void queryClient.invalidateQueries({ queryKey: ['tasks'] })} />
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    void queryClient.invalidateQueries({ queryKey: ['users'] })
  }
  const changePage = (next: Page) => {
    if (next === 'admin' && !isManager) return
    setPage(next)
  }

  return <Layout user={user} page={page} onPage={changePage} onLogout={() => { setToken(null); queryClient.clear(); setPage('dashboard'); setOpenTask(undefined); setAuthenticated(false) }}>
    {page === 'dashboard' && <Dashboard user={user} projects={projects} tasks={tasks} />}
    {page === 'admin' && isManager && <Admin actor={user} projects={projects} tasks={tasks} users={users} onRefresh={refresh} />}
    {page === 'tasks' && <Tasks tasks={tasks} onOpen={setOpenTask} />}
    {page === 'review' && <Tasks tasks={tasks} onOpen={setOpenTask} review />}
  </Layout>
}
