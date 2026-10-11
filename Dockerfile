# Build separado para que ferramentas e cache não sejam incluídos na imagem final.
FROM node:22-alpine3.21 AS deps
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine3.21 AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node app/package.json app/server.js ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]
