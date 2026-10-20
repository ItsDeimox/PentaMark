import {build} from 'esbuild';
import {test,expect} from './energy-fixture.mjs';

const peak=page=>page.locator('.pm-energy-layer').evaluateAll(layers=>{
  let peak=0;
  for(const c of layers){
    const data=window.readEnergyPixels(c);
    for(let i=3;i<data.length;i+=4)peak=Math.max(peak,data[i]);
  }
  return peak;
});

for(const boundary of ['pointerout','blur']){
  test(`existing wave dissipates instead of cutting off on ${boundary}`,async({page},info)=>{
    await page.goto('/');
    await expect(page.locator('.pm-signal-packet')).toHaveCount(12);
    await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
    await page.getByRole('button',{name:'Acrílico',exact:true}).click();
    await page.keyboard.press('Escape');
    await page.mouse.move(900,400);
    await page.mouse.move(1200,600,{steps:8});
    await expect.poll(()=>peak(page)).toBeGreaterThan(30);
    await page.evaluate(boundary=>{
      if(boundary==='blur')window.dispatchEvent(new Event('blur'));
      else document.dispatchEvent(new PointerEvent('pointerout',{relatedTarget:null,pointerType:'mouse'}));
    },boundary);
    expect(await peak(page)).toBeGreaterThan(10);
    await page.waitForTimeout(160);
    expect(await peak(page)).toBeGreaterThan(5);
    if(boundary==='pointerout')await page.screenshot({path:info.outputPath('acrylic-bloom.png')});
    await expect.poll(()=>peak(page),{timeout:6000}).toBe(0);
    await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointermove',{
      clientX:-10,clientY:400,pointerType:'mouse',
    })));
    await page.waitForTimeout(150);
    expect(await peak(page)).toBe(0);
  });
}

test('thin white core retains colored layered falloff and stable acrylic grain',async({page})=>{
  const bundle=await build({entryPoints:['src/features/workspace/energy-painter.ts'],
    bundle:true,write:false,format:'iife',globalName:'EnergyPainter'});
  await page.goto('/');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const result=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');
    const mesh={points:[{x:20,y:40},{x:180,y:40}],edges:[[0,1]],cells:[],path:''};
    const draw=acrylic=>{
      const painter=EnergyPainter.createEnergyPainter(canvas,mesh,200,80,1,'rgb(50,180,230)',acrylic);
      painter.draw(new Float32Array([1,1]));
      const pixels=window.readEnergyPixels(canvas);
      const at=y=>Array.from(pixels.slice((y*200+100)*4,(y*200+100)*4+4));
      painter.draw(new Float32Array([1,1]));
      const stable=window.readEnergyPixels(canvas).every((v,i)=>v===pixels[i]);
      painter.dispose();
      return {pixels:Array.from(pixels),core:at(40),near:at(42),far:at(45),stable};
    };
    const flat=draw(false),acrylic=draw(true);
    return {core:flat.core,near:flat.near,far:flat.far,stable:acrylic.stable,
      materialDifference:flat.pixels.some((v,i)=>v!==acrylic.pixels[i])};
  });
  // Premultiplied RGB: whitening raises red close to blue in the bright core,
  // while the outer halo keeps the theme's blue tint.
  expect(result.core[0]/result.core[2]).toBeGreaterThan(.75);
  expect(result.near[3]).toBeLessThan(result.core[3]*.25);
  expect(result.far[3]).toBeGreaterThan(0);
  expect(result.far[3]).toBeLessThan(result.near[3]);
  expect(result.near[2]).toBeGreaterThan(result.near[0]*1.5);
  expect(result.stable).toBe(true);
  expect(result.materialDifference).toBe(true);
});
