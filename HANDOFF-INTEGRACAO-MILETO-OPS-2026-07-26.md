# Handoff — Integração Mileto AI Video × Mileto Ops

Data do handoff: **2026-07-26**

Este documento deve ser lido pelo agente responsável pelo repositório **Mileto Ops**.

> Observação: o Mileto AI Video recebeu algumas atualizações depois da auditoria descrita aqui. Segundo o usuário, essas mudanças não interferem nas decisões e no avanço desta integração. Antes de programar, valide apenas os caminhos e símbolos atuais afetados pela implementação. Não descarte nem sobrescreva alterações locais.

## 1. Objetivo da integração

Queremos integrar dois produtos:

- **Mileto Ops:** fonte oficial de contas, organizações, funcionários, empresas, portfólios permitidos, pastas, ativos, MID, versões e permissões sobre mídia.
- **Mileto AI Video:** responsável por projetos, rascunhos, editor, timeline, processamento local, cache temporário, narração, música, legendas, títulos e exportação.

O proprietário conecta as duas contas. Depois disso, cada usuário deve possuir um vínculo permanente:

```text
ops_user_id ↔ ai_video_user_id
```

O e-mail pode ser usado como sugestão inicial, mas não deve continuar sendo a identidade da integração. Nomes nunca devem produzir vínculo definitivo automaticamente.

Regras de negócio já definidas:

- Nenhum usuário deve ser excluído automaticamente.
- Correspondências ambíguas exigem revisão manual.
- Usuários existentes em somente um dos sistemas devem ser preservados e apresentados como pendência.
- Cada funcionário vê somente as empresas e mídias permitidas no Ops.
- A mesma mídia não deve ser copiada desnecessariamente para o R2 do AI Video.
- O AI Video deve guardar uma referência externa ao ativo do Ops e fazer cache local somente quando necessário para edição ou exportação.
- Um futuro fluxo poderá enviar a exportação final de volta ao Ops.

## 2. Decisão arquitetural recomendada

A integração deve acontecer entre o **gateway do Mileto AI Video** e o **backend do Mileto Ops**.

```text
Electron/React
    ↓ sessão AI Video
Gateway AI Video
    ↓ conexão segura e identidade delegada
API Mileto Ops
    ↓ URL curta/autorizada
Servidor local AI Video
    ↓ cache temporário
FFmpeg/editor/exportação
```

O aplicativo Electron não deve receber access token, refresh token, master token ou segredo do Ops. O servidor Express local também não deve guardar credenciais privilegiadas do Ops.

A biblioteca do Ops deve aparecer no AI Video como uma nova origem, separada de:

- Local
- Compartilhado AI Video/R2
- Mileto Ops

Não recomendamos importar ou espelhar toda a biblioteca do Ops para `media_items` do AI Video. Isso duplicaria armazenamento e poderia contornar o portfólio individual de empresas.

## 3. Estado auditado do Mileto AI Video

### Worktree principal

- Repositório: `C:\Users\User\Desktop\Projetos de Programas\Mileto AI Video`
- Branch auditada: `main`
- Commit auditado: `2503a90497a600d9ec52ca661f128c68585f5c4b`
- Na auditoria estava 5 commits atrás de `origin/main`.
- Havia muitas alterações locais e arquivos não rastreados.

### Gateway

Na auditoria, a implementação efetiva do gateway estava no worktree:

```text
C:\Users\User\Desktop\Projetos de Programas\Mileto AI Video\.claude\worktrees\session-88436a
```

- Branch auditada: `claude/session-88436a`
- Commit auditado: `da3875c266253958d9791e29a277ad97d70234ba`

A revisão exata atualmente implantada em produção é **NÃO CONFIRMADO**.

Não use esses commits como autorização para reset, checkout ou descarte. O programa avançou em outra conversa e o estado atual deve ser preservado.

## 4. Stack confirmada do AI Video

- Electron 40.
- React 19, TypeScript e Vite.
- Servidor local Node/Express.
- FFmpeg, FFprobe e yt-dlp locais.
- Gateway Node/Express.
- PostgreSQL.
- Cloudflare R2 por API compatível com S3.

Arquivos relevantes, sujeitos a validação no estado atual:

```text
apps/client/electron-main/main.cjs
apps/client/src/context/AuthContext.tsx
apps/client/src/lib/authStorage.ts
apps/client/src/lib/gateway.ts
apps/client/src/pages/Account.tsx
apps/client/src/components/FileExplorer.tsx
apps/client/src/components/VideoUpload.tsx
apps/client/src/components/VideoSequencePreview.tsx
apps/client/src/components/ExportModal.tsx
apps/client/src/context/WizardContext.tsx
apps/client/src/types/index.ts
apps/server/src/routes/api.ts
apps/server/src/controllers/projectController.ts
apps/server/src/controllers/fileExplorerController.ts
apps/server/src/controllers/sharedController.ts
apps/server/src/controllers/videoController.ts
apps/server/src/services/ffmpeg.ts
.claude/worktrees/session-88436a/apps/gateway/src/auth.js
.claude/worktrees/session-88436a/apps/gateway/src/account.js
.claude/worktrees/session-88436a/apps/gateway/src/admin.js
.claude/worktrees/session-88436a/apps/gateway/src/config.js
.claude/worktrees/session-88436a/apps/gateway/src/crypto.js
.claude/worktrees/session-88436a/apps/gateway/src/db.js
.claude/worktrees/session-88436a/apps/gateway/src/server.js
.claude/worktrees/session-88436a/apps/gateway/src/shared.js
```

## 5. Autenticação atual do AI Video

Identificador: `AI-AUTH-01`

O AI Video usa autenticação própria:

- E-mail e senha.
- Senha com `scrypt`.
- Token próprio assinado por HMAC SHA-256.
- Payload com `sub`, `jti`, `role`, `org` e expiração.
- Validade observada de 30 dias.
- Bearer token no cabeçalho `Authorization`.
- Tabela `tokens` para revogação por `jti`.
- Sem OAuth/OIDC e sem cookies no fluxo atual.

No Electron, o token AI é cifrado com `safeStorage`/DPAPI. Em desenvolvimento no navegador existe fallback para `sessionStorage`.

Identificador: `AI-AUTH-02`

O Electron estava configurado com:

```text
nodeIntegration: true
contextIsolation: false
```

Isso aumenta o impacto de XSS e reforça que nenhuma credencial privilegiada do Ops pode chegar ao renderer.

### Segurança recomendada para a conexão

- Authorization Code + PKCE.
- `state` e `nonce` obrigatórios.
- Autorização aberta no navegador do sistema.
- Código curto e de uso único.
- Troca do código diretamente entre os backends.
- Tokens Ops cifrados e armazenados somente no gateway AI.
- Revogação explícita.
- Rotação de credenciais.
- Logs sem tokens ou URLs assinadas completas.

Escopos mínimos sugeridos:

```text
account.read
users.read
companies.read
assets.read
assets.stream
assets.download
assets.write       # somente em fase futura
```

## 6. Contas, equipe e permissões atuais

Identificador: `AI-TEAM-01`

Tabelas confirmadas no gateway AI:

```text
organizations
users
tokens
credits
usage_ledger
settings
credit_events
media_blobs
shared_folders
media_items
shared_drafts
shared_draft_assets
```

O vínculo atual de equipe é direto:

```text
users.org_id → organizations.id
```

Não existe atualmente:

- Tabela de memberships.
- Usuário em múltiplas organizações.
- Convite pendente.
- Empresa/cliente ou portfólio.
- Identificador externo de funcionário.
- Vínculo com o Ops.
- ACL por empresa, pasta ou ativo.

Papéis atuais:

```text
super_admin
owner
member
```

Esses papéis representam autorização dentro do produto AI Video e não devem ser confundidos com cargo ou função organizacional no Ops.

Identificador: `AI-TEAM-02`

O fluxo atual de remoção de membro faz exclusão física do usuário depois de revogar seus tokens. A sincronização Ops não pode reaproveitar esse comportamento.

Identificador: `AI-PERM-01`

A biblioteca compartilhada AI é isolada por organização, mas todos os membros podem listar e modificar os arquivos e rascunhos compartilhados. Não existe autorização por empresa ou portfólio.

Consequência: o backend Ops deve validar o usuário efetivo, a empresa e o ativo em cada operação. Esconder itens na interface não é uma barreira de segurança.

## 7. Reconciliação de usuários

A quantidade real de usuários e correspondências da conta da Impacto é **NÃO CONFIRMADO**. A consulta agregada de leitura ao PostgreSQL não conectou e ainda não recebemos dados equivalentes do Ops.

Algoritmo recomendado:

1. Ops fornece ID estável, nome, e-mail normalizado, papel e status.
2. AI Video compara e-mail exato normalizado apenas como sugestão.
3. Correspondência única é apresentada ao proprietário para confirmação, conforme decisão de produto.
4. Correspondência ambígua exige revisão manual.
5. Nome nunca finaliza uma correspondência.
6. Usuário somente no Ops aparece como candidato a convite/criação.
7. Usuário somente no AI Video permanece preservado e não vinculado.
8. Nenhum registro é excluído automaticamente.
9. Depois da confirmação, somente os IDs permanentes são usados.

Tabelas propostas no gateway AI — ainda não existentes:

```text
ops_connections
ops_user_links
ops_sync_runs
ops_sync_conflicts
ops_audit_events
external_media_references
```

## 8. Mídia e editor atuais

Identificador: `AI-MEDIA-01`

A biblioteca compartilhada do AI Video usa:

- R2.
- SHA-256.
- Deduplicação por organização, hash e tamanho.
- URLs pré-assinadas.
- Códigos semelhantes a `VID-######`, `AUD-######` e `IMG-######`.

Esses códigos não estão confirmados como MID do Ops.

Identificador: `AI-MEDIA-02`

O editor consegue usar URLs remotas em algumas etapas, mas o processamento ainda é mais confiável com um arquivo local:

- URLs assinadas podem expirar durante o projeto ou a exportação.
- O proxy local observado não encaminhava HTTP Range.
- A extração de frame pode baixar o vídeo remoto inteiro.
- O FFmpeg pode receber uma URL remota, mas compatibilidade completa de protocolo, Range e renovação é **NÃO CONFIRMADO**.
- Não existe cache específico para mídia externa do Ops.

Referência externa proposta para cada take:

```json
{
  "source": "mileto_ops",
  "opsAccountId": "...",
  "opsCompanyId": "...",
  "opsFolderId": "...",
  "opsAssetId": "...",
  "mid": "...",
  "version": "...",
  "checksum": "..."
}
```

Fluxo recomendado ao usar uma mídia:

1. Usuário escolhe empresa e ativo no AI Video.
2. Gateway deriva o vínculo do usuário autenticado.
3. Ops confirma permissão sobre empresa e ativo.
4. Ops fornece URL curta de stream ou download.
5. Servidor local materializa cache por `asset_id + versão/checksum`.
6. Editor e FFmpeg usam o caminho local.
7. Projeto preserva a referência Ops estável.
8. Cache pode ser removido sem apagar ou duplicar o ativo original.

## 9. Contrato de API sugerido

Todos os endpoints desta seção são propostas. Se o Ops já tiver equivalentes, devolver o caminho e o contrato existentes.

### Conexão no gateway AI Video

| Método e caminho | Chamador | Entrada/saída | Permissão e erros |
|---|---|---|---|
| `POST /v1/integrations/mileto-ops/connections` | Desktop → AI Gateway | Cria tentativa; retorna `attemptId`, `authorizationUrl`, `expiresAt` | `owner`; `409`, `503` |
| `GET /v1/integrations/mileto-ops/callback` | Ops/navegador → AI Gateway | Recebe `code` e `state`; conclui troca backend-backend | PKCE/state; `400`, `401`, `409`, `410` |
| `GET /v1/integrations/mileto-ops/connection` | Desktop → AI Gateway | Estado, conta, escopos e último sync; nunca tokens | `owner`; `404` |
| `DELETE /v1/integrations/mileto-ops/connection` | Desktop → AI Gateway | Revoga conexão sem excluir projetos ou usuários | `owner`; `409` |
| `POST /v1/integrations/mileto-ops/sync/users` | Desktop/worker → AI Gateway | Executa sync e retorna contagens/conflitos | `owner`; `409`, `429`, `502`, `503` |
| `GET /v1/integrations/mileto-ops/sync/conflicts` | Desktop → AI Gateway | Lista conflitos | `owner`; `404` |
| `PUT /v1/integrations/mileto-ops/user-links/:aiUserId` | Desktop → AI Gateway | Confirma `opsUserId` e justificativa | `owner`; `403`, `404`, `409`, `422` |
| `DELETE /v1/integrations/mileto-ops/user-links/:aiUserId` | Desktop → AI Gateway | Desvincula sem excluir nenhum usuário | `owner`; `404`, `409` |

### API necessária no Mileto Ops

| Método e caminho | Chamador | Entrada/saída | Permissão e erros |
|---|---|---|---|
| `POST /oauth/token` | AI Gateway → Ops | Código/refresh por access token com escopos | Cliente confidencial + PKCE; `400`, `401` |
| `POST /oauth/revoke` | AI Gateway → Ops | Revoga credenciais | Idempotente |
| `GET /integration/v1/account` | AI Gateway → Ops | Conta estável, nome, status e capacidades | `account.read` |
| `GET /integration/v1/users` | AI Gateway → Ops | IDs, e-mails normalizados, nomes, papéis, status e versão | `users.read`, paginação |
| `GET /integration/v1/me/companies` | AI Gateway → Ops | Empresas permitidas ao usuário efetivo | `companies.read` |
| `GET /integration/v1/companies/:companyId/folders` | AI Gateway → Ops | Pastas filhas e paginação | Empresa autorizada |
| `GET /integration/v1/companies/:companyId/assets` | AI Gateway → Ops | Ativos, MID, tipo, tamanho, duração, versão e thumbnail | `assets.read` |
| `GET /integration/v1/assets/:assetId` | AI Gateway → Ops | Metadados completos | Ator autorizado |
| `POST /integration/v1/assets/:assetId/thumbnail-url` | AI Gateway → Ops | URL curta para miniatura | `assets.read` |
| `POST /integration/v1/assets/:assetId/stream-url` | AI Gateway → Ops | URL curta compatível com Range | `assets.stream` |
| `POST /integration/v1/assets/:assetId/download-url` | AI Gateway → Ops | URL curta para cache/exportação | `assets.download`, auditado |

Erros esperados:

```text
400 entrada inválida
401 credencial inválida
403 usuário/empresa/ativo não permitido
404 recurso inexistente
409 conflito ou versão divergente
410 autorização, URL ou ativo expirado
422 metadado/checksum inválido
429 rate limit
502/503 dependência indisponível
```

### Futuro retorno da exportação ao Ops

```text
POST /integration/v1/companies/:companyId/folders/:folderId/assets/uploads
POST /integration/v1/assets/uploads/:uploadId/complete
```

Esse fluxo deve aceitar checksum, tamanho, MIME, nome, vínculo com o projeto de origem e regra clara sobre novo MID, nova versão ou ativo derivado.

## 10. Perguntas para o agente do Mileto Ops

Responder utilizando os identificadores abaixo.

### `OPS-AUTH-01`

Qual é a stack de autenticação? Existem OAuth/OIDC, Authorization Code, PKCE, refresh token e revogação?

### `OPS-AUTH-02`

Como um backend parceiro representa um usuário efetivo? Existe token delegado, token exchange, actor claim ou mecanismo equivalente? O cliente pode usar uma credencial de serviço sem perder a autorização individual?

### `OPS-TENANT-01`

Quais são as tabelas e IDs estáveis de conta, organização, usuário e funcionário? Um usuário pode pertencer a múltiplas contas?

### `OPS-TEAM-01`

Como funcionam status, convites, suspensão, remoção e reativação? Há webhooks para essas mudanças?

### `OPS-COMPANY-01`

Como empresas são associadas aos funcionários? As permissões são herdadas por pasta? Existem exceções por ativo? Existe “visualizar como” e como ele é auditado?

### `OPS-MEDIA-01`

Quais são as tabelas e IDs estáveis de empresa, pasta, ativo, arquivo físico, MID e versão? MID identifica um ativo lógico, arquivo físico ou versão?

### `OPS-MEDIA-02`

Onde a mídia é armazenada? Existem URLs assinadas? Streaming e download suportam HTTP Range? Qual é a configuração CORS e o tempo de validade?

### `OPS-MEDIA-03`

Quais metadados existem: MIME, duração, largura, altura, resolução, codec, tamanho, checksum, versão e thumbnail?

### `OPS-API-01`

Quais endpoints existentes podem substituir as propostas deste documento? Informar método, caminho, autenticação, entrada, saída, paginação e erros.

### `OPS-AUDIT-01`

Quais logs, webhooks e eventos existem para conexão, acesso, download, mudança de permissão, revogação, exclusão e restauração?

### `OPS-UPLOAD-01`

Existe upload multipart ou retomável? Como o Ops cria MID, versão ou derivado ao receber uma exportação?

### `OPS-LIMIT-01`

Quais são os limites de paginação, rate, tamanho de mídia, duração de URL e retenção/lixeira?

### `OPS-RECON-01`

Fornecer, se possível, uma visão sanitizada da equipe da conta da Impacto contendo:

- ID estável.
- E-mail normalizado.
- Nome.
- Papel.
- Status.
- Empresas permitidas ou quantidade delas.
- Duplicidades e ambiguidades.

Não enviar senhas, chaves, tokens, URLs assinadas ou segredos.

## 11. Riscos já identificados

| ID | Risco |
|---|---|
| `AI-AUTH-01` | Token AI atual dura 30 dias, não tem escopos e carrega papel/organização. |
| `AI-AUTH-02` | Segurança do renderer Electron precisa ser considerada na integração. |
| `AI-TEAM-01` | Remoção atual de membro faz exclusão física. |
| `AI-TEAM-02` | E-mail globalmente único pode limitar cenários multi-organização. |
| `AI-PERM-01` | Biblioteca compartilhada AI é acessível à organização inteira. |
| `AI-PERM-02` | Não há ACL por empresa, pasta ou usuário. |
| `AI-MEDIA-01` | URLs assinadas podem expirar durante edição/exportação. |
| `AI-MEDIA-02` | Proxy local observado não encaminhava Range. |
| `AI-MEDIA-03` | Não havia tipo estável para ativo externo/MID/versão. |
| `AI-EDITOR-01` | Biblioteca ainda precisava de ligação direta com “usar no editor”. |
| `AI-REPO-01` | Código auditado estava dividido entre worktrees modificados. |
| `OPS-UNKNOWN-01` | Autenticação, ACL e modelo de tenants do Ops são **NÃO CONFIRMADO**. |
| `OPS-UNKNOWN-02` | Range, CORS, versões, checksum e thumbnails do Ops são **NÃO CONFIRMADO**. |

## 12. Ordem de implementação proposta

### Fase 1 — Contrato e identidade

- Receber as respostas deste handoff.
- Confirmar IDs estáveis e tenancy.
- Definir OAuth/PKCE e escopos.
- Definir conexão, vínculo e auditoria.

### Fase 2 — Equipe

- Conectar contas pelo proprietário.
- Sincronizar somente em leitura.
- Sugerir correspondências.
- Resolver conflitos manualmente.
- Não excluir nem suspender automaticamente.

### Fase 3 — Biblioteca Ops

- Adicionar origem Mileto Ops.
- Exibir somente empresas autorizadas.
- Navegar pastas, pesquisar ativos e ver metadados.
- Obter thumbnail, stream e download sob demanda.

### Fase 4 — Editor e cache

- Criar referência de mídia externa.
- Adicionar “Usar no editor”.
- Materializar cache local.
- Validar versão/checksum.
- Renovar autorização e limpar cache com segurança.

### Fase 5 — Exportação para o Ops

- Upload multipart/retomável.
- Escolha de empresa e pasta.
- Registro de origem.
- Novo MID, versão ou derivado conforme regra definida pelo Ops.
- Auditoria e idempotência.

## 13. Instrução de resposta

Por favor, produza um documento de retorno chamado, se possível:

```text
HANDOFF-RETORNO-MILETO-OPS-PARA-AI-VIDEO.md
```

O retorno deve:

- Responder cada identificador `OPS-*`.
- Referenciar caminhos, tabelas, tipos e endpoints reais do Ops.
- Distinguir implementação existente de proposta.
- Marcar toda informação não verificada como **NÃO CONFIRMADO**.
- Não modificar código nesta etapa, salvo se o usuário der uma autorização posterior explícita.
- Não incluir segredos.

