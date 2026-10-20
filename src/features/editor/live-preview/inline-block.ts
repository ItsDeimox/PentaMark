import { isolateHistory, redo, undo } from '@codemirror/commands';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { ChangeSet, EditorSelection, Text } from '@codemirror/state';
import type { MutableRefObject } from 'react';
import { stringify } from 'yaml';
import type { LiveSourceBlock } from './blocks';
import type { LiveEditorProps } from './types';
import { mapInlineSource, sliceInlineMap, replaceInlineSource, type InlineSourceMap } from './inline-source-map';
import { tableCellRanges } from './table-source';

type Island = { element: HTMLElement; from: number; to: number; text: string; positions: number[]; map:InlineSourceMap; property?: boolean; prefix?:string; suffix?:string; tableIndex?:number };
type InlineBlock = { block: LiveSourceBlock; expected: string | null; update: (block: LiveSourceBlock) => boolean };
const controllers = new WeakMap<HTMLElement, InlineBlock>();
const editableIslands = new WeakMap<HTMLElement, {island:Island;control:InlineBlock}>();
const focusBookmarks = new WeakMap<EditorView, Set<{from:number}>>();
export const inlineBlock = (shell: HTMLElement) => controllers.get(shell);

export function trackInlineChanges(update:ViewUpdate){
  if(!update.docChanged)return;
  for(const bookmark of focusBookmarks.get(update.view)||[]){
    let association=1;
    update.changes.iterChangedRanges((from,to)=>{if(from<=bookmark.from&&to>bookmark.from)association=-1;});
    bookmark.from=update.changes.mapPos(bookmark.from,association);
  }
}

function visibleOffset(element:HTMLElement,node:Node,end:number){
  const prefix=document.createRange();prefix.setStart(element,0);prefix.setEnd(node,end);
  const holder=document.createElement('div');holder.append(prefix.cloneContents());return visibleText(holder,false).length;
}

function visiblePoint(element: HTMLElement, offset: number): {node:Node;offset:number} {
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
  let current:Node|null,remaining=Math.max(0,offset);
  while(current=walker.nextNode()) {
    if(current.nodeType===Node.TEXT_NODE){const length=current.textContent?.length||0;if(remaining<=length)return {node:current,offset:remaining};remaining-=length;}
    else if(current instanceof HTMLBRElement){if(remaining===0)return {node:current.parentNode!,offset:[...current.parentNode!.childNodes].indexOf(current)};remaining--;}
  }
  return {node:element,offset:element.childNodes.length};
}

/** Restore a logical editable cell/paragraph after a CodeMirror transaction
 * recreates its widget. It never redirects focus from another UI control. */
export function rememberInlineFocus(view: EditorView) {
  const active=document.activeElement;
  const element=active instanceof HTMLElement?active.closest<HTMLElement>('.pm-inline-editable'):null;
  const root=element?.closest<HTMLElement>('.pm-live-widget');
  if(!element||!root||!view.dom.contains(root))return null;
  const index=[...root.querySelectorAll('.pm-inline-editable')].indexOf(element);
  const bookmark={from:Number(root.dataset.pmFrom)};
  const records=focusBookmarks.get(view)||new Set<{from:number}>();records.add(bookmark);focusBookmarks.set(view,records);
  const previousState=view.state;
  const native=window.getSelection()?.rangeCount?window.getSelection()!.getRangeAt(0):null;
  const localFrom=native&&element.contains(native.startContainer)?visibleOffset(element,native.startContainer,native.startOffset):0;
  const localTo=native&&element.contains(native.endContainer)?visibleOffset(element,native.endContainer,native.endOffset):localFrom;
  return ()=>{
    records.delete(bookmark);
    if(view.state===previousState&&element.isConnected)return true;
    const current=document.activeElement;
    if(current!==active&&current!==document.body&&current!==view.contentDOM)return false;
    const nextRoot=[...view.dom.querySelectorAll<HTMLElement>('.pm-live-widget')].find(candidate=>Number(candidate.dataset.pmFrom)===bookmark.from);
    const next=nextRoot?.querySelectorAll<HTMLElement>('.pm-inline-editable')[index];
    const entry=next&&editableIslands.get(next);
    if(!next||!entry||next.contentEditable!=='true')return false;
    const main=view.state.selection.main;
    const glyph=(position:number)=>{
      const relative=position-entry.control.block.start;
      const found=entry.island.positions.findIndex(offset=>offset>=relative);
      return found<0?entry.island.text.length:Math.min(found,entry.island.text.length);
    };
    const inside=main.from>=entry.control.block.start+entry.island.map.from&&main.to<=entry.control.block.start+entry.island.map.to;
    const from=visiblePoint(next,inside?glyph(main.from):Math.min(localFrom,entry.island.text.length)),to=visiblePoint(next,inside?glyph(main.to):Math.min(localTo,entry.island.text.length));
    next.focus({preventScroll:true});
    const range=document.createRange();range.setStart(from.node,from.offset);range.setEnd(to.node,to.offset);
    const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
    return true;
  };
}

export function inlineSelection(view: EditorView) {
  const selection=window.getSelection();
  if(!selection?.rangeCount)return null;
  const range=selection.getRangeAt(0);
  const parent=range.startContainer instanceof Element?range.startContainer:range.startContainer.parentElement;
  const element=parent?.closest<HTMLElement>('.pm-inline-editable');
  const entry=element&&editableIslands.get(element);
  if(!entry||!view.dom.contains(element)||!element.contains(range.endContainer))return null;
  const start=visibleOffset(element,range.startContainer,range.startOffset),end=visibleOffset(element,range.endContainer,range.endOffset);
  const positions=entry.island.positions;
  return {from:entry.control.block.start+(positions[start]??entry.island.map.to),to:entry.control.block.start+(end>start?entry.island.map.ends[end-1]:positions[end])};
}

// Keep a source offset for each rendered character, not an estimated character
// width. Hidden emphasis/link delimiters never enter the browser's selection.
function visibleText(element: HTMLElement, caretPlaceholders=true) {
  // Browsers leave a lone <br> as the caret placeholder in an empty editing
  // host. It is not a user-inserted line break and must never enter Markdown.
  if(caretPlaceholders&&element.childNodes.length===1 && element.firstChild instanceof HTMLBRElement)return '';
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) text += (node.textContent || '').replace(/\u00a0/g,' ');
    else if (node instanceof HTMLBRElement) {
      const trailing=node===node.parentNode?.lastChild;
      if(caretPlaceholders&&trailing&&(node.previousSibling instanceof HTMLBRElement||node.parentElement?.tagName==='DIV'))return;
      text += '\n';
    }
    else {
      if(node!==element && node instanceof HTMLElement && /^(DIV|P)$/.test(node.tagName) && text && !text.endsWith('\n'))text+='\n';
      for (const child of node.childNodes) walk(child);
    }
  };
  walk(element); return text;
}

const positionsFor = (map:InlineSourceMap) => [...map.starts,map.ends.at(-1)??map.from];

export function attachInlineBlock(shell: HTMLElement, root: HTMLElement, initial: LiveSourceBlock,
  view: EditorView, props: MutableRefObject<LiveEditorProps>) {
  const islands: Island[] = [];
  const control: InlineBlock = { block: initial, expected: null, update(block) {
    if (control.expected !== block.raw || block.start !== control.block.start) return false;
    control.block = block; control.expected = null;
    root.dataset.pmFrom=String(block.start); root.dataset.pmTo=String(block.end);
    return true;
  } };
  controllers.set(shell, control);
  const readMap=(element:HTMLElement,raw:string,from:number,to:number,property=false)=>
    sliceInlineMap(mapInlineSource(raw,from,to,{quote:initial.type==='quote',literal:initial.type==='code'||property}),visibleText(element));
  const add = (element: HTMLElement, from: number, to: number, property = false) => {
    const map=readMap(element,initial.raw,from,to,property);
    if(!map)return null;
    const island: Island = {element,from,to,text:visibleText(element),positions:positionsFor(map),map,property};
    let codeInput:{text:string;caret:number}|null=null;
    islands.push(island);
    editableIslands.set(element,{island,control});
    element.contentEditable = props.current.readOnly ? 'false' : 'true';
    element.classList.add('pm-inline-editable');
    element.setAttribute('role','textbox');
    element.setAttribute('aria-label',initial.type==='table'?'Editar célula':initial.type==='code'?'Editar código':'Editar conteúdo do bloco');
    element.setAttribute('aria-multiline',String(initial.type!=='table'&&!property));
    element.spellcheck=initial.type!=='code';
    element.addEventListener('keydown', event => {
      // CodeMirror's keymap runs on the surrounding host too. Let the browser
      // move this island's caret, not the hidden main-editor selection.
      if(!((event.ctrlKey||event.metaKey)&&['s','p','f'].includes(event.key.toLowerCase())))event.stopPropagation();
      if((event.ctrlKey||event.metaKey)&&['Home','End','a'].includes(event.key)) {
        event.preventDefault();
        const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(element);
        if(event.key!=='a')range.collapse(event.key==='Home');
        if(selection){
          if(event.shiftKey&&event.key!=='a'&&selection.anchorNode&&element.contains(selection.anchorNode))selection.extend(range.startContainer,range.startOffset);
          else {selection.removeAllRanges();selection.addRange(range);}
        }
        element.focus({preventScroll:true});return;
      }
      const format=event.key.toLowerCase()==='b'?'bold':event.key.toLowerCase()==='i'?'italic':event.key.toLowerCase()==='k'?'link':null;
      if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&format) {
        event.preventDefault();event.stopPropagation();props.current.apiRef.current?.applyFormat(format);return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='z') {
        event.preventDefault(); event.stopPropagation();
        const restore=rememberInlineFocus(view);(event.shiftKey?redo:undo)(view);if(!restore?.())view.focus();return;
      }
      if (event.key==='Escape') { event.preventDefault(); element.blur(); }
      if (event.key==='Enter' && (initial.type==='table'||property)) {
        event.preventDefault();
        const next=islands[islands.indexOf(island)+1]; if(next)next.element.focus(); else element.blur();
      }
    });
    element.addEventListener('paste', event => {
      event.preventDefault();
      // Do not inject clipboard HTML into the live, sanitized rendering tree.
      document.execCommand('insertText',false,event.clipboardData?.getData('text/plain')||'');
    });
    element.addEventListener('drop', event=>{
      event.preventDefault();event.stopPropagation();
      if(!props.current.readOnly)document.execCommand('insertText',false,event.dataTransfer?.getData('text/plain')||'');
    });
    element.addEventListener('beforeinput', event => {
      if(event.isComposing)return;
      if(initial.type==='code'&&(event.inputType==='insertText'||event.inputType==='insertParagraph'||event.inputType==='insertLineBreak')){
        const range=window.getSelection()?.rangeCount?window.getSelection()!.getRangeAt(0):null;
        if(range&&element.contains(range.startContainer)&&element.contains(range.endContainer)){
          const start=visibleOffset(element,range.startContainer,range.startOffset),end=visibleOffset(element,range.endContainer,range.endOffset);
          const data=event.inputType==='insertText'?event.data:'\n';
          if(data!==null)codeInput={text:island.text.slice(0,start)+data+island.text.slice(end),caret:start+data.length};
        }
      }
      const selected=inlineSelection(view);
      if(selected)view.dispatch({selection:EditorSelection.range(selected.from,selected.to)});
      if (props.current.readOnly || view.state.readOnly) event.preventDefault();
      else if(event.inputType==='insertParagraph'||event.inputType==='insertLineBreak') {
        event.preventDefault();
        if(initial.type!=='table'&&!property)document.execCommand('insertText',false,'\n');
      }
      else if(event.inputType==='historyUndo'||event.inputType==='historyRedo') {
        event.preventDefault();const restore=rememberInlineFocus(view);(event.inputType==='historyUndo'?undo:redo)(view);if(!restore?.())view.focus();
      }
    });
    element.addEventListener('input', () => {
      if (props.current.readOnly || view.state.readOnly) return;
      let text=visibleText(element);const previous=island.text;
      // Chromium can append a caret-only newline to a multiline insert in a
      // preformatted editing host. Reconcile with beforeinput's actual data.
      if(codeInput&&text===codeInput.text+'\n'){
        const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null,last:CharacterData|null=null;
        while(node=walker.nextNode())last=node as CharacterData;
        if(last)last.deleteData(last.length-1,1);
        text=codeInput.text;
        const point=visiblePoint(element,codeInput.caret);window.getSelection()?.collapse(point.node,point.offset);
      }
      codeInput=null;
      if (text===previous) return;
      let first=0,oldEnd=previous.length,newEnd=text.length;
      while(first<oldEnd && first<newEnd && previous[first]===text[first]) first++;
      while(oldEnd>first && newEnd>first && previous[oldEnd-1]===text[newEnd-1]) {oldEnd--;newEnd--;}
      const block=control.block;
      // Never apply a stale DOM edit after a remote update or navigation.
      if (view.state.doc.sliceString(block.start,block.end)!==block.raw) return;
      const changes=property?[{from:island.from,to:island.to,insert:stringify(text).trimEnd()}]
        :replaceInlineSource(block.raw,island.map,first,oldEnd,text.slice(first,newEnd),{table:initial.type==='table'}).changes;
      if(!previous && changes.length===1&&(island.prefix||island.suffix)) {
        changes[0].insert=(island.prefix||'')+changes[0].insert+(island.suffix||'');
      }
      const changeSet=ChangeSet.of(changes,block.raw.length);
      const raw=changeSet.apply(Text.of(block.raw.split('\n'))).toString();
      control.expected=raw;
      const table=initial.type==='table'?tableCellRanges(raw):null;
      for(const other of islands){
        other.from=changeSet.mapPos(other.from,-1);other.to=changeSet.mapPos(other.to,1);
        if(other.tableIndex!==undefined&&table){
          const cell=table[other.tableIndex];
          if(cell){other.from=cell.from;other.to=cell.to;other.prefix=cell.insertPrefix;other.suffix=cell.insertSuffix;}
        }
        const map=readMap(other.element,raw,other.from,other.to,other.property);
        if(map){other.map=map;other.positions=positionsFor(map);}
        else control.expected=null; // Rebuild safely; never retain stale offsets.
      }
      island.text=text;island.prefix=undefined;island.suffix=undefined;
      // Re-map formatting spans after the edit; their actual browser DOM stays
      // intact during typing, IME composition and drag selection.
      const scroll=view.scrollDOM.scrollTop;
      const caret=control.expected?island.positions[Math.min(newEnd,island.positions.length-1)]:changeSet.mapPos(island.map.from,1);
      view.dispatch({changes:changes.map(change=>({...change,from:change.from+block.start,to:change.to+block.start})),selection:EditorSelection.cursor(block.start+caret),userEvent:'input.type',annotations:isolateHistory.of('full')});
      view.scrollDOM.scrollTop=scroll; view.requestMeasure();
    });
    return island;
  };

  if(initial.type==='table') {
    const cells=tableCellRanges(initial.raw);
    root.querySelectorAll<HTMLElement>('th,td').forEach((cell,index)=>{
      const range=cells[index];if(!range)return;
      const island=add(cell,range.from,range.to);
      if(island){island.tableIndex=index;island.prefix=range.insertPrefix;island.suffix=range.insertSuffix;}
    });
  } else if(initial.type==='code') {
    const code=root.querySelector<HTMLElement>('pre > code');
    const start=initial.raw.indexOf('\n')+1;
    const closing=/\n[ \t]*(?:`{3,}|~{3,})[ \t]*(?:\n|$)$/.exec(initial.raw);
    if(code && !code.closest('.pm-mermaid,.pm-kanban')){
      const island=add(code,start,closing?Math.max(start,closing.index):initial.raw.length);
      if(closing&&closing.index<start&&island)island.suffix='\n';
    }
  } else if(initial.type==='quote'||initial.type==='list'||initial.type==='heading'||initial.type==='paragraph') {
    const callout=/^\s*>\s*\[![^\]]+\][+-]?/.exec(initial.raw);
    let cursor=callout?.[0].length||0;
    root.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li,summary').forEach(original=>{
      let element=original;
      if(element.querySelector('p'))return;
      if(element.tagName==='LI' && element.querySelector('li')) {
        const inline=document.createElement('span');
        for(const child of [...element.childNodes]) {
          if(child instanceof Element && child.matches('ul,ol,.pm-list-marker,input'))continue;
          inline.appendChild(child);
        }
        if(!inline.textContent)return;
        element.insertBefore(inline,element.querySelector('ul,ol'));element=inline;
      }
      const island=add(element,cursor,initial.raw.length);
      if(island)cursor=island.map.to;
    });
  } else if(initial.type==='properties') {
    root.querySelectorAll<HTMLElement>('.pm-property').forEach(row=>{
      const key=row.querySelector('strong')?.textContent;
      const value=row.querySelector<HTMLElement>(':scope > div');
      if(!key||!value||value.children.length!==1)return;
      const lines=initial.raw.matchAll(/^([^\n:]+):[ \t]*(.*)$/gm);
      for(const line of lines)if(line[1]===key && !/^[\[\{>|&*!]/.test(line[2])) {
        const from=line.index!+line[0].length-line[2].length;
        add(value,from,from+line[2].length,true); break;
      }
    });
  }
  return control;
}
