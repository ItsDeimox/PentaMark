import {test,expect} from '@playwright/test';

test('document scrolling uses lightweight glass and restores refraction after settling',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('pentamark:appearance',JSON.stringify({graphicsPreset:'custom',graphicsMode:'acrylic',backgroundMotion:false,backgroundHover:false,interfaceMotion:true,refraction:true})));
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toContainText('Visão Geral do Projeto');
  await page.evaluate(()=>document.fonts.ready);
  await expect.poll(()=>page.locator('.cm-scroller').evaluate(el=>el.scrollHeight-el.clientHeight)).toBeGreaterThan(1000);
  const sidebar=page.locator('.pm-sidebar');
  await expect.poll(()=>sidebar.evaluate(el=>getComputedStyle(el).backdropFilter)).toContain('url(');
  const during=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const scroller=document.querySelector('.cm-scroller');
    const from=scroller.scrollTop;
    const target=from>500?0:Math.min(1000,scroller.scrollHeight-scroller.clientHeight);
    const timer=setTimeout(()=>{
      scroller.removeEventListener('scroll',onScroll);
      reject(new Error(JSON.stringify({from,target,actual:scroller.scrollTop,height:scroller.scrollHeight,client:scroller.clientHeight})));
    },3000);
    const onScroll=()=>{
      clearTimeout(timer);
      requestAnimationFrame(()=>resolve(getComputedStyle(document.querySelector('.pm-sidebar')).backdropFilter));
    };
    scroller.addEventListener('scroll',onScroll,{once:true});
    scroller.scrollTop=target;
  }));
  expect(during).toBe('blur(9px)');
  await expect.poll(()=>sidebar.evaluate(el=>getComputedStyle(el).backdropFilter)).toContain('url(');
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Flat',exact:true}).click();
  await page.waitForTimeout(250);
  await expect(page.locator('.pm-lens-defs')).toHaveCount(0);
  expect(await sidebar.evaluate(el=>el.style.getPropertyValue('backdrop-filter'))).toBe('');
});

test('isolate sidebar refraction cost during document scroll',async({page},info)=>{
  await page.addInitScript(()=>localStorage.setItem('pentamark:appearance',JSON.stringify({graphicsPreset:'custom',graphicsMode:'acrylic',backgroundMotion:false,backgroundHover:false,interfaceMotion:true,refraction:true})));
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await expect.poll(()=>page.locator('.pm-sidebar').evaluate(el=>getComputedStyle(el).backdropFilter)).toContain('url(');
  const lens=await page.locator('.pm-sidebar').evaluate(el=>{
    const original=el.style.setProperty.bind(el.style);
    window.profileFilter=null;
    el.style.setProperty=(key,value,priority)=>original(key,
      window.profileFilter&&key.endsWith('backdrop-filter')?window.profileFilter:value,priority);
    return getComputedStyle(el).backdropFilter;
  });
  const results=[];
  for(const mode of ['forced-lens','adaptive','forced-blur','none']){
    await page.waitForTimeout(250);
    const expected=mode==='forced-lens'?lens:mode==='none'?'none':'blur(9px)';
    await page.locator('.pm-sidebar').evaluate((el,{mode,lens,expected})=>{
      window.profileFilter=mode==='adaptive'?null:expected;
      for(const key of ['backdrop-filter','-webkit-backdrop-filter'])el.style.setProperty(key,mode==='adaptive'?lens:expected,'important');
    },{mode,lens,expected});
    const before=(await cdp.send('Performance.getMetrics')).metrics;
    const {frames,filters}=await page.evaluate(()=>new Promise(resolve=>{
      const scroller=document.querySelector('.cm-scroller');
      const frames=[],filters=[];let previous=performance.now(),start=previous,nextSample=start+500;
      const tick=now=>{
        frames.push(now-previous);previous=now;
        scroller.scrollTop=(Math.sin((now-start)/700)+1)*800;
        if(now>=nextSample){filters.push(getComputedStyle(document.querySelector('.pm-sidebar')).backdropFilter);nextSample+=500;}
        if(now-start<2500)requestAnimationFrame(tick);else resolve({frames,filters});
      };requestAnimationFrame(tick);
    }));
    expect(filters.length).toBeGreaterThanOrEqual(4);
    expect(filters.every(filter=>filter===expected)).toBe(true);
    const after=(await cdp.send('Performance.getMetrics')).metrics;
    frames.sort((a,b)=>a-b);
    results.push({mode,frames:frames.length,p95ms:frames[Math.floor(frames.length*.95)],
      taskSeconds:after.find(m=>m.name==='TaskDuration').value-before.find(m=>m.name==='TaskDuration').value});
  }
  console.log('scroll-profile',JSON.stringify(results));
  await info.attach('scroll-profile',{body:JSON.stringify(results),contentType:'application/json'});
});
