# Hey Media Downloader Deployment

Internal media downloader for `dl.heymedia.online`.

The app is a lightweight Node/Express server that serves the frontend and runs `yt-dlp` for downloads. The Docker deployment includes both `yt-dlp` and `ffmpeg`.

## Requirements

- Ubuntu server
- Docker Engine
- Docker Compose plugin
- Cloudflare Tunnel already configured or ready to configure

## Files

- `Dockerfile`: production image with Node.js, `yt-dlp` (kèm Deno + `yt-dlp-ejs` + `curl-cffi`), and `ffmpeg`.
- `docker-entrypoint.sh`: tự cập nhật `yt-dlp` khi container khởi động.
- `docker-compose.yml`: service definition with persistent downloads, restart policy, localhost-only port binding, và service `bgutil-provider` sinh PO token cho YouTube.
- `src/`: backend config, routes, download manager, and small utilities.
- `public/`: static frontend HTML, CSS, and browser JavaScript.
- `.dockerignore`: keeps local dependencies, logs, env files, and downloads out of the image build context.
- `.gitignore`: keeps generated/runtime files out of git.

## Environment Variables

Create an optional `.env` file next to `docker-compose.yml`:

```env
# Port phía host. Port bên trong container luôn cố định là 3001.
HOST_PORT=3001
# 127.0.0.1 = chỉ localhost. Đặt 0.0.0.0 nếu client LAN gọi trực tiếp.
BIND_ADDR=127.0.0.1
# uid:gid chạy container, phải khớp chủ sở hữu thư mục ./downloads.
RUN_UID=1000
RUN_GID=1000
MAX_ACTIVE_JOBS=3
JOB_TIMEOUT_MS=600000
JOB_TTL_MS=3600000

# 1 = tự cập nhật yt-dlp mỗi lần container khởi động (mặc định).
YTDLP_AUTO_UPDATE=1

# Client mặc định của yt-dlp (android_vr) bị YouTube trả 403 giữa chừng, 'tv'
# trả "The page needs to be reloaded", 'web' chỉ trả storyboard với video dài.
# web_embedded qua được cả video ngắn lẫn video 40+ phút.
YOUTUBE_PLAYER_CLIENT=web_embedded,mweb
YOUTUBE_FALLBACK_PLAYER_CLIENT=mweb,web_safari
YOUTUBE_PO_TOKEN=

# Provider tự sinh PO token (service bgutil-provider trong docker-compose).
YOUTUBE_POT_BASE_URL=http://bgutil-provider:4416
```

Defaults are already set in `docker-compose.yml`, so `.env` is only needed when overriding values.

## Build And Start

Tạo thư mục downloads **trước khi** `up`. Nếu chưa tồn tại, Docker sẽ tự tạo nó
bằng `root`, trong khi container chạy bằng uid 1000 — yt-dlp sẽ chết với
`[Errno 13] Permission denied` ngay khi ghi file `.part`:

```bash
mkdir -p downloads cookies
# Chỉ cần khi thư mục đã lỡ bị tạo bằng root:
sudo chown -R 1000:1000 downloads
```

```bash
docker compose build
docker compose up -d
```

Chạy thử ở port khác mà không đụng service đang chạy:

```bash
HOST_PORT=3002 docker compose up -d
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

Container tự chạy `pip install --upgrade` cho `yt-dlp` mỗi lần khởi động, nên chỉ cần:

```bash
docker compose restart yt-dlp-server
```

Muốn khoá phiên bản trong image thì đặt `YTDLP_AUTO_UPDATE=0` trong `.env` và rebuild:

```bash
docker compose build --no-cache
docker compose up -d
```

## YouTube: JS runtime, PO token

Từ 2026, `yt-dlp` bắt buộc phải có JS runtime (Deno) + gói `yt-dlp-ejs` để giải
signature/nsig của YouTube. Image cài `yt-dlp[default,curl-cffi,deno]` nên đã đủ:

- `default` → kéo theo `yt-dlp-ejs`
- `deno` → binary Deno tại `/opt/ytdlp/bin/deno`
- `curl-cffi` → impersonate (dùng cho Douyin/TikTok)

Service `bgutil-provider` sinh PO token tự động, thay cho việc dán tay
`YOUTUBE_PO_TOKEN` (YouTube gắn token theo từng video id nên token dán tay hết
tác dụng rất nhanh).

Kiểm tra tình trạng:

```bash
curl -s http://127.0.0.1:3001/api/diagnostics | python3 -m json.tool
```

Cần thấy:

- `ytdlpVersion` gần với bản mới nhất
- `jsRuntimes` có `deno-...`
- `optionalLibraries` có `yt_dlp_ejs-...`
- `potProvider.reachable` = `true`

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
curl -s http://127.0.0.1:3001/api/diagnostics | python3 -m json.tool
```

Nếu YouTube trả về PO-token hoặc 403, xem `/api/diagnostics` trước. Thứ tự xử lý:

1. `docker compose restart yt-dlp-server` để kéo bản `yt-dlp` mới nhất.
2. Nếu `jsRuntimes` trống → rebuild image (`docker compose build --no-cache`).
3. Nếu `potProvider.reachable` = `false` → `docker compose up -d bgutil-provider`.
4. Nếu vẫn bị "confirm you're not a bot" → nạp cookies YouTube từ một tài khoản
   phụ (export ở cửa sổ ẩn danh để cookie không bị xoay vòng):

```env
YTDLP_COOKIES_FILE=/cookies/youtube-cookies.txt
```

Các biến còn lại chỉ dùng khi thật sự cần ép:

```env
YTDLP_IMPERSONATE_CLIENT=chrome
YOUTUBE_PLAYER_CLIENT=tv
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

When `yt-dlp` returns Douyin `Fresh cookies` or JSON parsing errors, the server retries video downloads with a custom Douyin fallback that reads the logged-in cookie file, resolves the share URL, extracts a playable video URL from Douyin page data, and streams the MP4 directly.

On direct PM2/Ubuntu deployments, install a `curl_cffi` version supported by the current `yt-dlp` release for better browser impersonation support:

```bash
python3 -m pip install -U --break-system-packages 'curl_cffi==0.13.0'
```

Then confirm `yt-dlp -v` shows `curl_cffi` under request handlers before retrying Douyin. If `yt-dlp -v` marks it as `unsupported`, downgrade to a supported version.

If Douyin still serves empty page/API data, enable the optional browser fallback. It uses headless Chromium via Playwright, imports the same cookies.txt file, opens the Douyin page, watches video network requests, and downloads the captured media URL:

```bash
cd /home/heymedia/yt-dlp-server/yt-dlp-server
npm install playwright
npx playwright install chromium
```

Then restart PM2 with:

```bash
DOUYIN_BROWSER_FALLBACK=1
```
