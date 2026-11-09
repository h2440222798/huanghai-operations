import type { CfSlot, CfWeaponTag } from './world/cf'

/** 五个可玩模式 */
export type GameModeId = 'classic' | 'bomb' | 'bio' | 'challenge' | 'delta'

export type MatchPhase = 'briefing' | 'combat' | 'intermission' | 'paused' | 'victory' | 'defeat'

export type FeedKind = 'kill' | 'headshot' | 'info' | 'warn' | 'pickup' | 'streak' | 'objective'

export interface GameModeMeta {
  id: GameModeId
  name: string
  en: string
  tagline: string
  description: string
  /** 规则要点，首页与简报面板展示 */
  rules: string[]
  accent: string
  /** 目标描述（HUD 左侧常驻） */
  objective: string
  /** 单局时长（秒），用于首页标注 */
  duration: number
  icon: 'swords' | 'bomb' | 'biohazard' | 'target' | 'map'
}

export interface CaptureState {
  id: string
  label: string
  owner: 'ally' | 'enemy' | 'neutral'
  /** 0~100，向当前争夺方推进 */
  progress: number
  /** 玩家是否站在点内 */
  playerInside: boolean
}

export interface BombState {
  /** 未拾取 / 携带 / 已安放 / 已拆除 / 已爆炸 */
  state: 'idle' | 'carried' | 'planted' | 'defused' | 'exploded'
  site: 'A' | 'B' | null
  timer: number
  plantProgress: number
  defuseProgress: number
  /** 玩家是否在爆破点范围内 */
  inSite: boolean
}

export interface WaveState {
  wave: number
  totalWaves: number
  label: string
  enemiesLeft: number
  enemiesTotal: number
  intermission: number
}

export interface RadarBlip {
  x: number
  z: number
  kind: 'enemy' | 'ally' | 'objective' | 'bomb'
}

export interface MatchHud {
  mode: GameModeId
  modeName: string
  phase: MatchPhase

  health: number
  armor: number
  dead: boolean
  respawnIn: number

  weaponName: string
  weaponCn: string
  weaponTag: CfWeaponTag
  slot: CfSlot
  ammo: number
  reserve: number
  magazineSize: number
  reloading: boolean
  reloadProgress: number
  switching: boolean
  zoomed: boolean
  canZoom: boolean
  lowAmmo: boolean
  spin: number
  spreadPx: number

  kills: number
  headshots: number
  deaths: number
  score: number
  accuracy: number
  elapsed: number
  remaining: number

  hitMarker: number
  headshotMarker: number
  streak: number
  streakLabel: string
  streakRemaining: number

  /** 模式目标行 */
  objectiveTitle: string
  objectiveDetail: string
  /** 0~1，可选进度条 */
  objectiveProgress: number | null

  /** 双方比分 / 票数 */
  allyLabel: string
  enemyLabel: string
  allyScore: number
  enemyScore: number
  allyTarget: number

  bomb?: BombState
  captures?: CaptureState[]
  wave?: WaveState
  /** 生化模式的感染倒计时 / 存活时间 */
  survival?: { survived: number; target: number }
  /** 雷达：以玩家为中心的相对坐标由 HUD 计算 */
  radar: RadarBlip[]
  playerX: number
  playerZ: number
  playerYaw: number
}

export interface MatchResult {
  mode: GameModeId
  victory: boolean
  score: number
  kills: number
  headshots: number
  deaths: number
  accuracy: number
  time: number
  /** 结算面板副标题，例如「成功引爆炸弹 3 回合」 */
  detail: string
  /** 额外结算行 */
  lines: { label: string; value: string }[]
}

export interface FeedEntry {
  id: number
  text: string
  kind: FeedKind
}

export interface LoadoutChoice {
  primary: string
  secondary: string
  melee: string
}
