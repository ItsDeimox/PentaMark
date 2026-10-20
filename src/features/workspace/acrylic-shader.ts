export const ACRYLIC_VERTEX = `attribute vec2 aPosition;
void main(){gl_Position=vec4(aPosition,0.,1.);}`;
/** Transparent optical coating. DOM blur remains native; text is never captured. */
export const ACRYLIC_FRAGMENT = `precision highp float;
uniform vec2 uSize,uCrop,uCropSize,uBuffer,uPointer;
uniform vec3 uAccent;
uniform float uDensity,uRadius,uHover,uKind,uReveal,uLight;
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
 float depth=max(-sd,0.);
 // A subpixel crest above a curved bevel, not a broad painted outline.
 float rim=exp(-pow(depth/.65,2.)),bevel=exp(-depth*.38),spread=exp(-depth*.09);
 vec2 delta=p-uPointer;
 bool control=uKind>.5&&uKind<1.5;
 float radial=exp(-dot(delta,delta)/(control?3800.:22500.))*uHover;
 float quiet=uKind>2.5?.35:1.;
 float grain=(hash(floor(p*1.4))-.5)*.065;
 // Rounded-rectangle normal, not an ellipse stretched over straight edges.
 vec2 corner=max(q,0.);
 vec2 normal=length(corner)>.001?normalize(corner)*sign(p-h):
   (q.x>q.y?vec2(sign(p.x-h.x),0.):vec2(0.,sign(p.y-h.y)));
 float incident=.5+.5*dot(normal,normalize(vec2(-.65,-1.)));
 float edge=(.035+radial*.15)*rim+bevel*(.015+incident*.025+radial*.09);
 float reflection=radial*(spread*(control?.07:.035)+.035)*quiet;
 float sweep=(uReveal>.001&&uReveal<.999)?exp(-abs(p.x-front)*.65)*.12:0.;
 float body=(control?.045:uKind>1.5?.07:.10)+grain*.65;
 float optical=edge+reflection+sweep;
 float alpha=clamp(body+optical,0.,.92)*coverage;
 vec3 glass=mix(vec3(.074,.082,.082)+uAccent*.055,vec3(.93,.97,1.),uLight);
 vec3 light=mix(uAccent,vec3(.94,.97,1.),uLight>.5?.72:.26);
 vec3 rgb=(glass*body+light*optical)/max(body+optical,.001);
 rgb+=vec3((hash(floor(p*1.4))-.5)*(control?.04:.12));
 // Dispersion belongs to the backdrop lens, not a painted RGB outline.
 gl_FragColor=vec4(max(rgb,vec3(0.)),alpha);
}`;
