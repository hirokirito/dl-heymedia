#!/bin/sh
set -e

YTDLP_HOME="${YTDLP_HOME:-/opt/ytdlp}"

# YouTube đổi cơ chế liên tục, nên mặc định tự cập nhật yt-dlp mỗi lần container
# khởi động. Đặt YTDLP_AUTO_UPDATE=0 nếu muốn khoá phiên bản trong image.
if [ "${YTDLP_AUTO_UPDATE:-1}" = "1" ]; then
  echo "[entrypoint] updating yt-dlp..."
  if "$YTDLP_HOME/bin/pip" install --no-cache-dir --upgrade --quiet \
      "yt-dlp[default,curl-cffi,deno]" \
      bgutil-ytdlp-pot-provider; then
    echo "[entrypoint] yt-dlp updated"
  else
    echo "[entrypoint] update failed, dùng tiếp bản đã cài trong image"
  fi
fi

echo "[entrypoint] yt-dlp $("$YTDLP_HOME/bin/yt-dlp" --version 2>/dev/null || echo 'không chạy được')"

exec "$@"
