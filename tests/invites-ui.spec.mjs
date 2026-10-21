import {test,expect} from '@playwright/test';

const host='http://100.100.10.20:3417';
const official='https://login.tailscale.com/admin/invite/test_one-time';
const link=`pentamark://join?v=1&host=${encodeURIComponent(host)}&invite=${encodeURIComponent(official)}&name=Cofre%20do%20amigo`;
test.use({serviceWorkers:'block'});
async function native(page,{launch=false,expired=false,autoUpdate=false,readyUpdate=false}={}){
  await page.addInitScript(({launch,expired,link,official,host,autoUpdate,readyUpdate})=>{
    localStorage.setItem('pentamark:appearance',JSON.stringify({graphicsPreset:'economical',graphicsMode:'flat',interfaceMotion:false}));
    window.inviteCalls=[];let configured=false,pending=launch?link:null;
    const status=()=>({installed:true,connected:true,configured,deviceName:'Meu PC',address:host});
    window.pentaMarkDesktop={
      getProfile:async()=>({name:'Teste',avatar:''}),setProfile:async()=>({ok:true}),getVault:async()=>({ok:false}),
      tailscaleStatus:async()=>status(),saveTailscaleKey:async()=>{window.inviteCalls.push('save');configured=true;return status();},forgetTailscaleKey:async()=>{configured=false;},
      openTailscaleSetup:async step=>{window.inviteCalls.push(step);},createTailscaleInvite:async()=>{window.inviteCalls.push('create');if(expired)throw new Error('A chave de API expirou. Gere uma nova chave.');return {inviteUrl:official,address:host,deviceName:'Meu PC'};},
      consumeInvitation:async()=>{const value=pending;pending=null;return value;},onInvitation:()=>()=>{},openTailscaleInvite:async url=>{window.inviteCalls.push(url);},
      getUpdateStatus:async()=>({phase:autoUpdate?'available':readyUpdate?'ready':'current',currentVersion:'2.13.19',version:'2.13.20'}),checkForUpdates:async()=>({phase:autoUpdate?'checking':'current',currentVersion:'2.13.19'}),
      installUpdate:async()=>{window.inviteCalls.push('install');return {phase:'installing',currentVersion:'2.13.19'};}
    };
  },{launch,expired,link,official,host,autoUpdate,readyUpdate});
}
async function tools(page){await page.goto('/');await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();}

test('guided setup creates a one-use invitation and never persists the key in web storage',async({page})=>{
  await native(page);await tools(page);await page.getByRole('button',{name:'Compartilhar',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Compartilhar o cofre',exact:true});
  await dialog.getByRole('button',{name:'Gerar chave no Tailscale',exact:true}).click();
  const key='tskey-api-not-a-real-key-123456789012345';
  await dialog.getByLabel('Chave de API',{exact:true}).fill(key);
  await dialog.getByRole('button',{name:'Validar e salvar chave',exact:true}).click();
  await dialog.getByRole('button',{name:'Criar convite',exact:true}).click();
  await expect(dialog.getByLabel('Convite PentaMark')).toHaveValue(/pentamark:\/\/join\?v=1/);
  const values=await page.evaluate(()=>Object.values({...localStorage,...sessionStorage}).join('\n'));
  expect(values).not.toContain(key);
  expect(await page.evaluate(()=>window.inviteCalls)).toEqual(['keys','save','create']);
  await expect(dialog.getByLabel('Chave de API',{exact:true})).toHaveCount(0);
});

test('launching an invitation survives StrictMode and requires explicit official acceptance',async({page})=>{
  await native(page,{launch:true});await page.goto('/');
  const dialog=page.getByRole('dialog',{name:'Entrar no cofre',exact:true});
  await expect(dialog).toBeVisible();await expect(dialog).toContainText('Cofre do amigo');
  await expect(dialog.getByRole('button',{name:'Conectar ao cofre',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>window.inviteCalls)).toEqual([]);
  await dialog.getByRole('button',{name:'Abrir convite do Tailscale',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Conectar ao cofre',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>window.inviteCalls)).toEqual([official]);
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();await expect(dialog).toHaveCount(0);
});

test('pasted invite opens the guided join dialog; an arbitrary destination is rejected',async({page})=>{
  await native(page);await tools(page);await page.getByRole('button',{name:'Conectar a um cofre',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Conectar a um cofre',exact:true});
  await dialog.getByLabel('Endereço ou convite',{exact:true}).fill(link.replace(encodeURIComponent(host),encodeURIComponent('http://127.0.0.1:3417')));
  await dialog.getByRole('button',{name:'Conectar',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Entrar no cofre',exact:true})).toHaveCount(0);
  await dialog.getByLabel('Endereço ou convite',{exact:true}).fill(link);
  await dialog.getByRole('button',{name:'Conectar',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Entrar no cofre',exact:true})).toBeVisible();
});

test('automatic update reminder waits for the native check to complete',async({page})=>{
  await native(page,{autoUpdate:true});
  await page.goto('/');
  const reminder=page.getByRole('button',{name:'Atualização 2.13.20',exact:true});
  await expect(reminder).toBeVisible({timeout:12000});
  expect(Number(await page.evaluate(()=>localStorage.getItem('pentamark:update-checked-at')))).toBeGreaterThan(0);
  await reminder.click();
  await expect(page.getByRole('tab',{name:'Atualizações',exact:true})).toHaveAttribute('aria-selected','true');
});

test('unsaved note blocks actual settings installation when the save fails',async({page})=>{
  await native(page,{readyUpdate:true});
  await page.goto('/');
  await page.route('**/api/note?*',async route=>{if(route.request().method()==='PUT')await route.abort('failed');else await route.continue();});
  const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview',exact:true});
  await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type('\nProtected before update');
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Configurações',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'Configurações',exact:true});
  await settings.getByRole('tab',{name:'Atualizações',exact:true}).click();
  await settings.getByRole('button',{name:'Instalar e reiniciar',exact:true}).click();
  await expect(settings.getByRole('alert')).toContainText('Não foi possível salvar a nota');
  expect(await page.evaluate(()=>window.inviteCalls)).not.toContain('install');
});
