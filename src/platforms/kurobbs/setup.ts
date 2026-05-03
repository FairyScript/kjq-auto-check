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
