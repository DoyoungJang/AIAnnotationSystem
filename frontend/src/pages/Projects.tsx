import { useEffect, useMemo, useState } from 'react'
import { Archive, CheckSquare, ChevronDown, ChevronRight, Download, FileDown, FileImage, Folder, FolderPlus, Library, Plus, RotateCcw, Save, ShieldAlert, Trash2, Upload, UserCog } from 'lucide-react'
import { ApiError, downloadExport, request } from '../api/client'
import type { Asset, Dataset, ExportJob, Label, LabelPresetNode, Project, ProjectMember, Schema, Task, User } from '../types'

export type AssetSelectionMode = 'all' | 'odd' | 'even' | 'none'
export interface AssetFolderNode { name: string; path: string; assets: Asset[]; children: AssetFolderNode[] }

const ROOT_ASSET_FOLDER_PATH = '__all_assets__'

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff', 'dcm', 'dicom'])
const UPLOAD_BATCH_FILE_LIMIT = 200
const UPLOAD_BATCH_BYTE_LIMIT = 64 * 1024 * 1024
const ASSIGNMENT_BATCH_LIMIT = 1000
const KEEP_REVIEWER = '__KEEP_REVIEWER__'

interface ImportResult { dataset_id: string; assets: Asset[]; duplicate_count: number }

export function buildUploadBatches<T extends { size: number }>(files: T[], maxFiles = UPLOAD_BATCH_FILE_LIMIT, maxBytes = UPLOAD_BATCH_BYTE_LIMIT): T[][] {
  if (maxFiles < 1 || maxBytes < 1) throw new RangeError('Upload batch limits must be positive.')
  const batches: T[][] = []
  let batch: T[] = []
  let batchBytes = 0
  for (const file of files) {
    if (batch.length && (batch.length >= maxFiles || batchBytes + file.size > maxBytes)) {
      batches.push(batch)
      batch = []
      batchBytes = 0
    }
    batch.push(file)
    batchBytes += file.size
  }
  if (batch.length) batches.push(batch)
  return batches
}

const DEFAULT_LABELS: Label[] = [
  { label_code: 'FETAL_HEAD', label_name: '태아 머리', annotation_type: 'polygon', color: '#36d6c2', required: true, shortcut: '1' },
  { label_code: 'STANDARD_PLANE', label_name: '표준 단면', annotation_type: 'classification', color: '#6ea8fe', required: false, shortcut: '2' },
  { label_code: 'ANATOMY_ROI', label_name: '해부학 ROI', annotation_type: 'bbox', color: '#f5b84b', required: false, shortcut: '3' },
  { label_code: 'SEGMENTATION', label_name: '분할 영역', annotation_type: 'brush', color: '#ef6f91', required: false, shortcut: '4' },
]

export function Projects({ actor, projects, tasks, users, onRefresh }: { actor: User; projects: Project[]; tasks: Task[]; users: User[]; onRefresh: () => void }) {
  const [selectedId, setSelectedId] = useState(projects[0]?.id ?? '')
  const [created, setCreated] = useState<Project[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [schemas, setSchemas] = useState<Schema[]>([])
  const [draftLabels, setDraftLabels] = useState<Label[]>([])
  const [schemaMessage, setSchemaMessage] = useState('')
  const [schemaError, setSchemaError] = useState('')
  const [publishingSchema, setPublishingSchema] = useState(false)
  const [presetNodes, setPresetNodes] = useState<LabelPresetNode[]>([])
  const [presetFolderId, setPresetFolderId] = useState<string | null>(null)
  const [presetMessage, setPresetMessage] = useState('')
  const [presetError, setPresetError] = useState('')
  const [presetLoading, setPresetLoading] = useState(true)
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([])
  const [exportFolders, setExportFolders] = useState<string[]>([])
  const [exportFolder, setExportFolder] = useState('')
  const [exportFormat, setExportFormat] = useState<ExportJob['format']>('coco')
  const [includeExportImages, setIncludeExportImages] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [exportError, setExportError] = useState('')
  const [memberId, setMemberId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [folderSelection, setFolderSelection] = useState('선택된 폴더 없음')
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [expandedAssetFolders, setExpandedAssetFolders] = useState<string[]>([ROOT_ASSET_FOLDER_PATH])
  const [assigneeId, setAssigneeId] = useState('')
  const [reviewerId, setReviewerId] = useState(KEEP_REVIEWER)
  const [assigning, setAssigning] = useState(false)
  const [assignmentMessage, setAssignmentMessage] = useState('')
  const [assignmentError, setAssignmentError] = useState('')
  const visibleProjects = useMemo(() => [...projects, ...created.filter(item => !projects.some(project => project.id === item.id))], [projects, created])
  const selected = visibleProjects.find(project => project.id === selectedId) ?? visibleProjects[0]

  useEffect(() => { if (!selectedId && visibleProjects[0]) setSelectedId(visibleProjects[0].id) }, [selectedId, visibleProjects])
  useEffect(() => {
    let active = true
    setPresetLoading(true)
    request<LabelPresetNode[]>('/label-presets')
      .then(nodes => { if (active) setPresetNodes(nodes) })
      .catch(cause => { if (active) setPresetError(errorText(cause, '프리셋을 불러오지 못했습니다.')) })
      .finally(() => { if (active) setPresetLoading(false) })
    return () => { active = false }
  }, [actor.id])
  useEffect(() => {
    let active = true
    request<string[]>('/export-folders').then(folders => { if (active) setExportFolders(folders) }).catch(() => {})
    return () => { active = false }
  }, [actor.id])
  useEffect(() => {
    if (!selected) { setAssets([]); setMembers([]); setSchemas([]); setDraftLabels([]); setSelectedAssetIds([]); setExportJobs([]); return }
    let active = true
    setLoadingAssets(true)
    setError('')
    setSelectedAssetIds([])
    setExpandedAssetFolders([ROOT_ASSET_FOLDER_PATH])
    setAssignmentMessage('')
    setAssignmentError('')
    setSchemas([])
    setDraftLabels([])
    setSchemaMessage('')
    setSchemaError('')
    setExportFolder(safeExportFolderName(selected.name))
    setExportMessage('')
    setExportError('')
    Promise.all([
      request<Dataset[]>(`/projects/${selected.id}/datasets`).then(async datasets => (await Promise.all(datasets.map(dataset => request<Asset[]>(`/datasets/${dataset.id}/assets`)))).flat()),
      request<ProjectMember[]>(`/projects/${selected.id}/members`),
      request<Schema[]>(`/projects/${selected.id}/label-schemas`),
      request<ExportJob[]>(`/projects/${selected.id}/exports`),
    ]).then(([nextAssets, nextMembers, nextSchemas, nextExports]) => {
      if (active) { setAssets(nextAssets); setMembers(nextMembers); setSchemas(nextSchemas); setDraftLabels(nextSchemas[0]?.schema_json.labels.map(label => ({ ...label })) ?? []); setExportJobs(nextExports) }
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
  const addLabel = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSchemaMessage(''); setSchemaError('')
    const form = event.currentTarget; const data = new FormData(form)
    const labelCode = normalizeLabelCode(String(data.get('label_code') ?? ''))
    if (!labelCode) { setSchemaError('라벨 코드는 영문, 숫자, 밑줄 또는 하이픈으로 입력하세요.'); return }
    if (draftLabels.some(label => label.label_code === labelCode)) { setSchemaError(`이미 ${labelCode} 코드가 있습니다.`); return }
    const label: Label = {
      label_code: labelCode,
      label_name: String(data.get('label_name') ?? '').trim(),
      annotation_type: String(data.get('annotation_type')) as Label['annotation_type'],
      color: String(data.get('color')),
      required: data.get('required') === 'on',
      shortcut: String(data.get('shortcut') ?? '').trim() || undefined,
    }
    setDraftLabels(current => [...current, label]); setSchemaMessage(`${label.label_name} 항목을 초안에 추가했습니다.`); form.reset()
    const toolSelect = form.elements.namedItem('annotation_type')
    if (toolSelect instanceof HTMLSelectElement) toolSelect.value = label.annotation_type
  }
  const publishSchema = async () => {
    if (!selected) return
    setSchemaMessage(''); setSchemaError('')
    if (!draftLabels.length) { setSchemaError('게시할 라벨 항목을 한 개 이상 추가하세요.'); return }
    setPublishingSchema(true)
    try {
      const published = await request<Schema>(`/projects/${selected.id}/label-schemas`, { method: 'POST', body: JSON.stringify({ status: 'PUBLISHED', labels: draftLabels }) })
      setSchemas(current => [published, ...current]); setDraftLabels(published.schema_json.labels.map(label => ({ ...label }))); setSchemaMessage(`라벨 스키마 v${published.version}을 게시했습니다.`)
    } catch (cause) { setSchemaError(errorText(cause, '라벨 스키마를 게시하지 못했습니다.')) }
    finally { setPublishingSchema(false) }
  }
  const createPresetFolder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPresetMessage(''); setPresetError('')
    const form = event.currentTarget; const data = new FormData(form)
    try {
      const folder = await request<LabelPresetNode>('/label-presets/folders', { method: 'POST', body: JSON.stringify({ name: data.get('folder_name'), parent_id: presetFolderId }) })
      setPresetNodes(current => [...current, folder]); form.reset(); setPresetMessage(`${folder.name} 폴더를 만들었습니다.`)
    } catch (cause) { setPresetError(errorText(cause, '폴더를 만들지 못했습니다.')) }
  }
  const saveLabelPreset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPresetMessage(''); setPresetError('')
    if (!draftLabels.length) { setPresetError('저장할 라벨 항목을 한 개 이상 추가하세요.'); return }
    const form = event.currentTarget; const data = new FormData(form)
    try {
      const preset = await request<LabelPresetNode>('/label-presets', { method: 'POST', body: JSON.stringify({ name: data.get('preset_name'), parent_id: presetFolderId, labels: draftLabels }) })
      setPresetNodes(current => [...current, preset]); form.reset(); setPresetMessage(`현재 초안을 ${preset.name} 프리셋으로 저장했습니다.`)
    } catch (cause) { setPresetError(errorText(cause, '프리셋으로 저장하지 못했습니다.')) }
  }
  const loadLabelPreset = (preset: LabelPresetNode) => {
    setDraftLabels(preset.labels.map(label => ({ ...label })))
    setPresetMessage(`${preset.name} 프리셋의 ${preset.labels.length}개 항목을 프로젝트 초안에 불러왔습니다.`)
    setPresetError(''); setSchemaMessage(''); setSchemaError('')
  }
  const deletePresetNode = async (node: LabelPresetNode) => {
    const detail = node.node_type === 'FOLDER' ? '폴더 안의 모든 하위 폴더와 프리셋도 함께 삭제됩니다.' : '저장된 프리셋이 삭제됩니다.'
    if (!window.confirm(`${node.name}을(를) 삭제하시겠습니까?\n${detail}`)) return
    setPresetMessage(''); setPresetError('')
    try {
      await request<void>(`/label-presets/${node.id}`, { method: 'DELETE' })
      const removedIds = presetDescendantIds(presetNodes, node.id)
      setPresetNodes(current => current.filter(item => !removedIds.has(item.id)))
      if (presetFolderId && removedIds.has(presetFolderId)) setPresetFolderId(null)
      setPresetMessage(`${node.name}을(를) 삭제했습니다.`)
    } catch (cause) { setPresetError(errorText(cause, '프리셋 항목을 삭제하지 못했습니다.')) }
  }
  const upload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected || uploading) return; clearNotices(); setUploadError(''); setUploadStatus('')
    const form = event.currentTarget
    const formValues = new FormData(form)
    const input = form.elements.namedItem('files') as HTMLInputElement | null
    const selectedFiles = Array.from(input?.files ?? [])
    const files = selectedFiles.filter(file => SUPPORTED_IMAGE_EXTENSIONS.has(file.name.split('.').pop()?.toLowerCase() ?? ''))
    if (!files.length) { setUploadError('PNG, JPG, TIFF 또는 DICOM 파일이 들어 있는 폴더를 선택하세요.'); return }
    const datasetName = String(formValues.get('dataset_name') ?? '').trim()
    const batches = buildUploadBatches(files)
    let datasetId: string | undefined
    let duplicateCount = 0
    let transferredFiles = 0
    const importedAssets: Asset[] = []
    setUploading(true)
    try {
      for (let index = 0; index < batches.length; index += 1) {
        const payload = new FormData()
        payload.append('dataset_name', datasetName)
        if (datasetId) payload.append('dataset_id', datasetId)
        batches[index].forEach(file => {
          payload.append('files', file, file.name)
          payload.append('relative_paths', file.webkitRelativePath || file.name)
        })
        transferredFiles += batches[index].length
        setUploadStatus(`${files.length}개 파일 중 ${transferredFiles}개 전송 중 (${index + 1}/${batches.length})`)
        const result = await request<ImportResult>(`/projects/${selected.id}/datasets/import`, { method: 'POST', body: payload })
        datasetId = result.dataset_id
        duplicateCount += result.duplicate_count
        importedAssets.push(...result.assets)
      }
      setAssets(current => [...importedAssets, ...current.filter(item => !importedAssets.some(added => added.id === item.id))])
      const unsupported = selectedFiles.length - files.length
      setUploadStatus(`${importedAssets.length}개 영상 등록, 중복 ${duplicateCount}개 제외${unsupported ? `, 미지원 파일 ${unsupported}개 제외` : ''}. 폴더 구조를 그대로 보존했습니다.`)
      form.reset(); setFolderSelection('선택된 폴더 없음')
    } catch (cause) {
      if (importedAssets.length) setAssets(current => [...importedAssets, ...current.filter(item => !importedAssets.some(added => added.id === item.id))])
      setUploadError(`${errorText(cause, '데이터를 등록하지 못했습니다.')}${importedAssets.length ? ` (${importedAssets.length}개까지 등록됨)` : ''}`)
      setUploadStatus('')
    } finally { setUploading(false) }
  }
  const createExport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return
    setExportMessage(''); setExportError(''); setExporting(true)
    try {
      const job = await request<ExportJob>(`/projects/${selected.id}/exports`, { method: 'POST', body: JSON.stringify({ format: exportFormat, folder: exportFolder, include_images: includeExportImages }) })
      setExportJobs(current => [job, ...current.filter(item => item.id !== job.id)])
      const folder = job.storage_key?.split('/').slice(0, -1).join('/') || 'Export 저장소 최상위'
      setExportFolders(current => folder === 'Export 저장소 최상위' || current.includes(folder) ? current : [...current, folder].sort())
      setExportMessage(`승인 완료 결과를 ${folder} 폴더에 저장했습니다.`)
    } catch (cause) { setExportError(errorText(cause, '라벨링 결과를 저장하지 못했습니다.')) }
    finally { setExporting(false) }
  }
  const downloadExportJob = async (job: ExportJob) => {
    setExportMessage(''); setExportError('')
    try { await downloadExport(job.id, job.storage_key?.split('/').at(-1) ?? `sonolabel-${job.id}.zip`) }
    catch (cause) { setExportError(errorText(cause, '내보내기 파일을 다운로드하지 못했습니다.')) }
  }
  const addMember = async () => {
    if (!selected || !memberId) return; clearNotices()
    try {
      const member = await request<ProjectMember>(`/projects/${selected.id}/members`, { method: 'POST', body: JSON.stringify({ user_id: memberId }) })
      setMembers(current => [...current.filter(item => item.user_id !== member.user_id), member]); setMemberId(''); setMessage(`${member.display_name}님을 프로젝트 멤버로 추가했습니다.`)
    } catch (cause) { setError(errorText(cause, '프로젝트 멤버를 추가하지 못했습니다.')) }
  }
  const projectTasks = useMemo(() => tasks.filter(task => task.project_id === selected?.id), [tasks, selected?.id])
  const approvedTaskCount = projectTasks.filter(task => task.status === 'APPROVED').length
  const taskByAsset = useMemo(() => {
    const result = new Map<string, Task>()
    for (const task of projectTasks) if (!result.has(task.media_asset_id)) result.set(task.media_asset_id, task)
    return result
  }, [projectTasks])
  const selectableAssets = useMemo(() => assets.filter(asset => !taskByAsset.has(asset.id)), [assets, taskByAsset])
  const assetFolderTree = useMemo(() => buildAssetFolderTree(assets), [assets])
  const expandedAssetFolderSet = useMemo(() => new Set(expandedAssetFolders), [expandedAssetFolders])
  const chooseAssets = (mode: AssetSelectionMode) => setSelectedAssetIds(selectAssetIds(assets, mode))
  const toggleAsset = (assetId: string) => setSelectedAssetIds(current => current.includes(assetId) ? current.filter(id => id !== assetId) : [...current, assetId])
  const toggleAssetFolder = (node: AssetFolderNode) => {
    setSelectedAssetIds(current => toggleFolderAssetSelection(current, node, new Set()))
  }
  const toggleAssetFolderOpen = (path: string) => setExpandedAssetFolders(current => current.includes(path) ? current.filter(item => item !== path) : [...current, path])
  const assignSelected = async () => {
    setAssignmentMessage(''); setAssignmentError('')
    if (!selected) { setAssignmentError('프로젝트를 먼저 선택하세요.'); return }
    if (!selectedAssetIds.length) { setAssignmentError('배정할 이미지를 한 개 이상 선택하세요.'); return }
    const projectAssetIds = new Set(assets.map(asset => asset.id))
    const selectedProjectAssetIds = [...new Set(selectedAssetIds)].filter(assetId => projectAssetIds.has(assetId))
    const existingTaskIds = selectedProjectAssetIds.map(assetId => taskByAsset.get(assetId)?.id).filter((taskId): taskId is string => Boolean(taskId))
    const unassignedAssetIds = selectedProjectAssetIds.filter(assetId => !taskByAsset.has(assetId))
    if (!selectedProjectAssetIds.length) { setAssignmentError('현재 프로젝트의 이미지를 다시 선택하세요.'); return }
    if (unassignedAssetIds.length && !assigneeId) { setAssignmentError('미배정 이미지가 포함되어 있습니다. 신규 배정할 라벨러를 선택하세요.'); return }
    if (existingTaskIds.length && !assigneeId && reviewerId === KEEP_REVIEWER) { setAssignmentError('변경할 라벨러 또는 검수자를 선택하세요.'); return }
    setAssigning(true)
    const changed: Task[] = []
    try {
      for (const taskIds of buildAssignmentBatches(existingTaskIds)) {
        const body: { task_ids: string[]; assigned_to?: string; reviewer_id?: string | null } = { task_ids: taskIds }
        if (assigneeId) body.assigned_to = assigneeId
        if (reviewerId !== KEEP_REVIEWER) body.reviewer_id = reviewerId || null
        changed.push(...await request<Task[]>(`/projects/${selected.id}/tasks/reassign`, { method: 'POST', body: JSON.stringify(body) }))
      }
      for (const mediaAssetIds of buildAssignmentBatches(unassignedAssetIds)) {
        changed.push(...await request<Task[]>(`/projects/${selected.id}/tasks/batch`, { method: 'POST', body: JSON.stringify({ media_asset_ids: mediaAssetIds, assigned_to: assigneeId, reviewer_id: reviewerId === KEEP_REVIEWER ? null : reviewerId || null, priority: 50 }) }))
      }
      setSelectedAssetIds([])
      setAssigneeId('')
      setReviewerId(KEEP_REVIEWER)
      setAssignmentMessage(`${changed.length}개 이미지의 작업 배정을 저장했습니다.`)
      onRefresh()
    } catch (cause) {
      if (changed.length) onRefresh()
      setAssignmentError(`${errorText(cause, '작업 배정을 저장하지 못했습니다.')}${changed.length ? ` (${changed.length}개까지 저장됨)` : ''}`)
    }
    finally { setAssigning(false) }
  }
  function clearNotices() { setMessage(''); setError('') }

  const availableMembers = users.filter(user => user.role !== 'ADMINISTRATOR' && !members.some(member => member.user_id === user.id))
  const presetChildren = childrenInPresetFolder(presetNodes, presetFolderId)
  const presetTrail = presetFolderTrail(presetNodes, presetFolderId)
  return <>
    {message && <div className="success-banner">{message}</div>}{error && <div className="error-banner">{error}</div>}
    <div className="project-layout">
      <section className="panel project-list"><div className="panel-heading"><h2>프로젝트</h2></div>
        {visibleProjects.map(project => <button className={selected?.id === project.id ? 'project-item active' : 'project-item'} onClick={() => setSelectedId(project.id)} key={project.id}><span className="project-dot" /><div><strong>{project.name}</strong><small>{project.description || '설명 없음'}</small></div></button>)}
        <form className="inline-form" onSubmit={createProject}><input name="name" placeholder="새 프로젝트 이름" required /><input name="description" placeholder="설명" /><button className="primary"><Plus /> 생성</button></form>
      </section>
      <div className="project-details">{selected ? <>
        <section className="panel schema-editor">
          <div className="panel-heading"><div><span className="eyebrow">LABEL SCHEMA</span><h2>라벨링 항목 관리</h2></div><span>{schemas[0] ? `게시 버전 v${schemas[0].version}` : '게시 전'} · 초안 {draftLabels.length}개</span></div>
          <p className="muted">프로젝트 관리자가 항목을 추가하거나 삭제한 뒤 새 버전으로 게시합니다. 기존 버전과 완료된 Annotation은 변경되지 않습니다.</p>
          <div className="schema-actions"><button onClick={() => { setDraftLabels(DEFAULT_LABELS.map(label => ({ ...label }))); setSchemaMessage('기본 항목을 초안에 불러왔습니다.'); setSchemaError('') }}>기본 항목 불러오기</button><button onClick={() => { setDraftLabels(schemas[0]?.schema_json.labels.map(label => ({ ...label })) ?? []); setSchemaMessage('최근 게시 버전으로 되돌렸습니다.'); setSchemaError('') }}><RotateCcw /> 게시 버전으로 되돌리기</button><button className="primary" onClick={publishSchema} disabled={publishingSchema}><Save /> {publishingSchema ? '게시 중...' : '새 버전 게시'}</button></div>
          <section className="preset-library" aria-label="라벨 프리셋 라이브러리">
            <div className="preset-heading"><div><Library /><strong>분과별 라벨 프리셋</strong><small>현재 프로젝트 초안을 저장하거나 기존 프리셋을 불러옵니다.</small></div><span>{presetNodes.filter(node => node.node_type === 'PRESET').length}개 프리셋</span></div>
            <nav className="preset-breadcrumb" aria-label="프리셋 폴더 경로">
              <button className={!presetFolderId ? 'active' : ''} onClick={() => setPresetFolderId(null)}>전체 프리셋</button>
              {presetTrail.map(folder => <span key={folder.id}><ChevronRight /><button className={folder.id === presetFolderId ? 'active' : ''} onClick={() => setPresetFolderId(folder.id)}>{folder.name}</button></span>)}
            </nav>
            <div className="preset-create-row">
              <form onSubmit={createPresetFolder}><input name="folder_name" placeholder={presetFolderId ? '하위 폴더 이름' : '분과 폴더 이름'} maxLength={120} required /><button type="submit"><FolderPlus /> 폴더 만들기</button></form>
              <form onSubmit={saveLabelPreset}><input name="preset_name" placeholder="프리셋 이름" maxLength={120} required /><button className="primary" type="submit" disabled={!draftLabels.length}><Save /> 현재 초안 저장</button></form>
            </div>
            {presetMessage && <div className="success-banner preset-notice" role="status">{presetMessage}</div>}
            {presetError && <div className="error-banner preset-notice" role="alert">{presetError}</div>}
            {presetLoading ? <div className="preset-empty">프리셋을 불러오는 중입니다.</div> : <div className="preset-grid">
              {presetChildren.folders.map(folder => <article className="preset-card folder" key={folder.id}><button className="preset-open" onClick={() => setPresetFolderId(folder.id)}><Folder /><span><strong>{folder.name}</strong><small>{presetNodes.filter(node => node.parent_id === folder.id).length}개 항목</small></span></button>{canDeletePresetNode(actor, presetNodes, folder) && <button className="preset-delete" aria-label={`${folder.name} 폴더 삭제`} title="폴더 삭제" onClick={() => deletePresetNode(folder)}><Trash2 /></button>}</article>)}
              {presetChildren.presets.map(preset => <article className="preset-card" key={preset.id}><div><FileDown /><span><strong>{preset.name}</strong><small>{preset.labels.length}개 라벨</small></span></div><div className="preset-card-actions"><button className="primary" onClick={() => loadLabelPreset(preset)}>불러오기</button>{canDeletePresetNode(actor, presetNodes, preset) && <button className="preset-delete" aria-label={`${preset.name} 프리셋 삭제`} title="프리셋 삭제" onClick={() => deletePresetNode(preset)}><Trash2 /></button>}</div></article>)}
              {!presetChildren.folders.length && !presetChildren.presets.length && <div className="preset-empty">이 폴더는 비어 있습니다. 폴더를 만들거나 현재 초안을 프리셋으로 저장하세요.</div>}
            </div>}
          </section>
          <form className="label-add-form" onSubmit={addLabel}>
            <label>항목 이름<input name="label_name" placeholder="예: 병변 경계" maxLength={120} required /></label>
            <label>라벨 코드<input name="label_code" placeholder="예: LESION_BORDER" pattern="[A-Za-z0-9_-]+" maxLength={80} required /></label>
            <label>라벨링 도구<select name="annotation_type" defaultValue="bbox"><option value="classification">분류</option><option value="bbox">박스</option><option value="polygon">폴리곤</option><option value="brush">브러시</option></select></label>
            <label>색상<input name="color" type="color" defaultValue="#35d4bd" /></label>
            <label>단축키<input name="shortcut" placeholder="예: 5" maxLength={10} /></label>
            <label className="required-label"><input name="required" type="checkbox" /> 필수 항목</label>
            <button type="submit"><Plus /> 항목 추가</button>
          </form>
          {schemaMessage && <div className="success-banner schema-notice" role="status">{schemaMessage}</div>}
          {schemaError && <div className="error-banner schema-notice" role="alert">{schemaError}</div>}
          <div className="schema-label-list">{draftLabels.map((label, index) => <article key={label.label_code}><span className="label-color" style={{ background: label.color }} /><div><strong>{label.label_name}</strong><small>{label.label_code} · {annotationTypeName(label.annotation_type)}{label.required ? ' · 필수' : ''}{label.shortcut ? ` · 단축키 ${label.shortcut}` : ''}</small></div><span className="schema-order">{index + 1}</span><button title={`${label.label_name} 삭제`} aria-label={`${label.label_name} 삭제`} onClick={() => { setDraftLabels(current => current.filter(item => item.label_code !== label.label_code)); setSchemaMessage(''); setSchemaError('') }}><Trash2 /></button></article>)}{!draftLabels.length && <div className="empty">아직 라벨 항목이 없습니다. 위 폼에서 첫 항목을 추가하세요.</div>}</div>
        </section>
        <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PROJECT ACCESS</span><h2>프로젝트 멤버</h2></div><span>{members.length}명</span></div>
          <div className="member-chips">{members.map(member => <span key={member.id}>{member.display_name}<small>{member.project_role}</small></span>)}</div>
          <div className="member-assign"><select value={memberId} onChange={event => setMemberId(event.target.value)}><option value="">추가할 멤버 선택</option>{availableMembers.map(user => <option key={user.id} value={user.id}>{user.display_name} (@{user.username}) · {roleName(user.role)}</option>)}</select><button onClick={addMember} disabled={!memberId}><UserCog /> 멤버 추가</button></div>
          {availableMembers.length === 0 && <small className="muted">추가할 수 있는 사용자가 없습니다. {actor.role === 'ADMINISTRATOR' ? '사용자 관리에서 계정을 먼저 생성하세요.' : 'Sudo 관리자에게 계정 생성을 요청하세요.'}</small>}
        </section>
        <section className="panel export-panel">
          <div className="panel-heading"><div><span className="eyebrow">APPROVED EXPORT</span><h2>승인 완료 결과 저장</h2></div><span>승인 작업 {approvedTaskCount}개</span></div>
          <p className="muted">승인된 라벨링 결과만 ZIP으로 만들며, 지정한 경로는 서버의 <code>EXPORT_ROOT</code> 아래에 안전하게 생성됩니다.</p>
          <form className="export-form" onSubmit={createExport}>
            <label>저장 폴더<input value={exportFolder} onChange={event => setExportFolder(event.target.value)} list="export-folder-options" placeholder="예: 영상의학과/유방/2026-08" maxLength={500} required /><datalist id="export-folder-options">{exportFolders.map(folder => <option value={folder} key={folder} />)}</datalist><small>슬래시(/)로 하위 폴더를 구분합니다.</small></label>
            <label>저장 형식<select value={exportFormat} onChange={event => setExportFormat(event.target.value as ExportJob['format'])}><option value="coco">COCO · 박스/폴리곤</option><option value="yolo">YOLO · 박스</option><option value="mask">PNG Mask · 분할</option><option value="csv">CSV · 분류</option></select></label>
            <label className="export-check"><input type="checkbox" checked={includeExportImages} onChange={event => setIncludeExportImages(event.target.checked)} /> 원본 영상 포함</label>
            <button className="primary" disabled={exporting || approvedTaskCount === 0}><Archive /> {exporting ? '저장 중...' : '결과 저장'}</button>
          </form>
          {approvedTaskCount === 0 && <small className="muted">검수자가 승인한 작업이 있어야 결과를 저장할 수 있습니다.</small>}
          {exportMessage && <div className="success-banner export-notice" role="status">{exportMessage}</div>}
          {exportError && <div className="error-banner export-notice" role="alert">{exportError}</div>}
          <div className="export-history">{exportJobs.slice(0, 8).map(job => <article key={job.id}><span className={`export-status ${job.status.toLowerCase()}`}>{job.status}</span><div><strong>{exportFormatName(job.format)}</strong><small>{job.storage_key ?? job.error ?? '저장 경로 준비 중'}</small></div><time>{new Date(job.created_at).toLocaleString('ko-KR')}</time><button onClick={() => downloadExportJob(job)} disabled={job.status !== 'COMPLETED'}><Download /> 내 PC로 ZIP 다운로드</button></article>)}{!exportJobs.length && <div className="empty">아직 저장한 결과가 없습니다.</div>}</div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><span className="eyebrow">PROTECTED IMPORT</span><h2>초음파 영상 등록</h2></div></div>
          <div className="dataset-import-grid">
            <form className="upload-box" onSubmit={upload}>
              <Upload /><strong>파일 선택 등록</strong><span>PNG, JPG, TIFF, DICOM 파일을 여러 개 선택합니다.</span>
              <input name="dataset_name" defaultValue="MVP Dataset" aria-label="데이터셋 이름" required />
              <input name="files" type="file" multiple accept=".png,.jpg,.jpeg,.bmp,.tif,.tiff,.dcm,.dicom" required />
              <button className="primary" disabled={uploading}>{uploading ? '등록 중...' : '선택 파일 등록'}</button>
            </form>
            <form className="upload-box folder-upload" onSubmit={upload}>
              <Folder /><strong>폴더 선택</strong><span>선택한 폴더의 하위 구조와 파일 경로를 그대로 보존합니다.</span>
              <input name="dataset_name" defaultValue="Folder Dataset" aria-label="폴더 데이터셋 이름" required />
              <input id="folder-upload-input" className="folder-file-input" name="files" type="file" multiple accept=".png,.jpg,.jpeg,.bmp,.tif,.tiff,.dcm,.dicom" ref={element => { if (element) { element.setAttribute('webkitdirectory', ''); element.setAttribute('directory', '') } }} onChange={event => { const selectedFolderFiles = Array.from(event.currentTarget.files ?? []); const first = selectedFolderFiles[0]; const root = first?.webkitRelativePath.split('/')[0]; const form = event.currentTarget.form; const nameInput = form?.elements.namedItem('dataset_name') as HTMLInputElement | null; if (root && nameInput) nameInput.value = root; setFolderSelection(root ? `${root} · ${selectedFolderFiles.length}개 파일` : '선택된 폴더 없음') }} required />
              <label className="folder-picker" htmlFor="folder-upload-input"><Folder /> 폴더 선택</label>
              <span className="folder-selection-summary">{folderSelection}</span>
              <button className="primary" disabled={uploading}>{uploading ? '등록 중...' : '폴더 구조 그대로 등록'}</button>
            </form>
          </div>
          {uploadStatus && <div className="success-banner upload-notice" role="status">{uploadStatus}</div>}
          {uploadError && <div className="error-banner upload-notice" role="alert">{uploadError}</div>}
          <p className="import-security-note">원본 파일은 변경하지 않고 난수화된 보호 저장소에 보관하며, 화면에는 안전하게 검증한 상대 폴더 경로만 표시합니다.</p>
        </section>
        <section className="panel assignment-panel"><div className="panel-heading"><div><span className="eyebrow">BATCH ASSIGNMENT</span><h2>등록 영상 및 작업 배정</h2></div><span>{assets.length}개 · 미배정 {selectableAssets.length}개</span></div>
          {assets.length > 0 && <div className="batch-assignment">
            <div className="selection-toolbar"><strong>{selectedAssetIds.length}개 선택</strong><button onClick={() => chooseAssets('all')}>전체 선택</button><button onClick={() => chooseAssets('odd')}>홀수 번째</button><button onClick={() => chooseAssets('even')}>짝수 번째</button><button onClick={() => chooseAssets('none')}>선택 해제</button></div>
            <div className="assignment-fields"><label>라벨러<select value={assigneeId} onChange={event => setAssigneeId(event.target.value)}><option value="">기존 라벨러 유지</option>{users.filter(user => user.role === 'ANNOTATOR' || user.role === 'ADMINISTRATOR').map(user => <option value={user.id} key={user.id}>{user.display_name}</option>)}</select></label><label>검수자<select value={reviewerId} onChange={event => setReviewerId(event.target.value)}><option value={KEEP_REVIEWER}>기존 검수자 유지</option><option value="">검수자 없음</option>{users.filter(user => user.role === 'REVIEWER' || user.role === 'ADMINISTRATOR').map(user => <option value={user.id} key={user.id}>{user.display_name}</option>)}</select></label><button className="primary batch-assign-button" onClick={assignSelected} disabled={assigning}><CheckSquare /> {assigning ? '저장 중...' : `${selectedAssetIds.length}개 배정 저장`}</button></div>
            {!selectedAssetIds.length && <small className="muted">폴더 체크박스, 영상 카드 또는 전체·홀수·짝수 선택 버튼으로 이미지를 선택하세요.</small>}
            {assignmentMessage && <div className="success-banner assignment-notice" role="status">{assignmentMessage}</div>}
            {assignmentError && <div className="error-banner assignment-notice" role="alert">{assignmentError}</div>}
          </div>}
          {loadingAssets ? <div className="empty">영상을 불러오는 중입니다.</div> : assets.length ? <div className="asset-folder-tree"><AssetFolderTreeNode node={assetFolderTree} depth={0} expanded={expandedAssetFolderSet} selectedAssetIds={selectedAssetIds} taskByAsset={taskByAsset} users={users} onToggleOpen={toggleAssetFolderOpen} onToggleFolder={toggleAssetFolder} onToggleAsset={toggleAsset} /></div> : <div className="empty">등록된 영상이 없습니다.</div>}
        </section>
      </> : <div className="empty panel">프로젝트를 생성하거나 선택하세요.</div>}</div>
    </div>
  </>
}

function AssetCard({ asset, selected, task, users, onToggle }: { asset: Asset; selected: boolean; task?: Task; users: User[]; onToggle: (assetId: string) => void }) {
  const assignee = users.find(user => user.id === task?.assigned_to)
  const reviewer = users.find(user => user.id === task?.reviewer_id)
  return <article className={`asset-card selectable ${selected ? 'selected' : ''} ${task ? 'assigned' : ''}`}><label className="asset-selector"><input type="checkbox" checked={selected} onChange={() => onToggle(asset.id)} aria-label={`${asset.original_filename} 선택`} /><span>{task ? '배정 변경' : '선택'}</span></label><div className="asset-preview"><FileImage />{asset.phi_suspected && <span title="DICOM 개인정보 태그 의심"><ShieldAlert /></span>}</div><strong title={asset.original_filename}>{asset.original_filename}</strong><small>{asset.width} × {asset.height} · {asset.frame_count} frame</small>{task ? <div className="assignment-summary"><strong>{assignee?.display_name ?? '미지정'}</strong><small>{reviewer ? `검수 ${reviewer.display_name}` : '검수자 없음'} · {task.status}</small></div> : <small className="available-badge">배정 가능</small>}</article>
}

function AssetFolderTreeNode({ node, depth, expanded, selectedAssetIds, taskByAsset, users, onToggleOpen, onToggleFolder, onToggleAsset }: { node: AssetFolderNode; depth: number; expanded: Set<string>; selectedAssetIds: string[]; taskByAsset: Map<string, Task>; users: User[]; onToggleOpen: (path: string) => void; onToggleFolder: (node: AssetFolderNode) => void; onToggleAsset: (assetId: string) => void }) {
  const allAssets = collectFolderAssets(node)
  const selectableAssets = allAssets.filter(asset => !taskByAsset.has(asset.id))
  const selectedCount = allAssets.filter(asset => selectedAssetIds.includes(asset.id)).length
  const allSelected = allAssets.length > 0 && selectedCount === allAssets.length
  const open = expanded.has(node.path)
  return <section className={`asset-folder-node depth-${Math.min(depth, 4)}`}>
    <header className="asset-folder-header" style={{ marginLeft: `${depth * 18}px` }}>
      <button className="asset-folder-toggle" onClick={() => onToggleOpen(node.path)} aria-expanded={open} aria-label={`${node.name} 폴더 ${open ? '접기' : '열기'}`}>
        {open ? <ChevronDown /> : <ChevronRight />}<Folder /><span><strong>{node.name}</strong><small>전체 {allAssets.length}개 · 미배정 {selectableAssets.length}개{selectedCount ? ` · 선택 ${selectedCount}개` : ''}</small></span>
      </button>
      <label className={`asset-folder-selector ${allSelected ? 'selected' : selectedCount > 0 ? 'partial' : ''}`} title={`${node.name} 안의 영상 전체 선택 또는 배정 변경`}>
        <input type="checkbox" checked={allSelected} disabled={!allAssets.length} onChange={() => onToggleFolder(node)} aria-label={`${node.name} 폴더 전체 선택`} />
        <span>{allSelected ? '전체 해제' : selectedCount ? `${selectedCount}/${allAssets.length} 선택` : '폴더 전체 선택'}</span>
      </label>
    </header>
    {open && <div className="asset-folder-contents">
      {node.assets.length > 0 && <div className="asset-grid folder-direct-assets">{node.assets.map(asset => <AssetCard key={asset.id} asset={asset} selected={selectedAssetIds.includes(asset.id)} task={taskByAsset.get(asset.id)} users={users} onToggle={onToggleAsset} />)}</div>}
      {node.children.map(child => <AssetFolderTreeNode key={child.path} node={child} depth={depth + 1} expanded={expanded} selectedAssetIds={selectedAssetIds} taskByAsset={taskByAsset} users={users} onToggleOpen={onToggleOpen} onToggleFolder={onToggleFolder} onToggleAsset={onToggleAsset} />)}
    </div>}
  </section>
}

export function buildAssetFolderTree(assets: Asset[]): AssetFolderNode {
  type MutableFolder = AssetFolderNode & { childMap: Map<string, MutableFolder> }
  const root: MutableFolder = { name: '전체 데이터', path: ROOT_ASSET_FOLDER_PATH, assets: [], children: [], childMap: new Map() }
  for (const asset of assets) {
    const relativePath = asset.relative_path || asset.original_filename
    const folders = relativePath.split('/').slice(0, -1).filter(Boolean)
    let current = root
    for (const folderName of folders) {
      const folderPath = current.path === ROOT_ASSET_FOLDER_PATH ? folderName : `${current.path}/${folderName}`
      let child = current.childMap.get(folderName)
      if (!child) {
        child = { name: folderName, path: folderPath, assets: [], children: [], childMap: new Map() }
        current.childMap.set(folderName, child)
        current.children.push(child)
      }
      current = child
    }
    current.assets.push(asset)
  }
  const sortNode = (node: MutableFolder) => {
    node.assets.sort((left, right) => (left.relative_path || left.original_filename).localeCompare(right.relative_path || right.original_filename, 'ko'))
    node.children.sort((left, right) => left.name.localeCompare(right.name, 'ko'))
    node.children.forEach(child => sortNode(child as MutableFolder))
  }
  sortNode(root)
  return root
}

export function collectFolderAssets(node: AssetFolderNode): Asset[] {
  return [...node.assets, ...node.children.flatMap(collectFolderAssets)]
}

export function toggleFolderAssetSelection(currentIds: string[], node: AssetFolderNode, unavailableIds: Set<string>): string[] {
  const selectableIds = collectFolderAssets(node).map(asset => asset.id).filter(id => !unavailableIds.has(id))
  const selected = new Set(currentIds)
  const remove = selectableIds.length > 0 && selectableIds.every(id => selected.has(id))
  selectableIds.forEach(id => remove ? selected.delete(id) : selected.add(id))
  return [...selected]
}

export function groupAssetsByFolder(assets: Asset[]): Array<{ path: string; assets: Asset[] }> {
  const groups = new Map<string, Asset[]>()
  for (const asset of assets) {
    const path = asset.relative_path || asset.original_filename
    const segments = path.split('/')
    const folder = segments.length > 1 ? segments.slice(0, -1).join('/') : '최상위 폴더'
    groups.set(folder, [...(groups.get(folder) ?? []), asset])
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'ko'))
    .map(([path, grouped]) => ({ path, assets: grouped.sort((left, right) => (left.relative_path || left.original_filename).localeCompare(right.relative_path || right.original_filename, 'ko')) }))
}

function errorText(cause: unknown, fallback: string) {
  if (!(cause instanceof ApiError)) return fallback
  if (Array.isArray(cause.detail)) {
    const messages = cause.detail.map(item => {
      if (typeof item === 'object' && item !== null && 'msg' in item) return String((item as { msg: unknown }).msg)
      return String(item)
    })
    return messages.join(' / ') || fallback
  }
  if (typeof cause.detail === 'object' && cause.detail !== null && 'message' in cause.detail) return String((cause.detail as { message: unknown }).message)
  return String(cause.detail || fallback)
}

function roleName(role: User['role']) {
  return { ADMINISTRATOR: 'Sudo 관리자', PROJECT_MANAGER: '프로젝트 관리자', ANNOTATOR: '라벨러', REVIEWER: '검수자', OBSERVER: '관찰자' }[role]
}

export function selectAssetIds(assets: Asset[], mode: AssetSelectionMode): string[] {
  if (mode === 'none') return []
  const seen = new Set<string>()
  const uniqueAssets = assets.filter(asset => {
    if (seen.has(asset.id)) return false
    seen.add(asset.id)
    return true
  })
  return uniqueAssets.filter((_, index) => mode === 'all' || (mode === 'odd' ? index % 2 === 0 : index % 2 === 1)).map(asset => asset.id)
}

export function buildAssignmentBatches(assetIds: string[], maxItems = ASSIGNMENT_BATCH_LIMIT): string[][] {
  if (maxItems < 1) throw new RangeError('Assignment batch limit must be positive.')
  const uniqueIds = [...new Set(assetIds)]
  const batches: string[][] = []
  for (let index = 0; index < uniqueIds.length; index += maxItems) batches.push(uniqueIds.slice(index, index + maxItems))
  return batches
}

export function normalizeLabelCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
}

export function childrenInPresetFolder(nodes: LabelPresetNode[], parentId: string | null) {
  const children = nodes.filter(node => node.parent_id === parentId)
  return {
    folders: children.filter(node => node.node_type === 'FOLDER').sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    presets: children.filter(node => node.node_type === 'PRESET').sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  }
}

export function presetFolderTrail(nodes: LabelPresetNode[], folderId: string | null): LabelPresetNode[] {
  const trail: LabelPresetNode[] = []
  const seen = new Set<string>()
  let currentId = folderId
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const folder = nodes.find(node => node.id === currentId && node.node_type === 'FOLDER')
    if (!folder) break
    trail.unshift(folder)
    currentId = folder.parent_id
  }
  return trail
}

export function presetDescendantIds(nodes: LabelPresetNode[], nodeId: string): Set<string> {
  const ids = new Set([nodeId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) if (node.parent_id && ids.has(node.parent_id) && !ids.has(node.id)) { ids.add(node.id); changed = true }
  }
  return ids
}

export function canDeletePresetNode(actor: User, nodes: LabelPresetNode[], node: LabelPresetNode): boolean {
  if (actor.role === 'ADMINISTRATOR') return true
  const ids = presetDescendantIds(nodes, node.id)
  return [...ids].every(id => nodes.find(item => item.id === id)?.created_by === actor.id)
}

export function safeExportFolderName(value: string): string {
  return value.trim().replaceAll('/', '_').replace(/[<>:"\\|?*\u0000-\u001f]+/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'project-export'
}

function exportFormatName(format: ExportJob['format']): string {
  return { csv: 'CSV 분류', coco: 'COCO 박스/폴리곤', yolo: 'YOLO 박스', mask: 'PNG 분할 마스크', 'selected-7z': '선택 데이터 7z' }[format]
}

function annotationTypeName(type: Label['annotation_type']): string {
  return { classification: '분류', bbox: '박스', polygon: '폴리곤', brush: '브러시' }[type]
}
