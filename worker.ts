/**
 * worker.ts — 供 Bun.cron / 外部调度器直接执行的入口
 * 直接运行: bun run worker.ts
 */
import { runAll } from './src/runner.ts'

function main() {
  // 设置workdir为项目根目录，确保相对路径正确
  process.chdir(import.meta.dirname)
  runAll()
}

if (import.meta.main) {
  main()
}


