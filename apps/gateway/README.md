# Mileto Gateway

Servidor de **autenticação + proxy de IA + medição de consumo**. Roda local (Docker) hoje;
vai para a VPS quando o super admin for aprovado.

## Por que existe

As chaves de IA (Fish Audio, OpenAI, Gemini, ElevenLabs) **não podem ficar no PC do cliente** —
um app Electron não guarda segredo. O gateway guarda as chaves, recebe as chamadas do app
autenticadas por login, repassa aos fornecedores com a SUA chave, e mede o consumo por usuário.
Isso é o que permite vender "créditos Mileto" por cima do custo do fornecedor.

Ver `PLANO-COMERCIALIZACAO.md` na raiz do projeto.

## Rodar local

```bash
cd apps/gateway
cp .env.example .env        # depois edite: TOKEN_SECRET, ADMIN_*, e as chaves de IA
npm install
npm run setup               # sobe Postgres (Docker) + migra + cria admin
npm start                   # gateway em http://localhost:4000
```

Sem chaves de IA no `.env`, o gateway roda em **modo demo**: devolve áudio silencioso e não
cobra créditos — dá para ver todo o fluxo sem gastar. Cole suas chaves para síntese real.

## Ativar o ambiente Compartilhado

O Compartilhado usa um bucket privado do Cloudflare R2. Crie o bucket e uma credencial S3
restrita a ele, com permissão de leitura e gravação. Na VPS, execute:

```bash
cd /opt/mileto-gateway
bash scripts/configure-r2.sh
```

O assistente pede `Account ID`, `Access Key ID`, `Secret Access Key` e o nome do bucket sem
mostrar o segredo na tela. Ele salva um backup do `.env`, reinicia o gateway e faz uma prova
real de upload, leitura e exclusão. Enquanto os quatro valores estiverem vazios, o restante
do produto funciona normalmente e `/shared/status` informa quais campos faltam.

## Endpoints

| Método | Rota | Auth | O que faz |
|---|---|---|---|
| POST | `/auth/login` | — | email+senha → token de sessão |
| POST | `/auth/logout` | Bearer | revoga a sessão |
| GET | `/auth/me` | Bearer | dados do usuário + saldo de créditos |
| POST | `/v1/tts` | Bearer | proxy de narração, medido. Devolve MP3 |
| POST | `/v1/chat` | Bearer | proxy de roteiro/LLM, medido |
| GET | `/admin/usage` | Bearer admin | consumo agregado por usuário |

Headers de resposta do `/v1/tts`: `X-Mileto-Demo`, `X-Mileto-Charged`, `X-Mileto-Balance`.

## Verificado em 22/07/2026 (modo demo)

- login bloqueia senha errada (401) e emite token na correta
- `/v1/tts` sem token → 401; com token → 200 + MP3 + headers de medição
- consumo registrado no `usage_ledger` (units, custo do fornecedor, créditos debitados)

## Ainda falta (próximas fases)

- Tela de login no app Electron (gate na entrada)
- App chamar o gateway em vez dos fornecedores diretos (mantendo o cache MD5 local)
- Chave de licença + limite de máquinas
- Webhook de pagamento (Asaas) → cria usuário e credita saldo
- Refino do custo por modelo e do gross-up de importação no multiplicador
