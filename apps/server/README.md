# Servidor local

O servidor escuta somente em `127.0.0.1:3301`. No Electron, uma capacidade aleatória
por execução protege as APIs e os arquivos de mídia; ela é enviada pelo processo
principal nos headers, sem entrar nas URLs. O gateway continua exigindo seu próprio
Bearer para conta, integrações e gerações de IA.

Para desenvolvimento no navegador, execute o servidor local sem `NODE_ENV=production`
e sem `LOCAL_API_TOKEN`/`LOCAL_FILE_IMPORT_TOKEN`, junto com o Vite em
`http://localhost:5173` ou `http://127.0.0.1:5173`. Somente essas origens de desenvolvimento
são aceitas nesse modo; requisições sem origem/referer autorizado são recusadas.
Com uma capacidade configurada, ou em produção, essa exceção fica desativada.
`/health` é público e não expõe dados do usuário. `/debug` exige autorização.

Capas só podem usar mídia dos diretórios geridos pelo servidor ou referências
externas previamente registradas no índice de mídia. O JSON de um projeto, sozinho,
não autoriza a leitura de um arquivo fora do acervo.

Execute `npm test` neste diretório para rodar a suíte completa. Os arquivos de
teste rodam um por vez para evitar disputa entre compiladores TypeScript e
renders FFmpeg em computadores com poucos núcleos. A matriz de FPS verifica as
16 combinações de 24, 25, 30 e 60 fps, com prazo de 120 segundos por exportação,
preservando as verificações de duração, FPS e quantidade exata de quadros.
