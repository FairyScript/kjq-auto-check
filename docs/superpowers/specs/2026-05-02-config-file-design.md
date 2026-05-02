# Config File Design: env -> config.json

## Goal

Replace environment-variable-based configuration with a JSON config file. Each config entry specifies a platform, game type, and necessary credentials. Supports multiple accounts per platform, each with an independent enabled/disabled toggle.

## Config File Format

**File:** `config.json` (project root, gitignored)

```json
{
  "kurobbs": [
    {
      "enabled": true,
      "token": "your_kurobbs_token",
      "roleId": "your_role_id",
      "userId": "your_user_id",
      "gameId": "3",
      "serverId": "76402e5b20be2c39f095a152090afddc",
      "ipAddr": "180.168.255.251"
    }
  ],
  "tajiduo": [
    {
      "enabled": true,
      "token": "your_tajiduo_token",
      "roleId": "your_role_id",
      "gameId": "1289"
    }
  ]
}
```

Top-level keys are platform names matching `src/platforms/` directory names. Each platform holds an array of account entries.

### Per-platform fields

**KuroBBS:**

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| enabled | yes | - | Toggle this entry |
| token | yes | - | JWT auth token |
| roleId | yes | - | In-game role ID |
| userId | yes | - | User account ID |
| gameId | no | "3" | Game identifier |
| serverId | no | "76402e5b20be2c39f095a152090afddc" | Server identifier |
| ipAddr | no | (none) | Override default IP in devCode header |

**Tajiduo:**

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| enabled | yes | - | Toggle this entry |
| token | yes | - | Auth token |
| roleId | yes | - | Role ID |
| gameId | no | "1289" | Game identifier |

## Architecture Changes

### 1. New: `src/config.ts`

- Reads and parses `config.json` from project root
- Defines typed interfaces for each platform's config entry (`KuroBBSConfig`, `TajiduoConfig`)
- Exports `loadConfig()` that returns the validated config object
- Throws clear errors if file is missing or required fields are absent
- Applies default values for optional fields

### 2. Modified: `src/types.ts`

Replace the current `CheckInPlatform` interface:

```ts
export interface CheckInPlatform {
  readonly name: string
  run(): Promise<void>
}
```

- `isEnabled()` removed — the runner handles filtering via the `enabled` field
- Each platform class receives its config via constructor, stores it as instance field
- `run()` uses the stored config, no parameter needed

### 3. New: `src/platforms/index.ts`

Platform registry mapping platform names to classes:

```ts
import { KuroBBSPlatform } from "./kurobbs"
import { TajiduoPlatform } from "./tajiduo"

export const platforms = {
  kurobbs: KuroBBSPlatform,
  tajiduo: TajiduoPlatform,
}
```

### 4. Modified: Platform classes

**`src/platforms/kurobbs/index.ts`:**
- Remove `get config()` that reads `process.env`
- Constructor receives `KuroBBSConfig`, stores as `private readonly config`
- `buildHeaders()`, `buildFormData()` etc. use stored config
- Remove `isEnabled()` method

**`src/platforms/tajiduo/index.ts`:**
- Same pattern — constructor receives `TajiduoConfig`, stores as `private readonly config`
- Remove `isEnabled()` method

### 5. Modified: `src/runner.ts`

- Import `loadConfig` and `platforms` registry
- `runAll()` calls `loadConfig()`, iterates platform keys in config
- For each platform key, looks up class from registry, filters `enabled: true` entries, instantiates each with its config, calls `run()`
- Remove hardcoded `ALL_PLATFORMS` array
- Log: list enabled entry count per platform

### 6. Modified: `index.ts`

- Remove `process.env.CRON` check — keep only `--cron` CLI argument
- Runtime behavior (cron vs immediate) controlled purely by CLI args

## Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| create | `config.json` | Actual config (gitignored) |
| create | `config.example.json` | Template with placeholder values |
| create | `src/config.ts` | Config loader and types |
| create | `src/platforms/index.ts` | Platform registry |
| modify | `src/types.ts` | New CheckInPlatform interface |
| modify | `src/platforms/kurobbs/index.ts` | Accept config param, remove env |
| modify | `src/platforms/tajiduo/index.ts` | Accept config param, remove env |
| modify | `src/runner.ts` | Use config + registry |
| modify | `index.ts` | Remove env.CRON check |
| modify | `.gitignore` | Add config.json |
| delete | `.env.example` | No longer needed |

## What stays the same

- `headers.txt` files — HTTP headers still loaded from text files at runtime
- `randomDelay()` utility — stays in each platform file (could be extracted later, out of scope)
- `worker.ts` — calls `runAll()`, no changes needed
- `Dockerfile` — unchanged
- `.env` file — left untouched but no longer used by code
