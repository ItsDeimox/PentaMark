import {test as base,expect} from '@playwright/test';
export {expect};
export const test=base.extend({
  page:async({page},use)=>{
    await page.addInitScript(()=>{
      window.readEnergyPixels=(canvas,left=0,top=0,width=canvas.width,height=canvas.height)=>{
        const ctx=canvas.getContext('2d');
        if(ctx)return ctx.getImageData(left,top,width,height).data;
        const gl=canvas.getContext('webgl2'),raw=new Uint8Array(width*height*4),flipped=new Uint8Array(raw.length);
        gl.readPixels(left,canvas.height-top-height,width,height,gl.RGBA,gl.UNSIGNED_BYTE,raw);
        for(let row=0;row<height;row++)flipped.set(raw.subarray(row*width*4,(row+1)*width*4),(height-1-row)*width*4);
        return flipped;
      };
    });
    await use(page);
  },
});
