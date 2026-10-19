import { test, expect } from '@playwright/test';

test('closing a folder at 160 percent scale never stretches it before collapse',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});
 await page.addInitScript(()=>localStorage.setItem('pentamark:appearance',JSON.stringify({appScale:1.6})));
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
 const folder=page.locator('.pm-folder').filter({has:page.locator(':scope > .pm-folder-title').filter({hasText:'Planejamento'})}).first();
 await folder.locator(':scope > .pm-folder-title').click();await page.waitForTimeout(300);
 const result=await folder.evaluate(el=>new Promise(resolve=>{
  const disclosure=el.querySelector(':scope > .pm-tree-disclosure');
  const before=disclosure.getBoundingClientRect().height;
  el.querySelector(':scope > .pm-folder-title').click();
  const heights=[];let n=0;
  const sample=()=>{heights.push(disclosure.getBoundingClientRect().height);if(++n<20)requestAnimationFrame(sample);else resolve({before,heights})};requestAnimationFrame(sample);
 }));
 expect(Math.max(...result.heights),JSON.stringify(result)).toBeLessThanOrEqual(result.before+1);
 expect(result.heights.at(-1)).toBeLessThanOrEqual(1);
 expect(new Set(result.heights.map(n=>Math.round(n))).size).toBeGreaterThan(3);
});
