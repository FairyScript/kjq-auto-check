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
