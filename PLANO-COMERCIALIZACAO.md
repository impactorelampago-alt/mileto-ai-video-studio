# Plano de comercialização — Mileto AI Video

> **Data:** 22 de julho de 2026
> **Método:** pesquisa multi-agente com verificação adversarial das afirmações de custo, taxa e obrigação legal.
> **Escopo:** transformar o app interno em produto vendável.
> Complementa [PESQUISA-NARRACAO-IA.md](PESQUISA-NARRACAO-IA.md).

---

## 1. Veredito: sim, VPS — mas não pelo motivo que parecia

**Você precisa de servidor por UM motivo: as chaves de IA não podem morar no computador do cliente.**

Controle de usuários, financeiro e landing page são consequências baratas de já ter a máquina ligada — não são a justificativa. Isso importa porque **muda o que se constrói primeiro**: se a justificativa fosse "painel administrativo", você começaria por CRUD de usuários e gráficos de faturamento, gastaria dois meses e não teria vendido nada. Pela justificativa correta, a v1 do servidor tem **três endpoints e uma tabela**.

### Vai para a VPS

| Componente | Por quê |
|---|---|
| **Gateway de IA** — proxy autenticado para Fish Audio, ElevenLabs, OpenAI, Gemini, Replicate, Runway | Chaves em variável de ambiente da VPS, nunca mais tocam o cliente. **Isto é o produto.** |
| **Autenticação por licença** — ativação, refresh token, fingerprint de máquina, kill switch | Sem isso não existe cliente, só instalador |
| **Ledger de consumo** — créditos debitados por chamada, em Postgres | Alinha o que você cobra ao que você paga |
| **Webhook de pagamento** | Ativa e revoga licença automaticamente |
| **Painel admin mínimo** — listar licenças, ver consumo, revogar, resetar máquina | Uma página. Não é um produto. |

### NÃO vai para a VPS

| Componente | Onde fica | Por quê |
|---|---|---|
| **Renderização de vídeo** (FFmpeg + `h264_qsv`) | 100% no cliente | Maior vantagem de custo e a razão de ser desktop. Encoding no servidor te põe em concorrência direta com ferramentas web, gastando GPU que você não tem. **Nunca mova isso.** |
| Timeline, cortes, transições, preview | Local | Latência zero, funciona offline, custo marginal zero |
| Projetos, rascunhos, biblioteca de músicas | AppData local | Não crie obrigação de LGPD para guardar arquivo que o cliente já tem |
| **Cache MD5 de narração** (`fishAudio.ts`) | Local, e **priorize** | Cada acerto de cache é uma síntese que você não paga. A chamada só sai da máquina se o hash não existir em disco. |
| Servidor Express local :3301 | Continua existindo | Deixa de chamar `api.openai.com` e passa a chamar seu gateway. Vira cliente burro, não desaparece. |
| **Áudio gerado, permanentemente** | Em lugar nenhum no servidor | Guardar voz de cliente cria obrigação de LGPD sem gerar receita. Exceção: buffer de 24h para idempotência de retry. |
| Landing page | Cloudflare Pages, estático, grátis | Pico de tráfego de campanha não pode derrubar a geração dos clientes pagantes |
| Financeiro | Painel do gateway de pagamento | Você não vai construir um ERP |

### ⚠️ Achado no código

O `electron-builder.yml` empacota `../server` via `extraResources` — o `resources/server/bundle.js` fica **fora do `app.asar`**, como JavaScript comum em disco, editável no Bloco de Notas.

**Não tente corrigir isso.** Aceite que aquele processo não guarda segredo nenhum, e ponha o segredo na VPS. Corolário prático: a checagem de licença deve viver no `main.cjs` (dentro do asar), nunca no servidor local.

---

## 2. A decisão que muda tudo: BYOK ou você fornece a IA?

**Você fornece a IA. Sem meio-termo no plano principal.**

Hoje existe um **híbrido acidental**: o `WizardContext.tsx` já tem UI de chaves persistida em `localStorage` (ou seja, BYOK) **e tinha uma chave sua como default**. É o pior dos dois mundos — a fricção do BYOK, mais a sua conta pagando por todo mundo que não mexeu em nada.

### Por que BYOK foi descartado

1. **Seu comprador não sabe o que é uma API key, e não vai aprender para comprar seu produto.** Criar conta na OpenAI, na Fish Audio e na Runway, cartão internacional em três sites em inglês, entender rate limit, pagar em dólar com IOF. A conversão morre no onboarding, não na página de preço.
2. **Você vira uma casca.** Se a IA é do cliente, o que você vende é um editor de timeline. Ninguém paga R$197/mês por isso — e seu preço-teto vira "faço no ChatGPT e monto no CapCut".
3. **BYOK te deixa sem defesa contra pirataria.** Com IA do cliente, o crack funciona 100%. Com IA no gateway, um Mileto pirateado é um editor sem IA. **É o caso Adobe:** Photoshop pirata é onipresente, mas Generative Fill não roda nele porque o Firefly é server-side.
4. **Você perde a margem de revenda.** Atacado → varejo com metering transforma custo em receita.

### Formato

Cobre em **créditos Mileto** ("500 narrações e 200 roteiros/mês"), nunca em unidade do fornecedor. Se você billar em "bytes UTF-8 da Fish", trocar de TTS obriga a reprecificar toda a base.

**BYOK sobrevive como escotilha, só no plano Agência**, por dois motivos legítimos: seguro operacional se a VPS cair, e argumento de venda para quem já tem contrato com a OpenAI. **Nunca ofereça BYOK como forma de pagar menos** — se for mais barato, todo mundo migra e você volta a ser uma casca.

---

## 3. Arquitetura

### PC do cliente (Electron, Windows)

```
Renderer (React)  →  IPC  →  main.cjs (dentro do app.asar)
                                 ├── refresh token no safeStorage (DPAPI)
                                 ├── valida license file (Ed25519, chave PÚBLICA)
                                 └── spawn do Express local :3301
                                        ├── cache MD5 de narração  ← dinheiro
                                        ├── FFmpeg + h264_qsv (render local)
                                        └── HTTP → api.seudominio.com.br
```

**Regra:** a checagem de licença vive no `main.cjs`, dentro do asar. O Express local não recebe lógica sensível.

### VPS

Caddy (TLS automático) → gateway Node + Postgres + Redis, tudo em Docker Compose para que migrar de provedor seja uma tarde e não um trimestre.

---

## 4. Roteiro de execução

Escrito para **um** desenvolvedor. Duas fases em paralelo = zero entregue.

### FASE 0 — Contenção (esta semana, inegociável)

**Construir:** nada. Só apagar incêndio.

1. **Revogar** (não substituir) a chave OpenAI `sk-proj-RLqg...` e a da Fish Audio. Estão no histórico do Git — **bots varrem repositórios em minutos**.
2. Checar billing da OpenAI e da Fish procurando consumo que não foi seu.
3. Criar chaves novas em **projetos separados por fornecedor, com teto de gasto rígido**. A OpenAI permite limite por projeto — use. Transforma invasão futura em prejuízo limitado.
4. Remover a chave default do código. *(feito em 22/07/2026)*
5. Abrir processo de **code signing** (Certum OV Cloud, ~US$110/ano). Validação leva 1–3 semanas — a burocracia começa agora e roda em paralelo.
6. Abrir CNPJ se ainda não tem, e contratar contador.

**Critério para passar:** as chaves antigas retornam 401 quando testadas.

### FASE 1 — Gateway v1 (2 a 4 semanas)

- VPS com Caddy, Node, Postgres, Redis em Docker Compose
- Tabelas: `licenses`, `machines`, `usage_ledger`, `terms_acceptances`
- Endpoints: `/auth/activate`, `/auth/refresh`, `/v1/tts`, `/v1/script`. **Só isso.** Imagem e vídeo depois.
- Reserva/commit de cota no Redis, semáforo por provedor, idempotência
- Alerta de anomalia de gasto (consumo diário > 3σ da média do usuário) e kill switch por licença
- No cliente: trocar chamadas diretas por chamadas ao gateway, **mantendo o cache MD5 como primeiro passo**

**Critério:** sua equipe usa o app duas semanas só via gateway, sem nenhuma chave no cliente, e o ledger bate com a fatura do fornecedor dentro de 2%.

### FASE 2 — Licença, cobrança e primeira venda (1 a 2 semanas)

- License file assinado com **Ed25519 via `node:crypto`** (zero dependência), validade offline de 14 dias, renovação silenciosa, chave pública no `main.cjs`
- **3 máquinas** por licença, auto-reset a cada 90 dias, botão de desativar máquina
- Fingerprint tolerante: `MachineGuid` do registro + nome da máquina. **Não** combine MAC + disco + CPU — quebra em troca de placa de rede e vira ticket que custa mais que a licença
- Gateway de pagamento + webhook
- Tela de ativação, e-mail transacional
- **Termos, Política de Privacidade e gate de consentimento de voz** — não é opcional para vender
- Landing estática no Cloudflare Pages

**Critério:** três clientes externos pagantes que não são seus amigos, 30 dias de uso, sem você tocar no banco manualmente.

### FASE 3 — Degradação honesta (1 semana)

- **Offline correto:** sem internet, tudo local continua (abrir projeto, editar, cortar, exportar com narração já gerada). Só IA bloqueia, com mensagem honesta.
- **Nunca** apagar rascunho, travar exportação ou deletar dado por licença expirada. Degrade para modo local e mande e-mail. **Cliente que perde trabalho por causa do seu DRM não volta — no Brasil, vira reclamação pública.**
- Distinguir na UI "servidor fora" de "sua cota acabou"
- Assinar instalador e artefatos do electron-updater
- **Corrigir `electron-builder.yml`:** `electronVersion: '30.0.0'` está inconsistente com a devDependency `electron ^40.6.0`. Ligar os `electronFuses` (`embeddedAsarIntegrityValidation` + `onlyLoadAppFromAsar`) — 15 minutos, higiene contra tampering, **não** anti-pirataria.
- Página de status pública. O suporte que ela economiza paga o servidor.

### FASE 4 — Escala (quando doer, não antes)

Painel de consumo para o cliente (aviso em 80% e 95%), segunda VPS com health-check DNS, endpoints de imagem e vídeo.

### ❌ O que NÃO fazer, em nenhuma fase

**Não invista em ofuscação, bytenode ou "proteção de código-fonte".** O bytecode V8 tem decompilador público no Ghidra desde 2023, e a doc do electron-vite admite que strings sensíveis continuam legíveis dentro do bytecode — não resolveria nem o problema de chave hardcoded. O custo é real (crashes com arrow functions async, `Function.prototype.toString()` quebrado, stack traces inúteis, recompilação a cada bump de Electron) e a proteção comprada é de horas, não semanas.

**Pare de tentar proteger o binário e mova o valor para fora dele.**

---

## 5. Custos e preço

### Custo fixo mensal, fase inicial

| Item | Custo |
|---|---|
| VPS (2vCPU/4GB, 20 TB) | ~R$35 |
| Backup automático | ~R$7 |
| Cloudflare DNS/WAF + R2 até 10 GB | R$0 |
| TLS (Let's Encrypt via Caddy) | R$0 |
| Domínio .com.br rateado | ~R$4 |
| E-mail profissional + transacional | R$0–30 |
| Code signing rateado | ~R$50 |
| Provisão de reajuste de VPS | ~R$12 |
| **Contador** | **R$250–500** |
| **Total** | **~R$400 a R$650/mês** |

> **O contador custa 8× a VPS.** A discussão "Hetzner ou Vultr" é ruído — não gaste uma semana nela.

**Contraintuitivo sobre região:** como Fish Audio, OpenAI e ElevenLabs estão todas nos EUA, o hop dominante é servidor→fornecedor, não cliente→servidor. Uma VPS em São Paulo pode entregar latência ponta-a-ponta **maior**. Meça antes de decidir.

**Custo único:** advogado para Termos + Política + modelo de cessão de voz, **R$3.000 a R$8.000**. Não é opcional.

### Custo variável de IA por cliente

Premissa: PME típica, 40 anúncios/mês com retrabalho ≈ 120 sínteses de ~800 caracteres + 60 roteiros.

| Item | Custo |
|---|---|
| TTS (Fish Audio, US$15/1M bytes UTF-8) | ~US$1,60 |
| Roteiro (modelo nano/flash-lite, **não** o topo de linha) | ~US$0,10 |
| **Subtotal bruto** | **~US$1,70 ≈ R$9,40** |

**A parte que quase todo mundo esquece:** contratar Fish Audio e VPS do Brasil é **importação de serviço**. Incidem IOF-câmbio 3,5%, IRRF 15% sobre a remessa (com gross-up), ISS-importação 2–5% (o contribuinte é você, o tomador), possivelmente PIS/COFINS-Importação 9,25%. Desde 01/01/2026, IBS e CBS também incidem na importação. O gross-up realista vai de +3,5% a **+40 ou +50%**.

**Custo de IA por cliente, posto no Brasil: ~R$13 a R$14/mês.**

### Preço mínimo que fecha a conta

| Linha | R$97/mês | R$197/mês |
|---|---|---|
| Receita | 97,00 | 197,00 |
| Simples Anexo V (15,5%) | −15,04 | −30,54 |
| Gateway (Pix R$1,99 + NFS-e R$0,49) | −2,48 | −2,48 |
| IA com gross-up de importação | −14,00 | −14,00 |
| Infra rateada (100 clientes) | −5,00 | −5,00 |
| Suporte (15 min a R$100/h) | −25,00 | −25,00 |
| **Margem** | **35,48 (36%)** | **119,98 (61%)** |

**Recomendação: R$197/mês no plano principal. Piso absoluto R$149.** Abaixo disso, um cliente pesado ou dois tickets a mais zeram o mês.

> ### 🚫 Licença vitalícia com IA inclusa não fecha
> O cliente paga uma vez e consome para sempre. Com ~R$14/mês de custo variável, o vitalício vira prejuízo recorrente a partir do mês em que a margem inicial se esgota. Se quiser vender vitalício, a IA tem que ser BYOK.

**Fator R:** Anexo V começa em 15,5%; Anexo III, em 6%. Se a folha (incluindo pró-labore) atingir 28% da receita dos últimos 12 meses, você migra. Com R$197 × 100 clientes, ajustar o pró-labore economiza mais de R$1.800/mês. **Assunto de contador** — leve a pergunta pronta.

---

## 6. Jurídico: bloqueadores antes da primeira venda

### 1. Chaves vazadas
Já coberto na Fase 0. Além da exposição financeira, é falha de segurança sob os **arts. 46 a 49 da LGPD** e pesa na dosimetria de qualquer fiscalização futura.

### 2. Consentimento de voz — o maior risco do produto

**A proteção é de produto, não de contrato:**

- Antes de aceitar gravação ou upload para clonagem, exija **aceite ativo** (checkbox desmarcado por padrão) declarando que a voz é do próprio usuário **ou** que ele tem autorização escrita, específica, com prazo, território e finalidade publicitária.
- **Exija o upload do instrumento assinado, não só o checkbox.** O checkbox sozinho é direito de regresso, não defesa — os **arts. 42 e 43 da LGPD** não exoneram você por declaração de terceiro.
- **Registre o aceite com prova:** data, hora, IP, hash do áudio, hash do termo, versão do texto. Quando houver contas, esse log é o ativo jurídico mais valioso do produto.
- **Ofereça modelo de termo de cessão para download dentro do app.** Reduz o risco do cliente, o seu por tabela, e é diferencial competitivo real no Brasil.
- O termo precisa autorizar **expressamente a síntese e a geração de falas que a pessoa nunca proferiu**. Autorização para "gravar minha voz" **não é** autorização para "criar um modelo que fala coisas que eu não falei" — é um segundo consentimento, distinto. E não pode ser perpétuo nem geral: o **art. 11 do Código Civil** e o **Enunciado 4 da I Jornada de Direito Civil** tornam frágil a cessão "perpétua, irrevogável e universal".

### 3. Nota fiscal
Tributação de licenciamento de software está pacificada: incide **ISS, não ICMS** (STF, **ADI 5659** e **ADI 1945**) → documento é **NFS-e municipal**. "Vender por Pix sem nota" inviabiliza venda para agências, que precisam da nota para deduzir despesa.

> ### ⏰ PRAZO DURO: 03/08/2026
> A partir dessa data, documentos fiscais eletrônicos do regime regular passam a ser **rejeitados automaticamente** sem os campos de IBS e CBS. Confirme **hoje** com seu emissor (NFE.io, eNotas, Focus NFe) se a API já devolve esses campos. Alíquotas-teste de 2026: 0,9% CBS + 0,1% IBS, apuração informativa, carga adicional zero. Simples Nacional e MEI têm tratamento distinto — **confirme com contador**.

### 4. Direito de arrependimento
**CDC art. 49**, 7 dias, com meio facilitado e ostensivo (**Decreto 7.962/2013, art. 5º**). Há argumento de que não se aplica a software já ativado, mas não é pacífico, e cláusula que negue o art. 49 é **nula**. Honre com reembolso automatizado — litigar por R$197 em Juizado custa mais que o reembolso.

### 5. Limitação de responsabilidade em duas faixas
Perante **consumidor**, cláusula que exonere responsabilidade por vício é **nula** (**CDC art. 51, I**). Perante **empresa**, teto é válido. Não copie EULA americano com "AS IS, LIABILITY CAPPED AT $50" — perante consumidor brasileiro é nula e você fica sem a proteção que achava ter.

### 6. Transferência internacional (resolver no 1º trimestre)
Enviar roteiro e voz para fornecedores nos EUA e hospedar fora do país é transferência internacional (**LGPD arts. 33 a 36**). A **Resolução CD/ANPD nº 19/2024** aprovou as Cláusulas-Padrão e o prazo encerrou em **23/08/2025** — já é exigível. Declare na Política nomeando **categorias** de destinatários, com anexo versionado dos subprocessadores.

> **Mitigação de arquitetura que vale mais que qualquer cláusula: não retenha o áudio.** Sem persistir amostra de voz, sem logar payload, retenção de 24h só para idempotência — reduz o risco de forma desproporcionalmente maior que o custo de implementar.

---

## 7. Correções da verificação adversarial

Afirmações que **não sobreviveram** e foram corrigidas com fonte primária:

### Stripe Brasil
- ✅ Taxas confirmadas: cartão nacional **3,99% + R$0,39**; internacional +2%; boleto R$3,45; Pix 1,19%; Billing +0,7%. Chargeback R$55.
- ⚠️ **Pix é "invite only"** para contas brasileiras. Não planeje contando com 1,19% antes da liberação por escrito.
- ❌ **Pix + recorrência NÃO funciona.** "O Pix Automático não está disponível no Brasil" (docs.stripe.com/payments/pix). Para assinatura na Stripe BR: cartão é o padrão.
- ❌ **Parcelamento não disponível** no Brasil. Se parcelado for essencial, isso sozinho inviabiliza a Stripe frente a Pagar.me / Mercado Pago / PagSeguro.
- ℹ️ As taxas da Stripe no Brasil já são **líquidas de tributos indiretos** — não faça gross-up sobre os 3,99%.

### Asaas
- ✅ Pix e boleto **R$0,99** nos 3 primeiros meses, **R$1,99** depois. Sem mensalidade nem adesão.
- ✅ Cartão à vista 1,99% + R$0,49 (promo 3 meses) → 2,99% + R$0,49.
- ⚠️ Parcelado são **três faixas**, não intervalo contínuo: 2–6x = 3,49%; 7–12x = 3,99%; 13–21x = 4,29%. **Sem promoção.**
- ✅ **Asaas já opera Pix Automático** (>85% dos bancos desde abr/2026) — vantagem decisiva sobre a Stripe para assinatura.
- ⚠️ É **NFS-e**, não NF-e. R$0,49 por nota emitida.
- ⚠️ "Automaticamente" é **condicional**: exige PJ, inscrição municipal ativa e homologação com o portal da prefeitura.

**Leitura prática:** para assinatura recorrente em reais, com Pix Automático e NFS-e no mesmo lugar, o **Asaas leva** na fase inicial.

---

## 8. Incertezas nomeadas — resolver antes da Fase 1

| # | Incerteza | Por que importa | Como resolver |
|---|---|---|---|
| 1 | **Termos dos 6 fornecedores de IA** sobre uso comercial, revenda e consentimento de voz | Pode invalidar o modelo de negócio na origem. **Indício forte de que o plano gratuito da ElevenLabs proíbe uso comercial** | Ler os ToS atuais e pedir confirmação por escrito ao suporte onde houver dúvida. **Antes da Fase 1.** |
| 2 | **Preço real de Runway e Replicate por geração** | É o único custo variável que pode superar a assinatura inteira. Não foi apurado | Rodar 20 gerações reais medindo na fatura, antes de incluir vídeo generativo em qualquer plano |
| 3 | Modelo `s2.1-pro-free` da Fish diz "available through July 2026" | Hoje é 22/07/2026. Pode acabar a qualquer momento | Monitorar e ter o `s2-pro` pago como fallback já implementado |

---

*Números de taxa, preço e prazo conferidos em 22/07/2026 e mudam sem aviso. Nada aqui substitui consulta a advogado e a contador — as duas contratações estão no caminho crítico.*
