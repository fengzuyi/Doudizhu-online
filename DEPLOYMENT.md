# 云服务器部署步骤

本文按“宝塔面板 + Nginx + PM2 + MySQL”整理。前端由 Vite 构建为静态文件，后端由 Node.js 运行 Express + Socket.IO，账号系统使用 Prisma + MySQL。

## 1. 访问结构

推荐同域名部署：

- `https://你的域名/`：前端页面
- `https://你的域名/api/...`：后端 HTTP API
- `https://你的域名/socket.io/...`：Socket.IO 实时通信

这样前端当前的 `/api` 和 `io("/")` 可以直接使用，不需要额外改地址。

## 2. 宝塔准备

在宝塔软件商店安装：

- Nginx
- MySQL
- Node.js 版本管理器，选择 Node.js `18.19+` 或 Node.js 20 LTS
- PM2 管理器

安全组和防火墙开放：

- `80`
- `443`
- `22`

不要向公网开放 `3001`。后端 `3001` 只给本机 Nginx 反向代理访问。

## 3. 创建 MySQL 数据库

宝塔进入：

```text
数据库 -> 添加数据库
```

示例：

- 数据库名：`doudizhu`
- 用户名：`doudizhu`
- 密码：使用宝塔生成的强密码
- 访问权限：本地服务器

后端环境变量中的连接串格式：

```bash
DATABASE_URL=mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu
```

如果密码里有特殊字符，例如 `@`、`#`、`:`、`/`，需要做 URL 编码，或换一个只包含字母数字和常见符号的密码。

## 4. 上传项目

推荐目录：

```bash
/www/wwwroot/doudizhu
```

可以用宝塔文件管理器上传，也可以在宝塔终端拉 Git 仓库：

```bash
cd /www/wwwroot
git clone <你的仓库地址> doudizhu
cd /www/wwwroot/doudizhu
```

## 5. 安装依赖与构建

确认 Node 版本：

```bash
node -v
npm -v
which node
```

如果显示 Node 12，说明当前终端还在用系统旧版 Node。需要在宝塔 Node.js 版本管理器切换到 Node 18.19+ 或 Node 20，并重新打开终端。

安装依赖：

```bash
cd /www/wwwroot/doudizhu
npm ci --include=dev
```

生成 Prisma Client 并执行数据库迁移：

```bash
DATABASE_URL="mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu" \
npm --workspace apps/server run db:generate

DATABASE_URL="mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu" \
npm --workspace apps/server run db:deploy
```

检查和构建：

```bash
npm run typecheck
npm test
npm run build
```

构建后前端目录：

```bash
/www/wwwroot/doudizhu/apps/client/dist
```

后端入口：

```bash
/www/wwwroot/doudizhu/apps/server/dist/index.js
```

## 6. 创建宝塔网站

宝塔进入：

```text
网站 -> 添加站点
```

推荐配置：

- 域名：你的域名，例如 `game.example.com`
- 根目录：`/www/wwwroot/doudizhu/apps/client/dist`
- PHP：纯静态或不启用 PHP
- 数据库：这里不用再创建，前面已经建过 MySQL

如果有域名，进入站点设置：

```text
SSL -> Let's Encrypt
```

申请 HTTPS 证书。证书成功后，后端 `CLIENT_ORIGIN` 使用 HTTPS 域名。

如果暂时只有服务器 IP，可以先使用：

```bash
CLIENT_ORIGIN=http://服务器IP
```

## 7. 用 PM2 启动后端

宝塔终端执行：

```bash
mkdir -p /www/server/doudizhu-data/logs
cd /www/wwwroot/doudizhu

NODE_ENV=production \
PORT=3001 \
CLIENT_ORIGIN=https://你的域名 \
DATABASE_URL="mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu" \
AUTH_SESSION_TTL_DAYS=30 \
LOG_DIR=/www/server/doudizhu-data/logs \
LOG_TO_FILE=true \
pm2 start npm --name doudizhu-server -- --workspace apps/server run start

pm2 save
```

查看状态：

```bash
pm2 status
pm2 logs doudizhu-server
```

重启：

```bash
pm2 restart doudizhu-server --update-env
```

不要使用 PM2 cluster 多进程模式。当前房间、牌局和聊天最近消息保存在单个 Node 进程内存里，多进程会导致玩家状态分散。

## 8. 宝塔 PM2 面板写法

如果你使用宝塔的 PM2 面板新增项目：

- 项目目录：`/www/wwwroot/doudizhu`
- 项目名称：`doudizhu-server`
- 运行用户：默认即可
- Node 版本：18.19+ 或 20 LTS
- 端口：`3001`
- 启动命令：

```bash
npm --workspace apps/server run start
```

环境变量：

```bash
NODE_ENV=production
PORT=3001
CLIENT_ORIGIN=https://你的域名
DATABASE_URL=mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu
AUTH_SESSION_TTL_DAYS=30
LOG_DIR=/www/server/doudizhu-data/logs
LOG_TO_FILE=true
ROOM_CLEANUP_INTERVAL_MS=300000
EMPTY_ROOM_TTL_MS=60000
ENDED_ROOM_TTL_MS=1800000
LOBBY_ROOM_TTL_MS=7200000
```

## 9. Nginx 反向代理

宝塔进入：

```text
网站 -> 你的站点 -> 设置 -> 配置文件
```

在当前 `server { ... }` 里面加入：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /health {
    proxy_pass http://127.0.0.1:3001/health;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}

location /socket.io/ {
    proxy_pass http://127.0.0.1:3001/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
```

保存后执行：

```bash
nginx -t
sudo systemctl reload nginx
```

或在宝塔面板点击“重载配置”。

## 10. 验证部署

健康检查：

```bash
curl http://127.0.0.1:3001/health
curl https://你的域名/health
```

浏览器打开：

```text
https://你的域名/
```

验收顺序：

1. 注册账号并登录。
2. 刷新页面，确认仍保持登录。
3. 用同一个账号在另一个浏览器登录，确认旧设备被踢下线。
4. 两个不同账号登录大厅，发送聊天消息，确认实时可见。
5. 创建斗地主、炸金花或打板子房间，确认创建/加入/准备/结算流程正常。

## 11. 更新部署

每次更新代码后：

```bash
cd /www/wwwroot/doudizhu
git pull
npm ci --include=dev

DATABASE_URL="mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu" \
npm --workspace apps/server run db:generate

DATABASE_URL="mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu" \
npm --workspace apps/server run db:deploy

npm run typecheck
npm test
npm run build

pm2 restart doudizhu-server --update-env
nginx -t
sudo systemctl reload nginx
```

## 12. 常见问题

### `tsc: command not found`

没有安装开发依赖。使用：

```bash
npm ci --include=dev
```

### `SyntaxError: Unexpected token '?'`

Node.js 版本太旧。切换到 Node.js 18.19+ 或 Node.js 20 LTS，然后重新安装依赖。

### 登录接口失败

检查：

- `/api/` 反向代理是否存在。
- `DATABASE_URL` 是否写在 PM2 环境变量里。
- MySQL 数据库、用户名、密码是否正确。
- 是否已执行 `npm --workspace apps/server run db:deploy`。
- `pm2 logs doudizhu-server` 是否有 Prisma 连接错误。

### 页面能打开，但创建房间或聊天不工作

检查：

- `/socket.io/` 是否配置了 WebSocket 反向代理。
- 后端 PM2 服务是否正在运行。
- `CLIENT_ORIGIN` 是否和浏览器访问的域名完全一致，包括 `http` 或 `https`。

### 新代码部署后账号还在吗

账号和登录会话在 MySQL 中，正常更新代码不会丢失。房间、牌局和聊天最近消息仍在 Node 内存中，重启后会清空。
