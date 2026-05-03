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
  const rl = createInterface({ input: process.stdin, output: process.stdout })

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
