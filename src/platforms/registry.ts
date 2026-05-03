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
