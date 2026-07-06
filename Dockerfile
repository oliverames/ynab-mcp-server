# Container image for registry-hosted builds (e.g. Glama) and local use.
# The server speaks MCP over stdio; pass credentials via environment:
#   docker run -i -e YNAB_API_TOKEN=... -e YNAB_ALLOW_WRITES=0 <image>
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY index.js LICENSE README.md ./

USER node

ENTRYPOINT ["node", "index.js"]
