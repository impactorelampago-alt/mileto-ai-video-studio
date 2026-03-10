# 📂 Política de Storage e Limpeza

Este documento explica a nova política de armazenamento local configurada após a limpeza e otimização massiva do repositório.

## Pastas Locais Ignoradas (Não versionadas no Git/Docker)

Para evitar que o repositório infle com gigabytes de lixo desnecessário, as seguintes pastas foram adicionadas ao `.gitignore` e `.dockerignore`:

1. **`apps/server/temp/`**: Usada pelo FFmpeg durante o processamento de recortes e montagem do vídeo.
    - **Geração:** O servidor recria e exclui conteúdos nesta pasta de forma temporária.
    - **Tamanho seguro:** Sempre que essa pasta inflar por erro de limpeza no runtime, você pode apagar o conteúdo dela sem afetar produção.

2. **`apps/server/uploads/`**: Usada para salvar vídeos brutos recebidos dos usuários (inputs).
    - **Geração:** Estes arquivos são de produção local (runtime sources).
    - **Tamanho seguro:** É nesta pasta onde vive a maior parte do peso real (gigabytes de .MOV e .MP4).
    - **Em Produção:** Caso o servidor vá para nuvem num Docker estrito, configure esta pasta para persistir num EBS Layer, AWS S3 Compartilhado, ou Storage Persistente - e deixe-a mapeada virtualmente no container.

## Manutenção de Limpeza do Projeto

Se o seu espaço em disco encher novamente com dependências fantasmas e caches (Vite, Next, Turbo, logs):

- **Windows**: Rode `npm run clean`. (Ele dispara o arquivo `scripts/clean.ps1` com Bypass seguro).
- **Diagnóstico Rápido**: Rode `npm run size:report`. Ele escaneará toda a pasta ultra-rápido, listando os culpados acima de 50MB.
