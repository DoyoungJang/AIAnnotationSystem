import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { request,setToken,token } from './api/client'
import { Login } from './components/Login'
import { Layout,type Page } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Projects } from './pages/Projects'
import { Tasks } from './pages/Tasks'
import { TaskWorkspace } from './pages/TaskWorkspace'
import type { Project,Task,User } from './types'

export default function App(){const queryClient=useQueryClient();const[authenticated,setAuthenticated]=useState(!!token());const[page,setPage]=useState<Page>('dashboard');const[openTask,setOpenTask]=useState<Task>();const{data:user,error}=useQuery({queryKey:['me',authenticated],queryFn:()=>request<User>('/users/me'),enabled:authenticated,retry:false});const{data:projects=[]}=useQuery({queryKey:['projects'],queryFn:()=>request<Project[]>('/projects'),enabled:!!user});const{data:tasks=[]}=useQuery({queryKey:['tasks'],queryFn:()=>request<Task[]>('/tasks/my'),enabled:!!user});const{data:users=[]}=useQuery({queryKey:['users'],queryFn:()=>request<User[]>('/users'),enabled:!!user&&['ADMINISTRATOR','PROJECT_MANAGER'].includes(user.role),retry:false});useEffect(()=>{if(error){setToken(null);setAuthenticated(false)}},[error]);if(!authenticated||!user)return <Login onLogin={()=>setAuthenticated(true)}/>;if(openTask)return <TaskWorkspace initialTask={openTask} user={user} onClose={()=>setOpenTask(undefined)} onChanged={()=>void queryClient.invalidateQueries({queryKey:['tasks']})}/>;const refresh=()=>{void queryClient.invalidateQueries({queryKey:['projects']});void queryClient.invalidateQueries({queryKey:['tasks']})};return <Layout user={user} page={page} onPage={setPage} onLogout={()=>{setToken(null);queryClient.clear();setAuthenticated(false)}}>{page==='dashboard'&&<Dashboard user={user} projects={projects} tasks={tasks}/>} {page==='projects'&&<Projects projects={projects} users={users} onRefresh={refresh}/>} {page==='tasks'&&<Tasks tasks={tasks} onOpen={setOpenTask}/>} {page==='review'&&<Tasks tasks={tasks} onOpen={setOpenTask} review/>}</Layout>}
