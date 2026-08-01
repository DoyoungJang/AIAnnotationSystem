import { useEffect, useRef, useState } from 'react'
import type { Annotation } from '../types'
import { request } from '../api/client'

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error'

export function useAutoSave(
  taskId: string | undefined,
  annotations: Annotation[],
  deletedAnnotationIds: string[],
  dirty: boolean,
  version: number,
  onVersion: (value: number) => void,
  onSaved: (savedAnnotationIds: string[]) => void,
) {
  const [state, setState] = useState<SaveState>('idle')
  const [message, setMessage] = useState('')
  const latest = useRef({ annotations, deletedAnnotationIds, version })
  const editRevision = useRef(0)
  const inFlight = useRef<Promise<boolean> | null>(null)
  latest.current = { annotations, deletedAnnotationIds, version }

  useEffect(() => {
    editRevision.current += 1
  }, [annotations, deletedAnnotationIds])

  const save = async (): Promise<boolean> => {
    if (!taskId || !dirty) return true
    if (inFlight.current) return inFlight.current

    const operation = (async () => {
    setState('saving')
    setMessage('')
    const saveRevision = editRevision.current
    const snapshot = structuredClone(latest.current)
    const savedAnnotationIds = snapshot.annotations.map(annotation => annotation.id)
    const body = {
      client_version: snapshot.version,
      change_reason: 'autosave',
      annotations: snapshot.annotations.map(annotation => ({
        annotation_id: annotation.id,
        annotation_type: annotation.annotation_type,
        label_id: annotation.label_id,
        frame_index: annotation.frame_index,
        coordinate_system: 'source_pixel',
        image_width: Number(annotation.attributes_json.image_width),
        image_height: Number(annotation.attributes_json.image_height),
        geometry: annotation.geometry_json,
        attributes: annotation.attributes_json,
        source: annotation.source,
        model_version: annotation.model_version,
        confidence: annotation.confidence,
      })),
      deleted_annotation_ids: snapshot.deletedAnnotationIds,
    }
    const idempotencyKey = crypto.randomUUID()
    const put = () => request<{ aggregate_version: number }>(`/tasks/${taskId}/annotations`, {
      method: 'PUT',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    })
    try {
      let result: { aggregate_version: number }
      try {
        result = await put()
      } catch (error: any) {
        if (error?.status !== 423) throw error
        await request(`/tasks/${taskId}/lock`, { method: 'POST' })
        result = await put()
      }
      onVersion(result.aggregate_version)
      if (editRevision.current === saveRevision) {
        onSaved(savedAnnotationIds)
        localStorage.removeItem(`sonolabel-draft-${taskId}`)
        setState('saved')
      } else {
        setState('saving')
      }
      return true
    } catch (error: any) {
      localStorage.setItem(`sonolabel-draft-${taskId}`, JSON.stringify(body))
      setState(error?.status === 409 ? 'conflict' : navigator.onLine ? 'error' : 'offline')
      setMessage(error?.message || '자동 저장 요청을 처리하지 못했습니다.')
      return false
    }
    })()

    inFlight.current = operation
    try {
      return await operation
    } finally {
      if (inFlight.current === operation) inFlight.current = null
    }
  }

  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(() => void save(), 1200)
    return () => window.clearTimeout(timer)
  }, [annotations, deletedAnnotationIds, dirty, taskId, version])

  return { state, message, save }
}
