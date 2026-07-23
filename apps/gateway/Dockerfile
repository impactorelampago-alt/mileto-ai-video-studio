# Gateway do Mileto — imagem de produção para a VPS.
FROM node:24-alpine

WORKDIR /app

# Instala dependências primeiro (cache de camada)
COPY package.json ./
RUN npm install --omit=dev

# Código
COPY src ./src
COPY prompts ./prompts
COPY public ./public

ENV NODE_ENV=production
EXPOSE 4000

# Na subida: aplica o esquema (idempotente) + seed (idempotente) e sobe o servidor.
CMD ["sh", "-c", "node src/migrate.js && node src/seed.js && node src/server.js"]
