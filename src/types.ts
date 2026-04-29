/**
 * 签到平台接口，每个平台实现此接口
 */
export interface CheckInPlatform {
  /** 平台名称，用于日志展示 */
  readonly name: string
  /** 判断当前平台是否通过 env 启用 */
  isEnabled(): boolean
  /** 执行签到流程 */
  run(): Promise<void>
}
