FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node . .
RUN node scripts/build.mjs && mkdir -p /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "server/index.mjs"]
