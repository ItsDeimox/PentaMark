/** Reserve an end scrollbar without moving the document off the window centre.
 * A leading gutter cannot be used: CodeMirror's selection layers assume none.
 * Measure in layout pixels so CSS zoom and platform scrollbar widths work too.
 */
export function alignDocumentScrollbar(element:HTMLElement){
  const measure=()=>{
    const style=getComputedStyle(element);
    const borders=(parseFloat(style.borderLeftWidth)||0)+(parseFloat(style.borderRightWidth)||0);
    const half=Math.max(0,element.offsetWidth-element.clientWidth-borders)/2;
    const value=`${half}px`;
    if(element.style.getPropertyValue('--pm-scrollbar-half')!==value)element.style.setProperty('--pm-scrollbar-half',value);
  };
  measure();const observer=new ResizeObserver(measure);observer.observe(element);
  return ()=>{observer.disconnect();element.style.removeProperty('--pm-scrollbar-half');};
}
