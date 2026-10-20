FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
USER node
CMD ["node", "--no-warnings", "server.js"]
