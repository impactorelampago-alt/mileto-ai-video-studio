# Roadmap — Geração de Imagem e Vídeo por IA (adiado para v2)

> **Decisão (23/07/2026):** no **v1 vendável**, a geração de **imagem** e **vídeo** por IA fica
> **desabilitada/oculta** no app. O v1 foca em narração (TTS), chat/roteiros, títulos e legendas —
> todos passando pelo gateway. Imagem e vídeo voltam numa **v2**, já com as APIs trocadas.

## O que muda na v2 (as APIs vão TROCAR)

Hoje o código do app usa **Replicate** (imagem) e **Runway** (vídeo), em BYOK direto no cliente.
Na v2, além de passar pelo gateway (sem chave no cliente), os provedores mudam:

| Recurso | Hoje (BYOK, será removido) | v2 (via gateway) |
|---|---|---|
| **Geração de vídeo** | Runway | **Seedance** (API de geração de vídeo por IA) |
| **Geração de imagem** | Replicate | **Banana / Nano Banana** = modelo de imagem do **Google Gemini** |

## Por que adiar

- Cada geração de imagem/vídeo custa caro e de forma **imprevisível** por chamada — o
  `PLANO-COMERCIALIZACAO.md` já alertou que isso pode estourar a assinatura se não for medido.
- Antes de ligar, é preciso **apurar o custo real por geração** de Seedance e de Banana/Gemini,
  e definir o **multiplicador de cobrança** de cada um (ver aba "Créditos de IA" no super admin).

## O que precisa ser feito na v2

1. **Gateway:** criar `/v1/image` (Banana/Gemini) e `/v1/video` (Seedance), autenticados e medidos
   por crédito, com as chaves só no gateway (aba IA → API). Registrar consumo no `usage_ledger`
   com `kind = 'image'` / `kind = 'video'`.
2. **Cobrança:** a aba **Créditos de IA** do super admin já prevê os multiplicadores de `video` e
   `image` (deixados prontos no v1, mesmo com as features desligadas).
3. **App:** reabilitar a UI de geração de imagem/vídeo, apontando para o gateway com o token, e
   trocar qualquer referência a Replicate/Runway por Seedance/Banana.
4. **Custo:** rodar ~20 gerações reais de cada e medir a fatura antes de precificar (nota do plano).

## Onde está desligado no v1

- Os componentes/telas de geração de imagem e vídeo do app ficam ocultos.
- As chaves `replicate` e `runway` saem do BYOK (removidas junto com as outras).
- O gateway ainda **não** tem `/v1/image` nem `/v1/video` — serão criados na v2.
