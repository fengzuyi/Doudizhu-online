# 部署指南

适用环境：宝塔面板 + Nginx + PM2 + MySQL。

推荐部署目录：

```bash
/www/wwwroot/doudizhu
```

前端静态目录：

```bash
/www/wwwroot/doudizhu/apps/client/dist
```

后端启动文件：

```bash
/www/wwwroot/doudizhu/apps/server/dist/index.js
```

## 1. 服务器准备

宝塔软件商店安装：

- Nginx
- MySQL
- Node.js 20 LTS
- PM2 管理器

安全组只需要开放：

- `80`
- `443`
- `22`

`3001` 只给本机 Nginx 反向代理使用，不需要对公网开放。

## 2. 创建数据库

在宝塔 MySQL 中创建数据库：

- 数据库名：`doudizhu`
- 用户名：`doudizhu`
- 权限：本地服务器

数据库连接串格式：

```env
DATABASE_URL=mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu
```

如果密码包含 `@`、`#`、`/`、`:` 等特殊字符，需要 URL 编码，或者改成更简单的数据库密码。

## 3. 上传代码并构建

```bash
cd /www/wwwroot
git clone <你的仓库地址> doudizhu
cd /www/wwwroot/doudizhu

npm ci --include=dev

export DATABASE_URL='mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu'
npm --workspace apps/server run db:generate
npm --workspace apps/server run db:deploy

npm run build
```

构建后确认文件存在：

```bash
ls apps/server/dist/index.js
ls apps/client/dist
```

## 4. 配置后端环境变量

后端启动时必须拿到 `DATABASE_URL`。如果 PM2 没有拿到这个变量，服务会启动失败。

推荐优先在服务器创建 `.env` 文件，避免宝塔 PM2 面板的环境变量栏没有正确传入 Node 进程。

可以放在项目根目录：

```bash
cd /www/wwwroot/doudizhu
nano .env
```

也可以放在后端目录：

```bash
cd /www/wwwroot/doudizhu/apps/server
nano .env
```

写入以下内容：

```env
NODE_ENV=production
PORT=3001
CLIENT_ORIGIN=https://你的域名
DATABASE_URL=mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu
ADMIN_ACCOUNT=你的管理员账号
ADMIN_PASSWORD=你的强密码
AUTH_SESSION_TTL_DAYS=30
LOG_DIR=/www/server/doudizhu-data/logs
LOG_TO_FILE=true
ROOM_CLEANUP_INTERVAL_MS=300000
EMPTY_ROOM_TTL_MS=60000
ENDED_ROOM_TTL_MS=1800000
LOBBY_ROOM_TTL_MS=7200000
```

如果使用宝塔 PM2 面板的“环境变量”，也要按上面的格式逐行填写。

创建日志目录，提前确认 PM2 运行用户对日志路径有写入权限：

```bash
mkdir -p /www/server/doudizhu-data/logs
```

## 5. 启动后端

推荐优先用命令行启动，避免面板字段理解不一致：

```bash
cd /www/wwwroot/doudizhu

NODE_ENV=production \
PORT=3001 \
CLIENT_ORIGIN=https://ariescloud.art \
DATABASE_URL='mysql://doudizhu:hF4hSGf8x5aMGPKH@127.0.0.1:3306/doudizhu' \
ADMIN_ACCOUNT='admin' \
ADMIN_PASSWORD='888888' \
AUTH_SESSION_TTL_DAYS=30 \
LOG_DIR=/www/server/doudizhu-data/logs \
LOG_TO_FILE=true \
ROOM_CLEANUP_INTERVAL_MS=300000 \
EMPTY_ROOM_TTL_MS=60000 \
ENDED_ROOM_TTL_MS=1800000 \
LOBBY_ROOM_TTL_MS=7200000 \
pm2 start apps/server/dist/index.js --name doudizhu-server --cwd /www/wwwroot/doudizhu --update-env

pm2 save
```

如果使用宝塔 PM2 面板：

- 项目名称：`doudizhu-server`
- 启动文件：`/www/wwwroot/doudizhu/apps/server/dist/index.js`
- 运行目录：`/www/wwwroot/doudizhu`
- 实例数量：`1`
- 自动重载：关闭
- 启动方式：使用 `node` 运行该 JS 文件
- 环境变量：按第 4 节逐行填写

不要把 `ADMIN_ACCOUNT`、`ADMIN_PASSWORD`、`AUTH_SESSION_TTL_DAYS` 写在同一行。

## 6. 配置 Nginx

宝塔添加站点：

- 域名：你的域名
- 根目录：`/www/wwwroot/doudizhu/apps/client/dist`
- PHP：纯静态或不启用

站点配置中加入：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}

location /api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /socket.io/ {
    proxy_pass http://127.0.0.1:3001/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}

location = /health {
    proxy_pass http://127.0.0.1:3001/health;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}
```

保存后执行：

```bash
nginx -t
systemctl reload nginx
```

## 7. 验证

```bash
pm2 status
pm2 logs doudizhu-server --lines 100
curl http://127.0.0.1:3001/health
curl https://你的域名/health
```

浏览器访问：

```text
https://你的域名/
https://你的域名/admin
```

## 8. 服务未启动排查

先看 PM2 日志：

```bash
pm2 logs doudizhu-server --lines 100
```

常见错误和处理方式：

- `DATABASE_URL is required`：PM2 没拿到环境变量。重新填写环境变量后执行 `pm2 restart doudizhu-server --update-env`。
- `Can't reach database server` 或 `P1001`：MySQL 没启动、数据库地址不对、账号密码不对，或密码里的特殊字符没有 URL 编码。
- `Access denied for user`：数据库用户名、密码或权限错误。
- `Table ... does not exist`：没有执行 `npm --workspace apps/server run db:deploy`。
- `EADDRINUSE: address already in use :::3001`：`3001` 被其他进程占用，先用 `lsof -i:3001` 查占用。
- `Cannot find module .../dist/index.js`：没有执行 `npm run build`，或启动文件路径填错。

也可以绕过 PM2 直接启动一次看错误：

```bash
cd /www/wwwroot/doudizhu
NODE_ENV=production \
PORT=3001 \
DATABASE_URL='mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu' \
node apps/server/dist/index.js
```

如果这里能看到 `server.started`，说明后端本身能启动，问题在 PM2 环境变量或面板配置。

## 9. 更新部署

```bash
cd /www/wwwroot/doudizhu
git pull
npm ci --include=dev

export DATABASE_URL='mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu'
npm --workspace apps/server run db:generate
npm --workspace apps/server run db:deploy

npm run build
pm2 restart doudizhu-server --update-env

nginx -t
systemctl reload nginx
```
