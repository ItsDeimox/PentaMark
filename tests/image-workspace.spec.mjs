import {test,expect} from '@playwright/test';

async function uploadImage(page,width=2400,height=1200){
  const data=await page.evaluate(([width,height])=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const c=canvas.getContext('2d');
    c.fillStyle='#183341';c.fillRect(0,0,width,height);
    c.fillStyle='#68c4d1';c.fillRect(0,0,width/2,height/2);
    c.fillStyle='#d7a35a';c.fillRect(width/2,height/2,width/2,height/2);
    c.strokeStyle='#fff';c.lineWidth=4;
    for(let i=1;i<8;i++){c.beginPath();c.moveTo(width*i/8,0);c.lineTo(width*i/8,height);c.stroke();}
    c.fillStyle='#fff';c.font='bold 64px sans-serif';c.fillText('Imagem de validação',60,height*.75);
    return canvas.toDataURL('image/png').split(',')[1];
  },[width,height]);
  const response=await page.request.post(`/api/upload?name=Viewer-${width}x${height}.png`,{
    headers:{'Content-Type':'image/png'},data:Buffer.from(data,'base64'),
  });
  expect(response.status()).toBe(201);return response.json();
}

async function openAsset(page,name){
  await page.keyboard.press('Control+p');
  // Use the real quick-open search, not injected component props.
  await page.getByRole('combobox',{name:'Buscar arquivos'}).fill(name);
  const result=page.locator('.pm-quick-open-results button').first();
  await expect(result).toContainText(name);await result.click();
  await expect(page.locator('.pm-quick-open')).toHaveCount(0);
}
async function openImage(page,width=2400,height=1200){
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  const asset=await uploadImage(page,width,height);await openAsset(page,asset.name);
  const image=page.locator('.pm-asset-stage--image img');await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate(el=>el.naturalWidth)).toBe(width);
  return {image,stage:page.getByRole('region',{name:'Área da imagem'}),asset};
}
const pointAt=(box,u,v)=>({x:box.x+box.width*u,y:box.y+box.height*v});
async function assertAnchor(image,point,fraction){
  await expect.poll(async()=>{
    const next=await image.boundingBox();
    return Math.hypot(next.x+next.width*fraction.x-point.x,next.y+next.height*fraction.y-point.y);
  }).toBeLessThan(1.5);
}

test('image uses the full panel without title bars or legacy size caps',async({page},info)=>{
  await page.setViewportSize({width:2560,height:1440});
  const {image,stage}=await openImage(page);
  await expect(page.locator('.pm-asset-workspace > header')).toHaveCount(0);
  await expect(page.locator('.pm-asset-workspace > footer')).toHaveCount(0);
  await expect(page.locator('.pm-document-path')).toHaveCount(0);
  const box=await image.boundingBox(),area=await stage.boundingBox(),workspace=await page.locator('.pm-workspace').boundingBox();
  expect(box.width).toBeGreaterThan(1600);
  expect(box.width/box.height).toBeCloseTo(2,2);
  expect(Math.min(area.width-box.width,area.height-box.height)).toBeLessThan(20);
  expect(Math.abs(area.x-workspace.x)).toBeLessThan(2);
  expect(Math.abs(area.width-workspace.width)).toBeLessThan(2);
  expect(area.y+area.height).toBeGreaterThan(1430);
  await page.screenshot({path:info.outputPath('image-full-panel.png')});
  await page.getByRole('button',{name:'Fechar imagem',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  await expect(page.locator('.pm-document-path')).toBeVisible();
});

for(const scale of [1,1.5])test(`wheel zoom keeps the image point under the cursor at app scale ${scale}`,async({page})=>{
  const errors=[];page.on('console',message=>{if(/passive event listener|Unable to preventDefault/i.test(message.text()))errors.push(message.text());});
  await page.addInitScript(scale=>localStorage.setItem('pentamark:appearance',JSON.stringify({appScale:scale})),scale);
  const {image,stage}=await openImage(page);
  const initial=await image.boundingBox(),fraction={x:.7,y:.32},point=pointAt(initial,fraction.x,fraction.y);
  await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,-240);
  await expect.poll(async()=>(await image.boundingBox()).width).toBeGreaterThan(initial.width*1.3);
  await assertAnchor(image,point,fraction);
  const enlarged=await image.boundingBox();
  await page.mouse.wheel(0,180);
  await expect.poll(async()=>(await image.boundingBox()).width).toBeLessThan(enlarged.width*.9);
  await assertAnchor(image,point,fraction);
  const start=await image.boundingBox(),area=await stage.boundingBox(),origin=pointAt(area,.45,.5);
  await page.mouse.move(origin.x,origin.y);await page.mouse.down();
  await page.mouse.move(origin.x+110,origin.y+55,{steps:5});await page.mouse.up();
  const dragged=await image.boundingBox();
  expect(dragged.x-start.x).toBeCloseTo(110,0);expect(dragged.y-start.y).toBeCloseTo(55,0);
  const afterPanFraction={x:.55,y:.45},afterPan=pointAt(dragged,afterPanFraction.x,afterPanFraction.y);
  await page.mouse.move(afterPan.x,afterPan.y);await page.mouse.wheel(0,-120);
  await assertAnchor(image,afterPan,afterPanFraction);
  expect(errors).toEqual([]);
});

test('fit, zoom limits and pointer cancellation remain usable after panning',async({page})=>{
  const {image,stage}=await openImage(page),area=await stage.boundingBox(),origin=pointAt(area,.5,.4);
  const initial=await image.boundingBox();
  await page.mouse.move(origin.x,origin.y);await page.mouse.down();await page.mouse.move(origin.x+100,origin.y+50);
  await stage.dispatchEvent('pointercancel',{pointerId:1});
  const cancelled=await image.boundingBox();await page.mouse.move(origin.x+200,origin.y+100);await page.mouse.up();
  expect((await image.boundingBox()).x).toBeCloseTo(cancelled.x,1);
  await page.getByRole('button',{name:'Ajustar imagem ao painel'}).click();
  expect((await image.boundingBox()).width).toBeCloseTo(initial.width,0);
  expect((await image.boundingBox()).x).toBeCloseTo(initial.x,0);
  await page.mouse.move(origin.x,origin.y);
  for(let i=0;i<8;i++)await page.mouse.wheel(0,-1000);
  await expect(page.getByLabel('Zoom da imagem',{exact:true})).toHaveText('800%');
  await expect(page.getByRole('button',{name:'Aumentar zoom da imagem'})).toBeDisabled();
  for(let i=0;i<12;i++)await page.mouse.wheel(0,1000);
  await expect(page.getByLabel('Zoom da imagem',{exact:true})).toHaveText('15%');
  await stage.dblclick({position:{x:area.width*.4,y:area.height*.4}});
  await expect(page.getByLabel('Zoom da imagem',{exact:true})).toHaveText('100%');
  await page.keyboard.press('Escape');await expect(page.locator('.pm-asset-workspace')).toHaveCount(0);
});

test('a different image starts fitted and portrait stays contained on mobile',async({page},info)=>{
  const {asset}=await openImage(page);
  await page.getByRole('button',{name:'Aumentar zoom da imagem'}).click();
  const portrait=await uploadImage(page,900,1600);await openAsset(page,portrait.name);
  await expect(page.getByLabel('Zoom da imagem',{exact:true})).toHaveText('100%');
  await page.setViewportSize({width:390,height:660});
  const image=page.locator('.pm-asset-stage--image img'),stage=page.getByRole('region',{name:'Área da imagem'});
  await expect.poll(async()=>{
    const box=await image.boundingBox(),area=await stage.boundingBox();return box.width<=area.width&&box.height<=area.height;
  }).toBe(true);
  const box=await image.boundingBox();expect(box.width/box.height).toBeCloseTo(900/1600,2);
  await expect(page.getByRole('button',{name:'Fechar imagem'})).toBeInViewport();
  await page.screenshot({path:info.outputPath('image-mobile.png')});
  await openAsset(page,asset.name);await expect(page.locator('.pm-asset-stage--image img')).toBeVisible();
});

test('failed image can be closed and other file previews retain their actions',async({page})=>{
  await page.goto('/');const asset=await uploadImage(page);
  await page.route('**/api/file?**',route=>route.abort());
  await openAsset(page,asset.name);
  await expect(page.locator('.pm-image-status')).toHaveText('Não foi possível carregar esta imagem.');
  await expect(page.getByRole('button',{name:'Aumentar zoom da imagem'})).toBeDisabled();
  await page.getByRole('button',{name:'Fechar imagem'}).click();
  await page.unroute('**/api/file?**');
  const uploaded=await page.request.post('/api/upload?name=Viewer-document.txt',{headers:{'Content-Type':'text/plain'},data:'Documento de validação.'});
  expect(uploaded.status()).toBe(201);await openAsset(page,(await uploaded.json()).name);
  await expect(page.locator('.pm-asset-workspace > header')).toBeVisible();
  await expect(page.getByRole('link',{name:'Abrir arquivo'})).toBeVisible();
  await page.getByRole('button',{name:'Fechar',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
});

test('resize preserves the viewed center and editor modes never divide the image panel',async({page})=>{
  const {image,stage}=await openImage(page);
  const area=await stage.boundingBox(),origin=pointAt(area,.5,.4);
  await page.getByRole('button',{name:'Aumentar zoom da imagem'}).click();
  await page.mouse.move(origin.x,origin.y);await page.mouse.down();
  await page.mouse.move(origin.x+90,origin.y+45);await page.mouse.up();
  const before=await image.boundingBox(),center=pointAt(area,.5,.5);
  const fraction={x:(center.x-before.x)/before.width,y:(center.y-before.y)/before.height};
  await page.setViewportSize({width:1400,height:800});
  await expect.poll(async()=>{
    const box=await image.boundingBox(),next=pointAt(await stage.boundingBox(),.5,.5);
    return Math.hypot(box.x+box.width*fraction.x-next.x,box.y+box.height*fraction.y-next.y);
  }).toBeLessThan(2);
  for(const name of ['Editor Markdown','Somente leitura','Editor + visualização','Live Preview']){
    await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
    await page.getByRole('button',{name,exact:true}).click();await page.keyboard.press('Escape');
    const surface=await stage.boundingBox(),workspace=await page.locator('.pm-workspace').boundingBox();
    expect(surface.width).toBeCloseTo(workspace.width,0);
  }
});

test('image controls fit a narrow screen with 160 percent app scale',async({page},info)=>{
  await page.addInitScript(()=>localStorage.setItem('pentamark:appearance',JSON.stringify({appScale:1.6})));
  await openImage(page,900,1600);await page.setViewportSize({width:390,height:660});
  for(const name of ['Aumentar zoom da imagem','Ajustar imagem ao painel','Fechar imagem']){
    const button=page.getByRole('button',{name});await expect(button).toBeInViewport();
    const box=await button.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(391);
  }
  await page.screenshot({path:info.outputPath('image-mobile-scaled.png')});
});

for(const action of ['reset','resize'])test(`${action} during a drag cannot restore stale image coordinates`,async({page})=>{
  const {image,stage}=await openImage(page);
  await page.getByRole('button',{name:'Aumentar zoom da imagem'}).click();
  const area=await stage.boundingBox(),origin=pointAt(area,.45,.4);
  await page.mouse.move(origin.x,origin.y);await page.mouse.down();await page.mouse.move(origin.x+40,origin.y+20);
  if(action==='reset')await page.keyboard.press('0');
  else{
    await page.setViewportSize({width:1400,height:800});
    await expect(stage).toHaveAttribute('data-dragging','false');
  }
  const settled=await image.boundingBox();
  await page.mouse.move(origin.x+80,origin.y+40);await page.mouse.up();
  const after=await image.boundingBox();
  expect(after.width).toBeCloseTo(settled.width,0);expect(after.x).toBeCloseTo(settled.x,0);
  if(action==='reset')await expect(page.getByLabel('Zoom da imagem',{exact:true})).toHaveText('100%');
});

test('a delayed image failure does not steal focus from quick-open search',async({page})=>{
  await page.goto('/');const asset=await uploadImage(page);
  let release;const pending=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/file?**',async route=>{await pending;await route.abort();});
  try{
    await openAsset(page,asset.name);
    await expect(page.locator('.pm-image-status')).toHaveText('Carregando imagem…');
    await page.keyboard.press('Control+p');
    const search=page.getByRole('combobox',{name:'Buscar arquivos'});await search.fill('Plane');
    release();
    await expect(page.locator('.pm-image-status')).toHaveText('Não foi possível carregar esta imagem.');
    await expect(search).toBeFocused();
    await page.keyboard.type('jamento');await expect(search).toHaveValue('Planejamento');
  }finally{release();}
});
