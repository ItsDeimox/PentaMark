import {test,expect} from './energy-fixture.mjs';

test('reference wave keeps text stable and reduced motion clears its light',async({page})=>{
  await page.goto('/');
  const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview'});
  await expect(editor).toBeVisible();
  const before=await editor.boundingBox();
  await page.mouse.move(1150,350);
  await page.mouse.move(1350,500,{steps:12});
  const sample=()=>page.locator('.pm-energy-layer').evaluateAll(layers=>{
    let chromatic=0,lit=0;
    for(const c of layers){
      const data=window.readEnergyPixels(c);
      for(let i=0;i<data.length;i+=4){
        if(data[i+3]>6&&data[i]>data[i+1]*1.1)chromatic++;
        if(data[i+3]>10)lit++;
      }
    }
    return {chromatic,lit};
  });
  await expect.poll(async()=>(await sample()).lit).toBeGreaterThan(30);
  expect((await sample()).chromatic).toBe(0);
  expect(await editor.boundingBox()).toEqual(before);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(async()=>(await sample()).lit).toBe(0);
});

test('energy drawing recovers after graphics context loss',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.pm-energy-layer')).toBeVisible();
  await page.locator('.pm-energy-layer').evaluate(canvas=>{
    const gl=canvas.getContext('webgl2');
    window.energyContextExtension=gl.getExtension('WEBGL_lose_context');
    window.energyContextRestored=false;
    canvas.addEventListener('webglcontextrestored',()=>window.energyContextRestored=true,{once:true});
    window.energyContextExtension.loseContext();
  });
  await page.waitForTimeout(100);
  // Reinitialization must also work while the original context is still lost.
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Configurações',exact:true}).click();
  await page.getByRole('button',{name:'Pérola',exact:true}).click();
  await page.setViewportSize({width:1500,height:900});
  await page.waitForTimeout(200);
  await page.evaluate(()=>window.energyContextExtension.restoreContext());
  await expect.poll(()=>page.evaluate(()=>window.energyContextRestored)).toBe(true);
  await page.mouse.move(1100,300);
  await expect.poll(()=>page.locator('.pm-energy-layer').evaluate(canvas=>{
    const pixels=window.readEnergyPixels(canvas);
    let peak=0;for(let i=3;i<pixels.length;i+=4)peak=Math.max(peak,pixels[i]);
    return peak;
  })).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test('Canvas fallback still propagates when WebGL is unavailable',async({page})=>{
  await page.addInitScript(()=>{
    const context=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){
      if(kind==='webgl2'&&this.classList.contains('pm-energy-layer'))return null;
      return context.call(this,kind,...args);
    };
  });
  await page.goto('/');
  await expect(page.locator('.pm-signal-packet')).toHaveCount(12);
  await page.mouse.move(700,450);
  await page.mouse.move(1300,450,{steps:8});
  await expect.poll(()=>page.locator('.pm-energy-layer').evaluateAll(canvases=>{
    let peak=0;
    for(const canvas of canvases){
      const pixels=window.readEnergyPixels(canvas);
      for(let i=3;i<pixels.length;i+=4)peak=Math.max(peak,pixels[i]);
    }
    return peak;
  })).toBeGreaterThan(20);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.pm-energy-layer')).toHaveCount(1);
});

test('shader compilation failure uses a fresh Canvas fallback',async({page})=>{
  await page.addInitScript(()=>{
    const parameter=WebGL2RenderingContext.prototype.getShaderParameter;
    WebGL2RenderingContext.prototype.getShaderParameter=function(shader,key){
      if(key===this.COMPILE_STATUS&&this.canvas.classList.contains('pm-energy-layer'))return false;
      return parameter.call(this,shader,key);
    };
  });
  await page.goto('/');
  await expect(page.locator('.pm-signal-packet')).toHaveCount(12);
  await page.mouse.move(300,250);
  await expect.poll(()=>page.locator('.pm-energy-layer').evaluateAll(canvases=>{
    let peak=0;
    for(const canvas of canvases){
      const ctx=canvas.getContext('2d');if(!ctx)continue;
      const bounds=canvas.getBoundingClientRect();
      const x=(300-bounds.x)*canvas.width/bounds.width,y=(250-bounds.y)*canvas.height/bounds.height;
      if(x<60||y<60||x+60>canvas.width||y+60>canvas.height)continue;
      const data=ctx.getImageData(x-60,y-60,120,120).data;
      for(let i=3;i<data.length;i+=4)peak=Math.max(peak,data[i]);
    }
    return peak;
  })).toBeGreaterThan(20);
});
