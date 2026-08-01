import { describe,expect,it } from 'vitest'
import { fitTransform,screenToSource,sourceToScreen } from './coordinates'

describe('source/view coordinates',()=>{
  it('round trips after zoom and pan',()=>{const transform={scale:2.75,offsetX:-93,offsetY:41};const source={x:321.25,y:177.5};const screen=sourceToScreen(source,transform);expect(screenToSource(screen,transform)).toEqual(source)})
  it('fits without stretching',()=>{expect(fitTransform(1000,500,500,500)).toEqual({scale:.5,offsetX:0,offsetY:125})})
})
