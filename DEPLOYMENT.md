# 云服务器部署步骤

这份文档按当前项目结构整理：前端用 Vite 构建静态文件，后端用 Node.js 运行 Express + Socket.IO，Nginx 负责访问入口和 WebSocket 反向代理。

## 1. 部署方式

推荐使用同一个域名部署：

- `https://你的域名/`：前端页面
- `https://你的域名/api/...`：后端 HTTP API
- `https://你的域名/socket.io/...`：Socket.IO 实时通信

这样前端当前的 `io("/")` 和 `/api` 请求都可以继续使用，不需要额外改前端地址。

## 宝塔面板部署（推荐）

如果你使用宝塔面板，可以按下面这条路线走：宝塔负责创建网站、SSL 和 Nginx 配置；后端用 PM2 或宝塔的 Node 项目管理器常驻运行。

### 2.1 安装宝塔软件

在宝塔「软件商店」安装：

- Nginx
- Node.js 版本管理器，选择 Node.js 18.19+ 或 Node.js 20 LTS
- PM2 管理器，或 Node 项目管理器

云服务器安全组开放：

- `80`
- `443`
- `22`

不要对公网开放 `3001`。后端 `3001` 只给本机 Nginx 反向代理访问。

### 2.2 上传项目

建议项目目录：

```bash
/www/wwwroot/doudizhu
```

可以用宝塔文件管理器上传，也可以在宝塔终端里拉 Git 仓库：

```bash
cd /www/wwwroot
git clone <你的仓库地址> doudizhu
cd /www/wwwroot/doudizhu
npm ci
npm run typecheck
npm test
npm run build
```

构建后前端目录是：

```bash
/www/wwwroot/doudizhu/apps/client/dist
```

### 2.3 创建宝塔网站

宝塔面板进入：

```text
网站 -> 添加站点
```

推荐配置：

- 域名：你的域名，例如 `game.example.com`
- 根目录：`/www/wwwroot/doudizhu/apps/client/dist`
- PHP：纯静态或不启用 PHP
- 数据库：不创建

创建后进入站点设置：

```text
SSL -> Let's Encrypt
```

申请 HTTPS 证书。申请成功后，后端的 `CLIENT_ORIGIN` 要使用 HTTPS 域名。

如果你暂时只有服务器 IP，也可以先用：

```text
http://服务器IP/
```

对应后端环境变量写：

```bash
CLIENT_ORIGIN=http://服务器IP
```

### 2.4 启动后端：PM2 方式

在宝塔终端执行：

```bash
mkdir -p /www/server/doudizhu-data
cd /www/wwwroot/doudizhu

CLIENT_ORIGIN=https://你的域名 \
PORT=3001 \
AUTH_STORE_PATH=/www/server/doudizhu-data/auth-store.json \
AUTH_BACKUP_DIR=/www/server/doudizhu-data/backups \
LOG_DIR=/www/server/doudizhu-data/logs \
pm2 start npm --name doudizhu-server -- --workspace apps/server run start

pm2 save
```

查看状态：

```bash
pm2 status
pm2 logs doudizhu-server
```

后续重启：

```bash
pm2 restart doudizhu-server --update-env
```

不要使用 PM2 cluster 多进程模式。当前房间、牌局和聊天在线状态保存在单个 Node 进程内存里，多进程会导致玩家状态分散。

### 2.5 启动后端：宝塔 Node 项目管理器方式

如果你更想全程在宝塔界面里操作，也可以用「Node 项目管理器」新增项目：

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
AUTH_STORE_PATH=/www/server/doudizhu-data/auth-store.json
AUTH_BACKUP_DIR=/www/server/doudizhu-data/backups
AUTH_BACKUP_KEEP=20
AUTH_BACKUP_INTERVAL_MS=21600000
LOG_DIR=/www/server/doudizhu-data/logs
ROOM_CLEANUP_INTERVAL_MS=300000
EMPTY_ROOM_TTL_MS=60000
ENDED_ROOM_TTL_MS=1800000
LOBBY_ROOM_TTL_MS=7200000
```

如果宝塔插件要求填写「启动文件」而不是「启动命令」，优先选择 PM2 方式；PM2 对 npm workspace 项目更直接。

新增运维变量说明：

- `LOG_DIR`：应用 JSON 日志目录，默认每天一个 `.log` 文件。
- `AUTH_BACKUP_DIR`：账号文件备份目录。
- `AUTH_BACKUP_KEEP`：保留最近多少份账号备份，默认 `20`。
- `AUTH_BACKUP_INTERVAL_MS`：账号文件备份间隔，默认 `21600000`，也就是 6 小时。
- `ROOM_CLEANUP_INTERVAL_MS`：房间清理任务执行间隔，默认 5 分钟。
- `EMPTY_ROOM_TTL_MS`：空房间保留时间，默认 1 分钟。
- `ENDED_ROOM_TTL_MS`：已结束房间保留时间，默认 30 分钟。
- `LOBBY_ROOM_TTL_MS`：大厅等待房间无操作保留时间，默认 2 小时。

### 2.6 配置宝塔 Nginx 反向代理

进入：

```text
网站 -> 你的站点 -> 设置 -> 配置文件
```

在当前 `server { ... }` 里面加入下面三段配置。不要新建第二个 `server`，也不要整站反向代理，否则前端静态文件会被覆盖。

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

保存后在宝塔里点击：

```text
重载配置
```

或在终端执行：

```bash
nginx -t
sudo systemctl reload nginx
```

### 2.7 宝塔部署验证

后端健康检查：

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
2. 打开两个浏览器窗口，用两个账号登录。
3. 在大厅聊天发消息，确认另一个窗口实时收到。
4. 创建斗地主房间。
5. 另一个窗口输入房间号加入。
6. 三个窗口完成准备、叫分、出牌和结算。
7. 对局中展开右下角聊天，确认仍能收发消息。

### 2.8 宝塔更新部署

每次更新代码后，在宝塔终端执行：

```bash
cd /www/wwwroot/doudizhu
git pull
npm ci
npm run typecheck
npm test
npm run build
pm2 restart doudizhu-server --update-env
nginx -t
sudo systemctl reload nginx
```

如果你使用宝塔 Node 项目管理器，就在面板里重启 `doudizhu-server` 项目。

### 2.9 宝塔常见问题

如果页面能打开，但创建房间、聊天不工作：

- 检查 `/socket.io/` 是否配置了 WebSocket 反向代理。
- 检查后端 PM2/Node 项目是否正在运行。
- 检查 `CLIENT_ORIGIN` 是否和浏览器访问域名完全一致，包括 `http` 或 `https`。

如果登录注册接口失败：

- 检查 `/api/` 反向代理是否存在。
- 检查 `AUTH_STORE_PATH` 所在目录是否可写。
- 查看 `pm2 logs doudizhu-server`。
- 查看应用日志：`tail -f /www/server/doudizhu-data/logs/$(date +%F).log`。

如果 HTTPS 页面提示连接失败：

- 确认 `CLIENT_ORIGIN=https://你的域名`。
- 重启后端：`pm2 restart doudizhu-server --update-env`。
- 确认浏览器访问的是 HTTPS，而不是 HTTP。

如果 `npm run typecheck` 报 `SyntaxError: Unexpected token '?'`：

- 这是服务器 Node.js 版本太旧，不是 TypeScript 代码错误。
- 在宝塔「Node.js 版本管理器」安装并切换到 Node.js 18.19+ 或 Node.js 20 LTS。
- 重新打开宝塔终端后确认：

```bash
node -v
npm -v
```

- 然后重新安装依赖并构建：

```bash
cd /www/wwwroot/doudizhu
rm -rf node_modules apps/client/node_modules apps/server/node_modules packages/shared/node_modules
npm install --include=dev
npm run typecheck
npm run build
```

## 通用命令行部署参考

如果你使用宝塔，优先看上面的「宝塔面板部署」。下面这些步骤适合不用宝塔、直接手写 Nginx 和 PM2 配置的服务器。

## 2. 服务器准备

建议云服务器配置：

- Ubuntu 22.04 或 24.04
- Node.js 18.19+，更推荐 Node.js 20 LTS
- npm 10+
- Nginx
- PM2 或 systemd，用于守护 Node 后端进程

安全组或防火墙开放：

- `22`：SSH
- `80`：HTTP
- `443`：HTTPS

不要对公网开放后端 `3001` 端口，后端只给 Nginx 本机反代访问。

## 3. 上传或拉取代码

示例目录：

```bash
sudo mkdir -p /var/www/doudizhu
sudo chown -R $USER:$USER /var/www/doudizhu
cd /var/www/doudizhu
git clone <你的仓库地址> app
cd app
```

如果你暂时没有 Git 仓库，也可以把整个项目压缩上传到 `/var/www/doudizhu/app`。

## 4. 安装依赖和构建

```bash
cd /var/www/doudizhu/app
npm ci
npm run typecheck
npm test
npm run build
```

构建完成后主要产物：

- 前端静态文件：`apps/client/dist`
- 后端入口：`apps/server/dist/index.js`
- 共享包构建：`packages/shared/dist`

## 5. 配置后端环境变量

生产环境至少配置这些变量：

```bash
export NODE_ENV=production
export PORT=3001
export CLIENT_ORIGIN=https://你的域名
export AUTH_STORE_PATH=/var/lib/doudizhu/auth-store.json
export AUTH_BACKUP_DIR=/var/lib/doudizhu/backups
export LOG_DIR=/var/lib/doudizhu/logs
```

说明：

- `PORT`：后端监听端口，默认是 `3001`。
- `CLIENT_ORIGIN`：允许访问 Socket.IO 的前端域名。多个域名可用英文逗号分隔，例如 `https://a.com,https://b.com`。
- `AUTH_STORE_PATH`：账号文件保存位置。建议放到 `/var/lib/doudizhu`，避免每次重新部署覆盖账号数据。

创建账号数据目录：

```bash
sudo mkdir -p /var/lib/doudizhu
sudo chown -R $USER:$USER /var/lib/doudizhu
```

注意：当前登录 token 仍保存在内存里，后端重启后用户需要重新登录；账号文件会保留。

## 6. 用 PM2 启动后端

安装 PM2：

```bash
sudo npm install -g pm2
```

在项目根目录启动：

```bash
cd /var/www/doudizhu/app
CLIENT_ORIGIN=https://你的域名 \
PORT=3001 \
AUTH_STORE_PATH=/var/lib/doudizhu/auth-store.json \
AUTH_BACKUP_DIR=/var/lib/doudizhu/backups \
LOG_DIR=/var/lib/doudizhu/logs \
pm2 start npm --name doudizhu-server -- --workspace apps/server run start
```

设置开机自启：

```bash
pm2 save
pm2 startup
```

查看状态：

```bash
pm2 status
pm2 logs doudizhu-server
```

不要用 PM2 cluster 多进程模式。当前房间、牌局和聊天在线状态都在单个 Node 进程内存里，多进程会导致玩家分散到不同进程。

## 7. 配置 Nginx

创建配置文件：

```bash
sudo nano /etc/nginx/sites-available/doudizhu
```

写入以下内容，把 `你的域名` 改成真实域名：

```nginx
server {
    listen 80;
    server_name 你的域名;

    root /var/www/doudizhu/app/apps/client/dist;
    index index.html;

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
}
```

启用站点并重载：

```bash
sudo ln -s /etc/nginx/sites-available/doudizhu /etc/nginx/sites-enabled/doudizhu
sudo nginx -t
sudo systemctl reload nginx
```

如果默认站点占用了域名，可以删除默认配置：

```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 8. 配置 HTTPS

如果你有域名，推荐使用 Certbot：

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
```

完成后，把 PM2 启动时的 `CLIENT_ORIGIN` 设置为 HTTPS 域名：

```bash
CLIENT_ORIGIN=https://你的域名
```

然后重启后端：

```bash
pm2 restart doudizhu-server --update-env
```

## 9. 验证部署

检查后端：

```bash
curl http://127.0.0.1:3001/health
curl https://你的域名/health
```

浏览器打开：

```text
https://你的域名/
```

手动验收：

1. 注册两个或三个账号。
2. 打开多个浏览器窗口登录。
3. 在大厅发送聊天，确认其他窗口实时收到。
4. 创建斗地主好友房。
5. 其他窗口输入房间号加入。
6. 三人准备、叫分、出牌、结算。
7. 对局中展开右下角聊天，确认仍可收发消息。

## 10. 更新部署

之后每次更新代码：

```bash
cd /var/www/doudizhu/app
git pull
npm ci
npm run typecheck
npm test
npm run build
pm2 restart doudizhu-server --update-env
sudo nginx -t
sudo systemctl reload nginx
```

如果只改了前端样式，也仍然需要 `npm run build`，Nginx 会继续读取新的 `apps/client/dist`。

## 11. 当前生产边界

当前版本适合云服务器演示和小范围试玩，但还不是完整商业生产版：

- 房间、牌局、聊天在线状态保存在内存中，后端重启会清空。
- 聊天记录只保留最近 50 条，且服务重启后清空。
- 账号保存到文件，不是数据库。
- 登录 token 保存在内存中，后端重启后需要重新登录。
- 不建议多进程或多台服务器部署，除非后续把房间和聊天状态迁移到 Redis 或数据库。
- 没有短信、邮箱、验证码、找回密码、反作弊、风控和正式隐私合规流程。

如果只是让朋友远程试玩，这个部署方案已经够用；如果要长期公开运营，下一步应优先做数据库、Redis 会话/房间状态、日志监控和 HTTPS/域名合规配置。
