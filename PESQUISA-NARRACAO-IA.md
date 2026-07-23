# Pesquisa — Narração por IA realista em pt-BR

> **Data:** 22 de julho de 2026
> **Método:** 108 agentes de pesquisa · 26 fontes · 130 afirmações extraídas · 25 submetidas a verificação adversarial em 3 votos independentes · **13 confirmadas, 12 refutadas**
> **Relatório visual:** https://claude.ai/code/artifact/4c2fe861-4841-4b26-bfe7-7255d2d5207c
> **Pergunta:** como colocar um gerador de narração por IA realmente realista, expressivo e "animado" (som humano, com emoção) em pt-BR, num app Electron que roda **localmente** no PC do usuário.

---

## ⚠️ Antes de tudo: o limite que atravessa o relatório inteiro

**Não existe benchmark público que meça qualidade de TTS em português brasileiro.**

O único ranking quantitativo disponível (Artificial Analysis) avalia **exclusivamente inglês** — não tem filtro por idioma nem leaderboard por idioma. Toda comparação de "realismo" aqui é proxy em inglês. A decisão final de fornecedor **só pode sair de um teste cego interno** com os roteiros reais do app.

Além disso: **nada aqui foi testado em áudio.** Tudo é o que a documentação dos fornecedores garante. "Documentado" e "funciona" são coisas diferentes — ver §6.

---

## 1. Diagnóstico: o app não pede nada à IA

O `apps/server/src/services/fishAudio.ts` monta hoje:

```js
body: JSON.stringify({
    text: finalPayloadText,
    reference_id: voiceId,
    format: 'mp3',
    mp3_bitrate: 128,
})
```

Quatro campos, **nenhum de prosódia**. A voz sai no modo neutro padrão do modelo — que é exatamente o que soa robótico.

Outros achados no código:

| Item | Situação |
|---|---|
| `apps/server/src/services/elevenlabs.ts` | **Código morto.** O `ttsController` importa só do `fishAudio`. Está com `stability: 0.5` / `similarity_boost: 0.75` chumbados. |
| `apps/client/src/components/VoiceSelector.tsx` | Só escolhe voz, toca preview e clona. **Zero sliders.** |
| Clonagem via Fish `/model` | Usa `train_mode: 'fast'` — o modo mais rápido e de menor fidelidade. |
| Envio do texto | Roteiro inteiro de uma vez, sem quebra por frase, sem tratamento de números/siglas. |
| Cache | `md5(voiceId + texto)`. **Ao adicionar parâmetros, eles precisam entrar na chave** — senão mudar a velocidade devolve o áudio antigo. |

---

## 2. ✅ CONFIRMADO — A Fish Audio já expõe prosódia (3–0)

**Fontes:** `docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech`, `github.com/fishaudio/fish-speech/issues/1199`

O mesmo endpoint que você já usa aceita um objeto `prosody` opcional (default `null`):

| Campo | Faixa | Default | Doc verbatim |
|---|---|---|---|
| `prosody.speed` | 0.5 – 2.0 | `1` | *"Speaking rate multiplier. 1.0 = normal speed, 0.5 = half speed, 2.0 = double speed."* |
| `prosody.volume` | dB (SDK: −20 a +20) | `0` | *"Volume adjustment in decibels (dB). 0 = no change."* |
| `prosody.normalize_loudness` | bool | `true` | *"Normalize output loudness for more consistent perceived volume.* **S2-Pro only.**" |

E mais, no mesmo corpo de requisição:

| Campo | Faixa | Default |
|---|---|---|
| `temperature` | 0 – 1 | `0.7` |
| `top_p` | 0 – 1 | `0.7` |
| `chunk_length` | 100 – 300 | `300` |
| `min_chunk_length` | — | `50` |
| `normalize` | bool | `true` |
| `latency` | `normal` \| `low` \| `balanced` | `normal` |
| `max_new_tokens` | — | `1024` |
| `repetition_penalty` | — | `1.2` |
| `condition_on_previous_chunks` | bool | `true` |
| `early_stop_threshold` | — | `1` |
| `mp3_bitrate` | 64 \| 128 \| 192 | `128` |
| `references`, `sample_rate` | — | — |

**Por que a confiança é alta:** não é campo "aspiracional" de documentação. Aparece implementado no SDK Python oficial (`TTSConfig(prosody=Prosody(speed=1.2, volume=-5))`), no SDK Go (`Prosody: &fishaudio.Prosody{Speed: 1.2, Volume: -5}`) e na integração Pipecat, que monta literalmente `"prosody": {"speed": ..., "volume": ...}` com docstring *"Volume adjustment in dB (-20 to 20)"*.

A issue #1199 do `fish-speech`, que à primeira vista contradiz, na verdade confirma: ela reclama que o servidor **self-hosted** não expõe `speed`, *"but the Fish Audio cloud API (api.fish.audio) supports a `speed` parameter (range 0.5-2.0)"*.

**Limites conhecidos:**
- `normalize_loudness` é explicitamente restrito ao S2-Pro.
- A doc **não publica** matriz modelo-a-modelo para `speed`/`volume`.
- A doc **não diz** se `speed` é controle de token-rate no modelo ou reamostragem posterior → **a degradação em 0.5× e 2.0× é desconhecida.** Por isso a recomendação de travar o slider antes dos extremos.
- Se o projeto migrar para `fish-speech` self-hosted, **o parâmetro deixa de existir**.

---

## 3. ✅ CONFIRMADO — Como cada fornecedor controla emoção

### 3.1 ElevenLabs — a alavanca é `stability`, e é invertida (3–0)

**Fontes:** `github.com/elevenlabs/skills`, `elevenlabs.io/docs/api-reference/text-to-speech/convert`, `elevenlabs.io/docs/eleven-creative/playground/text-to-speech`

Três fontes primárias independentes dizem o mesmo: **quanto menor o `stability`, mais emoção.**

- Schema oficial da API: *"Lower values introduce broader emotional range for the voice. Higher values can result in a **monotonous** voice with limited emotion."*
- Repo oficial de skills: *"Lower = more emotional variation and expressiveness (but can sound erratic). Higher = steady, predictable tone."*

`GET /v1/voices/settings/default` retorna `stability 0.5`, `similarity_boost 0.75`, `style 0`, `use_speaker_boost true`, `speed 1`. **Ou seja: a config do `elevenlabs.ts` parado no projeto é literalmente o default neutro do fornecedor.** Nunca foi ajustada para soar animada.

As outras alavancas do v2 **não são emocionais**: `similarity_boost` = semelhança com a voz, `use_speaker_boost` = semelhança, `speed` = ritmo. Sobre `style`, a própria ElevenLabs diz: *"In general, we recommend keeping this setting at 0 at all times"* (deixa o modelo *"slightly less stable"*).

**Presets oficiais por caso de uso** (2–1 — repo first-party, não corroborável no site):

| Preset | `stability` | `similarity_boost` | `style` |
|---|---|---|---|
| Personagem / dramático | 0.30 | 0.80 | 0.50 |
| **Conversacional** | **0.40** | **0.75** | **0.30** |
| *Default do fornecedor* | *0.50* | *0.75* | *0.00* |
| Narração / audiobook | 0.70 | 0.50 | 0.00 |
| Notícias / profissional | 0.80 | 0.60 | 0.00 |

Para anúncio de vendas, o alvo fica entre conversacional e dramático → **`stability` 0.30–0.45**. Valores agnósticos de idioma; ponto de partida, não ótimo para pt-BR.

> **No Eleven v3 a lógica inverte:** a expressividade passa a vir de *audio tags*, não do slider. Doc: *"Eleven v3 introduces emotional control through audio tags. You can direct voices to laugh, whisper, act sarcastic, or express curiosity."* Aplicar "0.5 = neutro" ao v3 seria **errado**.

### 3.2 ElevenLabs `eleven_multilingual_v2` suporta pt-BR (3–0)

29 idiomas, incluindo *"Portuguese (Brazil, Portugal)"*. Limite de **10.000 caracteres por requisição** (~10 min de áudio). Não está obsoleto — o que foi aposentado em 09/jul/2026 foi o `eleven_monolingual_v1` e o `eleven_multilingual_v1`, e o v2 é o alvo recomendado de migração.

**Ressalva importante:** "variante listada" é listagem de documentação, **não locale selecionável via API**. O Multilingual v2 **não aceita** `language_code` (só Turbo v2.5 e Flash v2.5 suportam forçar idioma). Não existe chave pt-BR vs pt-PT na requisição — **o sotaque brasileiro vem da voz escolhida.**

### 3.3 OpenAI — só direção por texto (3–0)

**Fonte:** `developers.openai.com/api/reference/.../speech/methods/create`

O `POST /v1/audio/speech` enumera exatamente sete campos de corpo: `input`, `model`, `voice`, `instructions`, `response_format`, `speed`, `stream_format`.

- `speed`: *"Select a value from `0.25` to `4.0`. `1.0` is the default."*
- `instructions`: texto livre. *"Does not work with `tts-1` or `tts-1-hd`."*
- **Não há** pitch, stability, style, temperature, top_p nem seed.
- **Nem a referência nem o guia mencionam SSML**, `<prosody>`, `<break>` ou tags entre colchetes.

O guia lista o que dá para dirigir via `instructions`: *"accent, emotional range, intonation, impressions, speed of speech, tone, whispering"*.

> **🚩 Armadilha documentada:** a equipe da OpenAI declarou em 02/05/2025: *"The `speed` parameter is not supported for `gpt-4o-mini-tts` currently. This was a bug in our documentation which has been updated."* Quem reportou disse depois (24/06/2025) que voltou a funcionar. A doc atual não traz ressalva, mas a página do `gpt-4o-mini-tts` não lista `speed` entre os params suportados. **Não confie sem teste empírico.**

Extras: `input` limitado a **4.096 caracteres** (força chunking). Vozes custom existem mas são *"limited to eligible customers"* via contato comercial — **não é substituto drop-in para a clonagem da Fish**.

### 3.4 Azure — o mais granular, e o mais travado em inglês

**Fonte:** `learn.microsoft.com/.../speech-synthesis-markup-voice` (ms.date 2026-01-30, atualizado 2026-06-05)

**`mstts:express-as` tem exatamente 3 atributos (3–0):**

| Atributo | Obrigatório? | Faixa |
|---|---|---|
| `style` | **Sim** | vocabulário por voz |
| `styledegree` | Não | **0.01 – 2** inclusive, default `1`, unidade mínima `0.01` |
| `role` | Não | 8 valores: Girl, Boy, YoungAdultFemale, YoungAdultMale, OlderAdultFemale, OlderAdultMale, SeniorFemale, SeniorMale |

> **🚩 Falha silenciosa:** *"If the style value is missing or invalid, the entire `mstts:express-as` element is ignored and the service uses the default neutral speech."* Sem erro. Armadilha real de integração.

**Faixas de prosódia (3–0)** — úteis como molde para sliders e para o que o ffmpeg deve imitar:

| Propriedade | Faixa | Constantes |
|---|---|---|
| `rate` | **0.5× – 2×** | x-slow 0.5 / slow 0.64 / medium 1 / fast 1.55 / x-fast 2 |
| `pitch` | **0.5× – 1.5×** | x-low 0.55 / low 0.8 / medium 1 / high 1.2 / x-high 1.45 |
| `volume` | 0.0 – 100.0 | default `100.0` |
| `contour` | pares (posição%, delta) | *"doesn't work on single words and short phrases"* |

A doc diz *"should be"*, não *"must"* — valores fora da faixa sofrem **clamping**, não rejeição. Verificado que `prosody` **não** é desativado nas vozes mais realistas (os exemplos oficiais usam `DragonHDLatestNeural`); a única exclusão é `<mstts:voiceconversion>`.

**⚠️ O que sobra em pt-BR (3–0 / 2–1):**

| Recurso | pt-BR? |
|---|---|
| `<emphasis>` por palavra | ❌ *"only available for these neural voices: `en-US-GuyNeural`, `en-US-DavisNeural`, `en-US-JaneNeural`"* |
| `role` | ❌ Toda voz pt-BR marcada *"Roles Not supported"* |
| ~60 styles das vozes Dragon HD | ❌ *"Styles are available on all English content for all voices"* |
| 6 tags paralinguísticas (`laughter`, `coughing`, `throat_clearing`, `breathing`, `sighing`, `yawning`) | ✅ *"available on all voices with all languages"* |
| Vozes neural clássicas pt-BR | ⚠️ Só `pt-BR-FranciscaNeural` tem style (`calm`) |
| **`pt-BR-Caio` · `Luana` · `Pedro` · `Rafael` `:MAI-Voice-2`** | ✅ **angry, excited, happy, hopeful, joyful, sad, shouting, softvoice, surprised, whispering** |

**Conclusão:** a Azure só interessa **por causa das quatro vozes MAI-Voice-2**. Nelas, `style` + `styledegree` funcionam de verdade em português.

---

## 4. Comparativo e custo

| Provedor | Velocidade | Volume | Pitch | Emoção | Preço / 1M |
|---|---|---|---|---|---|
| **Fish Audio** *(atual)* | `0.5–2.0` | dB | — | — | US$ 15 (**bytes**) |
| **ElevenLabs** *(multilingual v2)* | `0.25–4.0` | — | — | `stability` ↓ | US$ 91–166 |
| **OpenAI** *(gpt-4o-mini-tts)* | `0.25–4.0` ⚠️ | — | — | prompt | *não verificado* |
| **Azure** *(MAI-Voice-2)* | `0.5–2×` | 0–100 | `0.5–1.5×` | `styledegree` | *não verificado* |
| **Chatterbox** *(local, MIT)* | ? | ? | ? | ? | grátis |

**Leaderboard (2–1)** — `artificialanalysis.ai/text-to-speech/leaderboard`, snapshot 22/07/2026:

| Rank | Modelo | ELO | ± | Amostras | Preço/1M |
|---|---|---|---|---|---|
| 1 | Alibaba Qwen-Audio-3.0-TTS-Plus | 1.238 | 16 | 1.479 | $27,6 |
| 11 | **ElevenLabs Eleven v3** | 1.172 | 12 | 3.785 | $100,0 |
| 17 | **Fish Audio S2.1 Pro** | 1.138 | 15 | 1.433 | $15,0 |

As faixas de rank publicadas não se sobrepõem (v3 = 9–12; S2.1 Pro = 13–21), então o "supera" se sustenta na modelagem de incerteza deles.

> **🚩 Esse número não serve para decidir.** O arena avalia **só inglês** — prompts de ~500 caracteres em Customer Service / Entertainment / Knowledge Sharing / Assistants, sem dimensão de idioma. Não estabelece nada sobre pt-BR. E o ranking se reembaralha semanalmente; o AA mantém vários boards com números diferentes, então citar a URL exata é obrigatório.

**Duas sutilezas de custo que te afetam:**

1. **A Fish cobra por BYTE UTF-8**, não por caractere. Cada `ã`, `ç`, `é`, `õ` ocupa 2 bytes → o custo real em pt-BR fica **5–10% acima** do preço de tabela.
2. O "$100/1M" do ElevenLabs é o **melhor caso** (plano anual, 80% de utilização). Preços reais: Creator $11/121k = **$90,91/1M**; Pro $99/600k = **$165/1M**; Scale $299/1,8M = **$166/1M**; Business $990/6M = **$165/1M**. Um dev típico paga ~$165 → a diferença real sobe para **~11×**.

---

## 5. Local / offline

Como o app roda no PC do usuário, gerar a voz localmente eliminaria custo por caractere e dependência de internet. **A licença é o filtro que elimina quase tudo.**

### 5.1 ❌ Fish Speech / S2 — proibido empacotar (3–0)

**Fontes:** `fish.audio/s2/`, `huggingface.co/fishaudio/s2-pro/blob/main/LICENSE.md`, `fish.audio/blog/what-we-mean-by-open-source-for-s2/`

Página oficial: *"S2 Pro is licensed under the Fish Audio Research License. Research and non-commercial use is permitted free of charge. **Commercial use requires a separate license from Fish Audio.**"* (contato: business@fish.audio)

Texto integral no HF (*FISH AUDIO RESEARCH LICENSE AGREEMENT*, Last Updated: March 7, 2026): licença limitada apenas para *Research* ou *Non-Commercial Purpose*, definido como *"not primarily intended for commercial advantage or monetary compensation… such as personal use (i.e., hobbyist) or evaluation and testing"*. *Commercial Use* cobre *"creating products/services, internal business operations, or charging fees"*.

**Não há isenção por receita nem por MAU** (diferente do carve-out de 700M MAU do Llama).

O próprio blog da Fish (12/mar/2026) admite: S2 é *"open weights, not open source by the OSI definition"*, e a tabela comparativa marca **"Free commercial use ❌"**.

Histórico: changelog v1.1.1 (08/jun/2024) registra *"License changed to CC-BY-NC-SA 4.0"*; hoje o README do `fish-speech` diz que **código E pesos** estão sob a Research License — a restrição **apertou**.

> ✅ **Isso NÃO afeta o uso atual via `api.fish.audio`**, que roda sob ToS comercial de API paga. A restrição só morde se os pesos forem empacotados no app distribuído.

### 5.2 ✅ Chatterbox — única opção viável (3–0)

**Fontes:** `github.com/resemble-ai/chatterbox`, `huggingface.co/ResembleAI/Chatterbox-Multilingual-pt-br`

- **Licença MIT** — arquivo LICENSE é o template padrão, *"Copyright (c) 2025 Resemble AI"*, **sem rider non-commercial, sem acceptable-use addendum**. Único texto de uso no card é a linha não vinculante *"Don't use this model to do bad things."*
- **Pesos reais publicados**, não roadmap: `ResembleAI/Chatterbox-Multilingual-pt-br`, criado 22/04/2026, modificado 10/06/2026, com `t3_pt_br.safetensors` (T3 finetunado em pt-BR), `s3gen_v3.safetensors` e tokenizer `grapheme_mtl_merged_expanded_v1.json`. Descrito como *"a dedicated single-language finetune in the Chatterbox Multilingual V3 Single Language Pack"* para quem quer *"tighter Brazilian Portuguese quality control"*.
- Multilingual V3: 23 idiomas, campo `language_id` (`generate(text, language_id="pt")`).

> **🚩 O detalhe que pode inviabilizar:** todo áudio sai com **marca d'água neural Perth embutida**, que segundo o model card *"survive[s] MP3 compression, audio editing, and common manipulations"*. **MIT não remove isso.** E MIT também não resolve consentimento / direito de imagem-voz na clonagem.

**Não verificado:** qualidade real do áudio pt-BR (o repo HF marca downloads = 0, sem sinal de tração) e requisitos de hardware.

### 5.3 Alternativas

| Modelo | Licença | pt-BR | Veredito |
|---|---|---|---|
| **Piper** | MIT | `pt/pt_BR/` | Roda em CPU, mas qualidade menor e **sem clonagem** zero-shot. |
| **Kokoro-82M** | Apache-2.0 | `pf_dora`, `pm_alex`, `pm_santa` | Voice packs sobre modelo compartilhado, fonemização via espeak-ng — mais "pt multilíngue genérico". |

---

## 6. Controles recomendados para a UI

Faixas **recomendadas** são mais estreitas que as máximas da API — de propósito, porque os extremos são território sem garantia de qualidade do fornecedor.

| Controle | Campo | Faixa API | **Recomendado** |
|---|---|---|---|
| Velocidade | `prosody.speed` | 0.5 – 2.0 | **0.80 – 1.25×** |
| Volume | `prosody.volume` | −20 a +20 dB | **−5 a +5 dB** |
| Expressividade | ElevenLabs `stability` | 0.0 – 1.0 | **0.30 – 0.45** ⚠️ invertido |
| Intensidade do estilo | Azure `styledegree` | 0.01 – 2 | **0.75 – 1.50** |
| Tom / pitch | Azure `prosody pitch` | 0.5 – 1.5× | só Azure, ou ffmpeg |

**Onde cada controle é implementado:**

| Controle | Via API | Precisa de pós-processamento |
|---|---|---|
| Velocidade | ✅ Todos (Fish, ElevenLabs, OpenAI, Azure) | não |
| Volume / loudness | ✅ Fish, Azure | não |
| Energia / emoção | ✅ ElevenLabs, Azure | impossível fora da API |
| **Tom / pitch** | ⚠️ Só Azure | ffmpeg, se ficar na Fish |
| **Pausas entre frases** | ❌ Nenhum | quebrar por frase + inserir silêncio |
| **Ênfase em palavra** | ❌ Nenhum em pt-BR | só engenharia de texto e pontuação |

> **Honestidade sobre as duas últimas linhas:** pausas e ênfase **não têm caminho de API em português em nenhum** dos fornecedores verificados. `<emphasis>` da Azure é limitado a 3 vozes en-US, a OpenAI não documenta SSML, e as supostas tags inline da Fish foram refutadas duas vezes. Resta pontuação e quebra de texto.

---

## 6-B. 🔺 CORREÇÃO — 22/07/2026, mesmo dia

> **A pesquisa ERROU sobre as tags de emoção da Fish Audio.** Verificado depois, direto nas
> fontes primárias e **testado empiricamente na API**.

**O que é verdade:**

1. O modelo vai num **header HTTP `model`**, não no corpo da requisição. O app não enviava esse
   header, então usava o modelo padrão legado.
2. O changelog oficial diz, verbatim: *"S2 introduces `[bracket]` syntax for natural language
   control over emotion and paralinguistic cues (e.g., `[whisper]`, `[laugh]`, `[emphasis]`)"*.
   A página do produto lista `[pause]`, `[emphasis]`, `[laughing]`, `[excited]`, `[whisper]`,
   `[singing]` e descrições livres como `[whisper in small voice]` ou `[professional broadcast tone]`.
3. **Existe um modelo gratuito**: `s2.1-pro-free`, sem custo e sem limite de caracteres,
   com clonagem por `reference_id`. Sem SLA, dados podem ser retidos para treino, e a
   página diz "available through July 2026" — **prazo a monitorar**.

**Por que os verificadores refutaram (falso negativo):** a *referência da API* em
`docs.fish.audio` documenta só os campos do corpo — e tags não são um campo, são conteúdo do
`text`. Quem checou a referência não achou e refutou. A capacidade está documentada no
changelog e na página do produto.

**Teste empírico feito** (mesmo texto, só mudando a tag, modelo `s2.1-pro-free`):

| Entrada | Duração |
|---|---|
| `Compre agora mesmo o seu produto hoje.` | 3,21 s |
| `[excited] Compre agora...` | 3,50 s |
| `[whisper] Compre agora...` | 3,32 s |
| `banana Compre agora...` *(controle: palavra falada)* | **4,02 s** |

Uma palavra falada custa **+0,81 s**. As tags custam +0,11 a +0,29 s — ou seja,
**não estão sendo lidas em voz alta, estão sendo consumidas como instrução.**

**Ressalva que continua de pé:** duração prova que a tag não é falada; **não** prova que a
emoção saiu correta. Isso exige escuta humana.

**Conclusão corrigida:** a afirmação "a Fish Audio não tem controle de emoção" era **falsa para o
S2** e verdadeira apenas para o modelo legado que o app usava por omissão.

### Vocabulário oficial completo — 66 tags

Fonte: https://docs.fish.audio/developer-guide/core-features/emotions (conferido 22/07/2026)

| Grupo | Tags |
|---|---|
| **Emoções básicas (24)** | happy · sad · angry · excited · calm · nervous · confident · surprised · satisfied · delighted · scared · worried · upset · frustrated · depressed · empathetic · embarrassed · disgusted · moved · proud · relaxed · grateful · curious · sarcastic |
| **Emoções avançadas (25)** | disdainful · unhappy · anxious · hysterical · indifferent · uncertain · doubtful · confused · disappointed · regretful · guilty · ashamed · jealous · envious · hopeful · optimistic · pessimistic · nostalgic · lonely · bored · contemptuous · sympathetic · compassionate · determined · resigned |
| **Tom (6)** | hurried *(ou `[in a hurry tone]`)* · shouting · screaming · whispering · soft tone · emphasis |
| **Efeitos sonoros (11)** | laughing · chuckling · sobbing · crying loudly · sighing · groaning · panting · gasping · yawning · snoring · clear throat |
| **Especiais** | audience laughing · background laughter · crowd laughing · break · long-break |

**Regras oficiais:**

- **Sintaxe muda por modelo:** S2 usa **colchetes** `[happy]`; o **S1 legado usa parênteses** `(happy)`.
- Emoção de frase funciona melhor **no começo da frase**. Tom e efeitos podem ir em qualquer lugar.
- `[emphasis]` vai **imediatamente antes** da palavra: `This is [emphasis] really important.`
- **Empilhamento:** `[sad][whispering]`, `[excited][laughing]` — **máximo 3 por frase**.
- **Modificadores de intensidade:** `[slightly sad]`, `[very excited]`, `[extremely angry]`.
- **Descrição livre** aceita, mas curta: `[professional broadcast tone]`, `[whisper in small voice]`.
- ✅ **PORTUGUÊS É OFICIALMENTE SUPORTADO.** A doc lista 13 idiomas que aceitam as marcações,
  e Portuguese está entre eles. **Isso derruba a ressalva de "sem evidência para pt-BR"** que
  aparece no resto deste documento no que diz respeito a tags.
- 💰 **As tags não são cobradas:** *"Emotion markers don't count toward token limits"*. Sem
  latência adicional.
- **Avisos oficiais:** não abusar em texto curto; não misturar emoções conflitantes; não escrever
  descrições longas nos colchetes. Risada escrita como "Ha, ha, ha" já funciona sem tag.

> O vocabulário vive em código em `apps/server/src/services/miletoSystemPrompt.ts`, que alimenta
> o system prompt do Chat Mileto. Se a Fish mudar a lista, é lá que se atualiza.

---

## 7. ❌ REFUTADO — não construir em cima disso

Cada afirmação foi submetida a **3 verificadores independentes instruídos a refutá-la**. Estas caíram. Várias são exatamente o tipo de coisa que se lê em blog e se implementa sem conferir.

| Voto | Afirmação | Por que importa |
|---|---|---|
| ~~0–3~~ **REVERTIDO** | ~~Fish S2 aceita tags inline `[whisper]`, `[excited]`, `[laughing]`~~ | 🔺 **Esta refutação estava ERRADA.** Ver §6-B: confirmado no changelog oficial e testado na API. Era falso negativo — os verificadores checaram a referência da API, onde tags não aparecem por não serem um campo. |
| **0–3** | `temperature` é o botão de expressividade da Fish | O **campo existe** (default 0.7). A **semântica emocional** é que não está estabelecida em lugar nenhum. |
| **0–3** | Fish classifica português como "Tier 2", não Tier 1 | Seria argumento forte para trocar de fornecedor. Não se sustenta. |
| **0–3** | Trocar a string do modelo de S1 → S2.1 Pro dá ganho de graça (S1 = rank 40, ELO 1.068) | Caiu como claim isolada, **apesar** de um verificador ter transcrito rank 40 / ELO 1.068 independentemente. **É a hipótese de maior alavancagem do relatório e a mais barata de testar.** |
| **0–3** | Chatterbox expõe `exaggeration` e `cfg_weight`, ambos default 0.5 | Deixa o projeto **sem nenhum dado verificado** sobre knobs de emoção no TTS local. |
| **0–3** | Chatterbox-Nano roda a 3× tempo real em 8 núcleos de CPU, sem GPU | Requisito **decisivo** para app distribuído a PCs Windows quaisquer — e sem dado por trás. |
| **0–3** | Modelos open-weights ficam muito abaixo dos líderes cloud (Kokoro 1.057, Chatterbox 1.011, XTTS v2 914, StyleTTS2 886) | O gap local × cloud **também não está estabelecido**. |
| **0–3** | Eleven v3 tem cap de 5.000 chars e 70+ idiomas incluindo português | Tratar como **incerto**. |
| **1–2** | `normalize` da Fish só cobre inglês e chinês | Se fosse verdade, números/datas em pt-BR precisariam ser expandidos no cliente. **Vale testar com "R$ 1.499,90" e "24h".** |
| **1–2** | `voice_settings` do ElevenLabs tem exatamente 5 campos | A lista pode ser maior. Conferir o schema na hora de implementar. |
| **1–2** | `instructions` da OpenAI só funciona no `gpt-4o-mini-tts` | A doc confirma que não funciona em `tts-1`/`tts-1-hd`, mas a exclusividade afirmada não passou. |
| **1–2** | Fish S2 (mar/2026, `s2-pro`) introduz sintaxe de tags `[bracket]` | Variante mais fraca da primeira linha. Também caiu. |

### 🔶 Contradição não resolvida entre verificadores

Um verificador afirma que o **Eleven v3 restringe `stability` a três valores discretos** — Creative `0.0`, Natural `0.5`, Robust `1.0` — e não suporta `similarity_boost`, `speed` nem speaker boost. Outro procurou especificamente por essa restrição em fontes first-party e **não encontrou nenhuma**, com o repo de skills mostrando `stability` contínua com `model_id="eleven_v3"`.

**Isso muda o desenho dos sliders** se o projeto for para o v3: slider contínuo ou três botões.

---

## 8. 🕳️ Lacunas — o que a pesquisa NÃO entregou

Das 8 perguntas do levantamento, **três voltaram praticamente vazias**. Registrado para não se assumir cobertura inexistente.

| Tema | Situação |
|---|---|
| **Preços e rate limits** | Só ElevenLabs e Fish confirmados. **Sem dados** de OpenAI, Azure, Gemini TTS, PlayHT, Cartesia, Hume, MiniMax, Speechify, Rime, Inworld. Sem custo estimado por narração de 30–60s. |
| **Pós-processamento ffmpeg** | **Zero claims sobreviveram.** Nada sobre `loudnorm`, EBU R128, −14 LUFS, `atempo` × `asetrate`, rubberband, crossfade entre blocos, concatenação sem clique. |
| **Engenharia de texto pt-BR** | **Zero claims.** Nada sobre normalizar números/moeda/siglas, chunking por frase, seed/consistência entre chunks. |
| **Jurídico brasileiro** | **Zero claims.** Nada sobre LGPD, direitos de personalidade sobre a voz, CONAR, consentimento escrito ou obrigação de disclosure de voz sintética. |
| **Demais provedores** | Gemini TTS, PlayHT, Cartesia Sonic, Hume, MiniMax, Speechify, Rime e Inworld ficaram sem nenhuma afirmação sobrevivente. |

> ### 🚨 A lacuna mais séria
> O app **já oferece clonagem de voz por gravação de microfone e upload** (`VoiceSelector.tsx` → `POST /api/tts/clone-voice`), e **não há uma linha verificada** sobre o que a lei brasileira exige disso em uso comercial. Isso merece **pesquisa jurídica dedicada** antes do recurso ser usado em campanha de cliente. Não é uma questão técnica.
>
> Fonte adjacente encontrada mas **não verificada**: `migalhas.com.br/depeso/444941/ia-e-apropriacao-protecao-da-imagem-voz-e-lgpd-para-atores-no-brasil`

---

## 9. Plano recomendado

### Passo 1 — Ligar a prosódia da Fish · risco zero
Enriquecer o payload em `fishAudio.ts`, **incluir os parâmetros na chave do cache md5**, e expor dois sliders na tela de voz: velocidade (0.80–1.25×) e volume (−5 a +5 dB). Não muda fornecedor, não muda custo, e é a única mudança que não depende de nada não verificado.

### Passo 2 — Testar S2.1 Pro contra S1 · ~1 hora
Mesma API, só trocar o modelo. A claim de "ganho de graça" foi refutada 0–3, mas continua sendo **a hipótese de maior alavancagem** do levantamento. Gerar o mesmo roteiro nos dois e ouvir.

### Passo 3 — A/B cego com roteiros reais · decisivo
Como não existe benchmark de pt-BR, **o teste tem que ser interno**. Pegar 5–10 roteiros reais do app e comparar às cegas:
- Fish S2.1 Pro com `prosody` ajustada
- ElevenLabs `multilingual_v2` com `stability` 0.35–0.45
- ElevenLabs v3 com audio tags
- Azure `pt-BR-Caio` / `Luana:MAI-Voice-2` com `express-as` + `styledegree`

### Passo 4 — Só então decidir sobre local · depende do passo 3
Chatterbox pt-BR só vale investigação se o custo por caractere virar problema real de escala. E antes de qualquer linha de código: decidir se a **marca d'água Perth** em todo áudio é aceitável para anúncio de cliente.

---

## 10. Fontes

**Primárias — documentação de fornecedor, LICENSE files, model cards:**

- https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
- https://docs.fish.audio/developer-guide/getting-started/changelog
- https://fish.audio/s2/ · https://fish.audio/developers/
- https://huggingface.co/fishaudio/s2-pro/blob/main/LICENSE.md
- https://elevenlabs.io/docs/overview/models
- https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices
- https://elevenlabs.io/pricing/api · https://elevenlabs.io/terms-of-use
- https://github.com/elevenlabs/skills/blob/main/text-to-speech/references/voice-settings.md
- https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
- https://developers.openai.com/api/docs/models/gpt-4o-mini-tts
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice
- https://github.com/resemble-ai/chatterbox
- https://huggingface.co/ResembleAI/Chatterbox-Multilingual-pt-br
- https://huggingface.co/coqui/XTTS-v2
- https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
- https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md

**Benchmark:**
- https://artificialanalysis.ai/text-to-speech/leaderboard *(só inglês, volátil)*

**Adjacentes — encontradas mas com pouca ou nenhuma claim verificada:**
- https://ffmpeg.org/ffmpeg-filters.html
- https://github.com/slhck/ffmpeg-normalize/blob/master/README.md
- https://developers.deepgram.com/docs/tts-text-chunking
- https://docs.inworld.ai/tts/capabilities/long-text-input
- https://github.com/traderpedroso/xphoneBR *(fonemização pt-BR)*
- https://github.com/k2-fsa/sherpa-onnx *(runtime ONNX para TTS local)*
- https://til.simonwillison.net/electron/python-inside-electron *(empacotar Python no Electron)*
- https://www.migalhas.com.br/depeso/444941/ia-e-apropriacao-protecao-da-imagem-voz-e-lgpd-para-atores-no-brasil

---

*Preços, IDs de modelo e posições de ranking mudam sem aviso. Nada neste documento foi testado em áudio.*
