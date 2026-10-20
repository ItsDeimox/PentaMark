import { test, expect } from '@playwright/test';

// Replace only the device bridge; the editor and transport use production code.
// Actual Java/WebView persistence is separately exercised by Android instrumentation.
async function nativeBridge(page, note) {
  await page.addInitScript(({ note }) => {
    window.androidBridge = {};
    window.Capacitor = {
      PluginHeaders: [{ name: 'LocalVault', methods: ['info','request','importDocuments','exportVault','removeListener'].map(name => ({name,rtype:'promise'})).concat({name:'addListener',rtype:'callback'}) }],
      convertFileSrc: path => '/api/file?path=' + encodeURIComponent(path.replace('/vault/','')),
      nativeCallback: () => 'listener-1',
      nativePromise: async (_plugin, method, options) => {
        if (method === 'info') return {root:'/vault'};
        if (method !== 'request') return {cancelled:true};
        if (options.url === '/api/presence') return {status:200,data:{ok:true}};
        const response = await fetch(options.url, {method:options.method,body:options.body,headers:{'Content-Type':'application/json'}});
        const data = await response.json();
        if (options.url === '/api/state') data.assetPaths = [...data.notes,...data.assets].map(item => item.path);
        return {status:response.status,data};
      },
    };
    localStorage.setItem('pentamark:android:last-note', note);
    localStorage.setItem('pentamark:appearance', JSON.stringify({graphicsMode:'flat',backgroundMotion:false,backgroundHover:false}));
    localStorage.setItem('pentamark:view','live');
  }, {note});
}

test('Android local opens the existing editor, saves text and restores it after reload', async ({page,request}) => {
  const path = `android-${Date.now()}.md`;
  await request.post('/api/note',{data:{path,content:'# Android local\n\nTexto original.'}});
  await nativeBridge(page,path);
  const failures=[];
  page.on('pageerror',error=>failures.push(error.message));
  await page.goto('/');
  const editor=page.locator('.cm-content');
  await expect(editor).toContainText('Texto original.');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Conteudo persistente.');
  await expect.poll(async()=> (await (await request.get('/api/note',{params:{path}})).json()).content).toContain('Conteudo persistente.');
  await page.reload();
  await expect(editor).toContainText('Conteudo persistente.');
  await expect(page.locator('html')).toHaveAttribute('data-platform','android');
  expect(failures).toEqual([]);
});

test('Android resumes a draft left before autosave without requiring the network transport', async ({page,request}) => {
  const path=`draft-${Date.now()}.md`;
  await request.post('/api/note',{data:{path,content:'Antes'}});
  const saved=await (await request.get('/api/note',{params:{path}})).json();
  await nativeBridge(page,path);
  await page.addInitScript(({path,revision})=>{
    localStorage.setItem('pentamark:android:draft:'+path,JSON.stringify({content:'Rascunho recuperado',revision}));
  },{path,revision:saved.revision});
  await page.goto('/');
  await expect(page.locator('.cm-content')).toContainText('Rascunho recuperado');
  await expect.poll(async()=> (await (await request.get('/api/note',{params:{path}})).json()).content).toBe('Rascunho recuperado');
});
