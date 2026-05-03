# Project Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the multi-platform auto check-in tool with unified architecture: interactive CLI setup for config, worker for execution, embedded headers, and Tajiduo login via Laohu SMS.

**Architecture:** Per-platform modules under `src/platforms/{name}/` with separate `setup.ts` (interactive config) and `worker.ts` (check-in execution). Shared config system reads/writes `config.json`. Unified entry point auto-detects mode.

**Tech Stack:** Bun + TypeScript (zero runtime deps), `node:crypto` for AES-ECB/MD5, `readline` for interactive CLI.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/config.ts` | Create | Config types + loadConfig/saveConfig |
| `src/http.ts` | Create | Shared HTTP utilities (headers, GET/POST, retry) |
| `src/platforms/registry.ts` | Create | Platform interface + registry |
| `src/setup.ts` | Create | Main setup entry (platform selection, dispatch) |
| `src/platforms/kurobbs/setup.ts` | Create | KuroBBS interactive config prompts |
| `src/platforms/kurobbs/worker.ts` | Create | KuroBBS check-in flow + embedded headers |
| `src/platforms/tajiduo/laohu.ts` | Create | Laohu SMS auth client |
| `src/platforms/tajiduo/setup.ts` | Create | Tajiduo SMS login flow |
| `src/platforms/tajiduo/worker.ts` | Create | Tajiduo check-in flow + DS + embedded headers |
| `src/platforms/tajiduo/token-manager.ts` | Rewrite | Token refresh + cache (self-contained) |
| `src/runner.ts` | Rewrite | Use config + registry |
| `index.ts` | Rewrite | Unified entry: setup / cron / run |
| `worker.ts` | Update | Use new runner |
| `src/types.ts` | Delete | Replaced by registry |
| `src/token-manager.ts` | Delete | Inlined into tajiduo token-manager |
| `src/platforms/kurobbs/index.ts` | Delete | Replaced by setup.ts + worker.ts |
| `src/platforms/tajiduo/index.ts` | Delete | Replaced by setup.ts + worker.ts |
| `src/platforms/kurobbs/headers.txt` | Delete | Headers embedded in worker |
| `src/platforms/tajiduo/headers.txt` | Delete | Headers embedded in worker |

---

### Task 1: Config System (`src/config.ts`)

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: Create config types and I/O**

```typescript
// src/config.ts
import { resolve } from 'path'

const CONFIG_PATH = resolve(import.meta.dirname, '../config.json')

export interface KuroBBSConfig {
  enabled: boolean
  token: string
  roleId: string
  userId: string
  gameId: string
  serverId: string
  ipAddr: string
}

export interface TajiduoConfig {
  enabled: boolean
  deviceId: string
  uid: string
  refreshToken: string
  gameId: string
}

export interface Config {
  kurobbs?: KuroBBSConfig
  tajiduo?: TajiduoConfig
}

export async function loadConfig(): Promise<Config> {
  const file = Bun.file(CONFIG_PATH)
  if (!(await file.exists())) {
    throw new Error('config.json 不存在，请先运行 --setup 进行配置')
  }
  return await file.json() as Config
}

export async function saveConfig(config: Config): Promise<void> {
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
  console.log(`配置已保存到 ${CONFIG_PATH}`)
}
```

- [ ] **Step 2: Verify types compile**

Run: `bun build src/config.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add config types and loadConfig/saveConfig utilities"
```

---

### Task 2: Platform Interface & Registry (`src/platforms/registry.ts`)

**Files:**
- Create: `src/platforms/registry.ts`

- [ ] **Step 1: Create platform interface and registry**

```typescript
// src/platforms/registry.ts
import type { Config, KuroBBSConfig, TajiduoConfig } from '../config.ts'

export interface PlatformSetupResult {
  platformKey: keyof Config
  config: KuroBBSConfig | TajiduoConfig
}

export interface PlatformRegistration {
  name: string
  setup(): Promise<PlatformSetupResult>
  isEnabled(config: Config): boolean
  run(config: Config): Promise<void>
}

const registry = new Map<string, PlatformRegistration>()

export function registerPlatform(key: string, platform: PlatformRegistration): void {
  registry.set(key, platform)
}

export function getPlatform(key: string): PlatformRegistration | undefined {
  return registry.get(key)
}

export function getAllPlatforms(): Map<string, PlatformRegistration> {
  return registry
}
```

- [ ] **Step 2: Verify types compile**

Run: `bun build src/platforms/registry.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/platforms/registry.ts
git commit -m "feat: add platform interface and registry"
```

---

### Task 3: Shared HTTP Utilities (`src/http.ts`)

**Files:**
- Create: `src/http.ts`

- [ ] **Step 1: Create HTTP utilities**

```typescript
// src/http.ts
import { createHash } from 'crypto'

export function buildHeaders(
  base: Record<string, string>,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return { ...base, ...overrides }
}

export async function httpGet<T>(
  url: string,
  query?: Record<string, string>,
  headers?: Record<string, string>,
): Promise<T> {
  const target = query
    ? `${url}?${new URLSearchParams(query)}`
    : url
  const res = await fetch(target, { method: 'GET', headers })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return await res.json() as T
}

export async function httpPost<T>(
  url: string,
  body: Record<string, string>,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body),
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return await res.json() as T
}

export async function requestWithRetry<T>(
  requestFn: () => Promise<T>,
  onUnauthorized: () => Promise<void>,
): Promise<T> {
  try {
    return await requestFn()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      await onUnauthorized()
      return await requestFn()
    }
    throw err
  }
}

export function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function generateDs(appVersion: string, salt: string): string {
  const DS_NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = Array.from({ length: 8 }, () =>
    DS_NONCE_ALPHABET[Math.floor(Math.random() * DS_NONCE_ALPHABET.length)]
  ).join('')
  const raw = `${timestamp}${nonce}${appVersion}${salt}`
  const hash = createHash('md5').update(raw).digest('hex')
  return `${timestamp},${nonce},${hash}`
}
```

- [ ] **Step 2: Verify types compile**

Run: `bun build src/http.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/http.ts
git commit -m "feat: add shared HTTP utilities (headers, GET/POST, retry, DS generation)"
```

---

### Task 4: KuroBBS Worker (`src/platforms/kurobbs/worker.ts`)

**Files:**
- Create: `src/platforms/kurobbs/worker.ts`

- [ ] **Step 1: Create KuroBBS worker with embedded headers**

```typescript
// src/platforms/kurobbs/worker.ts
import type { KuroBBSConfig } from '../../config.ts'
import { buildHeaders, httpPost, randomDelay } from '../../http.ts'

const INIT_SIGN_IN_URL = 'https://api.kurobbs.com/encourage/signIn/initSignInV2'
const SIGN_IN_URL = 'https://api.kurobbs.com/encourage/signIn/v2'
const RECORD_URL = 'https://api.kurobbs.com/encourage/signIn/queryRecordV2'

const DEFAULT_HEADERS: Record<string, string> = {
  'Host': 'api.kurobbs.com',
  'Connection': 'keep-alive',
  'Pragma': 'no-cache',
  'Cache-Control': 'no-cache',
  'sec-ch-ua-platform': '"Android"',
  'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Android WebView";v="146"',
  'devCode': '180.168.255.251, Mozilla/5.0 (Linux; Android 15; 22081212C Build/AQ3A.250226.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/146.0.7680.119 Mobile Safari/537.36 Kuro/3.0.0 KuroGameBox/3.0.0',
  'sec-ch-ua-mobile': '?1',
  'source': 'android',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 15; 22081212C Build/AQ3A.250226.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/146.0.7680.119 Mobile Safari/537.36 Kuro/3.0.0 KuroGameBox/3.0.0',
  'Accept': 'application/json, text/plain, */*',
  'Content-Type': 'application/x-www-form-urlencoded',
  'Origin': 'https://web-static.kurobbs.com',
  'X-Requested-With': 'com.kurogame.kjq',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
}

interface SignInRecord {
  code: number
  msg: string
  data: { sigInDate: string }[]
}

function buildRequestHeaders(config: KuroBBSConfig): Record<string, string> {
  const headers = buildHeaders(DEFAULT_HEADERS, { token: config.token })
  if (config.ipAddr) {
    headers['devCode'] = headers['devCode'].replace('180.168.255.251', config.ipAddr)
  }
  return headers
}

function buildFormData(config: KuroBBSConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    gameId: config.gameId,
    serverId: config.serverId,
    roleId: config.roleId,
    userId: config.userId,
    ...extra,
  }
}

export async function runKuroBBS(config: KuroBBSConfig): Promise<void> {
  const headers = buildRequestHeaders(config)

  // Init sign-in session
  await httpPost(INIT_SIGN_IN_URL, buildFormData(config), headers)
  await randomDelay(300, 1000)

  // Query records
  const record = await httpPost<SignInRecord>(RECORD_URL, buildFormData(config), headers)
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const hasSignedInToday = record.data.some((r) => r.sigInDate.startsWith(today))

  if (hasSignedInToday) {
    console.log('[KuroBBS] 今日已签到，跳过')
    return
  }

  await randomDelay(300, 1000)

  // Sign in
  const reqMonth = (new Date().getMonth() + 1).toString().padStart(2, '0')
  const result = await httpPost<{ msg: string }>(SIGN_IN_URL, buildFormData(config, { reqMonth }), headers)
  console.log(`[KuroBBS] ${result.msg}`)
}
```

- [ ] **Step 2: Verify types compile**

Run: `bun build src/platforms/kurobbs/worker.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/platforms/kurobbs/worker.ts
git commit -m "feat: add KuroBBS worker with embedded headers and config-based flow"
```

---

### Task 5: KuroBBS Setup (`src/platforms/kurobbs/setup.ts`)

**Files:**
- Create: `src/platforms/kurobbs/setup.ts`

- [ ] **Step 1: Create KuroBBS setup with interactive prompts**

```typescript
// src/platforms/kurobbs/setup.ts
import { createInterface } from 'readline'
import type { KuroBBSConfig } from '../../config.ts'

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

export async function setupKuroBBS(): Promise<KuroBBSConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log('\n--- 库洛社区 (KuroBBS) 配置 ---')
  console.log('请从 APP 或抓包工具中获取以下信息:\n')

  const token = await prompt(rl, 'Token (必填): ')
  if (!token) throw new Error('Token 不能为空')

  const roleId = await prompt(rl, 'Role ID (必填): ')
  if (!roleId) throw new Error('Role ID 不能为空')

  const userId = await prompt(rl, 'User ID (必填): ')
  if (!userId) throw new Error('User ID 不能为空')

  const gameId = await prompt(rl, 'Game ID (可选, 默认 3): ') || '3'
  const serverId = await prompt(rl, 'Server ID (可选, 默认 76402e5b20be2c39f095a152090afddc): ') || '76402e5b20be2c39f095a152090afddc'
  const ipAddr = await prompt(rl, 'IP 地址 (可选, 留空使用默认): ')

  rl.close()

  return { enabled: true, token, roleId, userId, gameId, serverId, ipAddr }
}
```

- [ ] **Step 2: Verify types compile**

Run: `bun build src/platforms/kurobbs/setup.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/platforms/kurobbs/setup.ts
git commit -m "feat: add KuroBBS interactive setup prompts"
```

---

### Task 6: Tajiduo Token Manager (Rewrite `src/platforms/tajiduo/token-manager.ts`)

**Files:**
- Rewrite: `src/platforms/tajiduo/token-manager.ts`

- [ ] **Step 1: Rewrite token manager to be self-contained**

```typescript
// src/platforms/tajiduo/token-manager.ts
import { mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'

const CACHE_DIR = resolve(import.meta.dirname, '../../.cache')
const REFRESH_TOKEN_URL = 'https://bbs-api.tajiduo.com/usercenter/api/refreshToken'

export interface TokenCache {
  accessToken: string
  refreshToken: string
}

export class TajiduoTokenManager {
  private cachePath: string

  constructor() {
    this.cachePath = resolve(CACHE_DIR, 'tajiduo.json')
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

  async refreshTokens(refreshToken: string, baseHeaders: Record<string, string>): Promise<TokenCache> {
    const headers = { ...baseHeaders, Authorization: refreshToken }
    const res = await fetch(REFRESH_TOKEN_URL, { method: 'POST', headers })
    const data = await res.json() as { code: number; msg: string; data: TokenCache }

    if (data.code !== 0) {
      throw new Error(`[Tajiduo] 刷新 token 失败: ${data.msg}`)
    }

    return { accessToken: data.data.accessToken, refreshToken: data.data.refreshToken }
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `bun build src/platforms/tajiduo/token-manager.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/platforms/tajiduo/token-manager.ts
git commit -m "refactor: make TajiduoTokenManager self-contained (no base class)"
```

---

### Task 7: Tajiduo Worker (`src/platforms/tajiduo/worker.ts`)

**Files:**
- Create: `src/platforms/tajiduo/worker.ts`

- [ ] **Step 1: Create Tajiduo worker with DS generation and embedded headers**

```typescript
// src/platforms/tajiduo/worker.ts
import type { TajiduoConfig } from '../../config.ts'
import { buildHeaders, httpGet, generateDs, randomDelay } from '../../http.ts'
import { TajiduoTokenManager } from './token-manager.ts'

const TAJIDUO_DS_SALT = 'pUds3dfMkl'
const TAJIDUO_APP_VERSION = '1.2.2'

const INIT_SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/sign/rewards'
const SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/sign'
const CHECK_SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/signin/state'
const GET_GAME_BIND_ROLE_URL = 'https://bbs-api.tajiduo.com/apihub/api/getGameBindRole'

const DEFAULT_HEADERS: Record<string, string> = {
  'accept': 'application/json, text/plain, */*',
  'platform': 'android',
  'appversion': TAJIDUO_APP_VERSION,
  'Host': 'bbs-api.tajiduo.com',
  'Connection': 'Keep-Alive',
  'Accept-Encoding': 'gzip',
  'User-Agent': 'okhttp/4.12.0',
}

interface SignInState {
  code: number
  msg: string
  ok: boolean
  data: { todaySign: boolean }
}

interface GameBindRoleResponse {
  code: number
  msg: string
  data: {
    account: string
    gameId: number
    gender: number
    lev: number
    roleId: number
    roleName: string
    serverId: number
    serverName: string
  }
}

function buildAuthHeaders(config: TajiduoConfig, token: string): Record<string, string> {
  return buildHeaders(DEFAULT_HEADERS, {
    'Authorization': token,
    'uid': config.uid,
    'deviceid': config.deviceId,
    'ds': generateDs(DEFAULT_HEADERS['appversion'] ?? TAJIDUO_APP_VERSION, TAJIDUO_DS_SALT),
  })
}

export async function runTajiduo(config: TajiduoConfig): Promise<void> {
  const tokenManager = new TajiduoTokenManager()

  // Get or refresh tokens
  let tokens = await tokenManager.getTokens()
  if (!tokens) {
    tokens = await tokenManager.refreshTokens(config.refreshToken, DEFAULT_HEADERS)
    await tokenManager.saveTokens(tokens.accessToken, tokens.refreshToken)
  }

  async function withRetry<T>(fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(tokens!.accessToken)
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        tokens = await tokenManager.refreshTokens(tokens!.refreshToken, DEFAULT_HEADERS)
        await tokenManager.saveTokens(tokens.accessToken, tokens.refreshToken)
        try {
          return await fn(tokens.accessToken)
        } catch (retryErr) {
          if ((retryErr as { status?: number }).status === 401) {
            throw new Error('[Tajiduo] refreshToken 已失效，请重新运行 --setup 登录')
          }
          throw retryErr
        }
      }
      throw err
    }
  }

  // Get bound role
  console.log('[Tajiduo] 获取绑定角色...')
  const roleData = await withRetry(async (token) => {
    return await httpGet<GameBindRoleResponse>(
      GET_GAME_BIND_ROLE_URL,
      { uid: config.uid, gameId: config.gameId },
      buildAuthHeaders(config, token),
    )
  })

  if (roleData.code !== 0 || !roleData.data) {
    throw new Error(`[Tajiduo] 获取绑定角色失败: ${roleData.msg || '未找到绑定角色'}`)
  }

  const roleId = String(roleData.data.roleId)
  console.log(`[Tajiduo] 绑定角色: ${roleData.data.roleName} (ID: ${roleId})`)

  // Init sign-in
  await withRetry(async (token) => {
    return await httpGet(INIT_SIGN_IN_URL, { gameId: config.gameId }, buildAuthHeaders(config, token))
  })

  await randomDelay(300, 1000)

  // Check already signed in
  const signState = await withRetry(async (token) => {
    return await httpGet<SignInState>(
      CHECK_SIGN_IN_URL,
      { gameId: config.gameId },
      buildAuthHeaders(config, token),
    )
  })

  if (signState.data?.todaySign) {
    console.log('[Tajiduo] 今日已签到，跳过')
    return
  }

  // Sign in
  const signResult = await withRetry(async (token) => {
    const res = await fetch(SIGN_IN_URL, {
      method: 'POST',
      headers: { ...buildAuthHeaders(config, token), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ roleId, gameId: config.gameId }),
    })
    if (res.status === 401) {
      const err = new Error('Unauthorized') as Error & { status?: number }
      err.status = 401
      throw err
    }
    return await res.json() as SignInState
  })

  console.log(`[Tajiduo] ${signResult.msg}`)
}
```

- [ ] **Step 2: Verify types compile**

Run: `bun build src/platforms/tajiduo/worker.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/platforms/tajiduo/worker.ts
git commit -m "feat: add Tajiduo worker with DS generation, embedded headers, token retry"
```

---

### Task 8: Laohu SMS Auth Client (`src/platforms/tajiduo/laohu.ts`)

**Files:**
- Create: `src/platforms/tajiduo/laohu.ts`

- [ ] **Step 1: Create Laohu client with AES-ECB and MD5 signing**

```typescript
// src/platforms/tajiduo/laohu.ts
import { createCipheriv, createHash } from 'crypto'
import { randomUUID } from 'crypto'

const LAOHU_BASE_URL = 'https://user.laohu.com'
const LAOHU_SDK_VERSION = '4.273.0'
const LAOHU_USER_AGENT = 'okhttp/4.9.0'
const LAOHU_DEFAULT_PACKAGE = 'com.pwrd.htassistant'
const LAOHU_DEFAULT_VERSION_CODE = 12

const LAOHU_APP_ID = 10550
const LAOHU_APP_KEY = '89155cc4e8634ec5b1b6364013b23e3e'

export interface LaohuAccount {
  userId: number
  token: string
}

interface LaohuDevice {
  deviceId: string
  deviceType: string
  deviceModel: string
  deviceName: string
  deviceSys: string
  adm: string
  imei: string
  idfa: string
  mac: string
}

function createDevice(): LaohuDevice {
  const deviceId = 'HT' + randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()
  return {
    deviceId,
    deviceType: 'Pixel 6',
    deviceModel: 'Pixel 6',
    deviceName: 'Pixel 6',
    deviceSys: 'Android 14',
    adm: deviceId,
    imei: '',
    idfa: '',
    mac: '',
  }
}

function aesEncrypt(plain: string, appKey: string): string {
  const key = Buffer.from(appKey.slice(-16))
  const cipher = createCipheriv('aes-128-ecb', key, null)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return encrypted.toString('base64')
}

function signParams(params: Record<string, string>, appKey: string): string {
  const raw = Object.keys(params).sort().map((k) => params[k]).join('') + appKey
  return createHash('md5').update(raw).digest('hex')
}

function commonFields(device: LaohuDevice, useMillis: boolean): Record<string, string> {
  const ts = useMillis
    ? String(Date.now())
    : String(Math.floor(Date.now() / 1000))

  const base: Record<string, string> = {
    appId: String(LAOHU_APP_ID),
    channelId: '1',
    deviceId: device.deviceId,
    deviceType: device.deviceType,
    deviceModel: device.deviceModel,
    deviceName: device.deviceName,
    deviceSys: device.deviceSys,
    adm: device.adm,
    idfa: device.idfa,
    sdkVersion: LAOHU_SDK_VERSION,
    bid: LAOHU_DEFAULT_PACKAGE,
    t: ts,
  }

  if (useMillis) {
    base['version'] = String(LAOHU_DEFAULT_VERSION_CODE)
    base['mac'] = device.mac
  } else {
    base['versionCode'] = String(LAOHU_DEFAULT_VERSION_CODE)
    base['imei'] = device.imei
  }

  return base
}

async function submit<T>(
  path: string,
  params: Record<string, string>,
  method: 'GET' | 'POST' = 'POST',
): Promise<T> {
  const signed = { ...params, sign: signParams(params, LAOHU_APP_KEY) }
  // Remove empty values
  const cleaned = Object.fromEntries(
    Object.entries(signed).filter(([, v]) => v !== ''),
  )

  const url = `${LAOHU_BASE_URL}${path}`
  const options: RequestInit = {
    method,
    headers: { 'User-Agent': LAOHU_USER_AGENT },
  }

  if (method === 'GET') {
    const qs = new URLSearchParams(cleaned).toString()
    const res = await fetch(`${url}?${qs}`, options)
    const payload = await res.json() as { code: number | string; message?: string; result?: T }
    if (payload.code !== 0 && payload.code !== '0') {
      throw new Error(`[Laohu] ${payload.message ?? '请求失败'}`)
    }
    return (payload.result ?? {}) as T
  } else {
    options.headers = { ...options.headers as Record<string, string>, 'Content-Type': 'application/x-www-form-urlencoded' }
    options.body = new URLSearchParams(cleaned)
    const res = await fetch(url, options)
    const payload = await res.json() as { code: number | string; message?: string; result?: T }
    if (payload.code !== 0 && payload.code !== '0') {
      throw new Error(`[Laohu] ${payload.message ?? '请求失败'}`)
    }
    return (payload.result ?? {}) as T
  }
}

export async function sendSmsCode(cellphone: string): Promise<void> {
  const device = createDevice()
  const params = commonFields(device, false)
  params['cellphone'] = cellphone
  params['areaCodeId'] = '1'
  params['type'] = '16'
  await submit('/m/newApi/sendPhoneCaptchaWithOutLogin', params)
}

export async function loginBySMS(cellphone: string, code: string): Promise<LaohuAccount> {
  const device = createDevice()
  const params = commonFields(device, true)
  params['cellphone'] = aesEncrypt(cellphone, LAOHU_APP_KEY)
  params['captcha'] = aesEncrypt(code, LAOHU_APP_KEY)
  params['areaCodeId'] = '1'
  params['type'] = '16'

  const result = await submit<{ userId?: number | string; token?: string }>(
    '/openApi/sms/new/login',
    params,
    'POST',
  )

  if (result.userId === undefined || result.token === undefined) {
    throw new Error('[Laohu] 登录返回缺少 userId/token')
  }

  const userId = Number(result.userId)
  if (isNaN(userId) || userId <= 0) {
    throw new Error('[Laohu] 登录返回 userId 无效')
  }

  return { userId, token: String(result.token) }
}
```

- [ ] **Step 2: Verify AES-ECB encryption works**

Create a quick test:
```bash
bun -e "
const { createCipheriv } = require('crypto');
const key = Buffer.from('89155cc4e8634ec5b1b6364013b23e3e'.slice(-16));
const cipher = createCipheriv('aes-128-ecb', key, null);
const enc = Buffer.concat([cipher.update('13800138000', 'utf8'), cipher.final()]);
console.log('AES-ECB OK:', enc.toString('base64').length > 0);
"
```
Expected: `AES-ECB OK: true`

- [ ] **Step 3: Verify types compile**

Run: `bun build src/platforms/tajiduo/laohu.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/platforms/tajiduo/laohu.ts
git commit -m "feat: add Laohu SMS auth client with AES-ECB encryption"
```

---

### Task 9: Tajiduo Setup (`src/platforms/tajiduo/setup.ts`)

**Files:**
- Create: `src/platforms/tajiduo/setup.ts`

- [ ] **Step 1: Create Tajiduo setup with SMS login flow**

```typescript
// src/platforms/tajiduo/setup.ts
import { createInterface } from 'readline'
import { randomUUID } from 'crypto'
import type { TajiduoConfig } from '../../config.ts'
import { sendSmsCode, loginBySMS } from './laohu.ts'
import { TajiduoTokenManager } from './token-manager.ts'

const USER_CENTER_LOGIN_URL = 'https://bbs-api.tajiduo.com/usercenter/api/login'
const REFRESH_SESSION_URL = 'https://bbs-api.tajiduo.com/usercenter/api/refreshToken'
const GET_BIND_ROLE_URL = 'https://bbs-api.tajiduo.com/apihub/api/getGameBindRole'

const TAJIDUO_BASE_HEADERS: Record<string, string> = {
  'accept': 'application/json, text/plain, */*',
  'platform': 'android',
  'appversion': '1.2.2',
  'Host': 'bbs-api.tajiduo.com',
  'Connection': 'Keep-Alive',
  'Accept-Encoding': 'gzip',
  'User-Agent': 'okhttp/4.12.0',
}

const TAJIDUO_USER_CENTER_APP_ID = '10551'

interface TajiduoSession {
  accessToken: string
  refreshToken: string
  uid: string
}

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

async function userCenterLogin(laohuToken: string, laohuUserId: number, deviceId: string): Promise<TajiduoSession> {
  const headers = { ...TAJIDUO_BASE_HEADERS, deviceid: deviceId, uid: '0' }
  const res = await fetch(USER_CENTER_LOGIN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: laohuToken,
      userIdentity: String(laohuUserId),
      appId: TAJIDUO_USER_CENTER_APP_ID,
    }),
  })
  const data = await res.json() as { code: number; msg: string; data?: { accessToken?: string; refreshToken?: string; uid?: string | number } }

  if (data.code !== 0 || !data.data) {
    throw new Error(`[Tajiduo] 用户中心登录失败: ${data.msg}`)
  }

  const accessToken = data.data.accessToken
  const refreshToken = data.data.refreshToken
  const uid = data.data.uid !== undefined ? String(data.data.uid) : undefined

  if (!accessToken || !refreshToken || !uid) {
    throw new Error('[Tajiduo] 登录返回缺少 accessToken/refreshToken/uid')
  }

  return { accessToken, refreshToken, uid }
}

async function refreshSession(refreshToken: string, deviceId: string): Promise<TajiduoSession> {
  const headers = { ...TAJIDUO_BASE_HEADERS, deviceid: deviceId, uid: '0', Authorization: refreshToken }
  const res = await fetch(REFRESH_SESSION_URL, { method: 'POST', headers })
  const data = await res.json() as { code: number; msg: string; data?: { accessToken?: string; refreshToken?: string } }

  if (data.code !== 0 || !data.data) {
    throw new Error(`[Tajiduo] 刷新 session 失败: ${data.msg}`)
  }

  const accessToken = data.data.accessToken
  const newRefresh = data.data.refreshToken

  if (!accessToken || !newRefresh) {
    throw new Error('[Tajiduo] 刷新返回缺少 accessToken/refreshToken')
  }

  return { accessToken, refreshToken: newRefresh, uid: '' }
}

async function getBindRole(accessToken: string, uid: string, gameId: string, deviceId: string): Promise<{ roleId: string; roleName: string }> {
  const headers = {
    ...TAJIDUO_BASE_HEADERS,
    deviceid: deviceId,
    uid,
    Authorization: accessToken,
  }
  const url = `${GET_BIND_ROLE_URL}?uid=${uid}&gameId=${gameId}`
  const res = await fetch(url, { method: 'GET', headers })
  const data = await res.json() as { code: number; msg: string; data?: { roleId?: number; roleName?: string } }

  if (data.code !== 0 || !data.data) {
    throw new Error(`[Tajiduo] 获取绑定角色失败: ${data.msg}`)
  }

  return {
    roleId: String(data.data.roleId ?? 0),
    roleName: data.data.roleName ?? '未知',
  }
}

export async function setupTajiduo(): Promise<TajiduoConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log('\n--- 塔吉多 (Tajiduo) 配置 ---')
  console.log('将通过手机短信验证码登录:\n')

  const gameId = await prompt(rl, 'Game ID (可选, 默认 1289): ') || '1289'

  // Generate deviceId
  const deviceId = 'HT' + randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()
  console.log(`\n设备 ID: ${deviceId}`)

  // SMS login
  const cellphone = await prompt(rl, '\n手机号码: ')
  if (!cellphone) throw new Error('手机号码不能为空')

  console.log('正在发送验证码...')
  await sendSmsCode(cellphone)
  console.log('验证码已发送!')

  const smsCode = await prompt(rl, '请输入验证码: ')
  if (!smsCode) throw new Error('验证码不能为空')

  console.log('正在登录老虎账号...')
  const laohuAccount = await loginBySMS(cellphone, smsCode)
  console.log(`老虎登录成功: userId=${laohuAccount.userId}`)

  console.log('正在登录塔吉多用户中心...')
  const session = await userCenterLogin(laohuAccount.token, laohuAccount.userId, deviceId)
  console.log(`塔吉多登录成功: uid=${session.uid}`)

  // Refresh to get a stable token pair
  console.log('正在获取稳定的 refreshToken...')
  const refreshed = await refreshSession(session.refreshToken, deviceId)

  // Get bind role for display
  console.log('正在获取绑定角色...')
  const role = await getBindRole(session.accessToken, session.uid, gameId, deviceId)
  console.log(`绑定角色: ${role.roleName} (ID: ${role.roleId})`)

  rl.close()

  return {
    enabled: true,
    deviceId,
    uid: session.uid,
    refreshToken: refreshed.refreshToken,
    gameId,
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `bun build src/platforms/tajiduo/setup.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/platforms/tajiduo/setup.ts
git commit -m "feat: add Tajiduo setup with Laohu SMS login flow"
```

---

### Task 10: Main Setup Orchestrator (`src/setup.ts`)

**Files:**
- Create: `src/setup.ts`
- Create: `src/platforms/kurobbs/index.ts` (register)
- Create: `src/platforms/tajiduo/index.ts` (register)

- [ ] **Step 1: Create platform registration files**

```typescript
// src/platforms/kurobbs/index.ts
import { registerPlatform } from '../registry.ts'
import { setupKuroBBS } from './setup.ts'
import { runKuroBBS } from './worker.ts'
import type { Config } from '../../config.ts'

registerPlatform('kurobbs', {
  name: '库洛社区 (KuroBBS)',
  async setup() {
    return { platformKey: 'kurobbs', config: await setupKuroBBS() }
  },
  isEnabled(config: Config) {
    return config.kurobbs?.enabled === true
  },
  async run(config: Config) {
    if (!config.kurobbs) throw new Error('[KuroBBS] 配置不存在')
    await runKuroBBS(config.kurobbs)
  },
})
```

```typescript
// src/platforms/tajiduo/index.ts
import { registerPlatform } from '../registry.ts'
import { setupTajiduo } from './setup.ts'
import { runTajiduo } from './worker.ts'
import type { Config } from '../../config.ts'

registerPlatform('tajiduo', {
  name: '塔吉多 (Tajiduo)',
  async setup() {
    return { platformKey: 'tajiduo', config: await setupTajiduo() }
  },
  isEnabled(config: Config) {
    return config.tajiduo?.enabled === true
  },
  async run(config: Config) {
    if (!config.tajiduo) throw new Error('[Tajiduo] 配置不存在')
    await runTajiduo(config.tajiduo)
  },
})
```

- [ ] **Step 2: Create main setup orchestrator**

```typescript
// src/setup.ts
import { createInterface } from 'readline'
import { saveConfig, type Config } from './config.ts'
import { getAllPlatforms } from './platforms/registry.ts'

// Import platform registrations (side effects)
import './platforms/kurobbs/index.ts'
import './platforms/tajiduo/index.ts'

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

export async function runSetup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdin })

  console.log('=== 自动签到工具配置向导 ===\n')

  const platforms = getAllPlatforms()
  const platformKeys = Array.from(platforms.keys())

  console.log('可用平台:')
  platformKeys.forEach((key, i) => {
    const p = platforms.get(key)!
    console.log(`  ${i + 1}. ${p.name}`)
  })

  const selection = await prompt(rl, '\n请选择要配置的平台 (输入编号，多个用逗号分隔，如 1,2): ')
  rl.close()

  const selectedIndices = selection.split(',').map((s) => parseInt(s.trim()) - 1)
  const selectedKeys = selectedIndices
    .filter((i) => i >= 0 && i < platformKeys.length)
    .map((i) => platformKeys[i])

  if (selectedKeys.length === 0) {
    console.log('未选择任何平台，退出配置')
    return
  }

  const config: Config = {}

  for (const key of selectedKeys) {
    const platform = platforms.get(key)!
    try {
      const result = await platform.setup()
      config[result.platformKey] = result.config
    } catch (err) {
      console.error(`\n${platform.name} 配置失败:`, err)
      console.error('跳过此平台')
    }
  }

  if (Object.keys(config).length === 0) {
    console.log('\n没有成功配置的平台，不保存配置文件')
    return
  }

  await saveConfig(config)
  console.log('\n配置完成!')

  const rl2 = createInterface({ input: process.stdin, output: process.stdout })
  const runNow = await prompt(rl2, '\n是否立即运行签到? (y/N): ')
  rl2.close()

  if (runNow.toLowerCase() === 'y') {
    const { runAll } = await import('./runner.ts')
    await runAll()
  }
}
```

- [ ] **Step 3: Verify types compile**

Run: `bun build src/setup.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/platforms/kurobbs/index.ts src/platforms/tajiduo/index.ts src/setup.ts
git commit -m "feat: add main setup orchestrator with platform registration"
```

---

### Task 11: Runner Refactor (`src/runner.ts`)

**Files:**
- Rewrite: `src/runner.ts`

- [ ] **Step 1: Rewrite runner to use config and registry**

```typescript
// src/runner.ts
import { loadConfig } from './config.ts'
import { getAllPlatforms } from './platforms/registry.ts'

// Import platform registrations (side effects)
import './platforms/kurobbs/index.ts'
import './platforms/tajiduo/index.ts'

export async function runAll(): Promise<void> {
  const config = await loadConfig()
  const platforms = getAllPlatforms()

  const enabled = Array.from(platforms.entries()).filter(([, p]) => p.isEnabled(config))

  if (enabled.length === 0) {
    console.log('未启用任何签到平台，请检查 config.json 配置')
    return
  }

  console.log(`已启用 ${enabled.length} 个签到平台: ${enabled.map(([, p]) => p.name).join(', ')}`)

  for (const [key, platform] of enabled) {
    console.log(`\n--- 开始执行: ${platform.name} ---`)
    try {
      await platform.run(config)
      console.log(`--- 完成: ${platform.name} ---`)
    } catch (err) {
      console.error(`--- 失败: ${platform.name} ---`)
      console.error(err)
    }
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `bun build src/runner.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/runner.ts
git commit -m "refactor: runner uses config.json and platform registry"
```

---

### Task 12: Unified Entry Point (`index.ts`)

**Files:**
- Rewrite: `index.ts`
- Update: `worker.ts`

- [ ] **Step 1: Rewrite index.ts as unified entry**

```typescript
// index.ts
import { existsSync } from 'fs'
import { resolve } from 'path'

const CONFIG_PATH = resolve(import.meta.dirname, 'config.json')
const args = process.argv.slice(2)

if (args.includes('--setup') || !existsSync(CONFIG_PATH)) {
  // Setup mode
  const { runSetup } = await import('./src/setup.ts')
  await runSetup()
} else if (args.includes('--cron') || process.env.CRON) {
  // Cron mode
  const minute = Math.floor(Math.random() * 60)
  const cronExpr = `${minute} 8 * * *`
  console.log(`已设置定时任务，cron 表达式: ${cronExpr}`)
  Bun.cron('./worker.ts', cronExpr, 'auto-check')
} else {
  // Immediate execution
  const { runAll } = await import('./src/runner.ts')
  await runAll()
}
```

- [ ] **Step 2: Update worker.ts**

```typescript
// worker.ts
import { runAll } from './src/runner.ts'
await runAll()
```

- [ ] **Step 3: Verify types compile**

Run: `bun build index.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add index.ts worker.ts
git commit -m "refactor: unified entry point with --setup/--cron/run modes"
```

---

### Task 13: Cleanup Old Files

**Files:**
- Delete: `src/types.ts`
- Delete: `src/token-manager.ts`
- Delete: `src/platforms/kurobbs/index.ts`
- Delete: `src/platforms/tajiduo/index.ts`
- Delete: `src/platforms/kurobbs/headers.txt`
- Delete: `src/platforms/tajiduo/headers.txt`

- [ ] **Step 1: Delete old files**

```bash
rm src/types.ts
rm src/token-manager.ts
rm src/platforms/kurobbs/index.ts
rm src/platforms/tajiduo/index.ts
rm src/platforms/kurobbs/headers.txt
rm src/platforms/tajiduo/headers.txt
```

- [ ] **Step 2: Verify no broken imports**

Run: `bun build index.ts --outdir /dev/null 2>&1 || true`
Expected: No errors.

- [ ] **Step 3: Update .gitignore if needed**

Ensure `config.json` is NOT gitignored (it's user config, should be in repo or documented). Ensure `.cache/` is still gitignored.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old platform files and headers.txt files"
```

---

### Task 14: Final Verification

- [ ] **Step 1: Full type check**

Run: `bun build index.ts --outdir /dev/null 2>&1 || true`
Expected: No type errors.

- [ ] **Step 2: Test setup flow**

Run: `bun run index.ts --setup`
Expected: Interactive setup wizard appears.

- [ ] **Step 3: Test worker flow** (requires config.json from setup)

Run: `bun run worker.ts`
Expected: Worker reads config and attempts check-in.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address verification issues"
```
