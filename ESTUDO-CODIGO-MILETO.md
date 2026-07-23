# Estudo do Codigo — Mileto AI Video

## Resumo executivo

A saude geral e preocupante na camada de servidor/gateway e razoavel na de UI. O maior peso esta em **seguranca do servidor local** (porta 3301) e em **integridade financeira do gateway** — sao os dois eixos que colocam dinheiro e dados do usuario em risco direto. Contagem por severidade (apos agrupar duplicatas): **2 criticos, 11 altos, ~18 medios, ~18 baixos**. Tres temas dominam: (1) **falta de validacao de caminho/host** no servidor local combinada com **CORS aberto sem auth**, o que transforma quase todo bug local em exploravel remotamente por qualquer site aberto no navegador; (2) **precificacao/cobranca do gateway furada** — o provedor pago e chamado antes de checar saldo e os custos ignoram o modelo real, gerando sangria financeira nos dois sentidos; (3) **ausencia sistematica de timeout, error-handling e cleanup** (fetch sem AbortController, handlers async sem try/catch no Express 4, object URLs/rAF/processos nunca liberados).

---

## 🔴 Criticos

**Injecao de comando via nome de arquivo no ffprobe**
`apps/server/src/controllers/musicController.ts:48`
`getAudioDuration()` monta um comando de shell interpolando o caminho do arquivo em `exec(\`ffprobe ... "${filePath}"\`)`, e a extensao do caminho vem de `req.file.originalname` (o multer so filtra mimetype). RISCO: `POST /api/music/upload` com filename `evil.$(touch /tmp/pwned)` executa comando arbitrario com os privilegios do servidor; como o CORS reflete qualquer origem e a rota nao tem auth, qualquer site aberto no navegador dispara isso. CORRECAO: trocar por `execFile('ffprobe', [..., filePath])` (sem shell) ou `fluent-ffmpeg.ffprobe`, e validar a extensao contra uma allowlist antes de gravar.

**Provedor de IA pago e chamado ANTES de checar saldo (sangria de dinheiro)**
`apps/gateway/src/server.js:71` (e :108 chat, :133 stt)
Nos tres endpoints `/v1/*`, `proxyTts/proxyChat/proxyStt` executa a sintese/geracao real (gastando dinheiro na Fish/OpenAI/ElevenLabs com a chave da plataforma) e SO DEPOIS `debitAndLog` verifica saldo (`meter.js:68`). O gasto no fornecedor e irreversivel e fica fora da transacao. RISCO: uma org com saldo 0 dispara N requisicoes; cada uma gasta dinheiro real da plataforma, recebe 402 e nunca e debitada — vetor de estouro de custo ilimitado; concorrencia tambem causa gasto duplo real. CORRECAO: pre-checar saldo/status da org (ou reservar credito estimado numa transacao com `SELECT FOR UPDATE`) ANTES de chamar o fornecedor; so entao chamar e reconciliar a diferenca.

---

## 🟠 Altos

**CORS reflete qualquer origem, com credenciais, numa API local sem auth**
`apps/server/src/index.ts:46`
`cors({ origin: true, credentials: true })` reflete o Origin de qualquer site; a maioria das rotas locais (proxy, projects, uploads, music, mux) nao exige token. RISCO: este e o **amplificador** que torna todos os achados do servidor local exploraveis remotamente — qualquer site aberto no navegador do usuario chama `http://localhost:3301/api/...` e le a resposta. CORRECAO: restringir `origin` apenas a(s) origem(ns) do app Electron, remover `credentials:true` se nao for necessario, e exigir Bearer/sessao nas rotas que mudam estado ou tocam arquivos.

**Proxy aberto = SSRF legivel por qualquer origem**
`apps/server/src/routes/api.ts:159`
`GET /api/proxy?url=<qualquer>` faz `axios.get` server-side (seguindo redirects), sem allowlist/esquema/auth, e devolve o corpo com `Access-Control-Allow-Origin:*`. RISCO: um site malicioso le `http://169.254.169.254/latest/meta-data/...` (credenciais de metadata da nuvem) ou varre servicos internos em loopback, usando o app como proxy cego. CORRECAO: allowlist de hosts de midia, bloquear esquemas nao-http(s) e faixas privadas/loopback/link-local resolvendo o DNS antes, `maxRedirects:0` (ou revalidar host apos redirect).

**Leitura de arquivo arbitrario no STT (caminho absoluto + traversal)**
`apps/server/src/controllers/sttController.ts:23` (e :39)
Dois vetores: retorna `audioUrl` diretamente se for absoluto e existir (ex.: `/etc/passwd`, `C:\Windows\...\hosts`); e `path.join(BASE_DATA_PATH, dir, rel)` sem checar containment (`/narrations/../../../...` escapa). O arquivo e lido e enviado ao gateway/Whisper. RISCO: exfiltracao de qualquer arquivo do disco do usuario (ex.: `~/.ssh/id_rsa`) para fora da maquina. CORRECAO: remover o atalho de caminho absoluto; apos `path.join`, `path.resolve` + `startsWith(base+sep)` e rejeitar qualquer `..`.

**Path traversal em save/getProjectData**
`apps/server/src/controllers/projectController.ts:144` (e :116)
`deleteProject` valida `..`/`/`/`\`, mas `saveProjectData` e `getProjectData` juntam o `:projectId` cru no caminho sem checagem (e o Express decodifica `%2e%2e%2f` -> `../`). RISCO: escrita/criacao de arquivos com JSON controlado pelo atacante fora de `PROJECTS_DIR`, e leitura fora da arvore — reachable sem auth via CORS aberto. CORRECAO: aplicar a mesma validacao do `deleteProject` (ou `path.resolve` + assert de prefixo) nos dois handlers.

**Path traversal em uploadImage (projectId nao sanitizado)**
`apps/server/src/controllers/uploadController.ts:18`
`projectId` vem de `req.body` e e juntado direto no diretorio de destino (linha 18/27), sem validacao. Mesmo padrao em `aiController.generateReplicateImage:50` e `getRunwayJobStatus:348`. RISCO: escrita de arquivo arbitrario fora do diretorio de dados; `projectId` ausente -> `path.join(undefined)` -> 500 nao tratado. CORRECAO: validar `projectId` contra `^[A-Za-z0-9_-]+$` (ou UUID) e rejeitar separadores antes de usar, consistente no `aiController`.

**Bypass da narracao-padrao nunca dispara -> cobra credito em toda geracao do demo**
`apps/server/src/services/gatewayNarration.ts:60` (duplicado em `fishAudio.ts:63-64`)
`normalizedText = text.replace(/[\s\W_]+/g,'')` remove acentos (`ç/ã/ó` casam `\W` sem flag `u`), mas os termos comparados (`'atençãoatenção'`, `'óticavivaz'`) ainda contem acento — os `includes` retornam `false` sempre. RISCO: `isDefault` e sempre falso; a narracao-padrao de demonstracao vai ao gateway e consome credito pago a cada render, exatamente o custo que o atalho pretendia evitar. CORRECAO: normalizar por transliteracao (`.normalize('NFD').replace(/[\u0300-\u036f]/g,'')`) dos dois lados e comparar sem acento, ou usar um marcador estavel do payload em vez de heuristica de texto.

**Handlers/middleware async sem try/catch e sem error-middleware (Express 4)**
`apps/gateway/src/server.js:33` e `apps/gateway/src/admin.js:42` (+ `account.js`)
O Express 4 nao captura rejeicoes de promessa de handlers async e nao ha error-handler global. `login`, `requireAuth`, `logout`, `/auth/me`, e a maioria dos handlers admin/account chamam `query()` sem try/catch. RISCO: qualquer indisponibilidade transitoria do Postgres (restart, pool esgotado) ou parametro invalido (`/admin/orgs/abc` -> `NaN`) vira `unhandledRejection`, a resposta nunca e enviada e o cliente pendura ate timeout. CORRECAO: envolver handlers num `asyncHandler(fn).catch(next)`, registrar `app.use((err,req,res,next)=>...500...)`, validar `:id` com `Number.isInteger`; ou migrar para express@5.

**pg.Pool sem listener 'error' -> derruba o processo inteiro do gateway**
`apps/gateway/src/db.js:4`
O Pool nao tem `pool.on('error', ...)`. Quando um cliente ocioso sofre erro de backend (Postgres reinicia, TCP cai), o EventEmitter sem listener faz o Node lancar e encerrar o processo — e nao ha `uncaughtException` registrado. RISCO: uma oscilacao de rede derruba todo o SaaS, e cada reinicio repete o ciclo se o DB ainda estiver instavel. CORRECAO: `pool.on('error', err => console.error(...))` logo apos criar o pool; opcionalmente `process.on('unhandledRejection'/'uncaughtException')` para logar sem morrer silenciosamente.

**Credenciais padrao de super admin (admin@mileto.local / admin)**
`apps/gateway/src/config.js:15`
`config.admin.password` cai para `'admin'` e o email para `'admin@mileto.local'` quando as env vars faltam; o seed cria o `super_admin` com esses valores. Diferente de `DATABASE_URL`/`TOKEN_SECRET`, `ADMIN_PASSWORD` nao e `required()`. RISCO: um deploy que esquece a variavel cria o dono da plataforma com senha `admin` — atacante loga e ganha controle total (chaves de IA, orgs, creditos, faturamento). CORRECAO: tornar `ADMIN_PASSWORD` obrigatorio via `required()` (ou abortar o seed se for default/curta).

**Custo do provedor e flat, ignora o modelo real — tiers caros cobrados a preco de nano**
`apps/gateway/src/meter.js:13` / `:16`
`PROVIDER_COST` tem um unico `usdPerMillion` por provedor (openai=0.6, gemini=0.4), mas `resolveTier` mapeia lite=gpt-4.1-nano, plus=gpt-4.1-mini, ultra=gpt-4.1 — precos ordens de grandeza maiores. O proprio comentario admite "estimativa p/ modelo nano; refine por modelo". RISCO: no tier Ultra a plataforma cobra ~0.6/M enquanto paga ~10-15x mais ao fornecedor -> prejuizo direto em todo uso do tier caro e `provider_cost` do overview subestimado, mascarando a margem real. CORRECAO: tabela de custo por `(provider, model)` resolvida via `resolveTier`, idealmente cobrando input e output separadamente.

**Export usa so a soma dos takes de video, truncando narracao/CTA mais longos**
`apps/client/src/components/ExportModal.tsx:92`
`totalDuration` = soma bruta de `take.trim.end-start` dos `mediaTakes`, sem considerar o audio-mestre; esse valor vira nº de frames e `duration` no backend. O preview usa `Math.max(takesDur, audioDuration)`, e o backend aplica `-shortest` + `-t <duration>` (`ffmpeg.ts:510-514`), cortando o MP4 na soma dos takes. RISCO: narracao+CTA de 28s com b-roll somando 20s (cenario que o proprio codigo antecipa) -> o export descarta silenciosamente os ultimos 8s de audio, o titulo de CTA e legendas apos 20s. CORRECAO: computar a duracao de export como `Math.max(soma dos takes, duracao do audio-mestre)` (probe do elemento de audio) e alimentar frame loop e backend com esse valor; segurar o ultimo frame/cauda preta quando os clipes forem mais curtos.

**Primeira mensagem em chat novo some enquanto a IA responde (race)**
`apps/client/src/components/chat/ChatMileto.tsx:269`
Em `handleSendWithFolder`, apos criar a sessao e `setActiveSessionId`, o `useEffect` (122-128) dispara `chatApi.getMessages(sessionId).then(setMessages)`; como a sessao recem-criada ainda nao tem mensagens no servidor, resolve `[]` e sobrescreve a `tempUserMsg`. RISCO: a bolha do usuario pisca e some, so o indicador de digitacao aparece por varios segundos, e se `sendMessage` falhar antes de resolver a mensagem se perde. CORRECAO: pular o fetch quando a sessao acabou de ser criada nesta acao (flag/ref `justCreated`), ou mesclar as mensagens temporarias com o resultado do `getMessages` em vez de substituir.

**electronVersion fixado em 30.0.0 enquanto o app roda em Electron 40**
`apps/client/electron-builder.yml:7`
O YAML fixa `electronVersion: '30.0.0'`, mas o `package.json` declara `electron: ^40.6.0` e dev/CI rodam sob v40; quando setado explicitamente, esse campo SOBREPOE a auto-deteccao e o instalador empacota o runtime 30 (Chromium ~124 / Node 20.9). RISCO: qualquer API/feature de DOM/Node presente na v40 mas nao na 30 funciona em dev e quebra so na build do usuario final — defeito que nunca reproduz na maquina do dev. CORRECAO: remover a linha `electronVersion` (deixar derivar do pacote instalado) ou fixar exatamente `40.6.0`, mantendo os dois em lockstep.

---

## 🟡 Medios

**Nenhum fetch/chamada ao gateway tem timeout (cliente e servidor)**
`apps/client/src/lib/gateway.ts:57` (+ `chatApi.request:10`) e `apps/server/src/services/gatewayClient.ts:60` (`gatewayChat/Tts/Stt`)
`fetch`/`node-fetch` sem `AbortController`/timeout: um socket "aberto mas mudo" nunca resolve nem rejeita. RISCO: login trava com "Entrando…" e botao desabilitado para sempre; chat com spinner eterno; num export, uma unica conexao travada com o gateway prende a requisicao do servidor local sem erro nem retry, o usuario mata o app. CORRECAO: `AbortSignal.timeout(...)` (menor para `/auth`, ~30-60s para IA) em todas as chamadas, traduzindo o abort em erro de rede exibivel.

**Editar texto ou trocar voz apos gerar a narracao nao invalida o audio**
`apps/client/src/pages/Step1.tsx:195` (e `VoiceSelector.tsx:49`)
O `onChange` do textarea e a troca de voz nao resetam `isNarrationGenerated` — inconsistente com `VoiceSettingsPanel.tsx:85`, que reseta. Como `canProceed` so exige `isNarrationGenerated`, o usuario avanca com audio desatualizado. RISCO: gera "Compre hoje", edita para "Ultimas unidades", avanca -> video fala o texto antigo e a legenda-base diverge do falado. CORRECAO: incluir `isNarrationGenerated:false` (e limpar `narrationAudioUrl`/`narrationDuration`) quando texto ou voz realmente mudarem.

**handleExport fecha sobre `targetDims` obsoleto (stale closure)**
`apps/client/src/components/ExportModal.tsx:295`
`targetDims` e state setado pelo probe, mas nao esta nas deps do `useCallback` de `handleExport` (nem `adData.format`, lido na linha 238). RISCO: o probe detecta 720x1280 (exibido na UI), mas o export roda com o default `{1080,1920}`, fazendo upscale de tudo e desabilitando a otimizacao de resolucao minima — a RES exibida contradiz a saida real. CORRECAO: adicionar `targetDims` e `adData.format` as deps, ou ler as dimensoes de um ref atualizado pelo probe.

**Botao Play fica inerte apos o audio chegar ao fim**
`apps/client/src/hooks/useAudioEngine.ts:213`
No fim, `pause()` grava `pausedTimeRef ≈ durationSec`; o proximo `play()` usa esse offset, todos os clips satisfazem `clipEnd <= startOffset` e sao pulados; o tick ve `t >= durationSec` e re-pausa. `setCurrentTime(durationSec)` nao reseta `pausedTimeRef`. RISCO: apos ouvir a narracao ate o fim, clicar Play de novo nao toca nada e o playhead nao se move; so um seek manual resolve. CORRECAO: no fim, resetar `pausedTimeRef.current = 0` (ou detectar `startOffset >= durationSec` em `play()` e reiniciar do 0).

**`isReady` vira true mesmo quando todos os fetches de audio falham**
`apps/client/src/hooks/useAudioEngine.ts:97`
Cada fetch com falha e so logado e engolido; apos `Promise.all`, `setIsReady(true)` e incondicional. RISCO: backend 3301 fora do ar -> editor marca "pronto", usuario clica Play e nada acontece, sem mensagem de erro. CORRECAO: rastrear se ao menos um buffer carregou e refletir estado de erro na UI; nao setar `isReady=true` sem nenhuma fonte carregada.

**Autosave e console.log da timeline inteira a cada frame de arrasto**
`apps/client/src/components/timeline/TimelineEditor.tsx:263`
O `useEffect` de autosave depende de `[timeline]`; cada `mousemove` gera novo objeto timeline, reexecutando `console.log(timeline)` (273-279) e `updateAdData` (grava no contexto global e provavelmente persiste rascunho) por frame. RISCO: arrastar um clip por 2s dispara ~120 escritas + logs do objeto inteiro -> jank visivel e persistencia redundante. CORRECAO: remover os `console.log` de debug e debounce/throttle do autosave (salvar so no `mouseup`/botao Salvar).

**Trim-start nao impede `inSec > outSec`, deixando o clip mudo**
`apps/client/src/components/timeline/TimelineEditor.tsx:352`
`newClip.inSec = Math.max(0, initialIn+change)` sem clamp contra `outSec`; se ultrapassar, `duration` fica negativo, o engine pula o clip e a largura vira 10px. `startSec`/`inSec` clampados a 0 independentemente dessincronizam o offset. RISCO: arrastar o handle esquerdo demais transforma o clip num sliver de 10px que nao toca audio, sem feedback. CORRECAO: clampar `inSec` a `[0, outSec-minLen]` e mover `startSec` pelo mesmo delta efetivo.

**mixAudio: erro no stream de origem pendura a requisicao e cacheia arquivo parcial**
`apps/server/src/controllers/audioController.ts:94`
Em `ensureLocalFile`, `response.data.pipe(writer)` so rejeita no `writer 'error'`; erro no meio do stream do axios nunca rejeita, e nao ha timeout. RISCO: URL de musica lenta/abortada trava `/api/audio/mix` indefinidamente e deixa um `ext_music_<hash>.mp3` truncado que `existsSync` considera cacheado para sempre. CORRECAO: `response.data.on('error', reject)`, timeout no axios, `unlink` do parcial em falha e so tratar arquivo finalizado e nao-vazio como cache.

**mixAudio: traversal local + SSRF em `resolveAudioInput`**
`apps/server/src/controllers/audioController.ts:29`
`narrationUrl`/`musicUrl` sao client-controlled; valor relativo -> `path.join(BASE_DATA_PATH, url)` sem containment; qualquer http(s) e baixado server-side. RISCO: `/../../../../etc/passwd` faz o ffmpeg ler arquivo arbitrario (possivelmente exposto via `/mixes`); `http://169.254.169.254/...` faz SSRF. CORRECAO: `path.resolve` + assert de prefixo sob `BASE_DATA_PATH`; allowlist de hosts e bloqueio de faixas privadas/loopback.

**mux/exportHybrid escrevem saida do ffmpeg num caminho totalmente client-supplied**
`apps/server/src/controllers/videoController.ts:154`
`outputPath` (120) e `finalPath` (167) vem do body sem containment; inputs tambem sao caminhos absolutos arbitrarios. RISCO: um caller cross-origin aponta `outputPath` para um documento/config existente e o ffmpeg sobrescreve — clobber de arquivos sensiveis; inputs arbitrarios permitem leitura fora do data dir. CORRECAO: `path.resolve` + prefix-check nas diretorias de dados do app; rejeitar caminhos absolutos/`..` vindos do cliente.

**serverProcess sem handler 'error' -> falha de spawn derruba o main process** (plausivel — confirmar)
`apps/client/electron-main/main.cjs:67`
`startServer()` so anexa `data`/`close`, nunca `error`. RISCO: build de producao sem `resources/server/bundle.js` (ou execPath ruim/EACCES) emite `error`, vira `uncaughtException` e o app trava no boot sem mensagem. CORRECAO: `serverProcess.on('error', err => {...notifica renderer})`, health-check/retry e dialog de erro visivel. Precisa de confirmacao manual do caminho de producao.

**Token de auth gravado em texto claro quando safeStorage indisponivel + descasamento write/read**
`apps/client/electron-main/main.cjs:156`
O comentario promete DPAPI, mas `writeAuthToken` cai para `Buffer.from(token)` plaintext quando `isEncryptionAvailable()` e false; e encrypt/decrypt sao decididos independentemente em write/read (142), entao se a disponibilidade mudar, `decryptString` lanca, e engolido e retorna null. RISCO: o bearer de longa duracao vai em claro para `mileto-auth.bin` (contradiz a garantia); se a criptografia "ligar" depois, o usuario e deslogado silenciosamente. CORRECAO: recusar persistir (ou avisar) quando indisponivel; gravar um marcador de formato/versao no arquivo para distinguir encrypted vs plaintext na leitura.

**Chave de criptografia dos segredos de IA derivada do mesmo tokenSecret dos tokens**
`apps/gateway/src/crypto.js:61`
`encKey = scryptSync(config.tokenSecret, 'mileto-secret-salt', 32)` usa o mesmo segredo que assina os tokens HMAC, com salt hardcoded. RISCO: um unico vazamento de `TOKEN_SECRET` permite simultaneamente forjar token de `super_admin` E descriptografar todas as chaves de API (OpenAI/Fish/ElevenLabs) do banco. CORRECAO: dois segredos independentes (`TOKEN_SECRET` p/ HMAC, `SECRET_ENCRYPTION_KEY` p/ AES), ambos obrigatorios sem default, salt aleatorio por segredo armazenado junto do ciphertext.

**Extensao do upload vem do originalname e o filtro so confia no mimetype**
`apps/server/src/middleware/upload.ts:16`
Filename gravado = `${uuid}${path.extname(originalname)}`; extensao 100% controlada pelo cliente e o `fileFilter` valida so `mimetype` (spoofavel). Uploads sao servidos em `/uploads/`. RISCO: gravar `<uuid>.html` com corpo `<script>...</script>` declarando `image/png` -> acessivel como `text/html`; aberto no renderer (nodeIntegration ligado) vira XSS/RCE, ou XSS armazenado na origem do app. CORRECAO: derivar a extensao de uma allowlist mapeada do mimetype real (magic bytes); servir `/uploads` com Content-Type fixo/`Content-Disposition:attachment` e `X-Content-Type-Options:nosniff`.

**Metricagem de chat ignora o uso real de tokens (inclui reasoning oculto)**
`apps/gateway/src/providers.js:161` (e Gemini 141)
`proxyChat` descarta `data.usage`; a cobranca usa `estimateUnits('chat', chars)=ceil(len/4)`. Para modelos de raciocinio, a OpenAI cobra milhares de tokens de reasoning que nao aparecem no texto e nunca sao contados; input e output tem precos diferentes tratados como iguais. RISCO: tier com `reasoning_effort high` fatura 8000 tokens de raciocinio + saida curta, o gateway conta `(prompt+saida)/4` e subcobra drasticamente. CORRECAO: usar `data.usage.total_tokens` (e `usageMetadata` do Gemini) como unidade real de cobranca.

**Sem chave de idempotencia — retry de rede cobra e chama o fornecedor duas vezes**
`apps/gateway/src/server.js:76`
Nenhum `/v1/*` aceita idempotency key nem deduplica; `debitAndLog` sempre insere e debita. RISCO: gateway processa 200 (Fish cobrada, org debitada) mas a resposta se perde antes do server local gravar o arquivo; o retry, sem cache em disco ainda, refaz -> Fish e org cobradas 2x pelo mesmo audio. CORRECAO: header `Idempotency-Key` por requisicao, gravado com UNIQUE no `usage_ledger`; em conflito, retornar o resultado ja processado sem novo debito nem nova chamada.

**Multiplicador/custo nao-finito propaga NaN e pode corromper o saldo**
`apps/gateway/src/meter.js:42`
`charged = providerCost * multiplier * CREDITS_PER_USD`; `getMultiplier` pode retornar `Number(process.env.RESELL_MULTIPLIER||1.5)` sem checar finitude. Com `charged=NaN`, `balance < charged` e sempre false (a insuficiencia nunca dispara) e `balance = balance - NaN` grava NaN permanentemente. RISCO: `RESELL_MULTIPLIER='1,5'` (virgula) -> a primeira cobranca real de qualquer org quebra o saldo para NaN. CORRECAO: validar `Number.isFinite` na carga do config com fallback seguro e curto-circuitar `priceOf` se `multiplier`/`providerCost` nao forem finitos.

**Object URLs do cache de export nunca sao revogadas**
`apps/client/src/components/VideoSequencePreview.tsx:659`
`extractFrameSync` popula `window._domCaptureBlobCache` (URL->objectURL) e `_exportVideoPlayer` persistentes; nada e revogado e o cache vive no `window` pela sessao toda. RISCO: exportar varios projetos numa sessao acumula object URLs (cada clipe = Blob de dezenas de MB) presos em memoria, crescendo ate reiniciar o Electron. CORRECAO: `URL.revokeObjectURL` + limpar o cache/liberar `_exportVideoPlayer` ao fim de cada export (do ExportModal, no finish/abort), ou escopar o cache a uma unica execucao.

**Leitura de `chat_db.json` corrompido apaga silenciosamente TODO o historico**
`apps/server/src/services/chatService.ts:58`
`readDB()` faz `JSON.parse` em try/catch e, no catch, sobrescreve o arquivo com um DB vazio; `writeDB` usa `writeFileSync` nao-atomico. RISCO: crash/lock transitorio (antivirus/indexador no Windows) durante a escrita deixa o JSON truncado; a proxima leitura destroi pastas, sessoes e mensagens sem log nem backup. CORRECAO: no catch, NAO sobrescrever — renomear para `.corrupt-<ts>` e retornar DB vazio em memoria; gravar de forma atomica (temp + `renameSync`).

**Oraculo de timing no login permite enumeracao de e-mails**
`apps/gateway/src/auth.js:20`
`!user || !verifyPassword(...)` faz o `scryptSync` (lento) rodar so quando o e-mail existe; e-mail inexistente retorna rapido. RISCO: medindo latencia, o atacante distingue contas cadastradas (lento) das nao cadastradas (rapido) — exatamente o que o comentario diz evitar; sem rate-limiting, enumera a base. CORRECAO: sempre rodar um scrypt dummy quando o usuario nao existe (comparar contra hash fixo) e adicionar rate-limiting por IP/e-mail.

**Docker build usa `npm install` e nunca copia o package-lock.json**
`apps/gateway/Dockerfile:8`
`COPY package.json ./` + `RUN npm install --omit=dev` ignora o lockfile commitado, resolvendo versoes frescas no build. RISCO: rebuild meses depois puxa patch/minor mais novos dos `^` ranges, introduzindo regressao (ou dep transitiva maliciosa) em producao sem nada mudar no repo, irreproduzivel a partir do lockfile. CORRECAO: `COPY package.json package-lock.json ./` + `RUN npm ci --omit=dev`.

---

## 🔵 Baixos

**loadProject aplica dados do rascunho sem verificar se o projectId ainda e o mesmo**
`apps/client/src/context/WizardContext.tsx:293` — fetch assincrono chama `applyLoadedDraft` incondicionalmente. RISCO: trocar de projeto durante o fetch (`startNewDraft`) faz o conteudo de 'A' cair na sessao 'B' e ser salvo. CORRECAO: capturar o projectId no inicio e comparar (via ref) antes de aplicar, ou flag de cancelamento no cleanup.

**contextValue nunca memoiza de fato — re-render de todos os consumidores** (plausivel — confirmar)
`apps/client/src/context/WizardContext.tsx:442` — `addCustomVoice/removeCustomVoice/renameCustomVoice` recriados a cada render estao nas deps do `useMemo`; somado a `adData` mudando por tecla. RISCO: digitar no textarea re-renderiza VoiceSelector/MusicLibrary/TimelineEditor a cada tecla, travando a digitacao com muitas vozes. CORRECAO: `useCallback([])` nos tres callbacks e separar `adData` num contexto proprio/seletores. Precisa medir o impacto real.

**login() dispara refreshMe() sem await e engole erros** (plausivel — confirmar)
`apps/client/src/context/AuthContext.tsx:62` — RISCO: um 401 transitorio pos-login roda em background, limpa a sessao e o app pisca de volta ao login sem mensagem. CORRECAO: `await refreshMe()` dentro de `login`.

**Corte Automatico pode duplicar ate 800 takes identicos, cada um um `<video>`**
`apps/client/src/pages/Step2.tsx:542` — RISCO: take curto + narracao longa chega ao teto de 800, centenas de `<video>` montados de uma vez -> travamento/memoria alta. CORRECAO: teto realista (dezenas) ou modelar o loop como metadado `repeatCount` em vez de materializar N takes.

**SFX de CTA dispara em todo mount, incluindo os 5 cards de preview**
`apps/client/src/components/DynamicTitleRenderer.tsx:38` — RISCO: abrir o accordion "Call to Action" monta 5 cards, ~10 `hit.mp3` sobrepostos; SFX ancorado ao mount, nao ao `timeElapsed`. CORRECAO: prop `isPreviewCard`/`disableSound` nos mocks e disparar pelo `timeElapsed` do titulo.

**`isExportingFrame` e setado true mas nunca volta a false**
`apps/client/src/components/VideoSequencePreview.tsx:616` — RISCO: apos um export, o preview interativo fica permanentemente no caminho JS congelado e com transicoes de legenda desabilitadas ate remontar. CORRECAO: `setIsExportingFrame(false)` num `finally` ao fim/abort do loop.

**Mapeamento frame/seek ignora a curva de velocidade em takes remapeados**
`apps/client/src/components/VideoSequencePreview.tsx:685` — `targetLocalTime = trim.start + targetTimeInTake` linear ignora `getPlaybackRateForRemap`. RISCO: com preset 'swoosh', clicar Sync/scrub mostra o frame linear errado (impacto limitado ao seek e ao path legado de export). CORRECAO: integrar a curva (`sourceTimeAtDisplayTime`) ao mapear offset->source.

**Loop de rAF nao e cancelado no unmount enquanto toca**
`apps/client/src/hooks/useAudioEngine.ts:22` — RISCO: desmontar o editor por navegacao durante a reproducao deixa o rAF rodando, com warnings de setState em componente desmontado e leitura de `ctx.currentTime` apos `ctx.close()`. CORRECAO: cleanup com `cancelAnimationFrame` + `stopAll()`.

**`URL.createObjectURL` nunca revogada em cada upload**
`apps/client/src/components/VideoUpload.tsx:17` — RISCO: dezenas de videos grandes acumulam blob URLs retendo os Files em memoria. CORRECAO: `revokeObjectURL` quando `source.url` chega ou quando o take e removido.

**`isPlaying` dessincroniza quando `audio.play()` e rejeitado**
`apps/client/src/components/AudioPlayer.tsx:40` — RISCO: bloqueio de autoplay mostra Pause com audio parado; o proximo clique tenta tocar achando que pausa. CORRECAO: setar `isPlaying` so no `then`, manter false no catch.

**Previas de voz sobrepostas e `onended` limpa o estado da voz errada**
`apps/client/src/components/VoiceSelector.tsx:111` — novo `Audio` a cada clique sem pausar o anterior. RISCO: clicar A e depois B toca ambos; ao fim de A, o `onended` zera o indicador de B. CORRECAO: guardar o `Audio` atual num ref, pausar o anterior, e so `setPlayingVoiceId(null)` se o voiceId que terminou ainda for o atual.

**Escritas fs sincronas nos handlers de export bloqueiam o event loop do main**
`apps/client/electron-main/main.cjs:234` — `appendFileSync`/`writeFileSync` por frame; `export-audio` ja usa async, inconsistente. RISCO: export de 900 frames congela a janela e atrasa todo o IPC. CORRECAO: `fs.promises.writeFile/appendFile` (`await`).

**serverProcess.kill() pode orfanar processos ffmpeg no Windows** (plausivel — confirmar)
`apps/client/electron-main/main.cjs:317` — RISCO: fechar o app no meio de um export deixa `ffmpeg.exe` orfao segurando lock em arquivo temp/saida, quebrando o proximo export. CORRECAO: matar a arvore (`taskkill /T /F`) ou spawnar em job detached; backend limpa filhos no SIGTERM.

**Duplicata morta e divergente do main process do Electron**
`apps/client/electron/main.js:1` — nao referenciado pelo `package.json` (`main: electron-main/main.cjs`); copia ESM antiga (229 linhas) sem `cwd` no spawn, sem auth IPC, sem auto-updater. RISCO: um refactor que repontar o entrypoint reintroduz bugs e faz auth/auto-update sumirem; ou o mantenedor edita o arquivo errado. CORRECAO: deletar `electron/main.js` (e o dir `electron/`).

**Checagem de limite de assentos em addMember nao e transacional (corrida)**
`apps/gateway/src/account.js:47` — le `COUNT` e insere fora de transacao. RISCO: dois `POST /account/team` simultaneos passam ambos na checagem e ultrapassam `max_seats`. CORRECAO: contagem + insert numa transacao com `SELECT ... FOR UPDATE`, ou constraint.

**createOrg aceita initialCredits negativo e sem auditoria**
`apps/gateway/src/admin.js:94` — `Number(initialCredits)||0` aceita negativo e o `credit_event` so e inserido se `>0`. RISCO: org nasce bloqueada com saldo negativo e sem rastro. CORRECAO: rejeitar `<0` (ou clamp) e registrar `credit_event` para qualquer valor `!= 0`.

**Chave da API do Gemini enviada na query string**
`apps/gateway/src/providers.js:137` — `...:generateContent?key=${apiKey}`. RISCO: qualquer proxy/CDN/log de saida grava a chave em texto claro. CORRECAO: header `x-goog-api-key: <key>` e nao logar URLs com o parametro.

**Sem CHECK de saldo nao-negativo em credits nem constraint de kind no ledger**
`apps/gateway/src/db.js:60` — RISCO: um estorno (`addCredits` com amount negativo) sem piso deixa `balance` negativo persistido sem o banco rejeitar; relatorios de overview ficam inconsistentes. CORRECAO: `CHECK (balance >= 0)`, `CHECK`/enum em `usage_ledger.kind` (incluir stt/image/video) e validar amount de estorno contra o saldo.

**tsconfig.app.json orfao — checagens mais estritas nunca rodam**
`apps/client/tsconfig.app.json:1` — nada referencia esse arquivo; `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUncheckedSideEffectImports`, `moduleDetection:force` nunca se aplicam a `src`. RISCO: contribuidor assume garantias que o build nao impoe e escreve codigo que depende delas. CORRECAO: deletar e dobrar os flags no `tsconfig.json`, ou restaurar o layout Vite padrao (`files:[]` + references para app e node).

---

## ⚡ Ganhos rapidos

- Remover a linha `electronVersion: '30.0.0'` do `electron-builder.yml` (uma linha; evita defeitos que so aparecem na build do usuario).
- Deletar `apps/client/electron/main.js` e `apps/client/tsconfig.app.json` orfaos (dead code/config enganoso).
- Remover os `console.log(timeline)` de debug no `TimelineEditor.tsx:273-279`.
- Trocar `exec(\`ffprobe ... "${filePath}"\`)` por `execFile('ffprobe', [...])` no `musicController.ts:48` (fecha o critico de injecao com pouca mudanca).
- Adicionar `pool.on('error', ...)` no `db.js` (uma linha; evita queda do gateway inteiro).
- Tornar `ADMIN_PASSWORD` obrigatorio via `required()` no `config.js` (fecha o default `admin`).
- Aplicar a validacao de `projectId` ja existente em `deleteProject` aos handlers `save`/`getProjectData` e `uploadImage` (copiar 3 linhas).
- Enviar a chave do Gemini no header `x-goog-api-key` em vez da query string.
- Trocar `npm install` por `COPY ... package-lock.json` + `npm ci` no `Dockerfile`.
- Normalizar acentos no check de narracao-padrao (`gatewayNarration.ts` e `fishAudio.ts`) para parar de cobrar credito no demo.

## 🏗️ Observacoes de arquitetura

- **O servidor local (3301) confia em "localidade" como se fosse seguranca.** A combinacao de `cors({origin:true, credentials:true})` sem auth + validacao de caminho/host ausente transforma cada bug local (proxy, uploads, projects, mux, stt, music) em superficie explotavel por qualquer site aberto no navegador. A correcao estrutural e uma so: **restringir CORS a origem do Electron e exigir um segredo/sessao nas rotas que tocam disco/rede/ffmpeg** — isso reduz drasticamente o raio de explosao de quase todos os achados de servidor de uma vez. Em paralelo, centralizar um helper `assertInsideDataDir(path)` e um `assertAllowedHost(url)` e usa-los em todos os resolvers (stt, audio, video, proxy) elimina a classe inteira de path-traversal/SSRF.

- **O gateway trata a cobranca como pos-fato, nao como reserva.** O padrao "chama o fornecedor -> depois debita" e a raiz de dois problemas de dinheiro (drenagem por saldo 0 e cobranca em duplicidade por retry) e a precificacao flat por provedor e a raiz do prejuizo por token. O caminho estrutural e um modelo **reserve-then-confirm** com tabela de custo por `(provider, model)`, uso real de tokens (`data.usage`) e `Idempotency-Key` com UNIQUE no ledger. Enquanto isso nao existe, o negocio esta exposto tanto a abuso quanto a margem negativa silenciosa.

- **Resiliencia e um tema transversal ausente.** No gateway (Express 4), handlers async sem `try/catch` + falta de error-middleware + Pool sem `on('error')` significam que qualquer oscilacao de DB pendura requisicoes ou derruba o processo. No cliente/servidor local, `fetch`/`node-fetch` sem `AbortController` significa que qualquer conexao muda trava login/chat/export para sempre. Sao dois padroes globais (um `asyncHandler` + error-middleware no gateway; um `fetchWithTimeout` compartilhado no cliente e no `gatewayClient`) que fechariam ~6 achados juntos.

- **Divida de ciclo de vida de recursos no renderer.** Object URLs (export cache, upload), loops de `requestAnimationFrame`, elementos `<audio>`/`<video>` e flags de export (`isExportingFrame`) sao criados mas nunca liberados/resetados. Falta uma disciplina de cleanup (revogar URLs, cancelar rAF, resetar flags em `finally`/`unmount`). Individualmente baixos, somados degradam a sessao longa do Electron ate exigir reinicio.

- **Duplicacao e "dead config" geram divergencia perigosa.** Dois main processes do Electron, dois tsconfig, e a mesma heuristica de narracao-padrao bugada copiada em dois servicos (`gatewayNarration.ts` e `fishAudio.ts`) mostram um padrao de copiar-colar sem fonte unica. Consolidar cada par (deletar o morto, extrair a heuristica compartilhada) reduz o risco de corrigir so metade de um bug no futuro.