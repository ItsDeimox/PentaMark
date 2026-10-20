import {test,expect} from '@playwright/test';

// Samples world coordinates, so moving the raster with the pointer cannot pass.
async function lightNear(page,x,y,radius=100){
  return page.evaluate(({x,y,radius})=>{
    let peak=0;
    for(const c of document.querySelectorAll('.pm-energy-layer')){
      const b=c.getBoundingClientRect(),sx=c.width/b.width,sy=c.height/b.height;
      const left=Math.max(0,Math.floor((x-radius-b.x)*sx)),top=Math.max(0,Math.floor((y-radius-b.y)*sy));
      const right=Math.min(c.width,Math.ceil((x+radius-b.x)*sx)),bottom=Math.min(c.height,Math.ceil((y+radius-b.y)*sy));
      if(right<=left||bottom<=top)continue;
      const data=c.getContext('2d').getImageData(left,top,right-left,bottom-top).data;
      for(let i=3;i<data.length;i+=4)peak=Math.max(peak,data[i]);
    }
    return peak;
  },{x,y,radius});
}
test('hover leaves world-space energy behind a fast cursor and clears at rest',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.pm-energy-layer').first()).toBeAttached();
  await page.mouse.move(450,450);
  await expect.poll(()=>lightNear(page,450,450)).toBeGreaterThan(20);
  await page.mouse.move(1200,450);
  await expect.poll(()=>lightNear(page,1200,450)).toBeGreaterThan(20);
  expect(await lightNear(page,450,450)).toBeGreaterThan(15);
  await expect.poll(()=>lightNear(page,450,450),{timeout:4000}).toBe(0);
  await expect.poll(()=>lightNear(page,1200,450),{timeout:4000}).toBe(0);
  const tracks=page.locator('.pm-mesh-track');
  if(await tracks.count())expect(await tracks.evaluate(el=>getComputedStyle(el).opacity)).toBe('0');
});

test('ambient lights follow the former perimeter circuits, not local mesh cells',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.pm-signal-packet').first()).toBeAttached();
  const travel=await page.locator('.pm-signal-packet').first().evaluate(el=>{
    const frames=el.getAnimations()[0].effect.getKeyframes();
    const points=frames.map(f=>new DOMMatrix(f.transform));
    return {spanX:Math.max(...points.map(p=>p.m41))-Math.min(...points.map(p=>p.m41)),
      spanY:Math.max(...points.map(p=>p.m42))-Math.min(...points.map(p=>p.m42))};
  });
  expect(travel.spanY).toBeGreaterThan(700);
  expect(travel.spanX).toBeGreaterThan(350);
});

test('wide trail crossing tile boundaries keeps both sides illuminated',async({page})=>{
  await page.setViewportSize({width:1920,height:1080});
  await page.goto('/');
  await expect(page.locator('.pm-energy-layer').first()).toBeAttached();
  await page.mouse.move(200,512);
  await expect.poll(()=>lightNear(page,200,512)).toBeGreaterThan(20);
  await page.mouse.move(1400,512);
  await expect.poll(()=>lightNear(page,1400,512)).toBeGreaterThan(20);
  for(const x of [200,800,1400]){
    expect(await lightNear(page,x,480,20)).toBeGreaterThan(5);
    expect(await lightNear(page,x,544,20)).toBeGreaterThan(5);
  }
});

test('resuming after decay or a drag never connects to stale coordinates',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.pm-energy-layer').first()).toBeAttached();
  for(const interruption of ['idle','drag']){
    await page.mouse.move(1300,400);
    await expect.poll(()=>lightNear(page,1300,400)).toBeGreaterThan(20);
    if(interruption==='idle'){
      await page.waitForTimeout(3200);
    }else{
      await page.mouse.down();
      await page.mouse.move(800,400);
      await page.mouse.up();
    }
    await page.mouse.move(300,400);
    await expect.poll(()=>lightNear(page,300,400)).toBeGreaterThan(20);
    expect(await lightNear(page,800,400,60)).toBe(0);
    await page.waitForTimeout(3200);
  }
});
