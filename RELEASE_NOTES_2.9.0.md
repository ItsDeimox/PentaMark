# PentaMark 2.9.0: refinamento visual e acrílico

## Interface
- Painéis reconstruídos com paleta compartilhada, superfícies grafite, cantos externos discretamente arredondados e ícones menores.
- Árvore compacta com expansão/recolhimento animados; marca fixa durante a transição da navegação.
- Documento centralizado ao recolher o menu, mantendo largura de leitura estável; fade nas bordas da rolagem.
- Menu de ferramentas reconstruído em grupos: visualização, material, documento e conexões.
- Ação Mostrar no diretório no contexto dos arquivos; usa a integração nativa no Desktop.
- Checkboxes alinhadas à primeira linha do texto.

## Materiais
Escolha **... > Material > Acrílico** ou **Flat**. O modo Acrílico combina textura pontilhada, refração do fundo óptico procedural em GLSL e blur nativo do conteúdo atrás do painel. O texto permanece em DOM, nítido e selecionável. A renderização é limitada por resolução, quantidade de superfícies e eventos; não há um loop contínuo quando tudo está parado. Sem WebGL, o visual utiliza fallback. O modo Flat não mantém canvases do material.

## Edição estável
Os blocos complexos deixam de ser substituídos por Markdown bruto dentro do documento ao receber foco. A edição da fonte de callouts, propriedades, tabelas e código ocorre num painel sobreposto, mantendo a geometria do documento durante a edição. Aplicar altera o conteúdo e pode, naturalmente, alterar a altura real. Cancelar preserva a fonte; uma atualização concorrente impede aplicar um intervalo desatualizado. A operação aplicada participa de desfazer/refazer.

## Prévias de links
Prévias ficam ancoradas ao link, não seguem o ponteiro, preservam os painéis ancestrais e limitam a profundidade a quatro. Requisições antigas são canceladas.

## Escopo e atualização
29 cenários automatizados verificam o host real e a interface no Chromium, incluindo WebGL real, estabilidade de blocos, conflitos, edição, teclado, tamanhos de tela, fallback e pausa do material ocioso. O teste de inicialização Windows no workflow verifica o pacote separadamente; consulte o resultado da execução correspondente.

Faça backup do cofre, feche o aplicativo antigo e execute a nova versão portátil. Preferências anteriores são preservadas. O executável não possui assinatura digital. Não foram implementados nesta versão o mapa neural nem o monitor de atividade MCP. A ponte MCP existente permanece disponível. O desempenho numa GPU específica e dispositivos móveis físicos ainda precisa de medição local.
