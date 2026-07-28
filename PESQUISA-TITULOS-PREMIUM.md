# Pesquisa e direção de arte — Títulos Premium

Data: 2026-07-27  
Aplicação: Mileto AI Video · etapa 4, Ganchos e Títulos

## Objetivo

Transformar o seletor de títulos em uma biblioteca de peças prontas para uso real em anúncios, conteúdo social, campanhas e vídeos institucionais. A coleção deve ajudar a comunicar hierarquia, intenção e ritmo — não apenas trocar fonte, cor e borda.

## Princípios usados na curadoria

1. **Leitura em menos de um segundo.** O título precisa sobreviver a vídeo em movimento, tela pequena e enquadramento vertical.
2. **Uma ideia visual por modelo.** Cada preset tem uma função reconhecível: interromper, vender, informar, validar, criar urgência ou posicionar marca.
3. **Hierarquia antes de decoração.** Contraste, escala, peso, blocos e ritmo guiam a leitura; efeitos entram como apoio.
4. **Movimento curto e intencional.** Entradas de aproximadamente 350–600 ms, com saída sincronizada ao tempo do título, evitam aparência amadora.
5. **Paletas controladas.** Cada modelo nasce com duas cores coerentes, mas continua personalizável pelo usuário.
6. **Composição responsiva.** Os modelos foram desenhados para frases curtas e para caber no preview sem depender de assets externos.
7. **Compatibilidade de exportação.** As animações são calculadas pelo tempo do projeto, preservando o mesmo resultado no preview e na renderização.

## Biblioteca implementada

### Impacto Social

- **Kinetic Punch:** palavra-chave maciça, sombra gráfica e sublinha animada.
- **Sticker Pop:** adesivo inclinado para reações, dicas e chamadas rápidas.
- **Marker Swipe:** marca-texto progressivo com leitura limpa.
- **Split Block:** frase dividida em dois blocos de entrada sequencial.
- **Outline Echo:** eco tipográfico controlado para energia e profundidade.
- **Creator Caption:** cartela compacta de opinião, fala ou ponto de vista.

### Vendas & Conversão

- **Sale Spotlight:** oferta central com selo e alto contraste.
- **Price Tag Pro:** etiqueta comercial para preço, desconto ou condição.
- **Urgency Pulse:** alerta de prazo, lote ou escassez com pulso discreto.
- **Coupon Ticket:** cupom destacável com código evidente.
- **Benefit Badge:** benefício validado em cartela de confiança.
- **Product Launch:** lançamento tecnológico com acabamento de campanha.

### Editorial & Marca

- **Luxury Editorial:** serifa, filetes e ritmo de campanha premium.
- **Swiss Modern:** grid suíço, índice e composição assimétrica.
- **Glass Prism:** painel de vidro com reflexo e profundidade.
- **Cinema Chapter:** cartela cinematográfica para narrativa e cases.
- **Magazine Stack:** capa editorial com palavras empilhadas.
- **Chrome Future:** acabamento metálico para tecnologia, moda e automóveis.

## Sistema tipográfico

- Impacto: Archivo Black, Anton e League Spartan.
- Clareza comercial: DM Sans e Space Grotesk.
- Marca/editorial: Playfair Display, Montserrat e Bebas Neue.
- Todas as fontes possuem uma pilha de segurança local para manter legibilidade quando a fonte online não estiver disponível.

## Movimento e sincronização

Os modelos usam cinco gramáticas simples: subida, queda, deslocamento lateral, pop elástico e revelação progressiva. O movimento é calculado a partir de `timeElapsed` e `durationSec`; portanto, não depende de uma animação CSS solta que poderia ficar dessincronizada da exportação.

## Critério para novos modelos

Um novo modelo só deve entrar se responder “sim” a estes pontos:

- Resolve uma intenção que os presets atuais ainda não resolvem?
- Continua legível sobre footage claro e escuro?
- Funciona com texto real em português, inclusive acentos?
- Possui estado inicial, estado final e saída coerentes?
- É visualmente diferente sem depender de excesso de efeitos?
- Pode ser reproduzido com consistência no preview e na exportação?

Se a diferença for apenas uma nova combinação de cor, borda ou sombra, ela deve virar variação de um modelo existente, não um novo preset.

## Referências de produto e motion design

- Adobe Premiere Pro — Motion Graphics e títulos: https://helpx.adobe.com/ph_fil/premiere-pro/how-to/impressive-motion-graphics.html
- Adobe Premiere Pro — camadas, propriedades e animação de gráficos: https://helpx.adobe.com/ph_fil/premiere-pro/how-to/essential-graphics-panel.html
- Adobe Premiere — animações modernas e Typewriter: https://helpx.adobe.com/uk/premiere/desktop/add-video-effects/types-of-effects/animations.html
- Apple Motion — comportamentos de sequência e animação de texto: https://support.apple.com/en-asia/guide/motion/motn17692a95/mac
- Apple Motion — previews animados para seleção de comportamentos: https://support.apple.com/guide/motion/browse-for-behaviors-motn1374768e/mac
- Canva — famílias de animações de texto e personalização: https://www.canva.com/features/text-animations/
- Canva Design School — uso de typewriter, wipe, camadas e trajetórias: https://www.canva.com/learn/how-to-use-text-effects-animations/
- CapCut — templates, contraste, cor, tamanho e uso moderado de animação: https://www.capcut.com/create/animated-text-maker
