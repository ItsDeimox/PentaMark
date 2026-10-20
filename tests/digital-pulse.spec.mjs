import {test,expect} from '@playwright/test';

test('digital pulse draws chromatic ghosts and faint pentagon faces without moving text',async({page})=>{
  await page.goto('/');
  const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview'});
  await expect(editor).toBeVisible();
  const before=await editor.boundingBox();
  await page.mouse.move(1150,350);
  await page.mouse.move(1350,500,{steps:12});
  const sample=()=>page.locator('.pm-energy-layer').evaluateAll(layers=>{
    let chromatic=0,filled=0,faceAlpha=0;
    for(const c of layers){
      const ctx=c.getContext('2d'),data=ctx.getImageData(0,0,c.width,c.height).data;
      for(let i=0;i<data.length;i+=4){
        if(data[i+3]>6&&data[i]>data[i+1]*1.1)chromatic++;
        // A face has a broad, low-alpha interior rather than only thin strokes.
        if(data[i+3]>=1&&data[i+3]<=5)filled++;
      }
      const r=c.getBoundingClientRect(),x=Math.floor((1344-r.x)*c.width/r.width),y=Math.floor((508-r.y)*c.height/r.height);
      // Hand-derived center of the pentagon spanning x1320..1368, y490..532.
      // It is >15px from an edge, beyond the width of every bloom stroke.
      if(x>=0&&y>=0&&x<c.width&&y<c.height)faceAlpha=Math.max(faceAlpha,data[(y*c.width+x)*4+3]);
    }
    return {chromatic,filled,faceAlpha};
  });
  await expect.poll(async()=>(await sample()).chromatic).toBeGreaterThan(10);
  expect((await sample()).filled).toBeGreaterThan(1000);
  expect((await sample()).faceAlpha).toBeGreaterThan(0);
  expect(await editor.boundingBox()).toEqual(before);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(async()=>(await sample()).chromatic).toBe(0);
});
