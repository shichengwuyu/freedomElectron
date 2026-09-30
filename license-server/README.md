# Freedom 授权服务端

只做 **注册 + 登录 + 续期**，没有卡密。客户端（Electron 主进程）在 `backend/license.js`
里调这三个接口，并用内置公钥验签返回的租约。

```
POST /v1/accounts/register   { username, password }
POST /v1/accounts/login      { username, password, machineCode, appVersion, clientSessionId }
POST /v1/licenses/validate   { lease, machineCode, appVersion, clientSessionId }
GET  /health                 （自检用）
```

## 密钥（最重要的一步）

租约用 **Ed25519** 签名，客户端用 `backend/license-public-key.pem` 验证。两边必须是同一对。

```bash
node -e "
const c=require('crypto'),fs=require('fs');
const {publicKey,privateKey}=c.generateKeyPairSync('ed25519');
fs.writeFileSync('backend/license-public-key.pem', publicKey.export({type:'spki',format:'pem'}));
fs.mkdirSync('license-server/keys',{recursive:true});
fs.writeFileSync('license-server/keys/license-private.pem', privateKey.export({type:'pkcs8',format:'pem'}), {mode:0o600});
"
```

- `license-server/keys/` 已被 `.gitignore` 排除，**私钥永远不要提交、不要发出去**。
- 服务端启动时会检查「本服务私钥」和「客户端公钥」是否配对，不配对直接拒绝启动（避免签出没人认的租约）。
- **换密钥 = 已发布的开校验版本全部失效**。确定要换时，先停服务、换完再重新打包客户端。

## 本地跑起来

```bash
node license-server/server.mjs
curl http://127.0.0.1:8787/health
```

## 部署到服务器（以 103.85.226.4 / xiaoyxiao.xyz 为例）

客户端**强制 HTTPS**（`license.js` 要求协议是 `https:`），所以必须挂证书。推荐让 Node 只监听本机，
前面用 nginx 做 TLS 终止。

1. **DNS**：把 `xiaoyxiao.xyz` 的 A 记录指到 `103.85.226.4`。
2. **上传**：把整个 `license-server/`（含 `keys/license-private.pem`）传到服务器，例如 `/opt/freedom-license`。
3. **防火墙/安全组**：放行 80 和 443（注意控制台里安全组要挂上，否则公网访问不到）。
4. **Node 18+**，然后先用 systemd 把服务跑起来：

```ini
# /etc/systemd/system/freedom-license.service
[Unit]
Description=Freedom License Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/freedom-license
ExecStart=/usr/bin/node /opt/freedom-license/server.mjs
Restart=always
RestartSec=3
User=freedom
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

5. **nginx + 免费证书**：

```nginx
server {
  listen 80;
  server_name xiaoyxiao.xyz;
  location / { proxy_pass http://127.0.0.1:8787; proxy_set_header Host $host; }
}
```

```bash
apt install -y nginx certbot python3-certbot-nginx
certbot --nginx -d xiaoyxiao.xyz      # 自动签证书并改写成 443
```

证书自动续期由 certbot 的 timer 负责。签完 `curl https://xiaoyxiao.xyz/health` 应该返回 JSON。

6. 客户端侧的 `backend/license-config.json` 里 `serverUrl` 已经是 `https://xiaoyxiao.xyz`，
   重新打包客户端即可生效。

## 管理账号

```bash
node admin.mjs list                          # 列出账号
node admin.mjs approve <用户名>               # 批准待审核账号
node admin.mjs revoke <用户名>                # 吊销（客户端下次复验即被锁）
node admin.mjs restore <用户名>
node admin.mjs passwd <用户名> <新密码>
node admin.mjs devices <用户名>               # 看已登记设备
node admin.mjs forget-device <用户名> <序号>   # 换机时移除旧设备
```

`config.json` 里的开关：

| 字段 | 说明 |
|---|---|
| `autoApproveSignups` | `true` = 注册即用；`false` = 注册进待审核，需 `admin.mjs approve` |
| `maxDevicesPerAccount` | 单账号可登录的设备数（默认 2） |
| `leaseTtlDays` | 租约有效期（默认 7 天，客户端到期前会自动续期） |

## 安全提醒

- `keys/` 与 `data/`（账号库，含密码哈希）都已 gitignore；`data/` 权限设成只有服务账号可读。
- `admin.mjs` 只在服务器本地跑，**不要**通过 nginx 暴露。
- 服务端已内置登录失败限流（同 IP + 用户名 10 分钟内 10 次）。
- 密码用 scrypt 存储，用户名不存在时也会跑一次哈希，避免通过响应时间探测账号。
