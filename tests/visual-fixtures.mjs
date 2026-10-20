export async function ensureVisualFixtures(page) {
  const notes = {
    '03 - Blocos.md': '---\ntitulo: Teste de blocos\nstatus: aprovado\n---\n\n# Blocos estáveis\n\n> [!note] Dimensão\n> Uma citação com **destaque** que precisa manter sua forma ao editar.\n> Mais uma linha para verificar a altura do painel.\n\n## Âncora depois do painel\n\n| Coluna | Valor |\n| --- | --- |\n| Peso | 42 |\n\n```js\nconst teste = 42;\nconsole.log(teste);\n```\n\n- [ ] Tarefa pendente\n- [x] Tarefa completa\n\nConsulte [[04 - Link A|Link A]].\n',
    '04 - Link A.md': '# Link A\n\nPrimeiro painel com [[05 - Link B|Link B]].\n',
    '05 - Link B.md': '# Link B\n\nSegundo painel para validar a navegação aninhada.\n',
  };
  for (const [path, content] of Object.entries(notes)) {
    const current = await page.request.get('/api/note?path=' + encodeURIComponent(path));
    if (!current.ok()) {
      const created = await page.request.post('/api/note', { data: { path, content } });
      if (!created.ok()) throw new Error('Cannot create synthetic fixture: ' + await created.text());
    }
  }
}
