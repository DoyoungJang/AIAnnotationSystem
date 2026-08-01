import { beforeEach,describe,expect,it } from 'vitest'
import { useAnnotationStore } from './annotationStore'

const annotation={id:'one',annotation_type:'bbox' as const,label_id:'HEAD',geometry_json:{x:1,y:2,width:3,height:4},attributes_json:{},frame_index:0,source:'human',model_version:null,confidence:null,current_version:1}
describe('annotation history',()=>{beforeEach(()=>useAnnotationStore.getState().load([]));it('undoes and redoes a creation',()=>{useAnnotationStore.getState().add(annotation);expect(useAnnotationStore.getState().annotations).toHaveLength(1);useAnnotationStore.getState().undo();expect(useAnnotationStore.getState().annotations).toHaveLength(0);useAnnotationStore.getState().redo();expect(useAnnotationStore.getState().annotations).toHaveLength(1)})})
