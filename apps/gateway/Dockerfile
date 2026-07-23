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
COPY prompts ./prompts
COPY public ./public

ENV NODE_ENV=production
EXPOSE 4000

# Na subida: aplica o esquema (idempotente) + seed (idempotente) e sobe o servidor.
CMD ["sh", "-c", "node src/migrate.js && node src/seed.js && node src/server.js"]
