import fs from 'node:fs';
import { renderFloat } from '../src/precision-engine.ts';
import { P3_SRGB, linear, encoded, transform } from '../src/precision-math.ts';
import { defaults, adjustPixels } from '../src/engine.ts';
const input = [0.42, 0.24, 0.14, 1];
const cases = [
  ['neutral', {}], ['exposure', { exposure: 0.7 }], ['light', {contrast: 18, shadows: 22, highlights: -30, whites: -12, blacks: 9}],
  ['balance', {temperature: 20,tint: -13,saturation: 23,vibrance: 18}], ['finish', {fade: 12,vignette: 24}],
  ['curves', {curveShadows: 15,curveMidtones:-8,curveHighlights:20}], ['mixer', {mixer_orange_hue:21,mixer_orange_saturation:-30,mixer_orange_luminance:15,mixer_red_saturation:10}],
  ['skin', {skinRedness:40,skinBrightness:35,skinSmooth:50}], ['hdr', {dynamicRange:'hdr',hdrHighlights:40,hdrPeak:1000}],
  ['p3', {colorSpace:'display-p3',contrast:11,saturation:18}],
  ['mask', {masks:[{id:'mask',name:'test',kind:'radial',points:[{x:.5,y:.5},{x:1,y:.5}],radius:.08,feather:.65,opacity:.5,inverted:false,enabled:true,exposure:.6,contrast:12,saturation:15,temperature:22}]}],
];
const result=cases.map(([name,values])=>{const adjustments={...defaults,precision:'float',...values};const frame=renderFloat({width:1,height:1,data:new Float32Array(input),colorSpace:'display-p3',hdr:false},adjustments,Infinity);return {name,input,adjustments,expected:[...frame.data]};});
for (const [name, values] of cases.filter(([name]) => name !== 'hdr' && name !== 'mask')) {
 const adjustments={...defaults,...values,precision:'legacy'};
 const rgb=adjustments.colorSpace==='display-p3' ? input.slice(0,3) : transform(P3_SRGB,...input.slice(0,3));
 const pixels=new Uint8ClampedArray([...rgb.map(v=>encoded(v)*255),255]);
 adjustPixels(pixels,1,1,adjustments);
 result.push({name:'legacy-'+name,input,adjustments,expected:[...pixels].map((v,i)=>i===3 ? v/255 : linear(v/255))});
}
const width=9,height=7;
const spatial=Array.from({length:width*height},(_,i)=>{
 const variation=(i*17%13)/70;
 return [linear(.72+variation),linear(.48+variation*.8),linear(.37+variation*.6),1];
}).flat();
for(const values of [{skinSmooth:70,skinRedness:35,skinBrightness:20},{skinSmooth:80,rotation:90,flip:true}]) {
 const adjustments={...defaults,precision:'float',...values};
 const frame=renderFloat({width,height,data:new Float32Array(spatial),colorSpace:'display-p3',hdr:false},adjustments,Infinity);
 result.push({name:values.rotation ? 'skin-spatial-rotated':'skin-spatial',width,height,outputWidth:frame.width,outputHeight:frame.height,input:spatial,adjustments,expected:[...frame.data]});
}
for(const kind of ['linear','radial','brush','subject']) {
 const mask={id:kind,name:kind,kind,points:kind==='linear' ? [{x:.1,y:.2},{x:.8,y:.6}] : kind==='radial' ? [{x:.3,y:.25},{x:.8,y:.6}] : kind==='brush' ? [{x:.3,y:.25,start:true},{x:.8,y:.6}] : [{x:.5,y:.5}],radius:.25,feather:.6,opacity:.8,inverted:kind==='subject',enabled:true,exposure:.5,contrast:12,saturation:-15,temperature:20};
 if(kind==='subject') {mask.raster={width:3,height:3,data:Buffer.from([0,20,80,80,180,255,255,160,20]).toString('base64')};mask.strokes=[{points:[{x:.2,y:.5},{x:.8,y:.5}],radius:.1,feather:.6,erase:true}];}
 const adjustments={...defaults,precision:'float',rotation:90,flip:true,masks:[mask]};
 const frame=renderFloat({width,height,data:new Float32Array(spatial),colorSpace:'display-p3',hdr:false},adjustments,Infinity);
 result.push({name:'mask-spatial-'+kind,width,height,outputWidth:frame.width,outputHeight:frame.height,input:spatial,adjustments,expected:[...frame.data]});
}
fs.writeFileSync('tests/native/editor-reference.json' ,JSON.stringify(result,null,2)+'\n');
