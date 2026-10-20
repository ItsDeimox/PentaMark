# PentaMark 2.13.2 | Correção dos fundos dos botões

Restaura as superfícies dos controles da 2.13.0, removidas indevidamente na 2.13.1.

- Recupera os fundos e os estados de hover e seleção na árvore de arquivos, modos do editor, menus e demais controles.
- Recupera o corpo e a reflexão do material Acrílico dos botões.
- Mantém os estilos por tema, o blur e a geometria dos componentes da 2.13.0.

A correção remove a regra global que forçava fundos transparentes e restaura duas linhas do shader. As demais implementações da 2.13.0 permanecem na versão.

Os testes de interface verificam preenchimento, hover, seleção, blur e estabilidade das dimensões. O pipeline Windows verifica a abertura do executável, o frontend empacotado e a leitura/gravação de uma nota em cofre de teste.

**Windows:** feche a versão anterior e abra `PentaMark-Desktop-2.13.2-Windows.exe`.
