/** Native backdrop-filter samples the DOM. GLSL owns the refracted optical
 * backing and the circuit layer below the frosted surface, never the glyphs. */
export const ACRYLIC_VERTEX = `attribute vec2 aPosition;
void main(){gl_Position=vec4(aPosition,0.0,1.0);}`;
export const ACRYLIC_FRAGMENT = `precision highp float;
uniform vec2 uSize,uCrop,uBuffer,uOrigin,uViewport,uPointer;
uniform vec3 uAccent;
uniform float uDensity,uRadius,uHover,uQuiet;
float hash(vec2 p){
  vec3 v=fract(vec3(p.xyx)*.1031);v+=dot(v,v.yzx+33.33);
  return fract((v.x+v.y)*v.z);
}
float segment(vec2 p,vec2 a,vec2 b){vec2 d=b-a;return length(p-a-d*clamp(dot(p-a,d)/max(dot(d,d),.001),0.,1.));}
float trace(vec2 p,vec2 a,vec2 b,float w){return 1.-smoothstep(w,w+max(.65,1./uDensity),segment(p,a,b));}
float circuits(vec2 pixel){
  vec2 cell=floor(pixel/96.),p=mod(pixel,96.);
  float seed=hash(cell);
  if(seed>.5)p=p.yx;
  if(hash(cell+7.)>.5)p.x=96.-p.x;
  float ink=0.;
  for(int i=0;i<3;i++){
    float lane=float(i)*7.;
    vec2 a=vec2(0.,22.+lane),b=vec2(27.+lane,22.+lane);
    vec2 c=vec2(48.+lane,43.+lane),d=vec2(48.+lane,96.);
    ink=max(ink,trace(p,a,b,.35));ink=max(ink,trace(p,b,c,.35));ink=max(ink,trace(p,c,d,.35));
  }
  vec2 via=vec2(17.,69.);
  ink=max(ink,1.-smoothstep(.45,1.15,abs(length(p-via)-3.2)));
  ink=max(ink,trace(p,via+vec2(3.2,0.),vec2(34.,69.),.3));
  ink=max(ink,trace(p,vec2(34.,69.),vec2(42.,77.),.3));
  vec2 chip=abs(p-vec2(78.,19.))-vec2(7.,9.);
  float box=max(chip.x,chip.y);
  ink=max(ink,(1.-smoothstep(.45,1.1,abs(box)))*step(.7,seed));
  float contact=step(73.,p.x)*step(p.x,83.)*step(7.,p.y)*step(p.y,31.);
  ink=max(ink,contact*(1.-smoothstep(.3,1.,abs(mod(p.y-7.,4.)-2.)))*step(.7,seed)*.45);
  return ink;
}
vec3 environment(vec2 p){
  vec2 uv=(p+uOrigin)/max(uViewport,vec2(1.));
  float light=exp(-pow((uv.x*.6+uv.y*.9-.52)*4.5,2.));
  float reflection=exp(-pow((uv.x*.85-uv.y*.4-.04)*11.,2.));
  float rib=.5+.5*sin((uv.x*.8+uv.y*.23)*31.);
  return vec3(.065,.078,.085)+uAccent*(light*.11+reflection*.10+rib*.013);
}
void main(){
  vec2 p=vec2(gl_FragCoord.x,uBuffer.y-gl_FragCoord.y)/uDensity+uCrop;
  vec2 halfSize=uSize*.5,q=abs(p-halfSize)-halfSize+uRadius;
  float sdf=length(max(q,0.))+min(max(q.x,q.y),0.)-uRadius;
  float mask=1.-smoothstep(-1./uDensity,.5/uDensity,sdf);if(mask<=0.)discard;
  vec2 cell=floor(p/3.),micro=vec2(hash(cell),hash(cell+17.))-.5;
  float rim=exp(-abs(sdf)/10.);
  vec2 normal=(p-halfSize)/max(halfSize,vec2(1.));
  vec2 refracted=p+micro*3.+normal*rim*8.;
  vec3 backing=environment(refracted)*.4;
  backing+=environment(refracted+vec2(6.,0.))*.15+environment(refracted-vec2(6.,0.))*.15;
  backing+=environment(refracted+vec2(0.,6.))*.15+environment(refracted-vec2(0.,6.))*.15;
  float dots=1.-smoothstep(.12,.4,length(fract(p/3.)-.5));
  float grain=(hash(floor(p))-.5)*.014;
  vec2 distance=p-uPointer;
  float halo=exp(-dot(distance,distance)/(145.*145.))*uHover;
  // A fixed printed circuit sits below the acrylic. It is revealed, not moved,
  // by the cursor's soft light. Document surfaces deliberately use less energy.
  float circuit=circuits(p+micro*.38);
  float energy=mix(1.,.35,uQuiet);
  vec3 glass=mix(vec3(.055,.066,.072),backing,.72);
  glass+=grain+(dots-.22)*.011;
  glass+=uAccent*energy*(halo*.028+circuit*(.0025+halo*.105));
  float bevel=exp(-abs(sdf+1.)/1.2);
  glass+=uAccent*(bevel*(.065+halo*.11)+rim*.008)*mix(1.,.4,uQuiet);
  gl_FragColor=vec4(glass,mask*mix(.94,.64,uQuiet));
}`;
