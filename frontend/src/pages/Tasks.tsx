import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, FileImage, Folder, LockKeyhole } from 'lucide-react'
import type { Task } from '../types'
import { Status } from './Dashboard'

export interface TaskFolderNode { name: string; path: string; tasks: Task[]; children: TaskFolderNode[] }
export type LabelingTaskFilter = 'ALL' | 'BEFORE_SUBMIT' | 'SUBMITTED'

const SUBMITTED_TASK_STATUSES = new Set<Task['status']>(['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'])

export function labelingTaskFilter(task: Task): Exclude<LabelingTaskFilter, 'ALL'> {
  return SUBMITTED_TASK_STATUSES.has(task.status) ? 'SUBMITTED' : 'BEFORE_SUBMIT'
}

export function filterLabelingTasks(tasks: Task[], filter: LabelingTaskFilter): Task[] {
  return filter === 'ALL' ? tasks : tasks.filter(task => labelingTaskFilter(task) === filter)
}

export function Tasks({ tasks, onOpen, review = false }: { tasks: Task[]; onOpen: (task: Task) => void; review?: boolean }) {
  const [labelingFilter, setLabelingFilter] = useState<LabelingTaskFilter>('ALL')
  const beforeSubmitCount = useMemo(() => tasks.filter(task => labelingTaskFilter(task) === 'BEFORE_SUBMIT').length, [tasks])
  const submittedCount = tasks.length - beforeSubmitCount
  const visible = useMemo(() => review ? tasks.filter(task => ['SUBMITTED', 'IN_REVIEW'].includes(task.status)) : filterLabelingTasks(tasks, labelingFilter), [review, tasks, labelingFilter])
  const projectTrees = useMemo(() => buildTaskProjectTrees(visible), [visible])
  const [expandedFolders, setExpandedFolders] = useState<string[]>([])

  useEffect(() => {
    setExpandedFolders(current => [...new Set([...current, ...projectTrees.map(tree => tree.path)])])
  }, [projectTrees])

  const expanded = useMemo(() => new Set(expandedFolders), [expandedFolders])
  const toggleFolder = (path: string) => setExpandedFolders(current => current.includes(path) ? current.filter(item => item !== path) : [...current, path])

  return <>
    <header className="page-header"><div><span className="eyebrow">{review ? 'QUALITY REVIEW' : 'ANNOTATION QUEUE'}</span><h1>{review ? '검수 대기열' : '내 작업'}</h1><p>{review ? '제출된 라벨을 확인하고 승인 또는 수정 요청합니다.' : '배정된 영상을 라벨링하고, 제출 이후 결과도 읽기 전용으로 확인할 수 있습니다.'}</p></div></header>
    {!review && <div className="task-status-filters" role="group" aria-label="제출 상태별 작업 보기">
      <button className={labelingFilter === 'ALL' ? 'active' : ''} onClick={() => setLabelingFilter('ALL')}>전체 <strong>{tasks.length}</strong></button>
      <button className={labelingFilter === 'BEFORE_SUBMIT' ? 'active' : ''} onClick={() => setLabelingFilter('BEFORE_SUBMIT')}>제출 전 <strong>{beforeSubmitCount}</strong></button>
      <button className={labelingFilter === 'SUBMITTED' ? 'active' : ''} onClick={() => setLabelingFilter('SUBMITTED')}>제출 완료 <strong>{submittedCount}</strong></button>
    </div>}
    {projectTrees.length ? <section className="task-folder-list">{projectTrees.map(tree => <TaskFolderTree key={tree.path} node={tree} depth={0} expanded={expanded} onToggle={toggleFolder} onOpen={onOpen} />)}</section> : <div className="empty panel">표시할 작업이 없습니다.</div>}
  </>
}

function TaskFolderTree({ node, depth, expanded, onToggle, onOpen }: { node: TaskFolderNode; depth: number; expanded: Set<string>; onToggle: (path: string) => void; onOpen: (task: Task) => void }) {
  const open = expanded.has(node.path)
  const allTasks = collectFolderTasks(node)
  return <section className={`task-folder-node ${depth === 0 ? 'project-root' : ''}`}>
    <button className="task-folder-header" onClick={() => onToggle(node.path)} aria-expanded={open} aria-label={`${node.name} 폴더 ${open ? '접기' : '열기'}`} style={{ paddingLeft: `${14 + depth * 18}px` }}>
      {open ? <ChevronDown /> : <ChevronRight />}<Folder /><span><strong>{node.name}</strong><small>{allTasks.length}개 작업{node.children.length ? ` · 하위 폴더 ${node.children.length}개` : ''}</small></span>
    </button>
    {open && <div className="task-folder-contents">
      {node.tasks.length > 0 && <div className="task-grid folder-task-grid">{node.tasks.map(task => <TaskCard task={task} onOpen={onOpen} key={task.id} />)}</div>}
      {node.children.map(child => <TaskFolderTree node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpen={onOpen} key={child.path} />)}
    </div>}
  </section>
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  const filename = task.media_asset_original_filename || task.media_asset_relative_path?.split('/').at(-1) || '보호된 의료영상'
  return <button className="task-card" onClick={() => onOpen(task)}><div><span className="mono">TASK {task.id.slice(0, 8)}</span><Status status={task.status} /></div><div className="task-image"><LockKeyhole /><FileImage /><strong title={task.media_asset_relative_path}>{filename}</strong><span>보호된 의료영상</span></div><footer><span>Priority {task.priority} · Version {task.aggregate_version}</span><ArrowRight /></footer></button>
}

export function buildTaskProjectTrees(tasks: Task[]): TaskFolderNode[] {
  const projects = new Map<string, Task[]>()
  tasks.forEach(task => projects.set(task.project_id, [...(projects.get(task.project_id) ?? []), task]))
  return [...projects.entries()].map(([projectId, projectTasks]) => buildTaskFolderTree(projectTasks, projectTasks[0]?.project_name || `프로젝트 ${projectId.slice(0, 8)}`))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'))
}

export function buildTaskFolderTree(tasks: Task[], projectName: string): TaskFolderNode {
  type MutableNode = TaskFolderNode & { childMap: Map<string, MutableNode> }
  const projectId = tasks[0]?.project_id || 'unknown'
  const root: MutableNode = { name: projectName, path: `project:${projectId}`, tasks: [], children: [], childMap: new Map() }
  for (const task of tasks) {
    const relativePath = task.media_asset_relative_path || task.media_asset_original_filename || task.media_asset_id
    const folders = relativePath.split('/').slice(0, -1).filter(Boolean)
    let current = root
    for (const folderName of folders) {
      let child = current.childMap.get(folderName)
      if (!child) {
        child = { name: folderName, path: `${current.path}/${folderName}`, tasks: [], children: [], childMap: new Map() }
        current.childMap.set(folderName, child)
        current.children.push(child)
      }
      current = child
    }
    current.tasks.push(task)
  }
  const sortNode = (node: MutableNode) => {
    node.tasks.sort((left, right) => (left.media_asset_relative_path || left.media_asset_id).localeCompare(right.media_asset_relative_path || right.media_asset_id, 'ko'))
    node.children.sort((left, right) => left.name.localeCompare(right.name, 'ko'))
    node.children.forEach(child => sortNode(child as MutableNode))
  }
  sortNode(root)
  return root
}

export function collectFolderTasks(node: TaskFolderNode): Task[] {
  return [...node.tasks, ...node.children.flatMap(collectFolderTasks)]
}

const NEXT_LABELING_STATUSES = new Set<Task['status']>(['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'DRAFT', 'CHANGES_REQUESTED'])

export function taskFolderPath(task: Task): string {
  const relativePath = (task.media_asset_relative_path || task.media_asset_original_filename || task.media_asset_id).replaceAll('\\', '/')
  return relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : ''
}

export function adjacentTasksInSameFolder(tasks: Task[], current: Task): { previous?: Task; next?: Task } {
  const folder = taskFolderPath(current)
  const sameFolder = [...tasks, ...(tasks.some(task => task.id === current.id) ? [] : [current])]
    .filter(task => task.project_id === current.project_id && task.assigned_to === current.assigned_to && taskFolderPath(task) === folder && (task.id === current.id || NEXT_LABELING_STATUSES.has(task.status)))
    .sort((left, right) => {
      const leftPath = left.media_asset_relative_path || left.media_asset_original_filename || left.media_asset_id
      const rightPath = right.media_asset_relative_path || right.media_asset_original_filename || right.media_asset_id
      return leftPath.localeCompare(rightPath, 'ko') || left.id.localeCompare(right.id)
    })
  const currentIndex = sameFolder.findIndex(task => task.id === current.id)
  return {
    previous: currentIndex > 0 ? sameFolder[currentIndex - 1] : undefined,
    next: currentIndex >= 0 ? sameFolder[currentIndex + 1] : undefined,
  }
}

export function nextTaskInSameFolder(tasks: Task[], current: Task): Task | undefined {
  return adjacentTasksInSameFolder(tasks, current).next
}
