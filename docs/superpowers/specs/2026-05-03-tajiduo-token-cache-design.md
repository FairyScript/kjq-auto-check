# Tajiduo Token 缓存与刷新功能设计

## 概述

为塔吉多平台添加 token 缓存和自动刷新功能，避免每次运行都需要手动更新 token。

## 目标

1. 将塔吉多的 accessToken 和 refreshToken 缓存到本地文件
2. 启动时优先使用缓存的 token
3. 收到 401 响应时自动刷新 token 并重试请求
4. 刷新失败时中断流程，避免无限循环

## 缓存文件

### 位置
`.cache/tajiduo.json`

### 格式
```json
{
  "accessToken": "xxx",
  "refreshToken": "xxx"
}
```

### 安全
- `.cache/` 目录加入 `.gitignore`

## TokenManager 类

### 位置
`src/platforms/tajiduo/token-manager.ts`

### 接口
```typescript
class TokenManager {
  private cachePath: string

  constructor(platformName: string)

  // 读取缓存的 token
  getTokens(): Promise<{ accessToken: string; refreshToken: string } | null>

  // 保存 token 到缓存
  saveTokens(accessToken: string, refreshToken: string): Promise<void>

  // 刷新 token
  refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>
}
```

### 刷新接口
- URL: `https://bbs-api.tajiduo.com/usercenter/api/refreshToken`
- 方法: POST
- 请求体: `{ refreshToken: string }`
- 响应: `{ data: { accessToken: string, refreshToken: string } }`

## TajiduoPlatform 改造

### config 属性
- 保留从环境变量读取 `refreshToken` 作为初始值/备用
- 移除对 `token` 的直接依赖

### buildHeaders() 方法
- 使用 `TokenManager.getValidAccessToken()` 获取 token
- 设置 `Authorization` 头

### 请求重试逻辑
每个需要认证的请求都包装在重试逻辑中：

```typescript
async requestWithRetry<T>(requestFn: (token: string) => Promise<T>): Promise<T> {
  // 1. 获取当前 token
  let tokens = await this.tokenManager.getTokens()

  if (!tokens) {
    // 缓存不存在，使用环境变量的 refreshToken 刷新
    tokens = await this.tokenManager.refreshTokens(this.config.refreshToken)
    await this.tokenManager.saveTokens(tokens.accessToken, tokens.refreshToken)
  }

  try {
    // 2. 尝试请求
    return await requestFn(tokens.accessToken)
  } catch (err) {
    // 3. 检查是否是 401 错误
    if (err instanceof HttpError && err.status === 401) {
      // 4. 刷新 token
      const newTokens = await this.tokenManager.refreshTokens(tokens.refreshToken)
      await this.tokenManager.saveTokens(newTokens.accessToken, newTokens.refreshToken)

      try {
        // 5. 重试请求
        return await requestFn(newTokens.accessToken)
      } catch (retryErr) {
        // 6. 重试仍然失败，refreshToken 已失效
        if (retryErr instanceof HttpError && retryErr.status === 401) {
          throw new Error('[Tajiduo] refreshToken 已失效，请重新登录获取')
        }
        throw retryErr
      }
    }
    throw err
  }
}
```

### 各方法改造
- `initSignIn()`: 使用 `requestWithRetry`
- `checkAlreadySignedIn()`: 使用 `requestWithRetry`
- `signIn()`: 使用 `requestWithRetry`

## 流程图

```
启动
  ↓
读取缓存 token (.cache/tajiduo.json)
  ↓
缓存存在？ → 是 → 使用缓存的 accessToken
  ↓ 否
使用环境变量的 refreshToken 调用刷新接口
  ↓
保存新 token 到缓存
  ↓
执行签到请求
  ↓
收到 401？ → 是 → 使用 refreshToken 刷新
  ↓ 否                ↓
返回结果         刷新成功？ → 是 → 保存新 token → 重试请求
                      ↓ 否
                 抛出错误，中断流程
```

## 文件变更

1. **新增**: `src/platforms/tajiduo/token-manager.ts` - TokenManager 类
2. **修改**: `src/platforms/tajiduo/index.ts` - 集成 TokenManager 和重试逻辑
3. **修改**: `.gitignore` - 添加 `.cache/`
4. **新增**: `.cache/tajiduo.json` - 缓存文件（运行时生成）

## 错误处理

1. 缓存文件不存在：正常，使用环境变量刷新
2. 缓存文件损坏：删除缓存，使用环境变量刷新
3. 刷新接口失败：抛出错误，中断流程
4. 刷新后仍然 401：抛出错误，提示 refreshToken 已失效
