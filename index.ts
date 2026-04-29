import { runAll } from './src/runner.ts'

const args = process.argv.slice(2)

if (args.includes('--cron') || process.env.CRON) {
  // 生成每天 8 点随机分钟的 cron 表达式，避免请求集中
  const minute = Math.floor(Math.random() * 60)
  const cronExpr = `${minute} 8 * * *`
  console.log(`已设置定时任务，cron 表达式: ${cronExpr}`)
  Bun.cron('./worker.ts', cronExpr, 'auto-check')
} else {
  // 立即执行一次签到
  await runAll()
}
