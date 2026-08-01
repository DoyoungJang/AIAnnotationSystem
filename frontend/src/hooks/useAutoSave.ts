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
  const latest = useRef({ annotations, deletedAnnotationIds, version })
  latest.current = { annotations, deletedAnnotationIds, version }

  const save = async () => {
    if (!taskId || !dirty) return
    setState('saving')
    const savedAnnotationIds = latest.current.annotations.map(annotation => annotation.id)
    const body = {
      client_version: latest.current.version,
      change_reason: 'autosave',
      annotations: latest.current.annotations.map(annotation => ({
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
      deleted_annotation_ids: latest.current.deletedAnnotationIds,
    }
    try {
      const result = await request<{ aggregate_version: number }>(`/tasks/${taskId}/annotations`, {
        method: 'PUT',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body),
      })
      onVersion(result.aggregate_version)
      onSaved(savedAnnotationIds)
      localStorage.removeItem(`sonolabel-draft-${taskId}`)
      setState('saved')
    } catch (error: any) {
      localStorage.setItem(`sonolabel-draft-${taskId}`, JSON.stringify(body))
      setState(error?.status === 409 ? 'conflict' : navigator.onLine ? 'error' : 'offline')
    }
  }

  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(() => void save(), 1200)
    return () => window.clearTimeout(timer)
  }, [annotations, deletedAnnotationIds, dirty, taskId, version])

  return { state, save }
}
