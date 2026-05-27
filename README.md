# 云上棋牌室

一个基于 `React + Vite + TypeScript`、`Node.js + Express + Socket.IO + TypeScript` 的在线棋牌游戏 MVP。

当前支持：

- 斗地主：三人真人联机、叫分、出牌、结算。
- 炸金花：多人好友房、看牌、下注、弃牌、比牌、结算。
- 打板子：四人好友房、包了、叫队友、隐藏身份、出牌收牌结算。
- 账号注册/登录：后端本地存储账号，登录 token 保存在前端。
- 大厅聊天：登录用户可在大厅和牌局中使用同一个实时聊天频道。

本项目主要用于学习、演示和本机/云服务器部署测试，不涉及真钱、支付、排行榜或真实用户体系。

## 技术栈

- 前端：React 18、Vite、TypeScript、Socket.IO Client、lucide-react
- 后端：Node.js、Express、Socket.IO、TypeScript
- 共享包：TypeScript 类型、斗地主规则、炸金花规则、打板子规则
- 包管理：npm workspace

## 项目结构

```text
.
├─ apps/
│  ├─ client/              # React/Vite 前端
│  │  └─ src/
│  │     ├─ pages/         # 登录、大厅、牌桌页面
│  │     ├─ App.tsx
│  │     └─ styles.css
│  └─ server/              # Express + Socket.IO 后端
│     └─ src/
│        ├─ createGameServer.ts
│        ├─ roomManager.ts
│        ├─ zjhRoomManager.ts
│        ├─ auth.ts
│        └─ logger.ts
├─ packages/
│  └─ shared/              # 共享类型和规则
│     └─ src/
│        ├─ types.ts
│        ├─ zjh.ts
│        └─ index.ts
├─ DEPLOYMENT.md           # 云服务器/宝塔部署说明
└─ package.json
```

## 环境要求

建议使用：

- Node.js `18+`
- npm `8+`

如果服务器上还是 Node 12，会导致 TypeScript、Vite 等工具无法运行。

检查版本：

```bash
node -v
npm -v
```

## 安装依赖

在项目根目录执行：

```bash
npm install
```

如果是在服务器上重新按 `package-lock.json` 安装：

```bash
npm ci --include=dev
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

Vite 启动时可能会显示多个 `Network` 地址，它们是当前电脑不同网卡的局域网地址。一般本机访问用 `http://localhost:5173/` 即可。

## 停止项目

在运行 `npm run dev` 的终端按：

```text
Ctrl + C
```

如果需要在 PowerShell 中检查端口：

```powershell
Get-NetTCPConnection -LocalPort 3001,5173 -ErrorAction SilentlyContinue
```

如果需要结束当前目录相关的 Node 进程：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*doudizhu*' -and $_.Name -eq 'node.exe' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
```

## 常用命令

```bash
# 启动开发环境
npm run dev

# 只启动后端
npm run dev:server

# 只启动前端
npm run dev:client

# 类型检查
npm run typecheck

# 单元测试和集成测试
npm test

# 生产构建
npm run build
```

## 登录与账号

当前账号系统是轻量演示版：

- 注册账号会保存到后端本地 JSON 文件。
- 默认账号文件在 `apps/server/data/auth-store.json`。
- 账号会持久化，服务重启后仍可登录。
- 登录 token 是内存会话，后端重启后需要重新登录。
- 没有短信、邮箱、验证码、找回密码和真实用户风控。

前端本地存储：

- `doudizhu:authToken`
- `doudizhu:authProfile`
- `doudizhu:nickname`

## 大厅聊天

大厅和牌局共用一个全局实时聊天频道：

- 登录后自动加入聊天。
- 消息通过 Socket.IO 实时广播。
- 后端只保留最近 50 条消息。
- 服务重启后聊天记录清空。
- 发送消息需要有效登录 token。

## 斗地主规则

当前斗地主为三人真人联机 MVP：

- 使用 54 张牌。
- 三人各 17 张，3 张底牌归地主。
- 房间满 3 人并全部准备后开始。
- 叫地主采用叫分制：不叫 / 1 分 / 2 分 / 3 分。
- 起始叫分玩家随机，之后按座位顺序叫分。
- 后叫分数必须大于当前最高分。
- 有人叫 3 分时立即成为地主。
- 三人都不叫会重新洗牌发牌。
- 叫分只决定地主，不影响倍数。
- 炸弹和王炸会让倍数翻倍。

支持牌型：

- 单张、对子、三张
- 三带一、三带二
- 顺子、连对
- 飞机、飞机带单、飞机带对
- 炸弹、王炸

结算规则：

- 基础分为 1。
- 地主胜利：地主 `+2 * multiplier`，农民各 `-1 * multiplier`。
- 地主失败：地主 `-2 * multiplier`，农民各 `+1 * multiplier`。

## 炸金花规则

当前炸金花为多人好友房 MVP：

- 使用 52 张牌，不含大小王。
- 每名玩家 3 张牌。
- 支持看牌、跟注、下注/加注、弃牌、比牌。
- 牌型大小：豹子 > 同花顺 > 金花 > 顺子 > 对子 > 单张。
- 顺子支持 A23，顺子大小中 `JQK < A23 < QKA`。
- 第一轮结束前所有玩家不能比牌。
- 未看牌玩家不能主动找别人比牌，除非场上只剩两名未弃牌玩家。
- 比牌后，只有发起比牌的玩家能临时看到被比较玩家的牌面，看完后自动隐藏。

下注规则：

- 闷牌玩家只能下注 `1`、`2`。
- 看牌玩家只能下注 `1`、`2`、`5`。
- 闷牌下注 `1` 等价于看牌下注 `2`。
- 闷牌下注 `2` 等价于看牌下注 `5`。

## 打板子规则

当前打板子为四人好友房 MVP：

- 使用 52 张牌，不含大小王。
- 四人各 13 张牌。
- 牌面大小：`3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2`。
- 发牌后先判定春天，春天直接获胜。
- 春天未出现时进入“包了”选择，每人一次机会。
- 有人包了则进入 `1v3`，包了玩家连续主动出牌 3 次。
- 无人包了则由黑桃 7 玩家叫队友，队友身份隐藏。
- 被叫的牌打出后，队友身份公开。
- 每轮所有其他玩家不出后，最后成功出牌者收走本轮打出的牌张数。
- 结算只展示胜负和收牌数，不维护积分。

支持牌型：

- 单张、对子、三张
- 顺子、连对
- 四张炸弹
- 三滚筒、四滚筒

压制关系：

- 同牌型比较点数。
- 三张可压单张、对子和更小三张。
- 连对可压单张、对子、三张、顺子和更小连对。
- 炸弹可压除滚筒炮外的所有牌型。
- 滚筒炮最大，四滚筒大于三滚筒。

## 本地验收流程

### 斗地主

1. 运行 `npm run dev`。
2. 打开 3 个浏览器窗口访问 `http://localhost:5173/`。
3. 分别注册或登录不同账号。
4. 在大厅选择斗地主。
5. 一名玩家创建房间，另外两名玩家输入房间号加入。
6. 三人准备，完成叫分、出牌和结算。

### 炸金花

1. 运行 `npm run dev`。
2. 打开多个浏览器窗口访问 `http://localhost:5173/`。
3. 分别登录不同账号。
4. 在大厅选择炸金花。
5. 创建或加入房间。
6. 全员准备后测试看牌、下注、弃牌、比牌和结算。

### 打板子

1. 运行 `npm run dev`。
2. 打开 4 个浏览器窗口访问 `http://localhost:5173/`。
3. 分别登录不同账号。
4. 在大厅选择打板子。
5. 一名玩家创建房间，另外三名玩家输入房间号加入。
6. 四人准备后测试包了/不包、叫队友、出牌、不出、收牌和结算。

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
PORT=3001
CLIENT_ORIGIN=http://你的域名或服务器IP
AUTH_STORE_PATH=/www/wwwroot/doudizhu/apps/server/data/auth-store.json
LOG_DIR=/www/wwwroot/doudizhu/apps/server/logs
LOG_TO_FILE=true
```

如果使用宝塔和 PM2 管理，请参考：

```text
DEPLOYMENT.md
```

部署时通常需要：

- 用 PM2 启动后端 Node 服务。
- 用 Nginx 托管前端 `apps/client/dist`。
- 将 `/api` 和 `/socket.io` 反向代理到后端端口。
- 放行服务器安全组和宝塔防火墙中的 HTTP/HTTPS 端口。

## 运行数据

当前项目为了简单演示，没有接数据库：

- 账号：后端 JSON 文件持久化。
- 登录会话：后端内存，重启失效。
- 斗地主房间：后端内存，重启清空。
- 炸金花房间：后端内存，重启清空。
- 打板子房间：后端内存，重启清空。
- 聊天记录：后端内存最近 50 条，重启清空。
- 日志：可写入 `apps/server/logs/`。

## 当前边界

暂未实现：

- 数据库账号系统
- 短信/邮箱验证
- 找回密码
- 真实好友系统
- 私聊
- 排行榜
- 支付或真钱玩法
- 机器人
- 复杂断线续局
- 反作弊和风控

这些功能适合在当前 MVP 稳定后逐步补上。
