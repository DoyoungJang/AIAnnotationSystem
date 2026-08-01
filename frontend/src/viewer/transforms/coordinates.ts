import type { Point } from '../../types'

export interface ViewTransform{scale:number;offsetX:number;offsetY:number}

export function sourceToScreen(point:Point, transform:ViewTransform):Point{return{x:point.x*transform.scale+transform.offsetX,y:point.y*transform.scale+transform.offsetY}}
export function screenToSource(point:Point, transform:ViewTransform):Point{return{x:(point.x-transform.offsetX)/transform.scale,y:(point.y-transform.offsetY)/transform.scale}}
export function fitTransform(sourceWidth:number,sourceHeight:number,viewportWidth:number,viewportHeight:number):ViewTransform{
  const scale=Math.min(viewportWidth/sourceWidth,viewportHeight/sourceHeight)
  return{scale,offsetX:(viewportWidth-sourceWidth*scale)/2,offsetY:(viewportHeight-sourceHeight*scale)/2}
}
export function clampPoint(point:Point,width:number,height:number):Point{return{x:Math.max(0,Math.min(width,point.x)),y:Math.max(0,Math.min(height,point.y))}}
