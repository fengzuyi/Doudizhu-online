# 云上棋牌室

一个基于 `React + Vite + TypeScript`、`Node.js + Express + Socket.IO + TypeScript` 的在线棋牌游戏 MVP。

当前支持：

- 斗地主：三人真人联机、叫分、出牌、结算。
- 炸金花：多人好友房、看牌、下注、弃牌、比牌、结算。
- 打板子：四人好友房、包了、叫队友、隐藏身份、出牌收牌结算。
- 账号系统：MySQL + Prisma 持久化账号和登录会话，支持同账号单设备登录。
- 大厅聊天：登录用户在大厅和牌局共用一个实时聊天频道。

本项目用于学习、演示和部署测试，不涉及真钱、支付、排行榜或真实风控体系。

## 技术栈

- 前端：React 18、Vite、TypeScript、Socket.IO Client、lucide-react
- 后端：Node.js、Express、Socket.IO、TypeScript
- 数据库：MySQL、Prisma
- 共享包：TypeScript 类型与斗地主、炸金花、打板子规则
- 包管理：npm workspaces

## 项目结构

```text
.
├─ apps/
│  ├─ client/              # React/Vite 前端
│  └─ server/              # Express + Socket.IO 后端
│     ├─ prisma/           # Prisma schema 和 migration
│     └─ src/
├─ packages/
│  └─ shared/              # 共享类型和规则
├─ DEPLOYMENT.md           # 宝塔/云服务器部署说明
└─ package.json
```

## 环境要求

- Node.js `18.19+` 或 Node.js 20 LTS
- npm `8+`
- MySQL `5.7+` 或 `8.x`

服务器上如果还是 Node 12，会导致 TypeScript、Vite、Prisma 等工具无法运行。

## 安装依赖

```bash
npm install
```

服务器上按锁文件安装：

```bash
npm ci --include=dev
```

## 数据库配置

先创建 MySQL 数据库，例如 `doudizhu`，然后配置后端环境变量：

```bash
DATABASE_URL=mysql://用户名:密码@127.0.0.1:3306/doudizhu
AUTH_SESSION_TTL_DAYS=30
```

首次初始化数据库：

```bash
npm --workspace apps/server run db:generate
npm --workspace apps/server run db:deploy
```

现在也可以把本地数据库配置直接写到 `apps/server/.env`：

```env
DATABASE_URL="mysql://root:你的密码@127.0.0.1:3306/doudizhu"
AUTH_SESSION_TTL_DAYS=30
```

之后执行 `npm run dev` 时，后端会自动创建数据库、生成 Prisma Client，并执行已存在的数据库迁移。

本地 PowerShell 示例：

```powershell
$env:DATABASE_URL="mysql://root:你的密码@127.0.0.1:3306/doudizhu"
$env:AUTH_SESSION_TTL_DAYS="30"
npm run dev
```

## 本地启动

开发模式同时启动前端和后端：

```bash
npm run dev
```

默认地址：

- 前端：http://localhost:5173/
- 后端：http://localhost:3001/
- 健康检查：http://localhost:3001/health

Vite 启动时可能显示多个 `Network` 地址，那是当前电脑不同网卡的局域网地址。本机访问通常用 `http://localhost:5173/`。

## 停止项目

运行 `npm run dev` 的终端按：

```text
Ctrl + C
```

PowerShell 检查端口：

```powershell
Get-NetTCPConnection -LocalPort 3001,5173 -ErrorAction SilentlyContinue
```

结束当前项目相关 Node 进程：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*doudizhu*' -and $_.Name -eq 'node.exe' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
```

## 常用命令

```bash
npm run dev
npm run dev:server
npm run dev:client
npm run typecheck
npm test
npm run build

npm run db:init
npm --workspace apps/server run db:generate
npm --workspace apps/server run db:migrate
npm --workspace apps/server run db:deploy
```

## 账号与登录

账号系统已数据库化：

- 注册账号写入 MySQL `User` 表。
- 登录会话写入 MySQL `UserSession` 表。
- 服务端只保存 token 的 SHA-256 hash，不保存明文 token。
- 登录态默认有效期为 `AUTH_SESSION_TTL_DAYS=30` 天。
- 同账号只允许一个设备在线，新设备登录后旧设备会收到下线提示。
- 不迁移旧 JSON 账号，上线数据库版后用户需要重新注册。

暂未实现短信、邮箱、验证码、找回密码、头像上传和管理后台。

## 大厅聊天

- 大厅和牌局共用一个全局实时聊天频道。
- 发送消息需要有效登录会话。
- 后端只保留最近 50 条消息在内存中。
- 服务重启后聊天记录清空。

## 运行数据

当前持久化：

- 账号：MySQL
- 登录会话：MySQL
- 日志：可写入 `LOG_DIR`

当前仍为内存状态：

- 斗地主房间和牌局
- 炸金花房间和牌局
- 打板子房间和牌局
- 大厅聊天最近 50 条消息

后端重启会清空房间、牌局和聊天最近消息，但不会清空账号和登录会话。

## 部署

生产构建：

```bash
npm run build
```

启动后端：

```bash
npm --workspace apps/server run start
```

常用后端环境变量：

```bash
NODE_ENV=production
PORT=3001
CLIENT_ORIGIN=https://你的域名
DATABASE_URL=mysql://用户名:密码@127.0.0.1:3306/doudizhu
AUTH_SESSION_TTL_DAYS=30
LOG_DIR=/www/server/doudizhu-data/logs
LOG_TO_FILE=true
```

宝塔和 PM2 部署请看 [DEPLOYMENT.md](DEPLOYMENT.md)。
