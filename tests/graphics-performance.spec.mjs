import {test,expect} from '@playwright/test';

// Diagnostic, not an FPS claim about the user's GPU. Same workload before/after.
test('profile continuous pointer movement with and without backdrop effects',async({page},info)=>{
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  const results=[];
  for(const mode of ['normal','no-backdrop']){
    if(mode==='no-backdrop'){
      await page.addStyleTag({content:'.pm-shell * {backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'});
      // Lens styles are inline !important: a stylesheet alone cannot disable them.
      await page.locator('.pm-material-host').evaluateAll(nodes=>nodes.forEach(el=>{
        el.style.setProperty('backdrop-filter','none','important');
        el.style.setProperty('-webkit-backdrop-filter','none','important');
      }));
      expect(await page.locator('.pm-material-host').evaluateAll(nodes=>nodes.every(el=>getComputedStyle(el).backdropFilter==='none'))).toBe(true);
    }
    const before=(await cdp.send('Performance.getMetrics')).metrics;
    await cdp.send('Profiler.start');
    const frames=await page.evaluate(()=>new Promise(resolve=>{
      const intervals=[];let previous=performance.now(),start=previous;
      const tick=now=>{
        intervals.push(now-previous);previous=now;
        const t=(now-start)/1000,x=800+Math.sin(t*4)*500,y=360+Math.cos(t*3)*200;
        document.elementFromPoint(x,y)?.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y,pointerType:'mouse'}));
        if(now-start<3000)requestAnimationFrame(tick);else resolve(intervals);
      };requestAnimationFrame(tick);
    }));
    const after=(await cdp.send('Performance.getMetrics')).metrics;
    const {profile}=await cdp.send('Profiler.stop');
    const hot=new Map();
    profile.samples?.forEach((id,i)=>{
      const n=profile.nodes.find(n=>n.id===id),name=n.callFrame.functionName||n.callFrame.url.split('/').at(-1);
      hot.set(name,(hot.get(name)||0)+(profile.timeDeltas?.[i]||0));
    });
    const delta=name=>after.find(m=>m.name===name).value-before.find(m=>m.name===name).value;
    frames.sort((a,b)=>a-b);
    results.push({mode,frames:frames.length,p95ms:frames[Math.floor(frames.length*.95)],taskSeconds:delta('TaskDuration'),layoutSeconds:delta('LayoutDuration'),styleSeconds:delta('RecalcStyleDuration')});
    console.log('profile-hotspots',mode,JSON.stringify([...hot].sort((a,b)=>b[1]-a[1]).slice(0,12)));
  }
  console.log('graphics-profile',JSON.stringify(results));
  await info.attach('graphics-profile',{body:JSON.stringify(results),contentType:'application/json'});
});
