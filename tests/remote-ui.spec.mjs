import {test,expect} from '@playwright/test';

async function bridge(page,{remote=false,offline=false,invitation=false}={}) {
  await page.addInitScript(({remote,offline,invitation})=>{
    let pendingInvite=invitation?'pentamark://join?v=1&host=http%3A%2F%2F100.100.1.2%3A3417&invite=https%3A%2F%2Flogin.tailscale.com%2Fadmin%2Finvite%2Foffline_test&name=Convite%20offline':null;
    if(!localStorage.getItem('test:remote-setup')) {
      localStorage.setItem('test:remote-setup','1');
      if(remote) localStorage.setItem('pentamark:android:remote-profile',JSON.stringify({origin:'http://100.100.1.2:3417'}));
      localStorage.setItem('pentamark:appearance',JSON.stringify({graphicsMode:'flat',backgroundMotion:false,backgroundHover:false}));
    }
    const config={vaultName:'Aparelho',port:3417,isHost:false,openBrowser:false,maxUploadMB:32,lockEditedNotes:false,cleanupUnusedAssets:false,aiBridgeEnabled:false,aiBridgeToken:''};
    window.androidBridge={};
    window.Capacitor={
      PluginHeaders:['LocalVault','RemoteVault','VaultInvitation'].map(name=>({name,methods:['info','request','configure','disconnect','startEvents','stopEvents','removeListener','getLaunchInvitation','acknowledge','openOfficialInvite'].map(name=>({name,rtype:'promise'})).concat({name:'addListener',rtype:'callback'})})),
      nativeCallback:()=> 'listener',
      nativePromise:async(plugin,method,options)=>{
        if(plugin==='VaultInvitation'&&method==='getLaunchInvitation')return {url:pendingInvite};
        if(plugin==='VaultInvitation'&&method==='acknowledge'){pendingInvite=null;localStorage.setItem('test:invite-ack','1');return {};}
        if(method==='info') return {root:'/vault'};
        if(method==='disconnect') {localStorage.setItem('test:disconnected','1');return {};}
        if(plugin==='RemoteVault' && (offline || localStorage.getItem('test:offline')==='1')) throw new Error('PC indisponível');
        if(method!=='request') return {};
        const isRemote=plugin==='RemoteVault';
        const key=isRemote?'test:pc-note':'test:local-note';
        const content=localStorage.getItem(key) || (isRemote?'Nota exclusiva do PC':'Nota exclusiva do aparelho');
        const path='Mesma.md',meta={path,title:'Mesma',modified:1,size:content.length};
        if(options.url==='/api/state') return {status:200,data:{app:'PentaMark',notes:[meta],assets:[],assetPaths:[path],folders:[],connections:[],locks:[],clients:1,urls:[],vaultName:isRemote?'PC':'Aparelho'}};
        if(options.url==='/api/config') return {status:200,data:{...config,vaultName:isRemote?'PC':'Aparelho'}};
        if(options.url.startsWith('/api/note')) {
          if(options.method==='PUT' && localStorage.getItem('test:require-lock')==='1' && JSON.parse(options.body).clientId!==options.clientId) return {status:423,data:{error:'Own lock requires clientId in body'}};
          if(options.method==='PATCH') {localStorage.setItem('test:renamed',JSON.parse(options.body).newPath);return {status:200,data:{path:JSON.parse(options.body).newPath}};}
          if(options.method==='PUT')localStorage.setItem(key,JSON.parse(options.body).content);
          return {status:200,data:{...meta,content:localStorage.getItem(key)||content,revision:'r1'}};
        }
        return {status:200,data:{ok:true}};
      }
    };
  },{remote,offline,invitation});
}

test('Android invitation opens through the native plugin and acknowledges only a received link',async({page})=>{
  await bridge(page,{invitation:true});await page.goto('/');
  await expect(page.getByRole('dialog',{name:'Entrar no cofre',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Conectar ao cofre',exact:true})).toBeDisabled();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('test:invite-ack'))).toBe('1');
  expect(await page.evaluate(()=>localStorage.getItem('pentamark:android:remote-profile'))).toBeNull();
});
test('unreachable PC offers return to local that opens notes without touching the PC draft',async({page})=>{
  await bridge(page,{remote:true,offline:true});
  await page.addInitScript(()=>localStorage.setItem('pentamark:android:remote:http%3A%2F%2F100.100.1.2%3A3417:draft:Mesma.md',JSON.stringify({content:'Rascunho PC',revision:'r1'})));
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Usar arquivos locais'})).toBeVisible();
  await page.getByRole('button',{name:'Usar arquivos locais'}).click();
  await expect(page.locator('.cm-content')).toContainText('Nota exclusiva do aparelho');
  expect(await page.evaluate(()=>localStorage.getItem('test:disconnected'))).toBe('1');
  expect(await page.evaluate(()=>localStorage.getItem('pentamark:android:remote:http%3A%2F%2F100.100.1.2%3A3417:draft:Mesma.md'))).toContain('Rascunho PC');
});

test('rename flush includes lock owner and preserves pending draft before moving',async({page})=>{
  await bridge(page,{remote:true});await page.goto('/');
  await expect(page.locator('.cm-content')).toContainText('Nota exclusiva do PC');
  await page.evaluate(()=>{
    localStorage.setItem('test:require-lock','1');
    localStorage.setItem('pentamark:android:remote:http%3A%2F%2F100.100.1.2%3A3417:draft:Mesma.md',JSON.stringify({content:'Rascunho antes de renomear',revision:'r1'}));
  });
  await page.locator('.pm-note-item').filter({hasText:'Mesma'}).click({button:'right'});
  await page.getByRole('button',{name:'Renomear',exact:true}).click();
  const input=page.getByPlaceholder('Nome da nota');
  await input.fill('Renomeada');await input.press('Enter');
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('test:renamed'))).toBe('Renomeada.md');
  expect(await page.evaluate(()=>localStorage.getItem('test:pc-note'))).toBe('Rascunho antes de renomear');
});
test('remote editor saves to PC while local note with the same filename is untouched',async({page})=>{
  await bridge(page,{remote:true});
  await page.goto('/');
  await expect(page.locator('.cm-content')).toContainText('Nota exclusiva do PC');
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.type(' editado');
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('test:pc-note'))).toContain('editado');
  expect(await page.evaluate(()=>localStorage.getItem('test:local-note'))).toBeNull();
  await page.getByRole('button',{name:'Usar arquivos locais'}).click();
  await expect(page.locator('.cm-content')).toContainText('Nota exclusiva do aparelho');
});

test('connection loss preserves a PC draft while local switch remains available',async({page})=>{
  await bridge(page,{remote:true});
  await page.goto('/');
  await expect(page.locator('.cm-content')).toContainText('Nota exclusiva do PC');
  await page.evaluate(()=>localStorage.setItem('test:offline','1'));
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.type(' texto offline');
  await expect(page.getByRole('status').filter({hasText:'PC desconectado'})).toBeVisible();
  await page.getByRole('button',{name:'Usar arquivos locais'}).click();
  await expect(page.locator('.cm-content')).toContainText('Nota exclusiva do aparelho');
  expect(await page.evaluate(()=>localStorage.getItem('pentamark:android:remote:http%3A%2F%2F100.100.1.2%3A3417:draft:Mesma.md'))).toContain('texto offline');
  expect(await page.evaluate(()=>localStorage.getItem('test:pc-note'))).toBeNull();
});

test('a successful retry restores autosave after an isolated request failure',async({page})=>{
  await bridge(page,{remote:true});await page.goto('/');
  const editor=page.locator('.cm-content');await expect(editor).toContainText('Nota exclusiva do PC');
  await page.evaluate(()=>localStorage.setItem('test:offline','1'));
  await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type(' tentativa');
  await expect(page.getByRole('status').filter({hasText:'PC desconectado'})).toBeVisible();
  await page.evaluate(()=>localStorage.removeItem('test:offline'));
  await page.keyboard.press('Control+s');
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('test:pc-note'))).toContain('tentativa');
  await page.keyboard.type(' autosave retomado');
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('test:pc-note'))).toContain('autosave retomado');
});
