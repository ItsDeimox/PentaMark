import {test,expect} from '@playwright/test';

async function settings(page) {
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Configurações',exact:true}).click();
  return page.locator('.pm-settings-dialog');
}
const peak = page => page.locator('.pm-energy-layer').evaluateAll(layers=>{
  let max=0;
  for(const c of layers){
    const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    for(let i=3;i<pixels.length;i+=4)max=Math.max(max,pixels[i]);
  }
  return max;
});
const pulsePosition = page => page.locator('.pm-signal-packet').first().evaluate(el=>{
  const b=el.getBoundingClientRect();return [b.x,b.y];
});

// Missing independent state, ignored switches or coupling to graphics fails this.
test('background controls independently persist all four combinations in both materials',async({page})=>{
  test.setTimeout(90000);
  await page.goto('/');
  for(const graphics of ['Flat','Acrílico']){
    for(const [ambient,hover] of [[true,false],[false,true],[false,false],[true,true]]){
      const dialog=await settings(page);
      await dialog.getByRole('button',{name:graphics,exact:true}).click();
      await dialog.getByLabel('Animações de fundo',{exact:true}).setChecked(ambient);
      await dialog.getByLabel('Reação ao mouse',{exact:true}).setChecked(hover);
      await dialog.getByRole('button',{name:'Salvar configurações',exact:true}).click();
      // Saving refreshes host state before persisting appearance. Reload only
      // after the UI confirms completion, not while that request is in flight.
      await expect(dialog).toBeHidden();
      await page.reload();
      await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
      const position=await pulsePosition(page);
      if(ambient)await expect.poll(()=>pulsePosition(page)).not.toEqual(position);
      else {await page.waitForTimeout(150);expect(await pulsePosition(page)).toEqual(position);}
      await page.mouse.move(1100,350);
      await page.mouse.move(1350,580,{steps:10});
      if(hover)await expect.poll(()=>peak(page)).toBeGreaterThan(20);
      else expect(await peak(page)).toBe(0);
    }
  }
});

test('writing column stays centered with either sidebar state and UI zoom',async({page},info)=>{
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  const measurements=[];
  for(const scale of [1,1.25,1.5]){
    const dialog=await settings(page);
    await dialog.getByRole('tab',{name:'Tipografia',exact:true}).click();
    const slider=dialog.getByLabel('Escala do app',{exact:true});
    await slider.focus();await page.keyboard.press('Home');
    for(let i=0;i<Math.round((scale-.8)/.05);i++)await page.keyboard.press('ArrowRight');
    await dialog.getByRole('button',{name:'Salvar configurações',exact:true}).click();
    await expect(dialog).toBeHidden();
    for(let state=0;state<2;state++){
      await page.getByRole('button',{name:'Mostrar ou ocultar arquivos',exact:true}).click();
      await page.waitForTimeout(400);
      const geometry=await page.evaluate(()=>{
        const content=document.querySelector('.cm-content').getBoundingClientRect();
        const area=document.querySelector('.pm-workspace').getBoundingClientRect();
        const line=document.querySelector('.cm-content .cm-line').getBoundingClientRect();
        return {contentOffset:(content.left+content.right-area.left-area.right)/2,lineOffset:(line.left+line.right-area.left-area.right)/2};
      });
      measurements.push({scale,...geometry});
      expect(Math.abs(geometry.contentOffset)).toBeLessThanOrEqual(2);
      expect(Math.abs(geometry.lineOffset)).toBeLessThanOrEqual(3);
    }
  }
  await info.attach('text-centering',{body:JSON.stringify(measurements),contentType:'application/json'});
});

test('legacy disabled background stays disabled; cancel restores both controls',async({page})=>{
  await page.addInitScript(()=>{
    if(!localStorage.getItem('test-seeded')){
      localStorage.setItem('pentamark:appearance',JSON.stringify({backgroundMotion:false}));
      localStorage.setItem('test-seeded','1');
    }
  });
  await page.goto('/');
  const dialog=await settings(page);
  await expect(dialog.getByLabel('Animações de fundo',{exact:true})).not.toBeChecked();
  await expect(dialog.getByLabel('Reação ao mouse',{exact:true})).not.toBeChecked();
  await dialog.getByLabel('Reação ao mouse',{exact:true}).check();
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  const reopened=await settings(page);
  await expect(reopened.getByLabel('Reação ao mouse',{exact:true})).not.toBeChecked();
});

test('restoring defaults does not recouple hover to ambient after saving',async({page})=>{
  await page.goto('/');
  const dialog=await settings(page);
  await dialog.getByRole('button',{name:'Restaurar visual',exact:true}).click();
  await dialog.getByLabel('Animações de fundo',{exact:true}).uncheck();
  await expect(dialog.getByLabel('Reação ao mouse',{exact:true})).toBeChecked();
  await dialog.getByRole('button',{name:'Salvar configurações',exact:true}).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  const reopened=await settings(page);
  await expect(reopened.getByLabel('Animações de fundo',{exact:true})).not.toBeChecked();
  await expect(reopened.getByLabel('Reação ao mouse',{exact:true})).toBeChecked();
});

test('background cannot restart from pointer events while window is blurred',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.pm-signal-packet')).toHaveCount(12);
  await page.mouse.move(1300,400);
  await expect.poll(()=>peak(page)).toBeGreaterThan(20);
  await page.evaluate(()=>{
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new PointerEvent('pointermove',{clientX:1200,clientY:500,pointerType:'mouse'}));
  });
  await page.waitForTimeout(150);
  expect(await peak(page)).toBe(0);
  expect(await page.locator('.pm-signal-packet').first().evaluate(el=>el.getAnimations()[0].playState)).toBe('paused');
  await page.evaluate(()=>{
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new PointerEvent('pointermove',{clientX:1100,clientY:400,pointerType:'mouse'}));
  });
  await expect.poll(()=>peak(page)).toBeGreaterThan(20);
  expect(await page.locator('.pm-signal-packet').first().evaluate(el=>el.getAnimations()[0].playState)).toBe('running');
});

test('an initially inactive window keeps effects paused after resize',async({page})=>{
  // Model the browser focus boundary, not the renderer's event handlers.
  await page.addInitScript(()=>Object.defineProperty(document,'hasFocus',{value:()=>false}));
  await page.goto('/');
  await expect(page.locator('.pm-signal-packet')).toHaveCount(12);
  await page.setViewportSize({width:1500,height:900});
  await page.waitForTimeout(200);
  await page.mouse.move(1200,500);
  await page.waitForTimeout(100);
  expect(await peak(page)).toBe(0);
  expect(await page.locator('.pm-signal-packet').first().evaluate(el=>el.getAnimations()[0].playState)).toBe('paused');
});

test('hover raster stays local and sharp at 4K/2x; idle and reduced motion stop drawing',async({browser,baseURL})=>{
  const context=await browser.newContext({viewport:{width:3840,height:2160},deviceScaleFactor:2});
  const page=await context.newPage();
  await page.addInitScript(()=>{
    window.energyClears=0;
    const clear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){
      if(this.canvas.classList.contains('pm-energy-layer'))window.energyClears++;
      return clear.apply(this,args);
    };
  });
  await page.goto(baseURL);
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  await page.mouse.move(1900,800);
  await page.mouse.move(2100,1000,{steps:8});
  await expect.poll(()=>peak(page)).toBeGreaterThan(20);
  const sizes=await page.locator('.pm-energy-layer').evaluateAll(layers=>layers.map(c=>{
    const r=c.getBoundingClientRect();return {w:c.width,h:c.height,cssW:r.width,cssH:r.height};
  }));
  expect(sizes.length).toBeLessThanOrEqual(4);
  expect(sizes.reduce((sum,s)=>sum+s.w*s.h,0)).toBeLessThanOrEqual(4*1024*1024);
  for(const size of sizes){
  expect(size.cssW).toBeLessThanOrEqual(512);
  expect(size.cssH).toBeLessThanOrEqual(512);
  expect(size.w/size.cssW).toBeGreaterThanOrEqual(1.9);
  expect(size.w*size.h).toBeLessThanOrEqual(1024*1024);
  }
  await expect.poll(()=>peak(page),{timeout:5000}).toBe(0);
  const clears=await page.evaluate(()=>window.energyClears);
  await page.waitForTimeout(250);
  expect(await page.evaluate(()=>window.energyClears)).toBe(clears);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.mouse.move(2200,1200,{steps:10});
  expect(await peak(page)).toBe(0);
  const position=await pulsePosition(page);
  await page.waitForTimeout(200);
  expect(await pulsePosition(page)).toEqual(position);
  await context.close();
});

// Diagnostic compositing isolation only: hidden layers can still run their solver.
test('profile background layers separately',async({page},info)=>{
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const results=[];
  for(const mode of ['all-visible','ambient-hidden','all-hidden']){
    if(mode==='ambient-hidden')await page.addStyleTag({content:'.pm-signal-packet,.pm-signal-halo{display:none!important}'});
    if(mode==='all-hidden')await page.addStyleTag({content:'.pm-energy-layer{display:none!important}'});
    const before=(await cdp.send('Performance.getMetrics')).metrics;
    const frames=await page.evaluate(()=>new Promise(resolve=>{
      const intervals=[];let prev=performance.now(),start=prev;
      const tick=now=>{
        intervals.push(now-prev);prev=now;
        const t=(now-start)/1000;
        document.querySelector('.pm-document').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:950+Math.sin(t*4)*400,clientY:480+Math.cos(t*3)*250,pointerType:'mouse'}));
        if(now-start<2000)requestAnimationFrame(tick);else resolve(intervals);
      };requestAnimationFrame(tick);
    }));
    const after=(await cdp.send('Performance.getMetrics')).metrics;
    frames.sort((a,b)=>a-b);
    results.push({mode,frames:frames.length,p95ms:frames[Math.floor(frames.length*.95)],
      taskSeconds:after.find(m=>m.name==='TaskDuration').value-before.find(m=>m.name==='TaskDuration').value});
  }
  console.log('background-profile',JSON.stringify(results));
  await info.attach('background-profile',{body:JSON.stringify(results),contentType:'application/json'});
});
