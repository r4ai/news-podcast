FROM node:24-bookworm-slim

WORKDIR /app
COPY infra/loadtest/provider-fakes/server.mjs /app/server.mjs
RUN chmod 0444 /app/server.mjs

USER node
ENTRYPOINT ["node", "/app/server.mjs"]
