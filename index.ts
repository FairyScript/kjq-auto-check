// index.ts
import { existsSync } from 'fs'
import { resolve } from 'path'
import { setDebug } from './src/debug.ts'

const CONFIG_PATH = resolve(import.meta.dirname, 'config.json')
const args = process.argv.slice(2)

if (args.includes('--debug')) setDebug(true)

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
