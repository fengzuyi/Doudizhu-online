# 云上棋牌室：在线斗地主 MVP

一个本机可演示的三人真人联机斗地主网页游戏。项目包含登录注册、游戏大厅、好友房创建/加入、斗地主叫分和出牌流程，适合学习和本地演示。

## 当前功能

- 账号注册、账号登录、退出登录
- 游戏大厅入口，当前只有“斗地主”可玩
- 创建好友房、输入房间号加入房间
- 三名真人玩家准备后自动发牌
- 轮流叫分：不叫、1 分、2 分、3 分
- 服务端判定出牌合法性
- 支持单张、对子、三张、三带一、三带二、顺子、连对、飞机、飞机带单、飞机带对、炸弹、王炸
- 底牌、上一手、当前回合、剩余牌数、地主标识、倍数和结算弹窗
- 对局中点击“离开”会弹确认框，防止误触
- 刷新、断线、离开房间后会清理前端房间状态并回到大厅

## 技术栈

- 前端：React 18、Vite、TypeScript、Socket.IO Client、Lucide React
- 后端：Node.js、Express、Socket.IO、TypeScript
- 共享包：牌组、规则、结算和类型定义
- 测试：Vitest
- 包管理：npm workspaces

## 项目结构

```text
.
├── apps
│   ├── client          # React 前端：登录、大厅、牌桌 UI
│   └── server          # Express + Socket.IO 后端
├── packages
│   └── shared          # 共享类型、牌组、牌型规则和结算逻辑
├── package.json        # 根 workspace 脚本
└── tsconfig.base.json  # 共享 TypeScript 配置
```

## 安装依赖

```powershell
npm install
```

## 启动项目

在项目根目录运行：

```powershell
npm run dev
```

默认服务地址：

- 前端：http://localhost:5173/
- 后端健康检查：http://localhost:3001/health

Vite 也会显示几个 `Network` 地址，例如 `http://192.168.x.x:5173/`。这些是局域网访问地址，本机测试通常直接用 `http://localhost:5173/` 即可。

## 停止项目

如果是在当前终端运行的 `npm run dev`，按：

```powershell
Ctrl + C
```

如果之前把服务留在后台，可以用 PowerShell 按项目路径停止相关 Node 进程：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*doudizhu*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
```

也可以按端口检查：

```powershell
Get-NetTCPConnection -LocalPort 3001,5173 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

## 本机三人试玩

推荐用三个相互独立的浏览器环境，例如 Chrome、Edge、无痕窗口，避免登录状态互相覆盖。

1. 打开三个窗口访问 `http://localhost:5173/`。
2. 分别注册或登录三个账号。
3. 第一个窗口进入大厅，点击“创建好友房”。
4. 复制房间号。
5. 另外两个窗口在大厅输入房间号并加入。
6. 三人都点击“准备”。
7. 按提示完成叫分、出牌和结算。
8. 对局中点击“离开”会先弹确认框；确认后回到大厅。

## 账号和数据说明

当前账号系统是本机演示版：

- 账号注册到后端本地文件。
- 账号文件位置：`apps/server/data/auth-store.json`
- token 会话仍在内存中，服务重启后需要重新登录。
- 房间和牌局也在内存中，服务重启后房间会消失。
- 删除 `apps/server/data/auth-store.json` 可以清空本机注册账号。

`apps/server/data/` 已放入 `.gitignore`，不会提交真实本机账号数据。

## 规则说明

- 使用 54 张牌，三人各 17 张，3 张底牌归地主。
- 发牌后随机一名玩家开始叫分。
- 三名玩家按座位顺序选择：不叫、1 分、2 分、3 分。
- 后叫分数必须大于当前最高分。
- 有人叫 3 分时立即成为地主。
- 一轮无人叫分会重新洗牌发牌。
- 一轮结束有人叫分时，最高分玩家成为地主。
- 叫分只决定地主，不改变结算倍数。
- 顺子、连对、飞机不允许包含 `2` 和大小王。
- 出牌必须同牌型、同长度且大于上一手。
- 炸弹可以压非炸弹，王炸最大。
- 每个炸弹或王炸都会让倍数翻倍。
- 一名玩家出完手牌后本局结束。
- 地主胜利：地主 `+2 * multiplier`，两个农民各 `-1 * multiplier`。
- 地主失败：地主 `-2 * multiplier`，两个农民各 `+1 * multiplier`。

## 常用命令

```powershell
npm run dev        # 同时启动后端和前端开发服务
npm run dev:server # 只启动后端
npm run dev:client # 只启动前端
npm run typecheck  # TypeScript 类型检查
npm test           # 运行 shared 和 server 测试
npm run build      # 构建 shared、server、client
```

生产构建后可启动后端：

```powershell
npm run build
npm --workspace apps/server run start
```

## 主要代码入口

- `apps/client/src/App.tsx`：前端主流程、Socket 事件、登录态和房间状态
- `apps/client/src/pages/LoginPage.tsx`：登录页和注册弹窗
- `apps/client/src/pages/GameHall.tsx`：游戏大厅
- `apps/client/src/styles.css`：整体视觉样式
- `apps/server/src/authManager.ts`：注册、登录、token 和账号文件存储
- `apps/server/src/createGameServer.ts`：HTTP API 和 Socket.IO 事件入口
- `apps/server/src/roomManager.ts`：房间状态机和服务端裁判逻辑
- `packages/shared/src/rules.ts`：牌型识别、压牌和结算
- `packages/shared/src/cards.ts`：牌组、洗牌、发牌和排序

## 当前边界

这个版本仍然是 MVP，目前不包含：

- 数据库
- 公网部署、HTTPS、域名
- 短信、邮箱、验证码、找回密码
- 复杂断线重连和续局恢复
- 机器人补位
- 匹配系统、排行榜、长期积分
- 春天、明牌、加倍等扩展规则
- 炸金花、麻将等其他游戏的真实玩法

## 常见问题

### 重启后房间没了？

正常。房间和牌局目前是后端内存状态，服务重启后会清空。

### 重启后账号还能登录吗？

可以。账号保存在 `apps/server/data/auth-store.json`。但登录 token 是内存状态，服务重启后需要重新登录一次。

### 想清空所有账号怎么办？

停止服务后删除：

```powershell
Remove-Item apps/server/data/auth-store.json -ErrorAction SilentlyContinue
```

### 前端打不开或房间创建失败？

先确认两个端口是否运行：

```powershell
Get-NetTCPConnection -LocalPort 3001,5173 -ErrorAction SilentlyContinue
```

如果端口没起来，重新运行：

```powershell
npm run dev
```
