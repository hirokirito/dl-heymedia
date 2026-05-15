# Hey Media Downloader Deployment

Internal media downloader for `dl.heymedia.online`.

The app is a lightweight Node/Express server that serves the frontend and runs `yt-dlp` for downloads. The Docker deployment includes both `yt-dlp` and `ffmpeg`.

## Requirements

- Ubuntu server
- Docker Engine
- Docker Compose plugin
- Cloudflare Tunnel already configured or ready to configure

## Files

- `Dockerfile`: production image with Node.js, `yt-dlp`, and `ffmpeg`.
- `docker-compose.yml`: service definition with persistent downloads, restart policy, and localhost-only port binding.
- `src/`: backend config, routes, download manager, and small utilities.
- `public/`: static frontend HTML, CSS, and browser JavaScript.
- `.dockerignore`: keeps local dependencies, logs, env files, and downloads out of the image build context.
- `.gitignore`: keeps generated/runtime files out of git.

## Environment Variables

Create an optional `.env` file next to `docker-compose.yml`:

```env
PORT=3001
MAX_ACTIVE_JOBS=3
JOB_TIMEOUT_MS=600000
JOB_TTL_MS=3600000

# Optional YouTube fallback settings for PO-token/client changes.
YOUTUBE_PLAYER_CLIENT=
YOUTUBE_PO_TOKEN=
```

Defaults are already set in `docker-compose.yml`, so `.env` is only needed when overriding values.

## Build And Start

Create the persistent downloads folder:

```bash
mkdir -p downloads
sudo chown -R 1000:1000 downloads
```

```bash
docker compose build
docker compose up -d
```

Check status:

```bash
docker compose ps
docker compose logs -f yt-dlp-server
curl http://127.0.0.1:3001/health
```

Open locally from the server:

```text
http://127.0.0.1:3001
```

## Curl Tests

These commands should work on the Ubuntu server after the container starts:

```bash
curl -i http://localhost:3001
curl -I http://localhost:3001/styles.css
curl -I http://localhost:3001/app.js
curl -s http://localhost:3001/health
```

Expected behavior:

- `curl -i http://localhost:3001` returns `HTTP/1.1 200 OK` and the `public/index.html` document.
- `styles.css` returns `Content-Type: text/css`.
- `app.js` returns `Content-Type: text/javascript`.
- `/health` returns JSON with `tools.ytdlp` and `tools.ffmpeg`.

## Persistent Downloads

Downloads are stored in:

```text
./downloads
```

The container mounts this folder to:

```text
/downloads
```

The app still deletes completed files after users download them and cleans old job files by TTL, but the folder persists across container restarts.

## Cloudflare Tunnel

The compose file binds the app to localhost only:

```yaml
ports:
  - "127.0.0.1:${PORT:-3001}:3001"
```

Use this Cloudflare Tunnel service target:

```yaml
service: http://127.0.0.1:3001
```

Example ingress:

```yaml
ingress:
  - hostname: dl.heymedia.online
    service: http://127.0.0.1:3001
  - service: http_status:404
```

For an internal tool, protect the hostname with Cloudflare Access. The frontend PIN is not server-side authentication.

## Update The App

```bash
git pull
docker compose build --pull
docker compose up -d
```

## Update yt-dlp

`yt-dlp` is installed during image build. To get a newer `yt-dlp`, rebuild the image:

```bash
docker compose build --no-cache
docker compose up -d
```

## Stop / Restart

```bash
docker compose restart
docker compose down
```

## Production Notes

- `restart: unless-stopped` keeps the service running after crashes and host reboot.
- `init: true` improves child-process cleanup for `yt-dlp`.
- `ffmpeg` is included for MP3 extraction and video/audio merging.
- Logs are rotated by Docker with a 10 MB file size and 3-file limit.
- The container runs as the non-root `node` user.
- The exposed port is localhost-only for Cloudflare Tunnel compatibility.

## Troubleshooting

Check binary detection:

```bash
docker compose exec yt-dlp-server yt-dlp --version
docker compose exec yt-dlp-server ffmpeg -version
curl http://127.0.0.1:3001/health
```

If YouTube starts returning PO-token or 403 errors, update `yt-dlp` first by rebuilding. If needed, set:

```env
YTDLP_JS_RUNTIME=/usr/local/bin/deno
YTDLP_COOKIES_FILE=/home/heymedia/yt-dlp-server/yt-dlp-server/cookies/douyin-cookies.txt
YOUTUBE_PLAYER_CLIENT=mweb
YOUTUBE_PO_TOKEN=mweb.gvs+TOKEN_VALUE
```

Then restart:

```bash
docker compose up -d
```

## Douyin Cookies

Douyin videos that require login need browser cookies. Export cookies from the logged-in browser in Netscape cookies.txt format, then copy them to the server:

```bash
mkdir -p /home/heymedia/yt-dlp-server/yt-dlp-server/cookies
chmod 700 /home/heymedia/yt-dlp-server/yt-dlp-server/cookies
```

Save the exported file as:

```text
/home/heymedia/yt-dlp-server/yt-dlp-server/cookies/douyin-cookies.txt
```

For PM2 deployments, set:

```bash
cd /home/heymedia/yt-dlp-server/yt-dlp-server
YTDLP_COOKIES_FILE=/home/heymedia/yt-dlp-server/yt-dlp-server/cookies/douyin-cookies.txt pm2 restart heymedia-downloader --update-env
```

For Docker deployments, set this in `.env`:

```env
YTDLP_COOKIES_FILE=/cookies/douyin-cookies.txt
```

Then restart:

```bash
docker compose up -d
```
