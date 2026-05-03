# Project Refactor Design

Date: 2026-05-03

## Goal

Refactor the multi-platform auto check-in tool to have a unified architecture with clear separation between configuration (interactive CLI setup) and execution (worker). The current platform implementations have inconsistent login/check-in flows; the new design standardizes this while keeping each platform self-contained.

## Architecture

### Entry Points

**`index.ts` (unified entry):**
1. `--setup` flag or missing `config.json` → run interactive setup
2. `--cron` flag → create Bun cron job (existing behavior)
3. Otherwise → run worker immediately

**`worker.ts` (standalone):** Lightweight entry for Docker/external schedulers. Calls `runAll()`.

### File Structure

```
src/
├── config.ts              # Config type definitions + loadConfig/saveConfig
├── http.ts                # Shared HTTP utilities (buildHeaders, request, requestWithRetry)
├── runner.ts              # Worker orchestrator (reads config, iterates platforms)
├── setup.ts               # Main setup entry (platform selection, dispatches to platform setup)
└── platforms/
    ├── registry.ts        # Platform registry (name → { setup, worker })
    ├── kurobbs/
    │   ├── setup.ts       # Interactive config flow (token, roleId, userId)
    │   └── worker.ts      # Check-in flow + embedded headers
    └── tajiduo/
        ├── setup.ts       # SMS login flow via Laohu → Tajiduo session
        ├── laohu.ts       # Laohu SMS auth client (AES-ECB, MD5 signing)
        ├── worker.ts      # Check-in flow + DS generation + embedded headers
        └── token-manager.ts  # Token refresh + file-based cache
```

## Config

`config.json` at project root:

```json
{
  "kurobbs": {
    "enabled": true,
    "token": "...",
    "roleId": "...",
    "userId": "...",
    "gameId": "3",
    "serverId": "76402e5b20be2c39f095a152090afddc",
    "ipAddr": ""
  },
  "tajiduo": {
    "enabled": true,
    "deviceId": "...",
    "uid": "...",
    "refreshToken": "...",
    "gameId": "1289"
  }
}
```

Single account per platform. Each platform has a typed config interface.

`src/config.ts` exports:
- `Config` type (top-level object)
- `KuroBBSConfig`, `TajiduoConfig` interfaces
- `loadConfig(): Config` — reads and parses `config.json`
- `saveConfig(config: Config): void` — writes `config.json`

## Platform Interface

```typescript
export interface Platform {
  readonly name: string
  isEnabled(config: PlatformConfig): boolean
  run(config: PlatformConfig): Promise<void>
}
```

Config is passed to `run()`, not read from `process.env`.

## Setup Flow

`src/setup.ts`:
1. Display welcome message
2. Ask user which platforms to enable (multi-select checkbox)
3. For each selected platform, call its `setup()` function
4. Save config to `config.json`
5. Ask if user wants to run worker immediately

### KuroBBS Setup

Prompt for:
- `token` (required) — user pastes from app/burp
- `roleId` (required)
- `userId` (required)
- `gameId` (optional, default "3")
- `serverId` (optional, default "76402e5b20be2c39f095a152090afddc")
- `ipAddr` (optional)

### Tajiduo Setup

Automated login flow:
1. Generate `deviceId` (format: `"HT" + 14 random hex chars`)
2. Prompt for phone number
3. Call Laohu `sendSmsCode()` to send SMS
4. Prompt for SMS verification code
5. Call Laohu `loginBySMS()` → `LaohuAccount` (userId + token)
6. Call Tajiduo `userCenterLogin()` → `TajiduoSession` (accessToken + refreshToken + uid)
7. Call `refreshSession()` to get a stable refresh token pair
8. Auto-save `uid`, `deviceId`, `refreshToken`
9. Display discovered `roleId` for user confirmation

Laohu client reimplemented in TypeScript at `src/platforms/tajiduo/laohu.ts`:
- AES-ECB encryption via `node:crypto` (`crypto.createCipheriv('aes-128-ecb', ...)`)
- MD5 signing (same algorithm as Python SDK)
- Device fingerprinting (Pixel 6 defaults, same as SDK)
- Endpoints: `listAreaCodes`, `sendSmsCode`, `checkSmsCode`, `loginBySMS`

## Worker Flow

`src/runner.ts`: Load config → iterate platforms → call `platform.run(config)` with try/catch per platform.

### KuroBBS Worker

Same flow as current implementation:
1. `initSignIn()` — POST `/encourage/signIn/initSignInV2`
2. Random delay (300-1000ms)
3. `queryRecord()` — POST `/encourage/signIn/queryRecordV2`
4. Check if today already signed in (UTC+8 date comparison)
5. Random delay (300-1000ms)
6. `signIn()` — POST `/encourage/signIn/v2`

All requests: POST with `application/x-www-form-urlencoded` body.

### Tajiduo Worker

Same flow as current implementation:
1. `refreshSession()` — refresh tokens if needed
2. `getGameBindRole()` — GET `/apihub/api/getGameBindRole`
3. `initSignIn()` — GET `/apihub/awapi/sign/rewards`
4. Random delay (300-1000ms)
5. `checkAlreadySignedIn()` — GET `/apihub/awapi/signin/state`
6. `signIn()` — POST `/apihub/awapi/sign`

Token retry: on 401, refresh tokens and retry once. Cache tokens in `.cache/tajiduo.json`.

## Headers

Embedded as JSON constants in each platform's worker module. No more `headers.txt` files.

### KuroBBS Headers

```typescript
const DEFAULT_HEADERS: Record<string, string> = {
  // All 20 headers from current headers.txt
  // devCode contains default IP 180.168.255.251
}
```

If `config.ipAddr` is set, replace the IP portion in `devCode`.

### Tajiduo Headers

```typescript
const DEFAULT_HEADERS: Record<string, string> = {
  "accept": "application/json, text/plain, */*",
  "platform": "android",
  "appversion": "1.2.2",
  "Host": "bbs-api.tajiduo.com",
  "Connection": "keep-alive",
  "Accept-Encoding": "gzip",
  "User-Agent": "okhttp/4.12.0",
}
```

Dynamic headers added at request time: `authorization`, `uid`, `deviceid`, `ds`.

## Shared HTTP Utilities (`src/http.ts`)

- `buildHeaders(base, overrides)` — merge base headers with dynamic values
- `post(url, body, headers)` — POST with form-urlencoded body
- `get(url, query, headers)` — GET with query params
- `requestWithRetry(fn, tokenRefresher)` — wraps a request function with token refresh on 401

## DS Generation (Tajiduo)

Same algorithm as current (identical in both TS and Python SDK):
1. `timestamp` = current time in seconds
2. `nonce` = 8 random alphanumeric chars
3. `raw` = `{timestamp}{nonce}{appVersion}{salt}` (salt: `pUds3dfMkl`)
4. `hash` = MD5(raw)
5. Header value: `{timestamp},{nonce},{hash}`

## Files to Delete

- `src/platforms/kurobbs/headers.txt`
- `src/platforms/tajiduo/headers.txt`
- `src/types.ts` (replaced by new interface in registry)
- `src/token-manager.ts` (base class inlined into tajiduo token-manager)

## Files to Keep (Adapted)

- `src/platforms/tajiduo/token-manager.ts` — adapted to use config instead of env vars
- `worker.ts` — kept as standalone entry, minimal changes
- `.cache/` directory — still used for Tajiduo token cache
