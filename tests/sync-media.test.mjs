import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// Exercise the actual Markdown URL gate without DOM/React or external network.
const source=readFileSync('src/features/markdown/renderer.ts','utf8');
const fn=source.slice(source.indexOf('export function markdownLinkHtml('),source.indexOf('\nexport function transformObsidianInline'))
 .replace('export function','function').replace('image: boolean, label: string, target: string, context: MarkdownContext, original: string','image, label, target, context, original');
for(const target of ['/uploads/picture.png','/assets/picture.png','/api/file?path=assets%2Fpicture.png'])test(`offline legacy ${target} cannot escape to the independent host`,()=>{
 const seen=[];const html=runInNewContext(fn+';markdownLinkHtml(true,"picture",target,{activePath:"a.md"},"ORIGINAL")',{
 target,isOfflineReplica:true,URL,extensionOfLink:()=> 'png',escapeAttribute:x=>x,escapeCode:x=>x,encodeSource:x=>x,splitLinkTarget:x=>({path:x}),vaultFileUrl:value=>{seen.push(value);return '/__replica_media/cap/file';},resolveNotePath:()=>'',resolveFolderPath:()=>''});
 assert.notEqual(html,'ORIGINAL');assert.deepEqual(seen,['assets/picture.png']);assert.match(html,/src="\/__replica_media\//);
});
