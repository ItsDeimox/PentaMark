# PentaMark 2.13.8 — Malha energética e vidro refrativo

## Melhorias gráficas

- Fundo com malha irregular estável de polígonos.
- Interação com o cursor: fragmentação leve, iluminação pelas arestas e rastro
  de energia que se dissipa gradualmente.
- Pulsos ambientais alongados, com halo difuso.
- Refração do fundo real nas bordas dos painéis acrílicos, com dispersão
  cromática localizada, substituindo o contorno RGB artificial.
- Texto e controles preservados, sem deformação do primeiro plano.
- Redimensionamento com atualização imediata dos limites da lente e
  regeneração adiada do mapa para evitar trabalho repetido.
- Limpeza dos efeitos no modo Flat, com redução de movimento, janela oculta
  e perda do contexto gráfico.

## Validação

- TypeScript e bundle de produção.
- Suíte de 88 testes de interface, incluindo temas, layouts compactos,
  escala de 160%, edição, salvamento, transições e recuperação WebGL.
- Comparação de pixels comprovando refração e dispersão cromática na borda,
  sem alteração significativa do centro.
- O pipeline verifica o build Windows, a inicialização do executável,
  o frontend empacotado e a gravação/leitura de uma nota em cofre temporário
  antes da publicação.

## Escopo

A visualização de arquivos e o zoom de imagens não foram alterados.
Nenhuma nova dependência foi adicionada.
