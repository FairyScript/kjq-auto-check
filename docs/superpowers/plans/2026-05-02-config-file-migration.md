# Config File Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace env-based configuration with a JSON config file (`config.json`) supporting multiple accounts per platform.

**Architecture:** A new `src/config.ts` module loads and validates `config.json`. Platform classes receive config via constructor instead of reading `process.env`. A platform registry in `src/platforms/index.ts` maps platform names to classes. The runner iterates config entries, instantiates platforms, and calls `run()`.

**Tech Stack:** Bun, TypeScript, zero external dependencies

---

### Task 1: Create config types and loader

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: Create `src/config.ts` with types and loader**

```ts
import { resolve } from 'path'

export interface KuroBBSConfig {
  enabled: boolean
  token: string
  roleId: string
  userId: string
  gameId: string
  serverId: string
  ipAddr?: string
}

export interface TajiduoConfig {
  enabled: boolean
  token: string
  roleId: string
  gameId: string
}

export interface AppConfig {
  kurobbs?: KuroBBSConfig[]
  tajiduo?: TajiduoConfig[]
}

const KUROBBS_DEFAULTS = {
  gameId: '3',
  serverId: '76402e5b20be2c39f095a152090afddc',
} as const

const TAJIDUO_DEFAULTS = {
  gameId: '1289',
} as const

function validateKuroBBSEntry(raw: Record<string, unknown>, index: number): KuroBBSConfig {
  const tag = `kurobbs[${index}]`
  if (typeof raw.token !== 'string' || !raw.token) throw new Error(`[${tag}] token 未配置`)
  if (typeof raw.roleId !== 'string' || !raw.roleId) throw new Error(`[${tag}] roleId 未配置`)
  if (typeof raw.userId !== 'string' || !raw.userId) throw new Error(`[${tag}] userId 未配置`)

  return {
    enabled: raw.enabled !== false,
    token: raw.token as string,
    roleId: raw.roleId as string,
    userId: raw.userId as string,
    gameId: (raw.gameId as string) ?? KUROBBS_DEFAULTS.gameId,
    serverId: (raw.serverId as string) ?? KUROBBS_DEFAULTS.serverId,
    ipAddr: raw.ipAddr as string | undefined,
  }
}

function validateTajiduoEntry(raw: Record<string, unknown>, index: number): TajiduoConfig {
  const tag = `tajiduo[${index}]`
  if (typeof raw.token !== 'string' || !raw.token) throw new Error(`[${tag}] token 未配置`)
  if (typeof raw.roleId !== 'string' || !raw.roleId) throw new Error(`[${tag}] roleId 未配置`)

  return {
    enabled: raw.enabled !== false,
    token: raw.token as string,
    roleId: raw.roleId as string,
    gameId: (raw.gameId as string) ?? TAJIDUO_DEFAULTS.gameId,
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = resolve(process.cwd(), 'config.json')
  const file = Bun.file(configPath)

  if (!(await file.exists())) {
    throw new Error('config.json 未找到，请参考 config.example.json 创建配置文件')
  }

  const raw: Record<string, unknown> = await file.json()
  const config: AppConfig = {}

  if (Array.isArray(raw.kurobbs)) {
    config.kurobbs = raw.kurobbs.map((entry, i) => validateKuroBBSEntry(entry, i))
  }

  if (Array.isArray(raw.tajiduo)) {
    config.tajiduo = raw.tajiduo.map((entry, i) => validateTajiduoEntry(entry, i))
  }

  return config
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `bun build src/config.ts --outdir /dev/null 2>&1 || echo "BUILD CHECK"`
Expected: No type errors

---

### Task 2: Create platform registry

**Files:**
- Create: `src/platforms/index.ts`

- [ ] **Step 1: Create `src/platforms/index.ts`**

```ts
import { KuroBBSPlatform } from './kurobbs/index.ts'
import { TajiduoPlatform } from './tajiduo/index.ts'
import type { CheckInPlatform } from '../types.ts'
import type { KuroBBSConfig, TajiduoConfig } from '../config.ts'

export const platforms: Record<string, new (config: never) => CheckInPlatform> = {
  kurobbs: KuroBBSPlatform as new (config: KuroBBSConfig) => CheckInPlatform,
  tajiduo: TajiduoPlatform as new (config: TajiduoConfig) => CheckInPlatform,
}
```

Note: This file will be updated in Task 5/6 after platform constructors change. For now it establishes the registry pattern.

- [ ] **Step 2: Verify the file compiles**

Run: `bun build src/platforms/index.ts --outdir /dev/null 2>&1 || echo "BUILD CHECK"`
Expected: May have type errors until Task 3-6 complete — that's expected

---

### Task 3: Modify `src/types.ts` — remove `isEnabled()`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Update the interface**

Replace the entire file content:

```ts
/**
 * 签到平台接口，每个平台实现此接口
 */
export interface CheckInPlatform {
  /** 平台名称，用于日志展示 */
  readonly name: string
  /** 执行签到流程 */
  run(): Promise<void>
}
```

- [ ] **Step 2: Verify no compile errors in types.ts itself**

Run: `bun build src/types.ts --outdir /dev/null 2>&1 || echo "BUILD CHECK"`
Expected: No errors

---

### Task 4: Modify KuroBBS platform — constructor-based config

**Files:**
- Modify: `src/platforms/kurobbs/index.ts`

- [ ] **Step 1: Rewrite KuroBBS platform**

Replace the entire file content:

```ts
import { resolve } from 'path'
import type { CheckInPlatform } from '../../types.ts'
import type { KuroBBSConfig } from '../../config.ts'

const INIT_SIGN_IN_URL = 'https://api.kurobbs.com/encourage/signIn/initSignInV2'
const SIGN_IN_URL = 'https://api.kurobbs.com/encourage/signIn/v2'
const RECORD_URL = 'https://api.kurobbs.com/encourage/signIn/queryRecordV2'

interface SignInRecord {
  code: number
  msg: string
  data: { sigInDate: string }[]
}

export class KuroBBSPlatform implements CheckInPlatform {
  readonly name = '库洛社区 (KuroBBS)'

  constructor(private readonly config: KuroBBSConfig) {}

  private async buildHeaders(): Promise<Headers> {
    const { token, ipAddr } = this.config
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

    if (ipAddr) {
      const devCode = headers.get('devCode') ?? ''
      headers.set('devCode', devCode.replace('180.168.255.251', ipAddr))
    }

    headers.set('token', token)
    return headers
  }

  private buildFormData(extra: Record<string, string> = {}): URLSearchParams {
    const { roleId, userId, gameId, serverId } = this.config
    const form = new URLSearchParams({ gameId, serverId, roleId, userId })
    for (const [k, v] of Object.entries(extra)) form.append(k, v)
    return form
  }

  private async request<T>(url: string, body: URLSearchParams): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.buildHeaders(),
      body,
    })
    if (!res.ok) {
      throw new Error(`[KuroBBS] HTTP ${res.status} ${res.statusText}`)
    }
    const data = (await res.json()) as { code: number; msg: string } & T
    if (data.code !== 200) throw new Error(`[KuroBBS] ${data.msg}`)
    return data
  }

  private async initSignIn(): Promise<void> {
    await this.request(INIT_SIGN_IN_URL, this.buildFormData())
  }

  private async queryRecord(): Promise<SignInRecord['data']> {
    const data = await this.request<SignInRecord>(
      RECORD_URL,
      this.buildFormData(),
    )
    return data.data
  }

  private async signIn(): Promise<void> {
    const reqMonth = (new Date().getMonth() + 1).toString().padStart(2, '0')
    const data = await this.request<{ msg: string }>(
      SIGN_IN_URL,
      this.buildFormData({ reqMonth }),
    )
    console.log(`[KuroBBS] ${data.msg}`)
  }

  async run(): Promise<void> {
    await this.initSignIn()
    await randomDelay(300, 1000)

    const record = await this.queryRecord()
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    const hasSignedInToday = record.some((r) => r.sigInDate.startsWith(today))

    if (hasSignedInToday) {
      console.log('[KuroBBS] 今日已签到，跳过')
      return
    }

    await randomDelay(300, 1000)
    await this.signIn()
  }
}

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

Key changes:
- Removed `get config()` that read `process.env`
- Removed `isEnabled()` method
- Added `constructor(private readonly config: KuroBBSConfig)`
- All methods now use `this.config` from constructor

- [ ] **Step 2: Verify compilation**

Run: `bun build src/platforms/kurobbs/index.ts --outdir /dev/null 2>&1 || echo "BUILD CHECK"`
Expected: No errors

---

### Task 5: Modify Tajiduo platform — constructor-based config

**Files:**
- Modify: `src/platforms/tajiduo/index.ts`

- [ ] **Step 1: Rewrite Tajiduo platform**

Replace the entire file content:

```ts
import { resolve } from 'path'
import type { CheckInPlatform } from '../../types.ts'
import type { TajiduoConfig } from '../../config.ts'

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

export class TajiduoPlatform implements CheckInPlatform {
  readonly name = '塔吉多 (Tajiduo)'

  constructor(private readonly config: TajiduoConfig) {}

  private async buildHeaders(): Promise<Headers> {
    const { token } = this.config
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
    const form = new URLSearchParams({ roleId, gameId })
    return form
  }

  private async initSignIn() {
    const { gameId } = this.config
    await fetch(`${INIT_SIGN_IN_URL}?gameId=${gameId}`, {
      headers: await this.buildHeaders()
    })
  }

  private async checkAlreadySignedIn() {
    const { gameId } = this.config
    const res = await fetch(`${CHECK_SIGN_IN_URL}?gameId=${gameId}`, {
      headers: await this.buildHeaders()
    })
    const data = await res.json() as SignInState
    return data && data.data?.todaySign
  }

  private async signIn(): Promise<void> {
    const headers = await this.buildHeaders()
    const data = await fetch(SIGN_IN_URL, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: this.buildFormData(),
    }).then((res) => res.json()) as SignInState
    console.log(`[Tajiduo] ${data.msg}`)
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

Key changes:
- Removed `get config()` that read `process.env`
- Removed `isEnabled()` method
- Added `constructor(private readonly config: TajiduoConfig)`
- All methods now use `this.config` from constructor

- [ ] **Step 2: Verify compilation**

Run: `bun build src/platforms/tajiduo/index.ts --outdir /dev/null 2>&1 || echo "BUILD CHECK"`
Expected: No errors

---

### Task 6: Update platform registry with correct types

**Files:**
- Modify: `src/platforms/index.ts`

- [ ] **Step 1: Update registry with proper constructor types**

Replace the entire file content:

```ts
import { KuroBBSPlatform } from './kurobbs/index.ts'
import { TajiduoPlatform } from './tajiduo/index.ts'
import type { CheckInPlatform } from '../types.ts'
import type { KuroBBSConfig, TajiduoConfig } from '../config.ts'

type PlatformConstructor<C> = new (config: C) => CheckInPlatform

export const platforms: Record<string, PlatformConstructor<any>> = {
  kurobbs: KuroBBSPlatform as PlatformConstructor<KuroBBSConfig>,
  tajiduo: TajiduoPlatform as PlatformConstructor<TajiduoConfig>,
}
```

- [ ] **Step 2: Verify compilation**

Run: `bun build src/platforms/index.ts --outdir /dev/null 2>&1 || echo "BUILD CHECK"`
Expected: No errors

---

### Task 7: Modify `src/runner.ts` — use config and registry

**Files:**
- Modify: `src/runner.ts`

- [ ] **Step 1: Rewrite runner**

Replace the entire file content:

```ts
import { loadConfig } from './config.ts'
import { platforms } from './platforms/index.ts'

/**
 * 运行所有已通过 config.json 启用的平台签到
 */
export async function runAll(): Promise<void> {
  const config = await loadConfig()

  let totalEnabled = 0
  const platformNames: string[] = []

  for (const [key, entries] of Object.entries(config)) {
    if (!Array.isArray(entries) || entries.length === 0) continue
    const enabled = entries.filter((e) => e.enabled)
    if (enabled.length > 0) {
      totalEnabled += enabled.length
      platformNames.push(`${key}(${enabled.length})`)
    }
  }

  if (totalEnabled === 0) {
    console.log('未启用任何签到账号，请检查 config.json 配置')
    return
  }

  console.log(`已启用 ${totalEnabled} 个签到账号: ${platformNames.join(', ')}`)

  for (const [key, entries] of Object.entries(config)) {
    if (!Array.isArray(entries) || entries.length === 0) continue

    const PlatformClass = platforms[key]
    if (!PlatformClass) {
      console.warn(`未知平台: ${key}，跳过`)
      continue
    }

    const enabled = entries.filter((e) => e.enabled)
    for (const entry of enabled) {
      const platform = new PlatformClass(entry)
      console.log(`\n--- 开始执行: ${platform.name} ---`)
      try {
        await platform.run()
        console.log(`--- 完成: ${platform.name} ---`)
      } catch (err) {
        console.error(`--- 失败: ${platform.name} ---`)
        console.error(err)
      }
    }
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `bun build src/runner.ts --outdir /dev/null 2>&1 || echo "BUILD CHECK"`
Expected: No errors

---

### Task 8: Modify `index.ts` — remove env.CRON check

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Update index.ts**

Replace the entire file content:

```ts
import { runAll } from './src/runner.ts'

const args = process.argv.slice(2)

if (args.includes('--cron')) {
  // 生成每天 8 点随机分钟的 cron 表达式，避免请求集中
  const minute = Math.floor(Math.random() * 60)
  const cronExpr = `${minute} 8 * * *`
  console.log(`已设置定时任务，cron 表达式: ${cronExpr}`)
  Bun.cron('./worker.ts', cronExpr, 'auto-check')
} else {
  // 立即执行一次签到
  await runAll()
}
```

Key change: removed `|| process.env.CRON` from the condition.

- [ ] **Step 2: Verify compilation**

Run: `bun build index.ts --outdir /dev/null 2>&1 || echo "BUILD CHECK"`
Expected: No errors

---

### Task 9: Create config files and update gitignore

**Files:**
- Create: `config.example.json`
- Create: `config.json` (with actual values from `.env`)
- Modify: `.gitignore`

- [ ] **Step 1: Create `config.example.json`**

```json
{
  "kurobbs": [
    {
      "enabled": true,
      "token": "your_kurobbs_token_here",
      "roleId": "your_role_id_here",
      "userId": "your_user_id_here",
      "gameId": "3",
      "serverId": "76402e5b20be2c39f095a152090afddc",
      "ipAddr": "your_ip_address_here"
    }
  ],
  "tajiduo": [
    {
      "enabled": true,
      "token": "your_tajiduo_token_here",
      "roleId": "your_role_id_here",
      "gameId": "1289"
    }
  ]
}
```

- [ ] **Step 2: Create `config.json` with actual values**

Read the current `.env` file and create `config.json` with the real values mapped to the new structure. The mapping is:

- `KUROBBS_TOKEN` → `kurobbs[0].token`
- `KUROBBS_ROLE_ID` → `kurobbs[0].roleId`
- `KUROBBS_USER_ID` → `kurobbs[0].userId`
- `KUROBBS_GAME_ID` → `kurobbs[0].gameId` (default "3")
- `KUROBBS_SERVER_ID` → `kurobbs[0].serverId` (default)
- `KUROBBS_IP_ADDR` → `kurobbs[0].ipAddr`
- `KUROBBS_ENABLED` → `kurobbs[0].enabled`
- `TAJIDUO_TOKEN` → `tajiduo[0].token`
- `TAJIDUO_ROLE_ID` → `tajiduo[0].roleId`
- `TAJIDUO_GAME_ID` → `tajiduo[0].gameId` (default "1289")
- `TAJIDUO_ENABLED` → `tajiduo[0].enabled`

- [ ] **Step 3: Add `config.json` to `.gitignore`**

Append `config.json` to the `.gitignore` file after the `.env` block:

```
# config file with secrets
config.json
```

---

### Task 10: Delete `.env.example` and verify end-to-end

**Files:**
- Delete: `.env.example`

- [ ] **Step 1: Delete `.env.example`**

```bash
rm .env.example
```

- [ ] **Step 2: Full type-check the project**

Run: `bun build index.ts --outdir /dev/null 2>&1`
Expected: No type errors

- [ ] **Step 3: Run the script to verify**

Run: `bun index.ts`
Expected: Script reads `config.json`, lists enabled accounts, attempts sign-in (may fail due to expired tokens, but should not crash on config loading)

- [ ] **Step 4: Commit all changes**

```bash
git add src/config.ts src/platforms/index.ts src/types.ts src/platforms/kurobbs/index.ts src/platforms/tajiduo/index.ts src/runner.ts index.ts config.example.json .gitignore
git rm .env.example
git commit -m "feat: migrate from env-based config to config.json

Replace environment variable configuration with a JSON config file
that supports multiple accounts per platform with independent
enable/disable toggles."
```
