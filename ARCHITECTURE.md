# Arquitetura do PentaMark

O frontend foi dividido por responsabilidade. A regra principal é simples: cada mudança deve acontecer no módulo dono do comportamento, sem duplicar lógica ou aparência em outro lugar.

## Mapa

```text
src/
├── app/
│   ├── PentaMarkApp.tsx       # Orquestra estado, ações e composição da tela
│   └── constants.tsx          # Defaults, fontes e ações de formatação
├── api/
│   └── client.ts              # Única porta HTTP usada pelo frontend
├── domain/
│   └── types.ts               # Contratos compartilhados do domínio
├── features/
│   ├── editor/
│   │   ├── LivePreviewEditor.tsx # Ciclo React e configuração do CodeMirror
│   │   ├── live-preview/
│   │   │   ├── blocks.ts         # Classificação dos blocos do CodeMirror
│   │   │   ├── decorations.ts    # Árvore sintática e markers contextuais
│   │   │   ├── widgets.ts        # Tabela, código, mídia, callout e cursores
│   │   │   └── types.ts
│   │   ├── formatting.ts
│   │   └── workspace.css
│   └── markdown/
│       ├── DocumentSurface.tsx # Superfície React reutilizada pelos dois modos
│       ├── document-elements.ts # Primitivas DOM usadas nos dois renderizadores
│       ├── document-layout.ts  # Contrato numérico único de geometria
│       ├── renderer.ts        # Markdown/Obsidian -> HTML seguro
│       ├── kanban.ts
│       ├── highlighting.ts
│       ├── obsidian.css
│       └── document.css       # Aparência visual compartilhada
├── components/
│   ├── dialogs/
│   ├── presence/
│   ├── AssetWorkspacePreview.tsx
│   └── ContextDropdown.tsx
└── shared/                    # Funções pequenas sem estado da aplicação
```

## Fronteiras

- `renderer.ts` é a fonte semântica para Preview e Live Preview: links, embeds, propriedades, callouts, Mermaid e HTML sanitizado.
- `DocumentSurface.tsx` contém os componentes React reutilizáveis da área do documento. `DocumentWorkspace` fornece o contrato aos dois modos, `DocumentSurface` fornece a mesma superfície e `MarkdownContent` concentra o HTML e o ciclo de blocos dinâmicos.
- `document-elements.ts` contém primitivas DOM que precisam existir tanto no HTML semântico quanto em widgets do CodeMirror, como o marcador visual das listas.
- `document-layout.ts` é a fonte numérica única da geometria: largura, padding, recuos e espaçamento vertical. Ele fornece variáveis CSS ao documento e os mesmos números ao adaptador do CodeMirror.
- `document.css` é a fonte visual única do documento: tipografia, cores, títulos, listas, citações e Markdown inline. Valores geométricos compartilhados devem consumir as variáveis de `document-layout.ts`.
- `LivePreviewEditor.tsx` cuida somente do ciclo React e da configuração do CodeMirror.
- `live-preview/blocks.ts` classifica blocos e adapta o contrato de `document-layout.ts` ao colapso de margens do HTML. `decorations.ts` materializa esse espaço em widgets transparentes e mensuráveis, separado das linhas pintadas. Nunca usar margem vertical em `.cm-line`: isso invalida o mapa de coordenadas do CodeMirror.
- `live-preview/decorations.ts` usa a árvore sintática GFM para revelar os delimitadores do conteúdo tocado pelo caret. Regex fica restrita às extensões que não pertencem ao parser (`[[wikilink]]`, `==destaque==` e `%%comentário%%`).
- `live-preview/widgets.ts` contém blocos HTML e espaçadores medidos. Clique em texto é convertido para um offset real da fonte e normalizado pela escala visual do app; mudanças assíncronas de altura sempre solicitam nova medição ao CodeMirror.
- `formatting.ts` contém transformações de texto puras, usadas tanto pelo textarea quanto pelo Live Preview.
- `kanban.ts` contém o formato, renderização e interações do Kanban.
- Componentes de modal e presença não acessam diretamente o estado global.
- `api/client.ts` centraliza cabeçalhos, erros e chamadas HTTP.

## Onde alterar

| Mudança | Arquivo principal |
| --- | --- |
| Estrutura React compartilhada entre os modos | `src/features/markdown/DocumentSurface.tsx` |
| Largura, padding, recuos ou espaçamento do documento | `src/features/markdown/document-layout.ts` |
| Tipografia, cores e aparência do Markdown | `src/features/markdown/document.css` |
| Regra Markdown, Obsidian, embed ou callout | `src/features/markdown/renderer.ts` |
| Ciclo React/configuração do CodeMirror | `src/features/editor/LivePreviewEditor.tsx` |
| Classificação dos blocos no Live Preview | `src/features/editor/live-preview/blocks.ts` |
| Markers e sintaxe contextual | `src/features/editor/live-preview/decorations.ts` |
| Clique ou bloco renderizado no Live Preview | `src/features/editor/live-preview/widgets.ts` |
| Negrito, lista, link e outros comandos | `src/features/editor/formatting.ts` |
| Kanban | `src/features/markdown/kanban.ts` |
| Modal específico | `src/components/dialogs/<Modal>.tsx` |
| Rede/API no navegador | `src/api/client.ts` |
| Estado e fluxo geral da aplicação | `src/app/PentaMarkApp.tsx` |
| Host local e persistência em disco | `local/server.mjs` |

## Regras para mudanças futuras

1. Não duplicar regra visual entre `.pm-markdown` e `.pm-live-*`; usar seletores compartilhados em `document.css`.
2. Não copiar números de geometria para CSS ou CodeMirror; adicioná-los ao contrato de `document-layout.ts`.
3. Não adicionar parsing Markdown dentro de componentes React.
4. Não chamar `fetch` fora de `api/client.ts`.
5. Manter funções puras fora do orquestrador quando elas não dependem de estado React.
6. Rodar `npm run check` antes de empacotar.
7. Comparar posições reais de texto entre Preview e Live Preview ao mudar tipografia ou espaçamento.
