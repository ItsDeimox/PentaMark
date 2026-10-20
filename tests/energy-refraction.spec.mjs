import { test, expect } from '@playwright/test';

// Removing cursor injection, decay, or the reduced-motion listener must fail this.
test('energy fragments follow the pointer and settle without moving content', async ({page}, info) => {
  await page.goto('/');
  const editor = page.getByRole('textbox',{name:'Editor Markdown em Live Preview'});
  await expect(editor).toBeVisible();
  // Let the existing document-entry decode finish before capturing the trail.
  await page.waitForTimeout(800);
  await expect(page.locator('.pm-decode-glyphs')).toHaveCount(0);
  const before = await editor.boundingBox();
  const layer = page.locator('.pm-energy-layer');
  await expect(layer).toBeVisible();
  // Inspect actual drawn alpha, not a telemetry attribute or mocked solver.
  const energy = () => layer.evaluate(c => {
    const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let peak=0;for(let i=3;i<pixels.length;i+=4)peak=Math.max(peak,pixels[i]);
    return peak/255;
  });
  await page.mouse.move(1200,200);
  await page.mouse.move(1300,400,{steps:12});
  await expect.poll(energy).toBeGreaterThan(.2);
  await page.screenshot({path:info.outputPath('energy-trail.png')});
  await expect.poll(energy,{timeout:5000}).toBeLessThan(.02);
  expect(await editor.boundingBox()).toEqual(before);
  await page.mouse.move(1100,300,{steps:8});
  await expect.poll(energy).toBeGreaterThan(.2);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(energy,{timeout:500}).toBeLessThan(.02);
  await page.mouse.move(1200,500,{steps:8});
  await expect.poll(energy).toBeLessThan(.02);
});

// A missing refraction layer, unsupported filter, or stale cleanup fails here.
test('glass uses backdrop lensing and removes it in Flat mode', async ({page}, info) => {
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Configurações',exact:true}).click();
  const dialog=page.locator('.pm-settings-dialog');
  await dialog.getByRole('button',{name:'Acrílico',exact:true}).click();
  await expect.poll(()=>dialog.evaluate(el=>getComputedStyle(el).backdropFilter)).toContain('url(');
  await page.screenshot({path:info.outputPath('refractive-dark.png')});
  await dialog.getByRole('button',{name:'Pérola',exact:true}).click();
  await expect.poll(()=>dialog.evaluate(el=>getComputedStyle(el).backdropFilter)).toContain('url(');
  await page.screenshot({path:info.outputPath('refractive-pearl.png')});
  await dialog.getByRole('button',{name:'Flat',exact:true}).click();
  await expect.poll(()=>dialog.evaluate(el=>getComputedStyle(el).backdropFilter)).not.toContain('url(');
  await expect(page.locator('.pm-lens-defs')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('refraction changes backdrop pixels at the edge, not the center', async ({page},info)=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  await page.keyboard.press('Escape');
  // Controlled optical chart exercises the real surface registry and filter.
  await page.evaluate(()=>{
    const chart=document.createElement('div');
    chart.id='optical-chart';
    chart.style.cssText='position:fixed;left:400px;top:180px;width:500px;height:300px;z-index:9999;background:repeating-linear-gradient(90deg,#ddd 0 8px,#222 8px 16px)';
    const panel=document.createElement('div');
    panel.className='pm-context-menu';
    panel.id='optical-probe';
    panel.style.cssText='position:absolute;left:30px;top:30px;width:440px;height:240px;min-width:0;border-radius:28px;background:transparent;box-shadow:none;pointer-events:none';
    chart.append(panel);document.querySelector('.pm-shell').append(chart);
  });
  const probe=page.locator('#optical-probe');
  await expect.poll(()=>probe.evaluate(el=>getComputedStyle(el).backdropFilter)).toContain('url(');
  await page.mouse.move(40,40);
  await page.waitForTimeout(300);
  await expect.poll(()=>probe.evaluate(el=>getComputedStyle(el).backdropFilter)).toContain('url(');
  // Capture the fixed chart without scrolling it or injecting caret-hiding CSS,
  // which causes CodeMirror to remeasure/scroll and activate lightweight glass.
  const clip=await probe.boundingBox();
  const distorted=await page.screenshot({clip,caret:'initial',path:info.outputPath('optical-chart-refracted.png')});
  expect(await probe.evaluate(el=>getComputedStyle(el).backdropFilter)).toContain('url(');
  await probe.locator('feDisplacementMap').evaluateAll(nodes=>nodes.forEach(n=>n.setAttribute('scale','0')));
  const undistorted=await page.screenshot({clip,caret:'initial',path:info.outputPath('optical-chart-neutral.png')});
  const difference=await page.evaluate(async([a,b])=>{
    const decode=async data=>{
      const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      return {width:image.width,height:image.height,data:ctx.getImageData(0,0,image.width,image.height).data};
    };
    const first=await decode(a),second=await decode(b);
    let edge=0,center=0,chroma=0,shoulder=0,ne=0,nc=0,ns=0;
    for(let y=40;y<first.height-40;y++)for(let x=2;x<first.width-2;x++){
      const i=(y*first.width+x)*4;
      const d=Math.abs(first.data[i]-second.data[i])+Math.abs(first.data[i+1]-second.data[i+1])+Math.abs(first.data[i+2]-second.data[i+2]);
      if(x<22||x>first.width-22){
        edge+=d;ne+=3;
        const a=Array.from(first.data.slice(i,i+3)),b=Array.from(second.data.slice(i,i+3));
        chroma+=Math.max(...a)-Math.min(...a)-Math.max(...b)+Math.min(...b);
      }
      if(x>60&&x<first.width-60){center+=d;nc+=3;}
      if(x>=23&&x<=30){shoulder+=d;ns+=3;}
    }
    return {edge:edge/ne,center:center/nc,chroma:chroma/(ne/3),shoulder:shoulder/ns};
  },[distorted.toString('base64'),undistorted.toString('base64')]);
  await info.attach('optical-pixel-difference',{body:JSON.stringify(difference),contentType:'application/json'});
  expect(difference.edge).toBeGreaterThan(4);
  expect(difference.center).toBeLessThan(1);
  expect(difference.chroma).toBeGreaterThan(2);
  expect(difference.shoulder).toBeGreaterThan(2);
  const map=probe.locator('feImage'),initial=await map.getAttribute('href');
  await probe.evaluate(el=>el.style.width='480px');
  await expect(map).toHaveAttribute('width','480');
  await expect.poll(()=>map.getAttribute('href')).not.toBe(initial);
});
