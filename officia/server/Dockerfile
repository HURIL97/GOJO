# Image du serveur d'équipe OfficiaTech (contexte de construction : le dossier « officia »).
FROM node:24-alpine
WORKDIR /app
COPY electron/ics.js electron/ics.js
COPY server/package.json server/server.js server/mobile.html server/
ENV NODE_ENV=production PORT=8790 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8790/api/health || exit 1
USER node
CMD ["node", "--no-warnings", "server/server.js"]
