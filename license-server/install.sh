#!/usr/bin/env bash
# Freedom 授权服务 · 一键部署（Linux + Docker）
#
# 用法：把整个 license-server/ 目录传到 Linux 服务器，然后：
#     sudo bash install.sh
#
# 前提：keys/license-private.pem 必须存在，且和客户端 backend/license-public-key.pem
#       是同一对密钥（换私钥 = 所有客户端要重新打包）。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="/root/freedom-license"
PORT="$(node -e "try{console.log(require('$DIR/config.json').port||8787)}catch{console.log(8787)}" 2>/dev/null || echo 8787)"

echo "== 检查依赖 =="
command -v docker >/dev/null 2>&1 || { echo "[FAIL] 没装 docker"; exit 1; }
[ -f "$DIR/keys/license-private.pem" ] || { echo "[FAIL] 缺少 keys/license-private.pem"; exit 1; }

echo "== 同步文件到 $TARGET =="
mkdir -p "$TARGET"
if [ "$DIR" = "$TARGET" ]; then
  echo "  （脚本就在目标目录里，跳过复制）"
else
  cp -r "$DIR/server.mjs" "$DIR/admin.mjs" "$DIR/config.json" "$DIR/lib" "$DIR/keys" "$TARGET/"
fi
chmod 600 "$TARGET/keys/license-private.pem"

echo "== 启动容器 =="
docker rm -f freedom-license >/dev/null 2>&1 || true
docker run -d --name freedom-license --restart unless-stopped \
  -p "127.0.0.1:${PORT}:${PORT}" \
  -v "$TARGET":/app -w /app \
  node:22-alpine node server.mjs >/dev/null

sleep 3
echo "== 自检 =="
docker ps --filter name=freedom-license --format '  容器: {{.Names}}  {{.Status}}  {{.Ports}}'
if ! curl -fsS "http://127.0.0.1:${PORT}/health"; then
  echo ""
  echo "[FAIL] /health 不通，看日志： docker logs freedom-license"
  exit 1
fi
echo ""

cat <<EOF

== 还差一步：nginx 反代（客户端强制 HTTPS，必须有域名 + 证书）==
在「对应域名的 443 server 块」里加下面这段，注意不要动已有的 location / ：

    location ^~ /license/ {
        proxy_pass http://127.0.0.1:${PORT}/;
        proxy_cache off;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }

然后：

    nginx -t && nginx -s reload
    curl https://<你的域名>/license/health

客户端 backend/license-config.json 里的 serverUrl 填 https://<你的域名>/license

== 常用管理（在服务器上跑）==
docker exec freedom-license node admin.mjs list
docker exec freedom-license node admin.mjs approve <用户名>
docker exec freedom-license node admin.mjs revoke  <用户名>
docker exec freedom-license node admin.mjs delete  <用户名>
docker exec freedom-license node admin.mjs passwd  <用户名> <新密码>
docker logs -f freedom-license
EOF
