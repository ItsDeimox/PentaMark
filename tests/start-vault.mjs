import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const port = Number(process.env.PM_TEST_PORT || 3417);
// A repeated run must not inherit notes, rename targets or configuration from
// an earlier fixture using the same port. Never reuse a personal vault.
const data = await mkdtemp(join(tmpdir(), `pentamark-approved-ui-tests-${port}-`));
const vault = join(data, 'vault');
await mkdir(join(vault, 'Planejamento'), { recursive: true });
await mkdir(join(vault, 'Referencias'), { recursive: true });
await writeFile(join(data, 'pentamark.config.json'), JSON.stringify({ vaultName: 'Cofre de validacao', port, bind: '127.0.0.1', openBrowser: false, aiBridgeEnabled: false, cleanupUnusedAssets: false, lockEditedNotes: false }));
await writeFile(join(vault, '00 - Visao Geral.md'), `# Visão Geral do Projeto

Um espaço para compreender, registrar e conectar.

## Organização do conhecimento

A documentação reúne decisões, referências e os próximos passos. Cada arquivo tem uma função clara e pode ser encontrado pela navegação ou pela busca.

A interface mantém o conteúdo em primeiro plano. As ferramentas aparecem quando você precisa delas, sem interromper a leitura.

## Princípios

- Clareza antes de ornamentação.
- Ação, resposta e consequência.
- Arquivos reais, sempre acessíveis.

## Referências

Consulte [[Planejamento/01 - Direcao|a direção do projeto]] para continuar.

${Array.from({length: 28}, (_, i) => `## Registro ${i + 1}\n\nEste registro valida a rolagem e a permanência do documento durante a navegação.\n\n`).join('')}`);
await writeFile(join(vault, 'Planejamento', '01 - Direcao.md'), '# Direção\n\nConteúdo de validação. Não pertence a um cofre pessoal.\n');
await writeFile(join(vault, 'Referencias', '02 - Edicao.md'), '# Edição estável\n\n' + Array.from({length: 12}, (_, i) => `**${'geometria estável '.repeat(12 + i).trimEnd()}**\n\nÂNCORA ${i}\n\n`).join('') + '\nUma ligação [[Planejamento/01 - Direcao|direção]] e `código legível`.\n');
for (let i = 0; i < 35; i++) await writeFile(join(vault, 'Planejamento', `${String(i + 10).padStart(2, '0')} - Registro.md`), `# Registro ${i}\n\nTeste de árvore e persistência.\n`);
const child = spawn(process.execPath, ['local/server.mjs'], { stdio: 'inherit', env: { ...process.env, PENTAMARK_DATA_DIR: data, PENTAMARK_VAULT_DIR: vault } });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
