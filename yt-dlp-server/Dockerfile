FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DOWNLOAD_DIR=/downloads \
    YTDLP_BIN=/usr/local/bin/yt-dlp \
    FFMPEG_BIN=/usr/bin/ffmpeg \
    PIPX_HOME=/opt/pipx \
    PIPX_BIN_DIR=/usr/local/bin

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    pipx \
    python3 \
  && pipx install yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY src ./src
COPY public ./public

RUN mkdir -p /downloads \
  && chown -R node:node /app /downloads

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
