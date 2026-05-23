# 在线斗地主 MVP

一个本机可演示的三人真人联机斗地主网页游戏。前端使用 React + Vite + TypeScript，后端使用 Node.js + Express + Socket.IO + TypeScript，牌型判断和共享类型放在 workspace 共享包里。

## 功能

- 创建房间、输入房间号加入房间
- 三名真人玩家准备后自动发牌
- 叫地主、抢地主、不叫、不抢
- 服务端校验出牌是否合法
- 支持单张、对子、三张、三带一、三带二、顺子、连对、飞机、飞机带单、飞机带对、炸弹、王炸
- 底牌展示、上一手牌展示、回合记录、倍数和结算弹窗
- 服务端只把当前玩家自己的完整手牌发给本人，其他玩家只显示剩余牌数

## 技术栈

- 前端：React 18、Vite、TypeScript、Socket.IO Client、Lucide React
- 后端：Node.js、Express、Socket.IO、TypeScript、tsx
- 测试：Vitest
- 包管理：npm workspaces

## 项目结构

```text
.
├── apps
│   ├── client          # React 牌桌界面
│   └── server          # Express + Socket.IO 游戏服务器
├── packages
│   └── shared          # 共享类型、牌组、规则和结算逻辑
├── package.json        # 根 workspace 脚本
└── tsconfig.base.json  # 共享 TypeScript 配置
```

## 快速开始

安装依赖：

```powershell
npm install
```

启动本地开发服务：

```powershell
npm run dev
```

默认地址：

- 前端：http://localhost:5173/
- 后端健康检查：http://localhost:3001/health

## 本机三人联机测试

1. 打开三个浏览器窗口，访问 `http://localhost:5173/`。
2. 第一个窗口输入昵称并创建房间。
3. 复制房间号，在另外两个窗口输入不同昵称并加入房间。
4. 三个窗口都点击“准备”。
5. 按界面提示完成叫地主、抢地主和出牌。

## 常用命令

```powershell
npm run dev        # 同时启动服务端和前端开发服务
npm run build      # 构建 shared、server、client
npm test           # 运行 shared 和 server 测试
npm run typecheck  # 运行 TypeScript 类型检查
```

也可以分别启动：

```powershell
npm run dev:server
npm run dev:client
```

## 规则说明

- 使用 54 张牌，三人各 17 张，3 张底牌归地主。
- 顺子、连对、飞机不允许包含 `2` 和大小王。
- 出牌必须同牌型、同长度且大于上一手。
- 炸弹可以压非炸弹，王炸最大。
- 每个炸弹或王炸都会让倍数翻倍。
- 一名玩家出完手牌后本局结束。
- 地主胜利：地主 `+2 * multiplier`，两个农民各 `-1 * multiplier`。
- 地主失败：地主 `-2 * multiplier`，两个农民各 `+1 * multiplier`。

## 当前边界

这是学习和演示用 MVP，目前不包含：

- 账号、登录、数据库或长期积分
- 公网部署、HTTPS、域名配置
- 机器人补位
- 匹配系统、排行榜、反作弊
- 春天、明牌、加倍等地方或平台扩展规则
- 复杂断线重连和续局恢复

## 主要代码入口

- `packages/shared/src/rules.ts`：牌型识别、压牌和结算
- `packages/shared/src/cards.ts`：牌组、洗牌、发牌和排序
- `apps/server/src/roomManager.ts`：房间状态机和服务端裁判逻辑
- `apps/server/src/createGameServer.ts`：Socket.IO 事件入口
- `apps/client/src/App.tsx`：前端页面和交互

## 停止后台开发服务

如果曾经用后台方式启动过本项目，可以用下面的 PowerShell 命令停止相关 Node 进程：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*doudizhu*' -and $_.Name -eq 'node.exe' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId }
```
