# 部署指南

适用环境：宝塔面板 + Nginx + PM2 + MySQL。

推荐目录：

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

安全组只开放：

- `80`
- `443`
- `22`

`3001` 只给本机 Nginx 反向代理使用，不需要对公网开放。

## 2. 创建数据库

宝塔创建 MySQL 数据库：

- 数据库名：`doudizhu`
- 用户名：`doudizhu`
- 权限：本地服务器

数据库连接串格式：

```env
DATABASE_URL=mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu
```

如果密码包含 `@`、`#`、`/`、`:` 等特殊字符，需要 URL 编码，或改成更简单的数据库密码。

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

## 4. 宝塔网站

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

## 5. PM2 面板

宝塔 PM2 项目填写：

- 项目名称：`doudizhu-server`
- Node 版本：`v20.x`
- 启动文件：`/www/wwwroot/doudizhu/apps/server/dist/index.js`
- 运行目录：`/www/wwwroot/doudizhu`
- 负载实例数量：`1`
- 自动重载：关闭
- 包管理器：`npm`
- 参数：留空

环境变量：

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

创建日志目录：

```bash
mkdir -p /www/server/doudizhu-data/logs
```

## 6. 验证

```bash
curl http://127.0.0.1:3001/health
curl https://你的域名/health
```

浏览器访问：

```text
https://你的域名/
https://你的域名/admin
```

## 7. 更新部署

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

## 8. 常用排查

查看后端日志：

```bash
pm2 logs doudizhu-server --lines 100
```

检查端口：

```bash
lsof -i:3001
```

`db:deploy` 报 `DATABASE_URL` 缺失时，先执行：

```bash
export DATABASE_URL='mysql://doudizhu:你的数据库密码@127.0.0.1:3306/doudizhu'
```

页面能打开但实时功能异常时，优先检查 Nginx 的 `/socket.io/` 反向代理。
