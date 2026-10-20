# PentaMark 2.13.9 — Malha imóvel e otimização gráfica

- Malha irregular menor e fixa: somente a iluminação percorre as arestas.
- Energia com dissipação gradual, desenhada em lotes numa camada leve.
- Removida a faixa luminosa animada da seleção de texto.
- Vidro com maior dispersão cromática e transição mais suave na borda.
- Buffer WebGL reutilizado entre painéis e botões, evitando realocação
  repetida durante o hover.
- Trocas de tema, redução de movimento e limpeza dos efeitos preservadas.

## Validação

TypeScript, build de produção, suíte de 93 testes de interface e testes do
grafo de energia. O pipeline Windows verifica a inicialização do executável,
a interface empacotada e a gravação/leitura em cofre temporário antes de publicar.

No cenário controlado em Chrome headless/SwiftShader, o tempo ocupado da
thread principal caiu de 0,934 s para 0,357 s em três segundos de movimento
do cursor (~62% menos). Isso não representa garantia de FPS no hardware do usuário.

O visualizador e o zoom de imagens não foram alterados.
Nenhuma nova dependência foi adicionada.
