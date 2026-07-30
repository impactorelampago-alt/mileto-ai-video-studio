# Melhoria automática de vídeo e nitidez

Decisão registrada em 30/07/2026 para retomada depois da estabilização do agente de IA.

## Objetivo

Adicionar tratamento não destrutivo para melhorar takes de baixa qualidade sem alterar o arquivo original e sem aplicar recompressões intermediárias.

## Escopo acordado

- Ação global **Melhorar automaticamente** para analisar cada take e aplicar correções moderadas de exposição, contraste, cor, redução de ruído e nitidez.
- Controle global de **Nitidez** aplicado a todos os takes.
- Controle de nitidez por take, com precedência sobre o valor global.
- Intensidades iniciais: desligado, suave, médio e forte, com limites seguros contra halos e amplificação excessiva de ruído.
- Comparação rápida **Original / Melhorado** no monitor antes da exportação.
- Ajustes salvos como parâmetros do projeto e aplicados somente no render final.
- Botão para desfazer e restaurar os parâmetros originais.

## Direção técnica

1. Primeira entrega com filtros adaptativos e previsíveis no FFmpeg, mantendo fidelidade de rosto, produto, texto e armações.
2. Detectar resolução, ruído, contraste e exposição para evitar a mesma intensidade em todos os vídeos.
3. Não executar upscale generativo automaticamente.
4. Avaliar posteriormente uma opção separada **Recuperar baixa resolução com IA**, com prévia e aviso de que modelos generativos podem inventar detalhes.

## Critérios de qualidade

- Não criar halos visíveis nas bordas.
- Não acentuar compressão, granulação ou ruído de pele.
- Não alterar cores de marca ou produto sem confirmação.
- Não processar novamente arquivos intermediários.
- Preservar resolução, proporção, FPS e áudio do projeto na exportação.
