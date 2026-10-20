/** Same band equation as the GLSL material, applied to live DOM without readback. */
export function fragmentClip(progress: number, width: number, height: number): string {
  if(progress>=.9999)return 'none';
  if(progress<=.0001)return 'inset(0 100% 0 0)';
  const points=['0px 0px'];
  for(let band=0;band<Math.ceil(height/28);band++){
    const delay=((band*7)%13)/13;
    const x=Math.max(0,Math.min(1,progress*1.24-delay*.24))*width;
    const y=Math.min(height,band*28),bottom=Math.min(height,(band+1)*28);
    points.push(`${x.toFixed(2)}px ${y}px`,`${x.toFixed(2)}px ${bottom}px`);
  }
  points.push(`0px ${height}px`);
  return `polygon(${points.join(',')})`;
}
