import { create } from 'zustand'
import type { Annotation, Tool } from '../types'

interface AnnotationState {
  annotations: Annotation[]
  history: Annotation[][]
  future: Annotation[][]
  persistedIds: string[]
  deletedAnnotationIds: string[]
  tool: Tool
  selectedLabel: string
  dirty: boolean
  load: (items: Annotation[]) => void
  setTool: (tool: Tool) => void
  setLabel: (label: string) => void
  replace: (items: Annotation[]) => void
  add: (item: Annotation) => void
  remove: (id: string) => void
  undo: () => void
  redo: () => void
  markSaved: (savedAnnotationIds?: string[]) => void
}

const snapshot = (items: Annotation[]) => structuredClone(items)
const deletedIds = (persistedIds: string[], items: Annotation[]) => {
  const visible = new Set(items.map(item => item.id))
  return persistedIds.filter(id => !visible.has(id))
}

export const useAnnotationStore = create<AnnotationState>((set) => ({
  annotations: [],
  history: [],
  future: [],
  persistedIds: [],
  deletedAnnotationIds: [],
  tool: 'bbox',
  selectedLabel: '',
  dirty: false,
  load: annotations => set({
    annotations: snapshot(annotations),
    history: [],
    future: [],
    persistedIds: annotations.map(item => item.id),
    deletedAnnotationIds: [],
    dirty: false,
  }),
  setTool: tool => set({ tool }),
  setLabel: selectedLabel => set({ selectedLabel }),
  replace: annotations => set(state => ({
    annotations: snapshot(annotations),
    history: [...state.history.slice(-49), snapshot(state.annotations)],
    future: [],
    deletedAnnotationIds: deletedIds(state.persistedIds, annotations),
    dirty: true,
  })),
  add: item => set(state => {
    const annotations = [...state.annotations, item]
    return {
      annotations,
      history: [...state.history.slice(-49), snapshot(state.annotations)],
      future: [],
      deletedAnnotationIds: deletedIds(state.persistedIds, annotations),
      dirty: true,
    }
  }),
  remove: id => set(state => {
    if (!state.annotations.some(item => item.id === id)) return state
    const annotations = state.annotations.filter(item => item.id !== id)
    return {
      annotations,
      history: [...state.history.slice(-49), snapshot(state.annotations)],
      future: [],
      deletedAnnotationIds: deletedIds(state.persistedIds, annotations),
      dirty: true,
    }
  }),
  undo: () => set(state => {
    if (!state.history.length) return state
    const annotations = snapshot(state.history.at(-1)!)
    return {
      annotations,
      history: state.history.slice(0, -1),
      future: [snapshot(state.annotations), ...state.future],
      deletedAnnotationIds: deletedIds(state.persistedIds, annotations),
      dirty: true,
    }
  }),
  redo: () => set(state => {
    if (!state.future.length) return state
    const annotations = snapshot(state.future[0])
    return {
      annotations,
      history: [...state.history, snapshot(state.annotations)],
      future: state.future.slice(1),
      deletedAnnotationIds: deletedIds(state.persistedIds, annotations),
      dirty: true,
    }
  }),
  markSaved: savedAnnotationIds => set(state => {
    const persistedIds = savedAnnotationIds ?? state.annotations.map(item => item.id)
    const deletedAnnotationIds = deletedIds(persistedIds, state.annotations)
    const visibleIds = state.annotations.map(item => item.id)
    const savedCurrentState = visibleIds.length === persistedIds.length
      && visibleIds.every(id => persistedIds.includes(id))
    return {
      persistedIds,
      deletedAnnotationIds,
      dirty: !savedCurrentState,
    }
  }),
}))
