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
 vec2 normal=normalize((p-h)/max(h,vec2(1.))+vec2(.00001));
 float incident=.5+.5*dot(normal,normalize(vec2(-.65,-1.)));
 float edge=(.035+radial*.22)*rim+bevel*(.025+incident*.035+radial*.14);
 float reflection=radial*(spread*(control?.07:.035)+.035)*quiet;
 float sweep=(uReveal>.001&&uReveal<.999)?exp(-abs(p.x-front)*.65)*.12:0.;
 float body=(control?.045:uKind>1.5?.07:.10)+grain*.65;
 float optical=edge+reflection+sweep;
 float alpha=clamp(body+optical,0.,.92)*coverage;
 vec3 glass=mix(vec3(.074,.082,.082)+uAccent*.055,vec3(.93,.97,1.),uLight);
 vec3 light=mix(uAccent,vec3(.94,.97,1.),uLight>.5?.72:.26);
 vec3 rgb=(glass*body+light*optical)/max(body+optical,.001);
 rgb+=vec3((hash(floor(p*1.4))-.5)*(control?.04:.12));
 // Offset spectral lobes simulate dispersion through a rounded glass bevel.
 // The tint grows toward the edge and fades smoothly into the clear center.
 float shift=.55+incident*.65;
 vec3 spectral=vec3(exp(-pow((depth-.65)/1.1,2.)),
                    exp(-pow((depth-1.2-shift)/1.5,2.)),
                    exp(-pow((depth-2.-shift)/1.7,2.)));
 float prism=(.12+radial*.42)*(control?.45:1.);
 rgb+=(spectral-vec3(dot(spectral,vec3(.333))))*prism;
 rgb-=(vec3(1.)-spectral)*prism*.35*uLight;
 gl_FragColor=vec4(max(rgb,vec3(0.)),alpha);
}`;
