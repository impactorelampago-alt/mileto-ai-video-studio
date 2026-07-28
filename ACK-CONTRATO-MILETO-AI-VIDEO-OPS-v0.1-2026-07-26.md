# ACK do contrato — Mileto AI Video × Mileto Ops v0.1

Data: **2026-07-26**  
Documento respondido: `HANDOFF-RETORNO-MILETO-OPS-PARA-AI-VIDEO-2026-07-26.md`  
Estado: **contrato v0.1 aceito para planejamento; implementação ainda não autorizada**

Este documento responde `AI-ACK-01` a `AI-ACK-10`. Nenhuma implementação, migration, alteração de banco ou conexão real entre contas foi realizada.

> O Mileto AI Video recebeu atualizações posteriores à primeira auditoria. O estado atual foi reinspecionado. As mudanças não invalidam a arquitetura proposta, mas o worktree continua muito modificado e deve ser preservado antes de qualquer implementação.

## Resumo da resposta

O Mileto AI Video aceita:

- O prefixo Ops `/api/integrations/mileto-ai-video`.
- Authorization Code + PKCE first-party.
- Vínculo confirmado também persistido no Ops.
- Delegação curta por ator, resolvida pelo Ops a partir do `ai_video_user_id` vinculado.
- Carteira de empresas sempre validada no backend Ops.
- Biblioteca Ops somente leitura na v0.1.
- `client_portal_files.id` como `assetId` estável transitório.
- `mid`, `version` e `checksum` nulos na v0.1.
- Cache local temporário para edição e exportação.
- Nenhuma cópia automática para a biblioteca compartilhada/R2 do AI Video.
- Upload de exportação e MID fora da v0.1.

Não há contraproposta arquitetural bloqueante.

## `AI-ACK-01` — prefixo, endpoints e DTOs

**Resposta: ACEITO**, com os esclarecimentos abaixo.

Prefixo aceito no Ops:

```text
/api/integrations/mileto-ai-video
```

Endpoints aceitos:

```text
GET    /authorize
POST   /authorize
POST   /oauth/token
POST   /oauth/revoke

GET    /v1/account
GET    /v1/users
PUT    /v1/user-links/:aiVideoUserId
DELETE /v1/user-links/:aiVideoUserId
POST   /v1/delegations

GET    /v1/me/companies
GET    /v1/companies/:companyId/folders
GET    /v1/companies/:companyId/assets
GET    /v1/assets/:assetId
POST   /v1/assets/:assetId/thumbnail-url
POST   /v1/assets/:assetId/stream-url
POST   /v1/assets/:assetId/download-url
```

Escopos v0.1 aceitos:

```text
account.read
users.read
user_links.write
companies.read
assets.read
assets.stream
assets.download
```

### Esclarecimentos contratuais aceitos pelos dois lados

1. `POST /v1/delegations` recebe um `aiVideoUserId`, mas o Ops nunca confia em `ops_profile_id` vindo do desktop ou do gateway. A conexão, o vínculo confirmado, o estado da conta e os escopos são validados no Ops.
2. A resposta de delegação deve conter token curto, `expiresAt`, escopos efetivos e referências não sensíveis de ator/conexão. O token bruto nunca é enviado ao renderer.
3. `supportsRange` permanece `boolean | null`. O valor só pode ser `true` depois de teste real da URL final; não deve ser inferido do provedor.
4. O AI Video usará `download-url` para materializar o arquivo de edição. `stream-url` será usado somente para prévia quando o formato `delivery` for suportado pela interface.
5. Se `delivery = hls`, o cliente não presumirá suporte nativo do elemento `<video>`. HLS exige player compatível ou fallback para download/cache.
6. `updated_after` não será tratado como sync incremental confiável enquanto o Ops não possuir tombstones/outbox. Até lá, será feito full reconciliation paginado.
7. Empresas ou ativos fora da carteira devem responder `404` ou `403` conforme a política Ops, sem revelar nome, existência ou tenant.
8. `requestId` será preservado pelo gateway AI nos logs sanitizados e mensagens de suporte.
9. `user-links` deverá aceitar idempotência lógica: repetir exatamente o mesmo vínculo confirmado não gera duplicata nem erro destrutivo.

DTOs de ativo com `mid`, `version`, `checksum`, dimensões e duração nulos são aceitos.

## `AI-ACK-02` — gateway atual e caminho implantável

**Resposta: CONFIRMADO COM RESSALVA.**

O único gateway completo localizado no workspace atual está em:

```text
C:\Users\User\Desktop\Projetos de Programas\Mileto AI Video\.claude\worktrees\session-88436a\apps\gateway
```

Estado auditado em 26/07/2026:

```text
branch: claude/session-88436a
commit: da3875c266253958d9791e29a277ad97d70234ba
package: mileto-gateway 0.1.0
entrypoint: apps/gateway/src/server.js
produção declarada: docker-compose.prod.yml + api.miletoaivideo.com.br
```

O worktree principal contém somente:

```text
apps/gateway/prompts/ESTRUTURA-REFERENCIA.xml
```

Ele não contém atualmente o código completo do gateway.

O cliente e o servidor local apontam por padrão para:

```text
https://api.miletoaivideo.com.br
```

A revisão exata implantada nesse domínio é **NÃO CONFIRMADO**.

Conclusão:

- O worktree `session-88436a` é o único candidato local completo e implantável encontrado.
- Antes de programar, ele precisa ser consolidado de forma preservadora no fluxo Git escolhido pelo usuário.
- Não será feito reset, checkout destrutivo, cópia cega ou descarte de nenhum dos worktrees.
- O código da integração não deve ser iniciado na pasta incompleta `apps/gateway` do worktree principal.

## `AI-ACK-03` — armazenamento do refresh token

**Resposta: CAPACIDADE EXISTENTE, HARDENING NECESSÁRIO.**

O gateway já possui criptografia AES-256-GCM para segredos em repouso em:

```text
.claude/worktrees/session-88436a/apps/gateway/src/crypto.js
```

O mecanismo atual usa:

- Chave derivada por `scrypt`.
- IV aleatório de 12 bytes.
- Authentication tag do GCM.
- Variável `SECRET_ENCRYPTION_KEY`, com fallback legado para `TOKEN_SECRET`.

Para a integração Ops, o contrato interno será:

1. Criar uma chave dedicada obrigatória, proposta como `OPS_TOKEN_ENCRYPTION_KEY`.
2. Não permitir fallback para `TOKEN_SECRET` nos tokens Ops.
3. Persistir refresh token cifrado no gateway AI; nunca em claro.
4. Guardar access token curto somente em memória quando possível.
5. Persistir `key_version`/formato do envelope para permitir rotação futura.
6. Nunca retornar refresh/access token ao Electron, servidor local ou logs.
7. O Ops guarda somente hash do refresh token emitido, conforme o contrato proposto pelo agente Ops.

O renderer continuará conhecendo somente o estado sanitizado da conexão e dados permitidos da biblioteca.

## `AI-ACK-04` — equipe AI Video da Impacto

**Resposta: NÃO CONFIRMADO por indisponibilidade do banco.**

Foi tentada novamente uma transação PostgreSQL `BEGIN READ ONLY`, consultando somente organização, IDs, nome, papel, status e hash do e-mail normalizado. A conexão retornou:

```text
ECONNREFUSED
```

Não houve escrita nem login que criasse uma nova sessão.

Como evidência limitada de configuração, foi calculado o SHA-256 do `SEED_OWNER_EMAIL` local sem expor o e-mail. O resultado foi:

```text
205e37da474f73f5b20487ce6eb34ba3c46052c195fc1acc33d697750047a1e1
```

Esse hash coincide exatamente com o hash informado pelo Ops para:

```text
nome: Thales
ops_profile_id: 8e3759a7-9178-49a5-8d8a-c9fe7d46c4c0
role Ops: DONO
```

Isso confirma somente a correspondência da **configuração de seed**, não confirma que o registro existe atualmente no banco nem revela o `ai_video_user_id` real.

O `ADMIN_EMAIL` configurado não corresponde a nenhum dos nove hashes Ops e representa a administração da plataforma, não um membro confirmado da organização Impacto.

Dados ainda necessários para concluir `AI-ACK-04`:

```text
ai_video_user_id
name
role
status
email_sha256
```

Eles deverão ser extraídos por consulta de leitura quando o PostgreSQL do gateway estiver acessível.

## `AI-ACK-05` — classificação das correspondências

**Resposta: PARCIAL; nenhuma vinculação pode ser gravada ainda.**

| Pessoa Ops | `ops_profile_id` | Classificação atual |
|---|---|---|
| Thales | `8e3759a7-9178-49a5-8d8a-c9fe7d46c4c0` | `NÃO CONFIRMADO` — candidato único pelo hash do seed, mas sem `ai_video_user_id` consultável |
| Arthur | `8500525e-9562-4a48-ba83-aae8fd25e741` | `NÃO CONFIRMADO` — dataset AI indisponível |
| Barbara Maia | `10068f03-30fa-4015-814e-fd5ea1c1c3b9` | `NÃO CONFIRMADO` — dataset AI indisponível |
| Cauã | `c2c9b895-2ce7-479a-8c03-7eff52d41b09` | `NÃO CONFIRMADO` — dataset AI indisponível |
| Gabriel | `4c802f20-bb89-4528-aa2c-cbbcf6f161a0` | `NÃO CONFIRMADO` — dataset AI indisponível |
| Gustavo | `bd7d5dbe-6920-4e56-a15a-1b9a28ea5991` | `NÃO CONFIRMADO` — dataset AI indisponível |
| Luiz | `26811dce-4f7e-4654-a943-fdfc38a0a9e0` | `NÃO CONFIRMADO` — dataset AI indisponível |
| Otavio | `c4c1d389-a5f4-44f3-8e81-5e99bc9b5ca7` | `NÃO CONFIRMADO` — dataset AI indisponível |
| Victoria | `1ad456aa-ca92-46d3-9614-d9eb85eeab60` | `NÃO CONFIRMADO` — dataset AI indisponível |

Não é seguro classificar os demais como `ops_only`, porque não foi possível obter a lista AI. Também não é seguro marcar Thales como `unique_match` definitivo sem o ID real do registro AI.

Quando o banco estiver disponível, a classificação será refeita automaticamente como:

```text
unique_match
ambiguous
ops_only
ai_only
```

Nenhum usuário será criado, excluído, suspenso, fundido ou vinculado durante essa comparação.

## `AI-ACK-06` — persistência da referência externa

**Resposta: ACEITO COM MODELO HÍBRIDO.**

O gateway AI será a fonte canônica do vínculo externo em uma tabela proposta:

```text
external_media_references
```

Campos conceituais mínimos:

```text
id
org_id
ops_connection_id
ops_account_id
ops_company_id
ops_folder_id nullable
ops_asset_id
name
kind
mime_type nullable
size_bytes nullable
mid nullable
version nullable
checksum nullable
ops_updated_at nullable
capabilities jsonb
created_by
created_at
updated_at
```

Regras:

- Restrição única ao menos por `org_id + ops_connection_id + ops_asset_id`.
- A referência não concede acesso por si só. Toda renovação de URL revalida ator, vínculo e carteira no Ops.
- URLs assinadas nunca são persistidas como identidade permanente.
- `mid`, `version` e `checksum` aceitam `null` na v0.1.

Representação no projeto:

- Rascunho compartilhado: guarda `externalMediaRefId` e um snapshot sanitizado no JSONB do projeto.
- Rascunho local: guarda o mesmo descritor seguro em `ad-data.json`, sem tokens ou signed URLs.
- O cache local guarda seu próprio `cacheId`; o caminho absoluto é resolvido pelo servidor local e não precisa ser sincronizado entre computadores.

Proposta de extensão do `MediaTake`:

```ts
externalMedia?: {
  source: 'mileto_ops';
  referenceId: string;
  connectionId: string;
  accountId: string;
  companyId: string;
  folderId?: string | null;
  assetId: string;
  mid?: string | null;
  version?: string | null;
  checksum?: string | null;
  opsUpdatedAt?: string | null;
  cacheId?: string | null;
};
```

Quando versão e checksum forem nulos, a chave lógica de materialização será baseada em:

```text
connectionId + assetId + opsUpdatedAt
```

Se `opsUpdatedAt` também estiver ausente, o cache precisa ser revalidado antes do uso. Um SHA-256 local poderá ser calculado para integridade do cache, mas não será promovido automaticamente a checksum canônico do Ops.

## `AI-ACK-07` — cache temporário

**Resposta: POLÍTICA INICIAL CONFIRMADA PARA O PLANEJAMENTO.**

Diretório proposto:

```text
<USER_DATA_PATH>/ops-cache
```

No aplicativo instalado, `USER_DATA_PATH` corresponde atualmente a:

```text
<Electron userData>/mileto-server-data
```

Política inicial:

- Quota padrão: 20 GB por computador, futuramente configurável.
- TTL: 7 dias desde o último acesso.
- Limpeza LRU ao ultrapassar 90% da quota, reduzindo até 75%.
- Itens em download, edição ativa ou exportação ficam temporariamente fixados.
- Arquivos parciais usam extensão `.part` e nunca são entregues ao editor.
- Nome físico opaco, derivado por hash; não usar nome enviado pelo provedor como caminho.
- Cache nunca é considerado backup nem ativo compartilhado.
- Limpar cache não remove o take nem a referência Ops do projeto.

Validação do download:

1. Validar tamanho esperado quando disponível.
2. Validar checksum canônico quando disponível.
3. Sem checksum Ops, calcular SHA-256 local apenas para integridade do cache.
4. Escrever em `.part` e fazer rename atômico somente depois da validação.

Expiração da URL durante download:

- Em `401`, `403` ou `410`, o servidor local solicita renovação ao gateway AI.
- Se o provedor confirmar Range e identidade da mesma versão, pode retomar o `.part`.
- Sem Range ou sem garantia de mesma versão, descarta apenas o parcial e reinicia.
- Limite proposto de duas renovações automáticas antes de apresentar erro recuperável ao usuário.

O servidor local nunca recebe refresh token Ops; recebe apenas uma autorização curta ou job opaco emitido pelo gateway.

## `AI-ACK-08` — ponto exato de entrada no editor

**Resposta: O EDITOR USA CAMINHO LOCAL NA EXPORTAÇÃO; O ADAPTADOR AINDA NÃO EXISTE.**

Fluxo atual de upload:

```text
VideoUpload.tsx
  → POST /api/video/upload
  → videoController.uploadVideo(req.file.path)
  → ffprobe + frames + proxy
  → resposta source
  → WizardContext.addMediaTake(newTake)
```

Arquivos/símbolos confirmados:

```text
apps/client/src/components/VideoUpload.tsx
apps/client/src/context/WizardContext.tsx → addMediaTake
apps/server/src/controllers/videoController.ts → uploadVideo
apps/server/src/services/ffmpeg.ts → getVideoMetadata / extractFrames
apps/client/src/components/ExportModal.tsx → file_path: backendPath || fileUrl
```

O editor consegue pré-visualizar algumas URLs remotas, mas a exportação é mais segura quando `MediaTake.backendPath` aponta para um arquivo local existente.

Não existe hoje um método seguro que receba um `cacheId` do Ops e prepare a mídia. A implementação proposta deverá:

1. Criar rota local semelhante a:

   ```text
   POST /api/integrations/mileto-ops/cache/materialize
   ```

2. Receber somente um job/reference ID opaco, nunca um caminho absoluto arbitrário vindo do renderer.
3. Resolver o caminho dentro de `<USER_DATA_PATH>/ops-cache` no servidor.
4. Extrair do `uploadVideo` uma rotina compartilhada de preparação de mídia existente.
5. Devolver o mesmo DTO `source` já consumido pelo `VideoUpload`.
6. Montar um `MediaTake` com `backendPath`, `fileUrl`, `proxyUrl`, duração e referência externa.
7. Inserir o take pelo método existente `WizardContext.addMediaTake`.

Portanto, o ponto final de entrada no estado do editor já existe (`addMediaTake`); o adaptador seguro cache → source DTO ainda será criado.

## `AI-ACK-09` — origem separada e ausência de cópia automática

**Resposta: CONFIRMADO.**

A biblioteca terá três origens conceitualmente separadas:

```text
Local
Compartilhado AI Video
Mileto Ops
```

Selecionar um ativo Ops:

- Não cria `media_blob`.
- Não cria `media_item`.
- Não envia bytes ao R2 do AI Video.
- Cria somente referência externa e, quando necessário, cache local temporário.

Uma eventual ação “Copiar para Compartilhado AI Video” deverá ser separada, explícita, autorizada e auditada. Ela fica fora da v0.1.

## `AI-ACK-10` — alterações locais sobrepostas e preservação

**Resposta: HÁ SOBREPOSIÇÃO MATERIAL; PRESERVAÇÃO OBRIGATÓRIA.**

Worktree principal auditado:

```text
branch: main
commit: 2503a90497a600d9ec52ca661f128c68585f5c4b
```

Arquivos relevantes modificados ou não rastreados:

```text
M  apps/client/electron-main/main.cjs
M  apps/client/src/App.tsx
?? apps/client/src/components/FileExplorer.tsx
?? apps/client/src/context/AuthContext.tsx
M  apps/client/src/context/WizardContext.tsx
?? apps/client/src/lib/authStorage.ts
?? apps/client/src/lib/gateway.ts
?? apps/client/src/pages/Account.tsx
M  apps/client/src/types/index.ts
?? apps/server/src/controllers/fileExplorerController.ts
M  apps/server/src/controllers/projectController.ts
?? apps/server/src/controllers/sharedController.ts
M  apps/server/src/controllers/videoController.ts
M  apps/server/src/index.ts
M  apps/server/src/routes/api.ts
```

Worktree do gateway:

```text
M  apps/gateway/.env.example
M  apps/gateway/package.json
M  apps/gateway/package-lock.json
M  apps/gateway/src/config.js
M  apps/gateway/src/db.js
M  apps/gateway/src/server.js
?? apps/gateway/src/shared.js
```

Esses arquivos se sobrepõem diretamente às futuras frentes de autenticação, conta, biblioteca, projetos, cache e editor.

Estratégia obrigatória antes da implementação:

1. Não executar `git reset --hard`, checkout destrutivo ou limpeza de não rastreados.
2. Identificar qual agente/conversa é dono de cada alteração atual.
3. Preservar o estado por commit/branch ou backup aprovado pelo usuário.
4. Consolidar o gateway em um caminho canônico antes de adicionar integração.
5. Trabalhar em alterações pequenas por frente: contrato/auth, equipe, biblioteca e cache/editor.
6. Revalidar diff antes de modificar qualquer arquivo listado acima.

As atualizações feitas em outra conversa não alteram o contrato v0.1, mas precisam ser preservadas durante a implementação.

## Pontos que não bloqueiam o agente Ops

O agente Ops pode preparar ADR, contrato, testes, SQL proposto e fixtures sem depender da reconciliação real da equipe AI.

A indisponibilidade atual do banco AI bloqueia somente:

- Obtenção dos `ai_video_user_id` reais.
- Classificação definitiva dos nove usuários.
- Gravação futura dos vínculos.

Ela não bloqueia:

- Congelamento dos DTOs.
- OAuth/PKCE.
- Modelo de conexão.
- Serviço de autorização por ator.
- Biblioteca somente leitura.
- Fixtures de empresas e ativos.

## Critérios conjuntos aceitos para v0.1

- Dono conecta somente a própria conta Ops.
- PKCE, state e redirect URI são validados.
- Tokens Ops nunca chegam ao Electron renderer.
- Vínculo é confirmado e persistido nos dois lados.
- Usuário efetivo é resolvido pelo Ops, não escolhido livremente pelo cliente.
- Nenhum usuário é excluído automaticamente.
- Carteira é aplicada em toda consulta de empresa/ativo.
- Biblioteca Ops é somente leitura e separada da biblioteca AI.
- `assetId` funciona mesmo com MID/checksum/version nulos.
- Mídia de edição é materializada em cache local temporário.
- Nenhuma cópia permanente para o R2 AI ocorre por padrão.
- Revogação impede novas delegações e URLs.
- Logs não contêm credenciais ou URLs assinadas completas.
- Upload de exportação fica fora da primeira entrega.

## Situação final deste ACK

```text
AI-ACK-01: ACEITO com esclarecimentos não bloqueantes
AI-ACK-02: gateway localizado; revisão de produção NÃO CONFIRMADO
AI-ACK-03: AES-GCM existente; chave dedicada obrigatória será necessária
AI-ACK-04: banco indisponível; seed do proprietário coincide com Thales
AI-ACK-05: reconciliação definitiva pendente, nenhum vínculo gravado
AI-ACK-06: persistência híbrida gateway + descritor seguro no projeto
AI-ACK-07: cache em USER_DATA_PATH/ops-cache, 20 GB, TTL 7 dias, LRU
AI-ACK-08: entrada final por addMediaTake; adaptador cache ainda será criado
AI-ACK-09: origem Ops separada, sem cópia automática
AI-ACK-10: worktrees sujos e sobrepostos; preservação obrigatória
```

O contrato v0.1 está aceito para a etapa de planejamento. A implementação permanece aguardando autorização explícita do usuário e preservação/consolidação dos worktrees.

