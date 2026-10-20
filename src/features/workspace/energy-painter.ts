import type {EnergyMesh} from './energy-mesh';

/** Draw thin analytic wires on the GPU. Only edge energies are uploaded, never
 * a full-screen CPU bitmap. The backing scale remains constant during a trail. */
export function createEnergyPainter(canvas:HTMLCanvasElement,mesh:EnergyMesh,width:number,height:number,zoom:number,color:string){
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});
  if(!gl||gl.isContextLost())return null;
  const density=Math.min(2,devicePixelRatio||1);
  canvas.width=Math.ceil(width*density);canvas.height=Math.ceil(height*density);
  canvas.style.width=`${width/zoom}px`;canvas.style.height=`${height/zoom}px`;
  const vertex=`#version 300 es
  precision highp float;
  in vec4 ends; in vec2 energy;
  uniform vec2 viewport;
  out float across; out float value;
  void main(){
    vec2 corners[6]=vec2[6](vec2(0.,-1.),vec2(1.,-1.),vec2(0.,1.),vec2(0.,1.),vec2(1.,-1.),vec2(1.,1.));
    vec2 c=corners[gl_VertexID],delta=ends.zw-ends.xy;
    vec2 normal=normalize(vec2(-delta.y,delta.x));
    vec2 p=mix(ends.xy,ends.zw,c.x)+normal*c.y*7.;
    gl_Position=vec4(p.x/viewport.x*2.-1.,1.-p.y/viewport.y*2.,0.,1.);
    across=c.y*7.; value=mix(energy.x,energy.y,c.x);
  }`;
  const fragment=`#version 300 es
  precision highp float;
  in float across; in float value; uniform vec3 tint; out vec4 pixel;
  void main(){
    float e=max(value-.02,0.);
    float radiance=pow(e,.92)*(1.+3.7*smoothstep(.18,1.1,value));
    float d=abs(across),aa=max(fwidth(across),.35);
    float wire=1.-smoothstep(.38,.38+aa,d);
    float halo=exp(-d*.85)*.08;
    float alpha=min(.8,radiance*(wire*.7+halo));
    pixel=vec4(tint,alpha);
  }`;
  const compile=(type:number,source:string)=>{
    const shader=gl.createShader(type);if(!shader)return null;
    gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);return null;}
    return shader;
  };
  const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
  if(!vs||!fs){if(vs)gl.deleteShader(vs);if(fs)gl.deleteShader(fs);return null;}
  const program=gl.createProgram();
  if(!program){gl.deleteShader(vs);gl.deleteShader(fs);return null;}
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  gl.deleteShader(vs);gl.deleteShader(fs);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);return null;}
  const buffer=gl.createBuffer(),vao=gl.createVertexArray();
  if(!buffer||!vao){if(buffer)gl.deleteBuffer(buffer);if(vao)gl.deleteVertexArray(vao);gl.deleteProgram(program);return null;}
  const data=new Float32Array(mesh.edges.length*6);
  gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data.byteLength,gl.DYNAMIC_DRAW);
  for(const [name,size,offset] of [['ends',4,0],['energy',2,16]] as const){
    const location=gl.getAttribLocation(program,name);
    gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,24,offset);gl.vertexAttribDivisor(location,1);
  }
  const swatch=document.createElement('canvas');swatch.width=swatch.height=1;
  const ctx=swatch.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
  const rgb=ctx.getImageData(0,0,1,1).data;
  gl.useProgram(program);gl.uniform2f(gl.getUniformLocation(program,'viewport'),width,height);
  gl.uniform3f(gl.getUniformLocation(program,'tint'),rgb[0]/255,rgb[1]/255,rgb[2]/255);
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.SCISSOR_TEST);gl.clearColor(0,0,0,0);
  let dirty:number[]|null=null;
  const clear=()=>{
    if(!dirty)return;
    gl.scissor(dirty[0],dirty[1],dirty[2],dirty[3]);gl.clear(gl.COLOR_BUFFER_BIT);dirty=null;
  };
  return {
    clear,
    draw(values:Float32Array){
      clear();
      let count=0,minX=width,minY=height,maxX=0,maxY=0;
      for(const [a,b] of mesh.edges){
        if(Math.max(values[a],values[b])<.025)continue;
        const p=mesh.points[a],q=mesh.points[b],i=count*6;
        data[i]=p.x;data[i+1]=p.y;data[i+2]=q.x;data[i+3]=q.y;data[i+4]=values[a];data[i+5]=values[b];count++;
        minX=Math.min(minX,p.x,q.x);minY=Math.min(minY,p.y,q.y);maxX=Math.max(maxX,p.x,q.x);maxY=Math.max(maxY,p.y,q.y);
      }
      if(!count)return;
      const left=Math.max(0,Math.floor((minX-8)*density)),top=Math.max(0,Math.floor((minY-8)*density));
      const right=Math.min(canvas.width,Math.ceil((maxX+8)*density)),bottom=Math.min(canvas.height,Math.ceil((maxY+8)*density));
      dirty=[left,canvas.height-bottom,Math.max(0,right-left),Math.max(0,bottom-top)];
      gl.scissor(dirty[0],dirty[1],dirty[2],dirty[3]);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,data.subarray(0,count*6));
      gl.drawArraysInstanced(gl.TRIANGLES,0,6,count);
    },
    dispose(){clear();gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteProgram(program);},
  };
}
