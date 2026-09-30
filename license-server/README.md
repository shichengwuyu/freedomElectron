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

## 当前部署（已上线）

服务已经部署在 **103.85.226.4**，通过 nginx **子路径**对外，复用该域名现成的 Let's Encrypt 证书：

```
客户端 serverUrl : https://xiaoyxiao.xyz/license
       ↓ nginx   location ^~ /license/  →  proxy_pass http://127.0.0.1:8787/
容器              freedom-license (node:22-alpine, 只发布 127.0.0.1:8787)
代码/私钥/账号库   /root/freedom-license  (挂载进容器 /app)
```

选子路径而不是新域名，是为了**不动 `xiaoyxiao.xyz` 上现有的 `location /`**
（那台机器上还跑着另一个 Go 服务和 new-api，走 3000 / 3001）。
`/health` 自检：`https://xiaoyxiao.xyz/license/health`。

### 重新部署 / 更新代码

```bash
# 本地：把改动传上去（不要漏 keys/）
scp -r license-server/* root@103.85.226.4:/root/freedom-license/

# 服务器：重启容器
docker restart freedom-license
docker logs --tail 20 freedom-license
```

容器是 `--restart unless-stopped`，服务器重启会自动拉起，**不需要 systemd**。

### 首次部署到新机器

1. 上传 `license-server/`（含 `keys/license-private.pem`，并 `chmod 600` 它）。
2. `docker run -d --name freedom-license --restart unless-stopped -p 127.0.0.1:8787:8787 -v /root/freedom-license:/app -w /app node:22-alpine node server.mjs`
3. nginx 里给对应域名的 **443 server 块**加一段（**注意别动 `location /`**）：
   ```nginx
   location ^~ /license/ {
       proxy_pass http://127.0.0.1:8787/;   # 末尾的 / 会把 /license/ 前缀去掉
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-Proto https;
   }
   ```
4. `nginx -t && nginx -s reload`
5. 客户端 `backend/license-config.json` 的 `serverUrl` 填 `https://<域名>/license`，重新打包。

## 管理账号

容器里跑（或本地对同一份库跑）：

```bash
docker exec freedom-license node admin.mjs list             # 列出账号
docker exec freedom-license node admin.mjs approve <用户名>  # 批准待审核账号
docker exec freedom-license node admin.mjs revoke <用户名>   # 吊销（客户端下次复验即被锁）
docker exec freedom-license node admin.mjs restore <用户名>
docker exec freedom-license node admin.mjs delete <用户名>   # 彻底删除
docker exec freedom-license node admin.mjs passwd <用户名> <新密码>
docker exec freedom-license node admin.mjs devices <用户名>  # 看已登记设备
docker exec freedom-license node admin.mjs forget-device <用户名> <序号>   # 换机时移除旧设备
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
