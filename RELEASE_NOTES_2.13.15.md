# PentaMark 2.13.15 — Visualizador de imagens

As imagens agora usam toda a área disponível do painel, com proporção
preservada e ajuste automático ao espaço. Foram retirados o cabeçalho com
título/caminho e o rodapé de instruções; os controles ficam numa barra
flutuante compacta sobre a prévia.

O zoom com a roda mantém parado o ponto da imagem sob o cursor, mesmo depois
de arrastar ou alterar a escala do app. O visualizador suporta ajuste ao
painel, arraste, duplo clique, teclas + / - / 0 e Esc para fechar. O limite
antigo de 1600 × 1100 px foi removido. A troca de arquivo inicia uma nova
prévia ajustada; redimensionar preserva o ponto central observado.

Os controles se adaptam a telas estreitas e escala de interface alta.
Falhas no carregamento exibem uma mensagem e mantêm a opção de fechar.
Cancelamento de arraste, reset durante movimento e erro tardio durante
uma busca não deixam coordenadas antigas nem tiram o foco da busca.

A prévia ocupa o painel inteiro em todos os modos do editor. Outros tipos
de arquivo conservam seus controles de abertura e fechamento. Nenhuma
dependência foi adicionada.

## Validação

TypeScript, build de produção e 32 testes relevantes de interface passaram,
sem falhas ou retries na rodada final. São 11 testes do visualizador e 21
regressões de edição, navegação, foco e uso em telas distintas.

O ponto da imagem sob o cursor foi medido antes/depois do zoom com escala
de app em 100% e 150%, inclusive após arraste. Também foram verificados
limites de zoom, ajuste, troca de imagem, redimensionamento, cancelamento
de gesto, tela de 390 px com escala de 160%, falha de carregamento e os
quatro modos do editor. Capturas desktop/mobile inspecionadas e revisão
independente concluída sem pendências importantes.
