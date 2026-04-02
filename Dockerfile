FROM node:22-alpine
LABEL io.modelcontextprotocol.server.name="com.scriptivox.www/transcription"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
ENTRYPOINT ["node", "dist/index.js"]
