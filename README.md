# auto-check

多平台每日自动签到脚本，基于 [Bun](https://bun.sh/) 开发，无额外依赖。

## 项目结构

```
index.ts                      # 入口：立即执行 或 启动定时任务
worker.ts                     # 供调度器直接调用的执行入口
src/
  types.ts                    # 平台接口定义
  runner.ts                   # 依次运行所有已启用的平台
  platforms/
    kurobbs/                  # 库洛社区 (鸣潮) 平台
      index.ts
      headers.txt             # 默认请求头参考（已内嵌至代码，无需读取）
    <new-platform>/           # 新增平台目录示例
      index.ts
```

## 支持的平台

| 平台 | 环境变量前缀 | 开启变量 |
|------|-------------|---------|
| 库洛社区 (KuroBBS) | `KUROBBS_` | `KUROBBS_ENABLED=true` |

## 环境变量配置

在项目根目录创建 `.env` 文件，按需填写对应平台的变量。

### 库洛社区 (KuroBBS / 鸣潮)

```env
# 启用此平台（必须设为 true 才会执行）
KUROBBS_ENABLED=true

# 必填
KUROBBS_TOKEN=你的Token
KUROBBS_USER_ID=你的UserId
KUROBBS_ROLE_ID=你的RoleId

# 可选（不填则使用默认值）
KUROBBS_GAME_ID=3
KUROBBS_SERVER_ID=76402e5b20be2c39f095a152090afddc
KUROBBS_IP_ADDR=执行环境的出口IP（用于替换 devCode 中的默认 IP）
```

## 运行

```bash
# 安装依赖
bun install

# 立即执行一次所有已启用的签到
bun index.ts

# 启动定时任务（每天 8:xx 随机分钟执行，进程保持运行）
bun index.ts --cron
# 或
CRON=true bun index.ts

# 直接执行 worker（供外部调度器调用，如 Docker / cron job）
bun worker.ts
```

## 新增平台

1. 在 `src/platforms/<平台名>/index.ts` 中实现 `CheckInPlatform` 接口：

```ts
import type { CheckInPlatform } from '../../types.ts'

export class MyPlatform implements CheckInPlatform {
  readonly name = '我的平台'

  isEnabled(): boolean {
    return process.env['MY_PLATFORM_ENABLED'] === 'true'
  }

  async run(): Promise<void> {
    // 签到逻辑
  }
}
```

2. 在 `src/runner.ts` 的 `ALL_PLATFORMS` 数组中添加实例：

```ts
import { MyPlatform } from './platforms/my-platform/index.ts'

const ALL_PLATFORMS: CheckInPlatform[] = [
  new KuroBBSPlatform(),
  new MyPlatform(),   // 新增
]
```

## 技术栈

- [Bun](https://bun.sh/) — 运行时 & 定时任务
- TypeScript

## 免责声明

本工具仅供学习交流使用，请勿用于非法用途。使用本脚本造成的任何后果由使用者本人承担。
