/** 星际大战：可登陆天体、武器、敌人与战场 UI 的共享类型 */

export type PlanetBattleId =
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'

export type EnemyKindId = 'grunt' | 'skirmisher' | 'brute' | 'drone'

export type WeaponTag = 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun' | 'melee'

export type WeaponSlot = 'primary' | 'secondary' | 'melee'

export type HitPart = 'head' | 'body' | 'leg'

/* ---------------- 难度与技能 ---------------- */

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5

export interface DifficultyProfile {
  level: DifficultyLevel
  label: string
  en: string
  stars: string
  color: string
  enemyCountMul: number
  enemyHpMul: number
  enemySpeedMul: number
  enemyDamageMul: number
  hazardIntervalMul: number
  hazardDamageMul: number
  lives: number
  scoreMul: number
}

export type SkillId = 'turret' | 'blink' | 'shield' | 'lifesteal' | 'orbital'

/** 瓦罗兰特式战术技能参数 */
export interface SkillSpec {
  id: SkillId
  name: string
  en: string
  /** 绑定的按键（单字符） */
  key: string
  description: string
  color: string
  /** 冷却/充能时间（秒），终极技能为 0 */
  cooldown: number
  /** 可储存次数 */
  charges: number
  /** 持续时间（秒）：炮台存在时间 / 护盾与吸血 buff 时间 / 终极落点延迟 */
  duration: number
  ultimate?: boolean
  ultCost?: number
  teleportDistance?: number
  shieldAmount?: number
  lifestealRatio?: number
  turretRange?: number
  turretDamage?: number
  turretInterval?: number
  strikeDamage?: number
  strikeRadius?: number
}

export interface SkillHud {
  id: SkillId
  name: string
  key: string
  color: string
  ultimate: boolean
  charges: number
  maxCharges: number
  /** 剩余冷却比例 0~1（1 表示刚进入冷却） */
  cooldown: number
  cooldownRemaining: number
  ready: boolean
  active: boolean
  activeRemaining: number
}

export interface WeaponModelStyle {
  /** 枪身主体颜色 */
  body: string
  /** 装饰色（护木/弹匣） */
  accent: string
  /** 金属件颜色 */
  metal: string
  /** 木质枪托颜色 */
  wood?: string
  /** 整体缩放 */
  scale: number
  /** 枪管长度系数 */
  barrel: number
  mag: 'curved' | 'straight' | 'none' | 'drum'
  stock: 'solid' | 'skeleton' | 'none'
  scope: boolean
  pump?: boolean
  blade?: boolean
}

export interface WeaponSound {
  /** 噪声爆破时长 */
  noise: number
  /** 低频冲击频率 */
  thump: number
  /** 金属脆响频率 */
  crack: number
  /** 音量 0~1 */
  gain: number
  /** 尾音时长 */
  tail: number
}

/** 武器参数：伤害 / 射速 / 弹匣 / 后坐力等参照 CS 1.6 真实数值 */
export interface WeaponSpec {
  id: string
  /** 英文型号，如 AK-47 */
  name: string
  /** 中文名 */
  cn: string
  tag: WeaponTag
  slot: WeaponSlot
  price: number
  damage: number
  /** 每分钟射速 */
  rpm: number
  automatic: boolean
  magazine: number
  reserve: number
  reloadTime: number
  drawTime: number
  /** 基础散布（度，1 度 ≈ 100 米处 1.75 米） */
  spread: number
  /** 移动时附加散布（度） */
  moveSpread: number
  /** 腾空时附加散布（度） */
  airSpread: number
  /** 每发垂直后坐（弧度） */
  recoil: number
  /** 每发水平后坐幅度（弧度） */
  recoilSide: number
  /** 穿甲系数：0~1，越高对护甲衰减越小 */
  armorPenetration: number
  headshotMultiplier: number
  legMultiplier: number
  /** 有效射程（米），超出后伤害衰减 */
  range: number
  /** 衰减到最低伤害所需的额外距离 */
  falloffRange: number
  /** 单次发射弹丸数（霰弹枪） */
  pellets: number
  /** 开镜 FOV（度），无则不能开镜 */
  zoomFov?: number
  /** 开镜时散布（度） */
  zoomSpread?: number
  sound: WeaponSound
  model: WeaponModelStyle
  desc: string
}

export interface EnemySpec {
  id: EnemyKindId
  name: string
  role: string
  hp: number
  speed: number
  damage: number
  /** 两次开火的间隔范围（秒） */
  fireDelay: [number, number]
  projectileSpeed: number
  ranged: boolean
  flying: boolean
  /** 站立高度（用于命中盒与血条） */
  height: number
  /** 身体半径 */
  bodyRadius: number
  /** 头部半径 */
  headRadius: number
  scale: number
  color: string
  armorColor: string
  visor: string
  score: number
}

export interface GroundTheme {
  style: 'rock' | 'ice' | 'desert' | 'lava' | 'cloud' | 'toxic' | 'ruin'
  base: string
  dark: string
  light: string
  /** 地形起伏幅度（米） */
  amplitude: number
  /** 起伏频率 */
  frequency: number
  roughness: number
  metalness: number
  craters: number
}

export interface SkyBody {
  color: string
  size: number
  dir: [number, number, number]
  label?: string
}

export interface SkyTheme {
  top: string
  horizon: string
  bottom: string
  sunColor: string
  sunSize: number
  sunDir: [number, number, number]
  /** 星星数量，0 表示被大气遮挡 */
  stars: number
  nebula: boolean
  moons: SkyBody[]
  ring?: { color: string; tilt: number; size: number; opacity: number }
  /** 云带（气态行星上空） */
  bands?: { color: string; speed: number; count: number }
}

export interface PropTheme {
  rock: number
  crystal: number
  wreck: number
  pillar: number
  tree: number
  ruin: number
  platform: number
  color: string
  accent: string
}

export interface ParticleTheme {
  kind: 'dust' | 'snow' | 'ash' | 'rain' | 'spark' | 'spore' | 'wind'
  color: string
  count: number
  speed: number
  size: number
}

export interface HazardTheme {
  kind: 'none' | 'meteor' | 'flare' | 'acid' | 'storm' | 'lightning' | 'quake'
  label: string
  desc: string
  /** 触发间隔（秒） */
  interval: number
  damage: number
  radius: number
  warning: string
  color: string
}

export interface PlanetBattle {
  id: PlanetBattleId
  name: string
  en: string
  codename: string
  tagline: string
  brief: string
  accent: string
  accentSoft: string
  /** 难度等级 1~5：新兵 / 普通 / 困难 / 噩梦 / 地狱 */
  difficulty: DifficultyLevel
  /** 重力加速度 m/s² */
  gravity: number
  fog: { color: string; near: number; far: number }
  sky: SkyTheme
  ground: GroundTheme
  props: PropTheme
  particles: ParticleTheme
  hazard: HazardTheme
  lighting: { sun: string; sunIntensity: number; ambient: string; ambientIntensity: number }
  enemies: {
    pool: EnemyKindId[]
    start: number
    perWave: number
    waves: number
    hpScale: number
    speedScale: number
  }
  weapons: string[]
  tips: string[]
}

/* ---------------- 运行时状态 ---------------- */

export interface HudState {
  health: number
  armor: number
  weaponName: string
  weaponCn: string
  weaponTag: WeaponTag
  slot: WeaponSlot
  ammo: number
  reserve: number
  reloading: boolean
  reloadProgress: number
  spreadPx: number
  kills: number
  headshots: number
  score: number
  wave: number
  totalWaves: number
  enemiesLeft: number
  lives: number
  zoomed: boolean
  time: number
  accuracy: number
  weaponSlots: { slot: WeaponSlot; name: string; ammo: number; active: boolean }[]
  /** 护盾剩余值（技能提供） */
  shield: number
  shieldMax: number
  /** 吸血剩余时间（秒） */
  lifesteal: number
  ultPoints: number
  ultCost: number
  difficulty: DifficultyLevel
  difficultyLabel: string
  difficultyStars: string
  skills: SkillHud[]
}

export type FeedKind = 'kill' | 'headshot' | 'info' | 'warn' | 'pickup' | 'skill'

export interface FeedEntry {
  id: number
  text: string
  kind: FeedKind
}

export type BannerKind = 'wave' | 'warn' | 'info' | 'success'

export interface BattleResult {
  victory: boolean
  kills: number
  headshots: number
  accuracy: number
  score: number
  wave: number
  totalWaves: number
  time: number
  shots: number
  hits: number
}

export interface BattleCallbacks {
  onHud?: (state: HudState) => void
  onFeed?: (entry: FeedEntry) => void
  onBanner?: (text: string, kind: BannerKind) => void
  onLockChange?: (locked: boolean) => void
  onWave?: (wave: number, totalWaves: number) => void
  onEnd?: (result: BattleResult) => void
  onReady?: () => void
  onError?: (message: string) => void
}

export interface LoadoutSelection {
  primary: string | null
  secondary: string
}
