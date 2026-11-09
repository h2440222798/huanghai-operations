/**
 * 对局界面是否挂载中。由 GameView 在 mount / unmount 时切换，
 * 供工坊 API 判断提示能否显示、是否需要排队。
 */
let gameplayActive = false

export function setGameplayActive(value: boolean): void {
  gameplayActive = value
}

export function isGameplayActive(): boolean {
  return gameplayActive
}
