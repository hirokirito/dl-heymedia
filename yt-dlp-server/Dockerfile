# --- Hey Tools: build app tĩnh tools-web/ ---
FROM node:22-bookworm-slim AS tools-web
WORKDIR /build
COPY tools-web/package.json tools-web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tools-web/ ./
RUN npm run build

# --- Server downloader + Hey Tools ---
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DOWNLOAD_DIR=/downloads \
    YTDLP_HOME=/opt/ytdlp \
    YTDLP_BIN=/opt/ytdlp/bin/yt-dlp \
    YTDLP_JS_RUNTIME=/opt/ytdlp/bin/deno \
    FFMPEG_BIN=/usr/bin/ffmpeg \
    DENO_DIR=/tmp/deno \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH=/opt/ytdlp/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# yt-dlp >= 2026 cần JS runtime (Deno) + gói yt-dlp-ejs để giải signature/nsig của
# YouTube, và curl-cffi để impersonate. Cài thiếu extras là YouTube fail sạch.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    python3 \
    python3-venv \
  && python3 -m venv "$YTDLP_HOME" \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Đổi YTDLP_CACHE_BUST (vd. --build-arg YTDLP_CACHE_BUST=$(date +%s)) để build lấy yt-dlp mới nhất
# thay vì dùng lại layer cũ; nhờ vậy entrypoint không phải tải bản mới lúc khởi động (từng mất ~4 phút).
ARG YTDLP_CACHE_BUST=""
RUN echo "yt-dlp cache bust: ${YTDLP_CACHE_BUST:-none}" \
  && "$YTDLP_HOME/bin/pip" install --no-cache-dir --upgrade pip \
  && "$YTDLP_HOME/bin/pip" install --no-cache-dir --upgrade \
    "yt-dlp[default,curl-cffi,deno]" \
    bgutil-ytdlp-pot-provider

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY src ./src
COPY public ./public
COPY --from=tools-web /build/dist ./tools-web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /downloads /tmp/deno /app/data \
  && chown -R node:node /app /downloads /tmp/deno "$YTDLP_HOME"

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
