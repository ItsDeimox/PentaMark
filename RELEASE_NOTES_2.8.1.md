# PentaMark 2.8.1

- Verificação de versões estáveis a cada abertura, com timeout e funcionamento offline. Quando há uma versão mais recente com executável Windows, oferece abrir a página oficial para download; a instalação não é automática.
- Tela visível durante a extração do portátil e logo animada enquanto o servidor local inicia. A consulta de atualizações ocorre em paralelo e não bloqueia a abertura.
- Marca unificada no aplicativo, ícone Windows, PWA e telas de carregamento, inspirada no portal e nos cinco vértices do Pentagory. Animações respeitam a preferência de movimento reduzido.
- A versão anterior precisa ser substituída manualmente uma vez, pois não contém a nova checagem. Preserve a pasta do cofre e os arquivos de configuração.

Fonte visual: public/pentamark-brand.svg. Para regenerar os arquivos derivados, execute scripts/build-brand.cjs com sharp disponível (ou PENTAMARK_SHARP_MODULE apontando para o módulo).
