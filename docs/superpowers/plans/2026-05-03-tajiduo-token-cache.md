# Tajiduo Token 缓存与刷新功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为塔吉多平台添加 token 缓存和自动刷新功能，支持 401 自动重试

**Architecture:** 创建通用 TokenManager 基类处理缓存读写，TajiduoTokenManager 继承它实现塔吉多特定的刷新逻辑，TajiduoPlatform 通过 requestWithRetry 方法包装所有请求

**Tech Stack:** TypeScript, Bun, fetch API

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/token-manager.ts` | 通用 TokenManager 基类，处理缓存读写 |
| `src/platforms/tajiduo/token-manager.ts` | TajiduoTokenManager，实现塔吉多刷新逻辑 |
| `src/platforms/tajiduo/index.ts` | TajiduoPlatform，集成 token 管理和重试逻辑 |
| `.gitignore` | 添加 `.cache/` 忽略规则 |

---

### Task 1: 更新 .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 添加 .cache/ 到 .gitignore**

在 `.gitignore` 文件末尾添加：

```
# token cache
.cache/
```

- [ ] **Step 2: 提交**

```bash
git add .gitignore
git commit -m "chore: add .cache/ to gitignore"
```

---

### Task 2: 创建通用 TokenManager 基类

**Files:**
- Create: `src/token-manager.ts`

- [ ] **Step 1: 创建 TokenManager 类**

创建 `src/token-manager.ts`：

```typescript
import { mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'

const CACHE_DIR = resolve(import.meta.dirname, '../.cache')

export interface TokenCache {
  accessToken: string
  refreshToken: string
}

export abstract class TokenManager {
  private cachePath: string

  constructor(platformName: string) {
    this.cachePath = resolve(CACHE_DIR, `${platformName}.json`)
  }

  async getTokens(): Promise<TokenCache | null> {
    try {
      const file = Bun.file(this.cachePath)
      if (!(await file.exists())) return null
      const data = await file.json() as TokenCache
      if (!data.accessToken || !data.refreshToken) return null
      return data
    } catch {
      return null
    }
  }

  async saveTokens(accessToken: string, refreshToken: string): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true })
    await Bun.write(this.cachePath, JSON.stringify({ accessToken, refreshToken }, null, 2))
  }

  abstract refreshTokens(refreshToken: string): Promise<TokenCache>
}
```

- [ ] **Step 3: 提交**

```bash
git add src/token-manager.ts
git commit -m "feat: add base TokenManager class for token caching"
```

---

### Task 3: 创建 TajiduoTokenManager

**Files:**
- Create: `src/platforms/tajiduo/token-manager.ts`

- [ ] **Step 1: 创建 TajiduoTokenManager 类**

创建 `src/platforms/tajiduo/token-manager.ts`：

```typescript
import { TokenManager } from '../../token-manager.ts'
import type { TokenCache } from '../../token-manager.ts'

const REFRESH_TOKEN_URL = 'https://bbs-api.tajiduo.com/usercenter/api/refreshToken'

export class TajiduoTokenManager extends TokenManager {
  constructor() {
    super('tajiduo')
  }

  async refreshTokens(refreshToken: string): Promise<TokenCache> {
    const res = await fetch(REFRESH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': refreshToken
      }
    })
    const data = await res.json() as { code: number; msg: string; data: TokenCache }

    if (data.code !== 0) {
      throw new Error(`[Tajiduo] 刷新 token 失败: ${data.msg}`)
    }

    return {
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/platforms/tajiduo/token-manager.ts
git commit -m "feat: add TajiduoTokenManager for tajiduo token refresh"
```

---

### Task 4: 改造 TajiduoPlatform

**Files:**
- Modify: `src/platforms/tajiduo/index.ts`

- [ ] **Step 1: 重写 TajiduoPlatform**

替换 `src/platforms/tajiduo/index.ts` 的完整内容：

```typescript
import { resolve } from 'path'
import type { CheckInPlatform } from '../../types.ts'
import { TajiduoTokenManager } from './token-manager.ts'

const INIT_SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/sign/rewards'
const SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/sign'
const CHECK_SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/signin/state'

interface SignInState {
  code: number
  msg: string
  ok: boolean
  data: {
    todaySign: boolean
  }
}

interface TokenRefreshError extends Error {
  status?: number
}

export class TajiduoPlatform implements CheckInPlatform {
  readonly name = '塔吉多 (Tajiduo)'
  private tokenManager = new TajiduoTokenManager()

  private get config() {
    const refreshToken = process.env['TAJIDUO_REFRESH_TOKEN']
    const roleId = process.env['TAJIDUO_ROLE_ID']
    const gameId = process.env['TAJIDUO_GAME_ID'] ?? '1289'

    if (!refreshToken) throw new Error('[Tajiduo] TAJIDUO_REFRESH_TOKEN 未配置')
    if (!roleId) throw new Error('[Tajiduo] TAJIDUO_ROLE_ID 未配置')

    return { refreshToken, roleId, gameId }
  }

  isEnabled(): boolean {
    return process.env['TAJIDUO_ENABLED'] === 'true'
  }

  private async buildHeaders(token: string): Promise<Headers> {
    const rawHeaders = await Bun.file(resolve(import.meta.dirname, 'headers.txt')).text()
    const DEFAULT_HEADERS = Object.fromEntries(
      rawHeaders
        .split('\n')
        .filter((line) => line.includes(':'))
        .map((line) => {
          const [k, v] = line.split(':', 2)
          return [k!.trim(), v!.trim()]
        }),
    )

    const headers = new Headers(DEFAULT_HEADERS)
    headers.set('Authorization', token)
    return headers
  }

  private buildFormData(): URLSearchParams {
    const { roleId, gameId } = this.config
    return new URLSearchParams({ roleId, gameId })
  }

  private async requestWithRetry<T>(requestFn: (token: string) => Promise<T>): Promise<T> {
    let tokens = await this.tokenManager.getTokens()

    if (!tokens) {
      tokens = await this.tokenManager.refreshTokens(this.config.refreshToken)
      await this.tokenManager.saveTokens(tokens.accessToken, tokens.refreshToken)
    }

    try {
      return await requestFn(tokens.accessToken)
    } catch (err) {
      const tokenErr = err as TokenRefreshError
      if (tokenErr.status === 401) {
        const newTokens = await this.tokenManager.refreshTokens(tokens.refreshToken)
        await this.tokenManager.saveTokens(newTokens.accessToken, newTokens.refreshToken)

        try {
          return await requestFn(newTokens.accessToken)
        } catch (retryErr) {
          const retryTokenErr = retryErr as TokenRefreshError
          if (retryTokenErr.status === 401) {
            throw new Error('[Tajiduo] refreshToken 已失效，请重新登录获取')
          }
          throw retryErr
        }
      }
      throw err
    }
  }

  private async initSignIn() {
    const { gameId } = this.config
    await this.requestWithRetry(async (token) => {
      const res = await fetch(`${INIT_SIGN_IN_URL}?gameId=${gameId}`, {
        headers: await this.buildHeaders(token)
      })
      if (res.status === 401) {
        const err = new Error('Unauthorized') as TokenRefreshError
        err.status = 401
        throw err
      }
    })
  }

  private async checkAlreadySignedIn() {
    const { gameId } = this.config
    return await this.requestWithRetry(async (token) => {
      const res = await fetch(`${CHECK_SIGN_IN_URL}?gameId=${gameId}`, {
        headers: await this.buildHeaders(token)
      })
      if (res.status === 401) {
        const err = new Error('Unauthorized') as TokenRefreshError
        err.status = 401
        throw err
      }
      const data = await res.json() as SignInState
      return data && data.data?.todaySign
    })
  }

  private async signIn(): Promise<void> {
    await this.requestWithRetry(async (token) => {
      const res = await fetch(SIGN_IN_URL, {
        method: 'POST',
        headers: {
          ...(await this.buildHeaders(token)),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: this.buildFormData(),
      })
      if (res.status === 401) {
        const err = new Error('Unauthorized') as TokenRefreshError
        err.status = 401
        throw err
      }
      const data = await res.json() as SignInState
      console.log(`[Tajiduo] ${data.msg}`)
    })
  }

  async run(): Promise<void> {
    await this.initSignIn()
    await randomDelay(300, 1000)

    const alreadySignedIn = await this.checkAlreadySignedIn()
    if (alreadySignedIn) {
      console.log(`[Tajiduo] 今日已签到，跳过`)
      return
    }

    await this.signIn()
  }
}

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

- [ ] **Step 2: 提交**

```bash
git add src/platforms/tajiduo/index.ts
git commit -m "feat: integrate token refresh and retry logic to TajiduoPlatform"
```

---

### Task 5: 验证构建

**Files:**
- None

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
bunx tsc --noEmit
```

预期：无错误输出

- [ ] **Step 2: 修复可能的类型错误（如有）**

如果类型检查失败，根据错误信息修复问题。

- [ ] **Step 3: 提交修复（如有）**

```bash
git add -A
git commit -m "fix: resolve type errors"
```
