/** Routed, non-tiling traces. Rasterized once per panel size, not per frame. */
export function createCircuitMap(width: number, height: number, density: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * density));
  canvas.height = Math.max(1, Math.ceil(height * density));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(density, density);
  ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  let state = (seed ^ 0x6d2b79f5) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const path = (points: number[][], strength: number, lane: number) => {
    ctx.lineWidth = lane === 0 ? .75 : .55;
    ctx.strokeStyle = `rgba(255,255,255,${strength})`;
    ctx.beginPath(); points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.stroke();
    // Flat rectangular lands, never the old repeated circular vias.
    if (lane % 3 === 0) {
      const [x,y] = points[points.length-1];
      ctx.fillStyle = `rgba(255,255,255,${strength*.8})`; ctx.fillRect(x-1.2,y-.7,2.4,1.4);
    }
  };
  const group = (right: boolean, y: number, extent: number, slope: number, count: number) => {
    for (let lane=0; lane<count; lane++) {
      const separation = lane*6, start = y+separation;
      const bend = width*(.13+random()*.025) + lane*3;
      const diagonal = Math.min(Math.abs(slope), width*.21);
      const end = Math.min(width*.75, extent+lane*11);
      const sign = Math.sign(slope);
      let points = [[-8,start],[bend,start],[bend+diagonal,start+sign*diagonal],[end,start+sign*diagonal]];
      if (lane % 2 === 0) points.push([end+7,start+sign*diagonal+sign*7],[end+7,start+sign*diagonal+sign*(20+random()*32)]);
      if (right) points = points.map(([x,yy])=>[width-x,yy]);
      path(points,.46+random()*.42,lane);
    }
  };
  group(false, height*(.12+random()*.06), width*(.46+random()*.1), height*.22, width>420?5:3);
  group(true, height*(.58+random()*.12), width*(.38+random()*.09), -height*.17, width>420?4:3);
  if (height>280) {
    for(let lane=0;lane<3;lane++) {
      const x=width*(.2+lane*.018), y=height*(.72+lane*.023), d=Math.min(width*.1,60);
      path([[x,height+8],[x,y+d],[x+d,y],[x+d+width*.12,y]],.33+random()*.26,lane+1);
    }
  }
  if (width>620) {
    const x=width*.72,y=height*.22;
    for(let lane=0;lane<3;lane++) path([[x+lane*5,-8],[x+lane*5,y-lane*7],[x+28+lane*5,y+28-lane*7],[width+8,y+28-lane*7]],.3+random()*.2,lane+1);
  }
  return canvas;
}
