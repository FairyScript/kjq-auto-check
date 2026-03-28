import { main } from './worker'

const args = process.argv.slice(2)
if (args.includes('--cron') || process.env.CRON) {
  // 生成8点随机分钟的cron表达式
  const minute = Math.floor(Math.random() * 60)
  const cronExpr = `${minute} 8 * * *`
  console.log(`Scheduling task with cron expression: ${cronExpr}`)
  Bun.cron('./worker.ts', cronExpr, 'kjq-auto-check')
} else {
  main()
}
