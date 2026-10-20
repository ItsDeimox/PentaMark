import {test,expect} from './energy-fixture.mjs';

test('pointer light never translates the mesh geometry',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.pm-signal-background')).toBeVisible();
  await page.evaluate(()=>{
    window.meshMoved=false;
    window.meshObserver=new MutationObserver(records=>{
      if(records.some(r=>r.attributeName==='transform'&&r.target.getAttribute('transform')))window.meshMoved=true;
    });
    window.meshObserver.observe(document.querySelector('.pm-signal-background'),{subtree:true,attributes:true,attributeFilter:['transform']});
  });
  await page.mouse.move(900,200);
  await page.mouse.move(1300,650,{steps:24});
  expect(await page.evaluate(()=>{window.meshObserver.disconnect();return window.meshMoved})).toBe(false);
});

test('hover does not repeatedly reallocate the shared WebGL drawing buffer',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  const button=page.getByRole('button',{name:'Live Preview',exact:true});
  await button.hover();
  await page.waitForTimeout(400);
  await page.evaluate(()=>{
    window.bufferResizes=0;
    for(const key of ['width','height']){
      const descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,key);
      Object.defineProperty(HTMLCanvasElement.prototype,key,{...descriptor,set(value){
        if(this.dataset.material==='acrylic')window.bufferResizes++;
        descriptor.set.call(this,value);
      }});
    }
  });
  const b=await button.boundingBox();
  await page.mouse.move(b.x+4,b.y+8);
  await page.mouse.move(b.x+b.width-4,b.y+b.height-8,{steps:20});
  expect(await page.evaluate(()=>window.bufferResizes)).toBeLessThan(4);
});

test('multiline selection has no moving floodlight and preserves document geometry',async({page},info)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  await page.keyboard.press('Escape');
  const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview'});
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press('Control+Home');
  const before=await editor.boundingBox();
  for(let i=0;i<12;i++)await page.keyboard.press('Shift+ArrowDown');
  const selection=page.locator('.cm-selectionBackground').first();
  await expect(selection).toBeVisible();
  expect(await selection.evaluate(el=>getComputedStyle(el).backgroundImage)).toBe('none');
  expect(await selection.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  expect(await editor.boundingBox()).toEqual(before);
  await page.screenshot({path:info.outputPath('multiline-selection.png')});
});

test('live theme changes recolor the energy instead of retaining the old accent',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Configurações',exact:true}).click();
  await page.getByRole('button',{name:'Pérola',exact:true}).click();
  await page.mouse.move(1200,200);
  await page.mouse.move(1300,400,{steps:12});
  const haloPixels=await page.locator('.pm-energy-layer').first().evaluate(c=>{
    const data=window.readEnergyPixels(c);
    // Pearl accent is #35788c. Bright cores are intentionally near-white;
    // measure the colored halo instead of the most opaque pixel.
    let matching=0;
    for(let i=0;i<data.length;i+=4){
      if(data[i+3]>12&&data[i+2]>5&&Math.abs(data[i]/data[i+2]-53/140)<.045
        &&Math.abs(data[i+1]/data[i+2]-120/140)<.06)matching++;
    }
    return matching;
  });
  expect(haloPixels).toBeGreaterThan(10);
});
