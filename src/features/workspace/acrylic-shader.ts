export const ACRYLIC_VERTEX = `attribute vec2 aPosition;
void main(){gl_Position=vec4(aPosition,0.,1.);}`;
/** Transparent optical coating. DOM blur remains native; text is never captured. */
export const ACRYLIC_FRAGMENT = `precision highp float;
uniform vec2 uSize,uCrop,uBuffer,uPointer;
uniform vec3 uAccent;
uniform sampler2D uCircuit;
uniform float uDensity,uRadius,uHover,uKind,uReveal;
float hash(vec2 p){vec3 v=fract(vec3(p.xyx)*.1031);v+=dot(v,v.yzx+33.33);return fract((v.x+v.y)*v.z);}
void main(){
 vec2 p=vec2(gl_FragCoord.x,uBuffer.y-gl_FragCoord.y)/uDensity+uCrop;
 vec2 h=uSize*.5,q=abs(p-h)-h+uRadius;
 float sd=length(max(q,0.))+min(max(q.x,q.y),0.)-uRadius;
 float aa=max(.55,.8/uDensity),coverage=1.-smoothstep(-aa,aa,sd);
 if(coverage<.001)discard;
 float front=uSize.x;
 if(uReveal<.9999){
   float delay=mod(floor(p.y/28.)*7.,13.)/13.;
   front=clamp(uReveal*1.24-delay*.24,0.,1.)*uSize.x;
   if(p.x>front||uReveal<.0001)discard;
 }
 float depth=max(-sd,0.),rim=exp(-depth*1.8),spread=exp(-depth*.12);
 vec2 delta=p-uPointer;
 bool control=uKind>.5&&uKind<1.5;
 float radial=exp(-dot(delta,delta)/(control?3800.:22500.))*uHover;
 float quiet=uKind>2.5?.35:1.;
 float grain=(hash(floor(p*1.2))-.5)*.008;
 // A single edge, with the same local falloff as Checkpoint's controls.
 float edge=(.035+radial*(control?.88:.38))*rim;
 float reflection=radial*(spread*(control?.15:.024)+.012)*quiet;
 float wire=0.,aura=0.;
 if(!control){
   // Subpixel refraction through the static microtexture, not a repeated tile.
   vec2 micro=vec2(hash(floor(p*.8)),hash(floor(p*.8)+17.))-.5;
   vec2 uv=(p+micro*.48)/uSize;
   wire=texture2D(uCircuit,uv).a;
   vec2 texel=vec2(1.3)/uSize;
   aura=(texture2D(uCircuit,uv+vec2(texel.x,0.)).a+texture2D(uCircuit,uv-vec2(texel.x,0.)).a+texture2D(uCircuit,uv+vec2(0.,texel.y)).a+texture2D(uCircuit,uv-vec2(0.,texel.y)).a)*.25;
 }
 float circuit=(wire*(.004+radial*.46)+aura*radial*.055)*quiet;
 float sweep=(uReveal>.001&&uReveal<.999)?exp(-abs(p.x-front)*.65)*.12:0.;
 float body=(control?.035:uKind>1.5?.07:.11)+grain;
 float optical=edge+reflection+circuit+sweep;
 float alpha=clamp(body+optical,0.,.92)*coverage;
 vec3 glass=vec3(.075,.10,.12)+uAccent*.025;
 vec3 light=mix(uAccent,vec3(.92,.98,1.),control?.30:.15);
 vec3 rgb=(glass*body+light*optical)/max(body+optical,.001);
 gl_FragColor=vec4(rgb,alpha);
}`;
