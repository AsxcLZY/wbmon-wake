# wbmon-wake · WorkBuddy 云端服务心跳唤醒器

WorkBuddy 的云端托管沙箱是**请求驱动**的：一段时间没有外部请求就会休眠，休眠期间不会跑签到、猫猫旅行、成长任务。

这个仓库只做一件事——用 **GitHub Actions 定时打一下公开的 `/health`**，让沙箱保持活跃，并把每一轮的结果（tickCount、令牌剩余天数、告警）写进 Actions 的 Job Summary。电脑关机也能跑。

## 安全性

- 只访问 `/health`。这是云端唯一**公网无鉴权**的端点，设计上只暴露数量类信息（uptime、tickCount、账号数、令牌剩余天数），不含昵称、余额、任务明细。
- **不**访问 `/status`、`/log`、`/tick`、`/config`、`/digest` 等需要 `access_key` 的端点。
- 仓库里不存在任何密钥。`access_key`、`refreshToken` 一律不进 Git（`.gitignore` 已兜底）。

## 用法

### 1. 建仓库并推上去

```bash
git init -b main
git add -A
git commit -m "feat: GitHub Actions 定时唤醒云端服务"
git remote add origin git@github.com:<你的用户名>/wbmon-wake.git
git push -u origin main
```

> 推公网仓库还是私有仓库都行。私有仓库的 Actions 有每月 2000 分钟免费额度，本工作流每次约 20~40 秒、每 30 分钟一次，月耗约 500 分钟，够用。公网仓库则完全免费。

### 2. 改地址（可选）

默认地址写在 `scripts/wake.mjs` 的 `DEFAULT_ENDPOINT`，也支持用仓库变量覆盖：
Settings → Secrets and variables → Actions → Variables → New variable，名 `WBMON_ENDPOINT`，值为你的服务地址（不带 `/health`）。

改完手动跑一次：Actions → `wake` → Run workflow。也可以在该页面临时填一个 `endpoint` 覆盖值做测试。

### 3. 调频率

改 `.github/workflows/wake.yml` 里的 cron：

| 需求 | cron |
| --- | --- |
| 每 30 分钟（默认） | `*/30 * * * *` |
| 每 20 分钟（对齐 tickMinutes） | `*/20 * * * *` |
| 每小时 | `0 * * * *` |
| 每天 8 点、14 点、20 点 | `0 0,6,12 * * *` |

注意 GitHub 的定时任务**最小间隔 5 分钟**，且高峰期有 5~15 分钟抖动，这属于正常现象，不影响保活。

## 判定逻辑

| 情况 | 退出码 | 说明 |
| --- | --- | --- |
| HTTP 200 且 `ok: true` | 0 | 服务存活 |
| 连不上 / 非 200 / `ok` 不为 true | 1 | Actions 标红并给你发失败邮件 |
| `tickCount` 未增长 | 0 | 只在 Summary 里提示，不算失败（冷启动时这一轮可能还没跑完） |

失败会自动重试 4 次，每次间隔 15 秒，单次超时 45 秒——冷启动首包偶尔要两三秒。

Job Summary 会输出一张表：结果、HTTP、耗时、`tickCount` 及与上次的对比、`uptimeMinutes`、`staleHours`、令牌剩余天数、告警。另外 `staleHours > 26` 时会单独提示，意思是业务链路已经很久没有成功跑过一轮了。

## 本地直接用

不依赖 GitHub 也能跑，需要 Node 18+：

```bash
node scripts/wake.mjs            # 或双击 wake.cmd（Windows）
```

`tickCount` 基线存在本地的 `.wake-state.json`（已 gitignore）。在 Actions 里这份基线通过 `actions/cache` 跨 run 保留。

## 已知限制

- **仓库 60 天无活动，GitHub 会自动停用定时工作流**。给仓库点个 star 或偶尔提交一次即可重置；收到停用邮件时进 Actions 页面点 "Enable workflow"。
- Actions 从 GitHub 的机器发起请求，出口 IP 是公共云厂商网段，个别服务可能对此有限制（本服务没有）。
- 这不是"部署服务"，而是"部署调度器"——真正跑业务的仍是云端那台托管沙箱，本仓库只负责按时敲门。

## 目录

```
.github/workflows/wake.yml   定时工作流
scripts/wake.mjs             心跳脚本（零依赖）
wake.cmd                     Windows 一键运行
.wake-state.json             本地 tick 基线（不入库）
```
