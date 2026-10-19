# Regressão de escala na árvore

Na revisão do componente de expansão, a versão inicial usava getBoundingClientRect().height como valor CSS da animação. Com zoom de 160%, esse valor já vinha escalado e era aplicado novamente, causando um esticamento antes do fechamento.

Uma fixture isolada com o componente real e Chromium, sem rede, registrou altura inicial 320px e primeiro frame de fechamento 512px. O teste falhou. Após usar a altura computada em CSS pixels, a sequência começou em 320px e decresceu até zero; o mesmo teste passou. O componente foi checado pelo TypeScript.

O cenário também está em tests/disclosure-scale.spec.mjs contra o host real da suíte, usando viewport 1920x1080 e escala de 160%. Com ele a suíte final contém 65 cenários. Consulte a execução de CI do commit para o resultado efetivo.
