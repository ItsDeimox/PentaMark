export const ACRYLIC_VERTEX = `attribute vec2 aPosition;
void main(){gl_Position=vec4(aPosition,0.,1.);}`;
/** Transparent optical coating. DOM blur remains native; text is never captured. */
export const ACRYLIC_FRAGMENT = `precision highp float;
uniform vec2 uSize,uCrop,uCropSize,uBuffer,uPointer;
uniform vec3 uAccent;
uniform float uDensity,uRadius,uHover,uKind,uReveal;
float hash(vec2 p){vec3 v=fract(vec3(p.xyx)*.1031);v+=dot(v,v.yzx+33.33);return fract((v.x+v.y)*v.z);}
void main(){
 vec2 p=vec2(gl_FragCoord.x,uBuffer.y-gl_FragCoord.y)/uBuffer*uCropSize+uCrop;
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
 float depth=max(-sd,0.),rim=exp(-abs(depth-1.)*1.4),spread=exp(-depth*.09);
 vec2 delta=p-uPointer;
 bool control=uKind>.5&&uKind<1.5;
 float radial=exp(-dot(delta,delta)/(control?3800.:22500.))*uHover;
 float quiet=uKind>2.5?.35:1.;
 float grain=(hash(floor(p*1.4))-.5)*.065;
 // A single edge, with the same local falloff as Checkpoint's controls.
 float edge=(.07+radial*(control?.36:.28))*rim;
 float reflection=radial*(spread*(control?.07:.035)+.035)*quiet;
 float sweep=(uReveal>.001&&uReveal<.999)?exp(-abs(p.x-front)*.65)*.12:0.;
 float body=(control?.06:uKind>1.5?.09:.14)+grain;
 float optical=edge+reflection+sweep;
 float alpha=clamp(body+optical,0.,.92)*coverage;
 vec3 glass=vec3(.074,.082,.082)+uAccent*.055;
 vec3 light=mix(uAccent,vec3(.94,.96,.96),control?.26:.08);
 vec3 rgb=(glass*body+light*optical)/max(body+optical,.001);
 rgb+=vec3((hash(floor(p*1.4))-.5)*(control?.04:.12));
 float rimDispersion=rim*(.007+radial*(control?.028:.021));
 rgb+=vec3(rimDispersion, .001*rim, -rimDispersion*.67);
 gl_FragColor=vec4(max(rgb,vec3(0.)),alpha);
}`;
