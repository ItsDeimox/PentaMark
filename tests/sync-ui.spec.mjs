import {test,expect} from '@playwright/test';

async function offlineBridge(page,platform) {
 await page.addInitScript(({platform})=>{
  const p={vaultId:'11111111-1111-4111-8111-111111111111',serverId:'22222222-2222-4222-8222-222222222222',replicaId:'33333333-3333-4333-8333-333333333333',origin:'http://100.100.1.2:3417',offlineEnabled:true,mode:'manual'};
  localStorage.setItem('pentamark:sync:profile:'+p.replicaId,JSON.stringify(p));localStorage.setItem('pentamark:sync:active',p.replicaId);
  localStorage.setItem('pentamark:appearance',JSON.stringify({graphicsMode:'flat',backgroundMotion:false,backgroundHover:false}));
  const status={phase:'waiting-manual',localSaved:true,pendingCount:0,conflictCount:0,snapshotComplete:true,lastSuccessfulSync:null,errorCode:null};
  const meta=path=>({path,title:path.slice(0,-3),size:20,modified:1});
  const handler=async(method,args={})=>{
   if(['handshake','remoteSnapshot','changes','apply','downloadBlob','uploadBlob'].includes(method)){localStorage.setItem('test:network-called',method);throw Error('host offline');}
   if(method==='open'||method==='configure')return status;
   if(method==='snapshot')return{profile:p,status,cursor:'epoch:1',epoch:'epoch',initialCopy:null,entries:[],conflicts:[],preparedOperations:[]};
   if(method==='preparePending')return{operations:[]};
   if(method==='importDocument'){localStorage.setItem('test:native-import',JSON.stringify(args));return{entryId:'44444444-4444-4444-8444-444444444444',path:args.path,kind:'asset'};}
   if(method==='exportReplica'){localStorage.setItem('test:native-export','1');return{cancelled:false};}
   if(method!=='request')return{};
   if(args.url==='/api/state')return{status:200,data:{notes:['Alpha.md','Beta.md'].map(meta),assets:[],folders:[],connections:[],locks:[],clients:1,urls:[],vaultName:'Cópia offline'}};
   if(args.url==='/api/config')return{status:200,data:{vaultName:'Cópia offline',port:3417,isHost:false,openBrowser:false,maxUploadMB:32,lockEditedNotes:false,cleanupUnusedAssets:false,aiBridgeEnabled:false,aiBridgeToken:''}};
   if(args.url.startsWith('/api/note')){
    if(args.method==='POST'){localStorage.setItem('test:preserved-conflict',JSON.stringify(args.body));return{status:201,data:{path:args.body.path,revision:'copy-head'}};}
    const path=new URL(args.url,'http://local').searchParams.get('path');const key='test:replica:'+path;
    if(args.method==='PUT')localStorage.setItem(key,args.body.content);
    return{status:200,data:{...meta(path),content:localStorage.getItem(key)||'Conteúdo local '+path,revision:'local-head'}};
   }
   return{status:404,data:{error:'unavailable-offline'}};
  };
  if(platform==='android'){
   localStorage.setItem('pentamark:android:remote-profile',JSON.stringify({origin:p.origin}));window.androidBridge={};
   window.Capacitor={PluginHeaders:['SyncVault','LocalVault','RemoteVault'].map(name=>({name,methods:['open','configure','request','snapshot','preparePending','handshake','remoteSnapshot','changes','apply','downloadBlob','uploadBlob','importDocument','exportReplica','info','disconnect','startEvents','stopEvents'].map(name=>({name,rtype:'promise'})).concat({name:'addListener',rtype:'callback'})})),nativeCallback:()=> 'listener',nativePromise:async(plugin,method,args)=>{
    if(plugin==='SyncVault')return handler(method,args);
    if(plugin==='RemoteVault'){if(method==='disconnect'){localStorage.setItem('test:legacy-disconnected','1');return{};}localStorage.setItem('test:legacy-network','1');throw Error('host offline');}
    return method==='info'?{root:'/independent'}:{};
   }};
  }else{
   window.pentaMarkDesktop={sync:{invoke:async c=>{
    const key={open:'profile',configure:'config',persistIncoming:'batch',confirm:'result',resolve:'input'}[c.method];
    let value=await handler(c.method,key?{[key]:c.payload}:c.payload);if(c.method==='preparePending')value=value.operations;
    return{requestId:c.requestId,replicaId:c.replicaId,ok:true,value};
   }},getProfile:async()=>({name:'Teste',avatar:''}),getVault:async()=>({ok:false}),getUpdateStatus:async()=>({phase:'unsupported'}),checkForUpdates:async()=>({phase:'unsupported'}),consumeInvitation:async()=>null,onInvitation:()=>()=>{}};
  }
 },{platform});
}
for(const platform of ['pc','android'])test(`${platform}: known manual replica opens, saves and reopens with host disconnected`,async({page})=>{
 await offlineBridge(page,platform);await page.goto('/');
 const editor=page.locator('.cm-content');await expect(editor).toContainText('Conteúdo local Alpha.md');
 await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type(' alteração offline');
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('test:replica:Alpha.md'))).toContain('alteração offline');
 await page.locator('.pm-note-item').filter({hasText:'Beta'}).click();await expect(editor).toContainText('Conteúdo local Beta.md');
 await page.reload();await expect(editor).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('test:network-called'))).toBeNull();
 expect(await page.evaluate(()=>localStorage.getItem('test:legacy-network'))).toBeNull();
 if(platform==='android')expect(await page.evaluate(()=>localStorage.getItem('test:legacy-disconnected'))).toBe('1');
});
for(const choice of ['Usar servidor','Manter minha versão'])test(`pc: recovered draft resolution ${choice} retains original and does not return after reload`,async({page})=>{
 await offlineBridge(page,'pc');await page.addInitScript(()=>{if(!localStorage.getItem('test:draft-seeded')){localStorage.setItem('test:draft-seeded','1');localStorage.setItem('pentamark:sync:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333:draft:Alpha.md',JSON.stringify({content:'Rascunho divergente',revision:'old-head'}));}});await page.goto('/');
 await page.getByRole('button',{name:choice,exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('test:preserved-conflict'))).toContain('Rascunho divergente');
 await page.reload();await expect(page.locator('.cm-content')).toBeVisible();await expect(page.getByRole('button',{name:'Usar servidor',exact:true})).toHaveCount(0);
});
for(const platform of ['pc','android'])test(`${platform}: offline attachment uses native picker, settings export stays native`,async({page})=>{
 await offlineBridge(page,platform);await page.goto('/');
 await expect(page.locator('.cm-content')).toContainText('Conteúdo local Alpha.md');
 await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
 await page.getByLabel('Caminho do anexo offline').fill('assets/referencia.pdf');
 await page.getByRole('button',{name:'Anexar arquivo offline',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('test:native-import'))).toBe(JSON.stringify({path:'assets/referencia.pdf'}));
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('test:replica:Alpha.md'))).toContain('assets/referencia.pdf');
 await page.getByRole('button',{name:'Configurações',exact:true}).click();
 await page.getByRole('tab',{name:'Sincronização',exact:true}).click();
 await expect(page.getByLabel('Manter cópia offline')).toBeChecked();
 await page.getByRole('button',{name:'Exportar pendências',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('test:native-export'))).toBe('1');
 expect(await page.evaluate(()=>localStorage.getItem('test:network-called'))).toBeNull();
});
