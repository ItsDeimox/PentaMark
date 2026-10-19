# Primeiro incremento: interface aprovada do PentaMark

## O que mudou

A interface existente agora utiliza superfícies grafite, cantos de 90 graus, menu flutuante e coluna de leitura estável. O painel de ferramentas reúne os modos e ações existentes; a busca rápida usa Ctrl+P e a formatação aparece junto à seleção. As transições dos painéis são curtas e respeitam movimento reduzido.

Em instalações novas, Live Preview e a fonte técnica Chakra Petch são os padrões. Fontes, escala e modo previamente salvos são mantidos. A fonte é uma dependência do aplicativo, não uma requisição a um serviço remoto durante o uso.

A correção de geometria mantém marcadores inline e prefixos de títulos fora da largura medida do texto, mesmo com foco. O modo Markdown explícito continua acessível. Isso não modifica a fonte salva nem remove a formatação. Blocos complexos ainda usam o comportamento anterior e precisam de um incremento próprio.

## Evidências de regressão

Na versão anterior, recolher a árvore deslocava a coluna em aproximadamente 139,5 px. Um teste do primeiro caractere do título registrou um salto horizontal de 34 px ao receber foco. A suíte compara as mesmas coordenadas após as correções.

Há 18 cenários automatizados no Chromium usando o host real com um cofre sintético, sem dados pessoais: abertura, geometria, busca, árvore, preferências, movimento reduzido, edição/seleção, formatação contextual, salvamento, desfazer/refazer, Escape e criação/renomeação. A composição é capturada em 1672×941, 1280×800 e 390×844. Isso não equivale a um teste em celular físico ou do executável Windows.

Executar:

```sh
npm ci
npm run check
npx playwright install chromium
npx playwright test
```

O teste usa a porta 3417. Feche um host que esteja usando essa porta antes de executá-lo. O workflow `Approved workspace regression` instala as dependências do navegador e publica `test-results/` por sete dias. Consulte a execução correspondente ao commit para seu resultado efetivo.

## Experimentar sem trocar a instalação atual

```sh
git clone --branch agent/approved-visual-guide --single-branch https://github.com/ItsDeimox/PentaMark.git PentaMark-visual
cd PentaMark-visual
npm ci
npm run local:build
node local/server.mjs
```

Use uma pasta de teste e não mova seu cofre original. Uma preferência já salva no mesmo navegador/origem pode continuar ativa, por exemplo o modo dividido ou a fonte anterior. Isso é intencional.

## Limites desta entrega

O mapa neural e o acompanhamento ao vivo de operações MCP ainda não foram implementados. Configuração MCP, formatos Markdown, recursos do cofre e colaboração existentes não foram substituídos, mas seus fluxos completos precisam de regressões próprias.

A instalação das dependências sinalizou 27 alertas de auditoria já presentes na base, incluindo um crítico, e o build mantém avisos de bundles grandes. Não foi aplicado `npm audit fix --force` nem uma atualização ampla de dependências fora do escopo visual. Esses pontos devem ser avaliados antes de uma distribuição de produção.

Os workflows temporários de preparação foram removidos; a validação final possui somente permissão de leitura e não faz commits, merge ou deploy.
