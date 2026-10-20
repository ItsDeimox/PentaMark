# PentaMark 2.11.0: vidro óptico e navegação refinada

## O que mudou

- Removida a renomeação por duplo clique de notas e pastas. A ação Renomear continua no menu de contexto e nas ferramentas.
- Expansão das pastas usa a altura exibida como início da animação e desmonta o conteúdo ao terminar, em vez de usar um temporizador de remoção. Reversões mantêm continuidade. A altura é medida em pixels CSS para não esticar a pasta ao usar escala aumentada.
- O acrílico deixa de ser uma camada quase opaca. Painéis, Conta e cartões internos usam transparência real, blur e apenas o contorno óptico do material. As bordas CSS dessas superfícies ficam transparentes, preservando as dimensões.
- Cantos mais contidos, incluindo avatar e prévia de Conta. Removidos textos ornamentais e explicações técnicas que ocupavam a interface; avisos de acesso e segurança continuam presentes.
- Material passa a ser chamado Gráficos. Flat permanece disponível.
- Novos circuitos finos, roteados e não repetidos em mosaico, com pequenos contatos retangulares em vez das antigas vias circulares. Luz localizada e reflexão interna nos controles, adaptadas da referência Checkpoint Portfolios.
- Fundo principal integrado à paleta do vidro, sem a placa cinza opaca atrás da escrita.
- A navegação abre da esquerda para a direita em fragmentos no modo Acrílico, com reversão no fechamento. Flat usa uma transição horizontal simples. Movimento reduzido desativa os efeitos de deslocamento.

## Implementação visual

O shader desenha microtextura, circuitos refratados, iluminação e uma única borda suavizada. A revelação em GLSL e a máscara do conteúdo HTML compartilham a mesma progressão. O texto continua sendo texto nativo selecionável, sem capturas de tela. O blur do conteúdo atrás do vidro é nativo do navegador; não existe refração arbitrária de todo o DOM em uma textura.

O renderer mantém um contexto WebGL e buffers limitados. Superfícies sem interação permanecem em cache; Flat libera as camadas. Perda de contexto mantém fallback funcional.

## Verificação e distribuição

A suíte inclui os testes anteriores e novos cenários para renomeação, expansão, transparência medida no shader, iluminação dos controles, revelação horizontal, reversão, ausência de deslocamento do documento ao iluminar a marca e fechamento das pastas com escala de 160%. O resultado efetivo fica na execução de CI do commit distribuído. O workflow Windows também inicializa o portátil, carrega sua interface e grava/lê uma nota descartável.

Faça backup do cofre e feche o executável antigo antes de abrir o novo. O portátil não precisa de Node.js e continua sem assinatura digital. As alterações permanecem na branch de revisão; não há merge automático. As dependências existentes não foram atualizadas nesta entrega. Não houve benchmark na GPU do autor nem teste em celular físico.
