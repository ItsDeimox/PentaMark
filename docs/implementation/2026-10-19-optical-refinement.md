# Vidro e navegação: refinamento 2.11

## Pedido

Retirar duplo clique para renomear, tornar as expansões consistentes, transparência visível em todas as superfícies acrílicas, um único contorno suave, cantos menores e Conta com o mesmo material. Usar a iluminação dos controles do Checkpoint Portfolios. Trocar o circuito repetido por trilhas finas. Abrir/recolher a navegação horizontalmente com fragmentação apenas no modo Acrílico. Remover preenchimento textual na interface sem remover avisos funcionais.

## Referência consultada

ItsDeimox/checkpoint-portfolio, commit 23cc76ab88ca2bffd8a33525e18fb70225b69438, arquivo deimoxportfolios/src/shaders/modal-material.frag, blob c18a45456503feebafb575c2db4853b280819bae. A adaptação utiliza uma única silhueta, queda óptica do contorno exp(-depth*1.8), reflexão interna exp(-depth*.12) e luz local dos controles exp(-distanceSquared/3800). Nenhum arquivo do Checkpoint foi alterado.

## Causas e mudanças

A camada anterior tinha alfa base de aproximadamente 94%, além do fundo e da borda CSS. O cartão do perfil não era um alvo do renderer. A nova camada usa alfa baixo, contorno único e alvos adicionais. Preserva espaço de borda transparente para não mudar a geometria.

A expansão dependia de duas requestAnimationFrame e um timeout de desmontagem. A nova animação usa a altura visual e finaliza/desmonta pelo evento da animação; receber um novo estado cancela a anterior após guardar a altura atual.

Os circuitos deixaram de usar o mesmo desenho por célula de 96px. Um mapa de trilhas é gerado por dimensões, mantido em cache e iluminado em GLSL. Não há círculos decorativos repetidos. O conteúdo do documento não é capturado.

## Regressões

Baseline 39301120034: 56 passaram e 5 falharam nos novos requisitos. Primeira implementação 39303621191: 61 passaram. Revisão acrescentou dois testes que reproduziram uma regressão de posicionamento de controles absolutos e o fim do fechamento perdendo a máscara; execução 39304778151 registrou 62 aprovados e 2 falhas. As correções preservam o posicionamento original e mantêm a máscara fechada até reabrir ou trocar para Flat.

Consulte a execução final para os resultados dos 64 cenários e o teste nativo Windows. A existência de testes não equivale à aprovação. Os workflows temporários de edição foram removidos da validação; ela volta a ser somente leitura.

## Limites

Fragmentação do material GLSL é sincronizada com uma máscara poligonal do DOM. Blur do conteúdo é nativo. Fallback mantém um contorno CSS discreto quando WebGL não está disponível, pois nesse caso não existe a borda óptica. Seletores do sistema e renderização de PDF externa continuam nativos. Não foi feita auditoria ampla das dependências nem medição de FPS na máquina do autor. Main e dados do cofre permanecem intactos.
