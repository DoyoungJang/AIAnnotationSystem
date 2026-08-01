import { create } from 'zustand'
import type { Annotation, Tool } from '../types'

interface AnnotationState{
  annotations:Annotation[];history:Annotation[][];future:Annotation[][];tool:Tool;selectedLabel:string;dirty:boolean
  load:(items:Annotation[])=>void;setTool:(tool:Tool)=>void;setLabel:(label:string)=>void
  replace:(items:Annotation[])=>void;add:(item:Annotation)=>void;remove:(id:string)=>void;undo:()=>void;redo:()=>void;markSaved:()=>void
}
const snapshot=(items:Annotation[])=>structuredClone(items)
export const useAnnotationStore=create<AnnotationState>((set)=>({
  annotations:[],history:[],future:[],tool:'bbox',selectedLabel:'',dirty:false,
  load:(annotations)=>set({annotations:snapshot(annotations),history:[],future:[],dirty:false}),
  setTool:(tool)=>set({tool}),setLabel:(selectedLabel)=>set({selectedLabel}),
  replace:(annotations)=>set((state)=>({annotations:snapshot(annotations),history:[...state.history.slice(-49),snapshot(state.annotations)],future:[],dirty:true})),
  add:(item)=>set((state)=>({annotations:[...state.annotations,item],history:[...state.history.slice(-49),snapshot(state.annotations)],future:[],dirty:true})),
  remove:(id)=>set((state)=>({annotations:state.annotations.filter(item=>item.id!==id),history:[...state.history.slice(-49),snapshot(state.annotations)],future:[],dirty:true})),
  undo:()=>set((state)=>state.history.length?{annotations:snapshot(state.history.at(-1)!),history:state.history.slice(0,-1),future:[snapshot(state.annotations),...state.future],dirty:true}:state),
  redo:()=>set((state)=>state.future.length?{annotations:snapshot(state.future[0]),history:[...state.history,snapshot(state.annotations)],future:state.future.slice(1),dirty:true}:state),
  markSaved:()=>set({dirty:false})
}))
