/** Optical backing for DOM panels. Native backdrop-filter blurs document pixels;
 * GLSL refracts this procedural environment, adds fixed microtexture and a rim.
 * DOM glyphs are never copied, rasterized, distorted or blurred by the shader. */
export const ACRYLIC_VERTEX = `attribute vec2 aPosition;
void main(){gl_Position=vec4(aPosition,0.0,1.0);}`;
export const ACRYLIC_FRAGMENT = `precision mediump float;
uniform vec2 uViewport, uPointer;
uniform vec4 uRect;
uniform vec3 uAccent;
uniform float uDpr, uRadius, uOpacity;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 environment(vec2 p){
  vec2 uv=p/uViewport;
  float light=exp(-pow((uv.x*.6+uv.y*.9-.52)*4.5,2.0));
  float reflection=exp(-pow((uv.x*.85-uv.y*.4-.04)*11.0,2.0));
  float rib=.5+.5*sin((uv.x*.8+uv.y*.23)*31.0);
  return vec3(.065,.078,.085)+uAccent*(light*.11+reflection*.10+rib*.013);
}
void main(){
  vec2 pixel=vec2(gl_FragCoord.x,uViewport.y*uDpr-gl_FragCoord.y)/uDpr;
  vec2 local=pixel-uRect.xy,halfSize=uRect.zw*.5;
  vec2 q=abs(local-halfSize)-halfSize+uRadius;
  float sdf=length(max(q,0.0))+min(max(q.x,q.y),0.0)-uRadius;
  float mask=1.0-smoothstep(-1.0,0.5,sdf);
  if(mask<=0.0)discard;
  vec2 cell=floor(local/3.0);
  vec2 micro=vec2(hash(cell),hash(cell+17.0))-.5;
  vec2 normal=(local-halfSize)/max(halfSize,vec2(1.));
  float rim=exp(-abs(sdf)/10.0);
  // Each tiny frosted lens redirects the optical backing, never the text.
  vec2 refracted=pixel+micro*4.0+normal*rim*9.0;
  vec3 blurred=environment(refracted)*.40;
  blurred+=environment(refracted+vec2(6.,0.))*.15;
  blurred+=environment(refracted-vec2(6.,0.))*.15;
  blurred+=environment(refracted+vec2(0.,6.))*.15;
  blurred+=environment(refracted-vec2(0.,6.))*.15;
  float dots=1.0-smoothstep(.12,.4,length(fract(local/3.)-.5));
  float grain=(hash(floor(local))-.5)*.017;
  float hover=exp(-dot(pixel-uPointer,pixel-uPointer)/(125.*125.));
  float bevel=exp(-abs(sdf+1.0)/1.2);
  vec3 glass=mix(vec3(.055,.066,.072),blurred,.72);
  glass+=grain+(dots-.22)*.013;
  glass+=uAccent*(bevel*(.065+hover*.11)+rim*.008+hover*dots*.011);
  gl_FragColor=vec4(glass,mask*.94*uOpacity);
}`;
