import { createInterface } from 'readline'
import type { KuroBBSConfig } from '../../config.ts'
import { loadConfigSafe, saveConfigPartial } from '../../config.ts'

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

export async function setupKuroBBS(): Promise<KuroBBSConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log('\n--- 库洛社区 (KuroBBS) 配置 ---')

  const existing = await loadConfigSafe()
  const cfg = existing.kurobbs

  if (cfg?.token) {
    console.log('检测到已有配置，直接回车可保留原值:\n')
  } else {
    console.log('请从 APP 或抓包工具中获取以下信息:\n')
  }

  const token = await prompt(rl, `Token (必填${cfg?.token ? ', 当前已设置' : ''}): `) || cfg?.token || ''
  if (!token) throw new Error('Token 不能为空')

  const roleId = await prompt(rl, `Role ID (必填${cfg?.roleId ? ', 当前: ' + cfg.roleId : ''}): `) || cfg?.roleId || ''
  if (!roleId) throw new Error('Role ID 不能为空')

  const userId = await prompt(rl, `User ID (必填${cfg?.userId ? ', 当前: ' + cfg.userId : ''}): `) || cfg?.userId || ''
  if (!userId) throw new Error('User ID 不能为空')

  const gameId = await prompt(rl, `Game ID (可选, 默认 ${cfg?.gameId || '3'}): `) || cfg?.gameId || '3'
  const serverId = await prompt(rl, `Server ID (可选, 默认 ${cfg?.serverId || '76402e5b20be2c39f095a152090afddc'}): `) || cfg?.serverId || '76402e5b20be2c39f095a152090afddc'
  const ipAddr = await prompt(rl, `IP 地址 (可选, 留空使用默认${cfg?.ipAddr ? ', 当前: ' + cfg.ipAddr : ''}): `) || cfg?.ipAddr || ''

  rl.close()

  const result: KuroBBSConfig = { enabled: true, token, roleId, userId, gameId, serverId, ipAddr }
  await saveConfigPartial({ kurobbs: result })
  console.log('(KuroBBS 配置已保存)')

  return result
}
