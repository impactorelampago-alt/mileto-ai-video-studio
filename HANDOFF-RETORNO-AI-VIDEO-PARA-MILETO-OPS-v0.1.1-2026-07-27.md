# Handoff — Mileto AI Video → Mileto Ops v0.1.1

Data: 2026-07-27  
Estado: implementação local e publicação controlada do gateway concluídas; vínculo do Dono, contextos, biblioteca, thumbnails e stream validados em produção  
Escopo: somente leitura  
`assets.write`: não habilitado

## 1. Contrato recebido

O AI Video implementou o contrato entregue pelo Mileto Ops no commit:

```text
ad29fd337e7292d9beac0fd42ca7018763255a88
```

A fonte de verdade para hierarquia, cargos, subordinados, carteira e isolamento de conta continua sendo exclusivamente o Mileto Ops.

## 2. Comportamento implementado

### Contextos de visualização

- delegação inicial em `self`;
- consulta a `/v1/me/view-contexts`;
- renderer recebe somente campos visuais e `contextId` opaco;
- seletor com `Minha conta`, `Todos` e pessoas autorizadas;
- nenhuma regra local baseada no nome do cargo;
- nenhum `ops_user_id` livre é aceito do renderer;
- `aiVideoUserId` continua derivado da sessão autenticada no gateway;
- nova delegação emitida para o `contextId` selecionado;
- cache de delegação isolado por conexão, usuário e hash do contexto;
- o `contextId` não aparece na chave do cache nem em logs;
- troca de contexto invalida empresas, pastas, arquivos, thumbnails e prévia exibidos;
- renovação dos contextos ocorre antes do TTL;
- se a seleção deixar de existir, a interface informa a mudança e volta explicitamente para o contexto seguro padrão;
- `view_context_forbidden` descarta o estado anterior, consulta novamente as opções e nunca amplia acesso silenciosamente.

### Recursos subordinados ao mesmo contexto

O mesmo `contextId` é enviado em:

- empresas;
- pastas;
- arquivos;
- detalhe do arquivo;
- thumbnails;
- reprodução/prévia;
- download;
- criação de referência lógica;
- materialização local para o editor.

O servidor local repassa o contexto ao gateway durante toda a materialização e durante renovações da entrega.

### Proteção da mídia

As URLs de entrega do Ops não são mais devolvidas ao renderer.

O gateway:

1. recebe e valida a URL do Ops;
2. guarda a URL apenas em memória;
3. emite uma rota efêmera e opaca do próprio AI Video;
4. transmite a mídia pelo gateway;
5. aceita Range seguro;
6. não repassa redirects externos;
7. não persiste grant ou signed URL;
8. remove tickets expirados;
9. nunca registra a URL original.

O servidor local continua recebendo a entrega apenas no fluxo servidor-servidor necessário para materializar o cache do editor. Nenhum token Ops chega ao renderer.

## 3. Arquivos da implementação

Gateway:

```text
apps/gateway/package.json
apps/gateway/src/opsIntegration.js
apps/gateway/src/opsViewContext.js
apps/gateway/src/server.js
apps/gateway/test/opsViewContext.test.js
```

Cliente:

```text
apps/client/src/components/OpsLibrary.tsx
apps/client/src/lib/gateway.ts
```

Servidor local:

```text
apps/server/src/controllers/opsController.ts
apps/server/src/index.ts
apps/server/src/services/gatewayClient.ts
```

## 4. Rotas adicionadas no gateway AI

```text
GET /v1/integrations/mileto-ops/view-contexts
GET /v1/integrations/mileto-ops/media/:ticket
```

O cabeçalho interno entre renderer/servidores do AI Video é:

```text
X-Ops-View-Context: <contextId-opaco>
```

O cabeçalho aceita somente uma string opaca limitada e nunca aceita ator, perfil ou e-mail.

## 5. Testes e validações

Executados com sucesso:

```text
npm test --prefix apps/gateway
npm run build --workspace=apps/client
npm run build --workspace=apps/server
npx eslint apps/client/src/components/OpsLibrary.tsx apps/client/src/lib/gateway.ts apps/server/src/controllers/opsController.ts apps/server/src/services/gatewayClient.ts
node --check apps/gateway/src/server.js
node --check apps/gateway/src/opsIntegration.js
node --check apps/gateway/src/opsViewContext.js
git diff --check
```

Resultados:

- 4 testes unitários do gateway aprovados;
- cliente TypeScript/Vite aprovado;
- servidor local TypeScript aprovado;
- lint focado aprovado;
- sintaxe do gateway aprovada;
- sanitização impede envio de e-mail, perfil interno e regras de hierarquia ao renderer;
- chaves de cache diferenciam `self`, `team` e `profile`;
- contexto inválido falha fechado.

Validação autenticada em produção após a confirmação explícita do Dono:

```text
vínculos confirmados: 1
contextos de visualização devolvidos: 10
canViewTeam: true
canViewProfiles: true
thumbnails emitidas com sucesso: 27
streams emitidos com sucesso: 2
```

O usuário confirmou visualmente que a biblioteca foi liberada e carregou corretamente após o
novo modal de confirmação. O modal diferencia sincronização de confirmação, destaca a
correspondência única do usuário atual e mantém casos ambíguos fora da confirmação rápida.

## 6. Estado de produção

Publicação controlada concluída em 2026-07-27.

Imagem em execução:

```text
sha256:2ce3dfe9cbc9c8c5fd2252a3fed096fb8367f0631c19dc05932cc1eb26c331ed
```

Backup verificável do PostgreSQL, criado antes da publicação:

```text
/opt/backups/mileto-gateway/gateway_v011_predeploy_20260727T133415Z.dump
bytes: 48242
sha256: ad1331f30a184b82f57964f860be492fbb43711ad585b5d3d8005690da98e25b
pg_restore --list: 114 entradas
```

Backup do código anterior, sem o arquivo `.env`:

```text
/opt/backups/mileto-gateway/code_pre_v011_20260727T1335Z.tar.gz
sha256: 6043436b28c204f223ab0ae6a5e33dbc6cbc31a22e90b78eedc6ca4f4049b830
```

A imagem anterior também foi preservada com a tag:

```text
mileto-gateway:pre-v011-20260727T1335Z
```

Verificações após a publicação:

```text
GET https://api.miletoaivideo.com.br/health
200

GET https://api.miletoaivideo.com.br/v1/integrations/mileto-ops/view-contexts
401 sem credencial

GET https://api.miletoaivideo.com.br/v1/integrations/mileto-ops/media/<ticket-desconhecido>
410
```

O container do gateway está saudável. O container PostgreSQL permaneceu em execução desde
2026-07-23 e não foi reiniciado durante a publicação. As seis variáveis `OPS_*` previstas no
compose foram repassadas ao container sem imprimir seus valores.

Inspeção sanitizada dos logs após a publicação:

```text
marcadores de segredo, grant ou URL privada: 0
linhas de erro, exceção, fatal ou unhandled: 0
```

Não houve migration do banco do AI Video nesta entrega. `assets.write` permanece desabilitado.

## 7. Pendências para conclusão

Concluídos:

- `user_link` do Dono confirmado por correspondência única;
- consulta autenticada de contextos;
- capacidade de equipe e perfis subordinados devolvida pelo Ops;
- carregamento da biblioteca;
- thumbnails;
- reprodução/stream;
- inspeção sanitizada dos logs, sem tokens, grants, URLs privadas ou erros.

Testes finais ainda recomendados antes de encerrar integralmente o E2E:

1. selecionar `Todos` e ao menos um subordinado permitido;
2. testar uma tentativa fora da hierarquia com usuário apropriado;
3. baixar um arquivo;
4. usar um arquivo do Ops no editor;
5. validar renovação/expiração e uma mudança de hierarquia;
6. devolver o resultado final ao Mileto Ops.

## 8. Git

Nenhum commit foi criado automaticamente porque o worktree já contém muitas alterações locais anteriores, inclusive em arquivos da integração. Nenhuma alteração do usuário foi descartada, revertida ou sobrescrita por reset.
