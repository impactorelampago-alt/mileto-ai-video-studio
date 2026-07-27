# Gateway do Mileto — imagem de produção para a VPS.
FROM node:24-alpine

WORKDIR /app

# Instala dependências primeiro (cache de camada). `npm ci` respeita o lockfile:
# build reproduzível. `npm install` (antigo) ignorava o lock e podia puxar
# minor/patch mais novos num rebuild meses depois — regressão irreproduzível.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Código
COPY src ./src
COPY migrations ./migrations
COPY prompts ./prompts
COPY public ./public

ENV NODE_ENV=production
EXPOSE 4000

# Produção usa migrations explícitas, auditáveis e precedidas de backup.
# Nunca execute a migration monolítica automaticamente durante um restart.
CMD ["node", "src/server.js"]
