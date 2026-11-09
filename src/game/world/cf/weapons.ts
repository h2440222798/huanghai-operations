/**
 * 穿越火线（CrossFire / CF）风格军械库
 *
 * 与「太阳系战场」的 CS 1.6 数值体系完全分离：这里只服务校园 CF 挑战模式。
 * 数值取向参考 CF 的经典手感——
 *   · 单发伤害高、头部倍率大，三发点射是步枪的正确打开方式；
 *   · 后坐力以「固定弹道」为主（AK 的 7 字、M4 的 T 字），抬枪后不会自动回正，要靠压枪；
 *   · 首发极准，连发散布按发数累积，停火后快速收敛；
 *   · 移动 / 跳跃惩罚很重，开镜狙击一枪定音。
 */

export type CfWeaponTag = 'rifle' | 'smg' | 'sniper' | 'machinegun' | 'pistol' | 'melee'
export type CfSlot = 'primary' | 'secondary' | 'melee'
export type CfRarity = 'standard' | 'rare' | 'hero'

export interface CfRecoilPattern {
  /** 每发上扬角（度）。数组循环使用，形成 CF 的固定弹道。 */
  pitch: readonly number[]
  /** 每发水平偏移（度，正为右）。 */
  yaw: readonly number[]
}

export interface CfWeaponSound {
  /** 低频冲击（Hz） */
  body: number
  /** 金属脆响（Hz） */
  crack: number
  /** 爆破噪声时长（秒） */
  noise: number
  /** 尾音时长（秒） */
  tail: number
  /** 音量 0~1 */
  gain: number
  /** 音色模板 */
  flavor: 'ak' | 'm4' | 'deagle' | 'barrett' | 'gatling' | 'smg' | 'suppressed' | 'knife' | 'shovel'
}

export interface CfWeaponModel {
  body: string
  metal: string
  furniture: string
  accent: string
  /** 枪管长度系数 */
  barrel: number
  mag: 'curved' | 'straight' | 'drum' | 'box' | 'none'
  stock: 'wood' | 'buffer' | 'folding' | 'none'
  scope: boolean
  /** 英雄级动态皮肤 */
  skin?: 'flame' | 'thunder'
  /** 近战类型 */
  blade?: 'kukri' | 'shovel'
}

export interface CfWeaponSpec {
  id: string
  /** 英文型号，如 AK-47 */
  name: string
  /** 中文名 */
  cn: string
  tag: CfWeaponTag
  slot: CfSlot
  rarity: CfRarity
  /** 基础单发伤害（CF 口径：躯干） */
  damage: number
  /** 每分钟射速 */
  rpm: number
  automatic: boolean
  magazine: number
  reserve: number
  /** 换弹时间（秒） */
  reloadTime: number
  /** 切枪时间（秒） */
  drawTime: number
  /** 站定单发散布（度） */
  spread: number
  /** 移动附加散布（度） */
  moveSpread: number
  /** 腾空附加散布（度） */
  airSpread: number
  /** 每发连射散布增长（度） */
  bloom: number
  /** 连射散布上限（度） */
  bloomMax: number
  /** 连射散布恢复（度/秒） */
  bloomRecovery: number
  recoil: CfRecoilPattern
  /** 枪身后坐动画强度（0~1.5） */
  kick: number
  armorPenetration: number
  headshotMultiplier: number
  legMultiplier: number
  /** 伤害衰减起点（米） */
  falloffStart: number
  /** 伤害衰减终点（米） */
  falloffEnd: number
  /** 远距离最低伤害比例 */
  minDamageRatio: number
  pellets: number
  /** 开镜 FOV 缩放（0.35 ≈ 2.85 倍镜），无则不能开镜 */
  zoomFov?: number
  /** 开镜散布（度） */
  zoomSpread?: number
  /** 开镜后坐力倍率 */
  zoomRecoil?: number
  /** 开镜移动速度倍率 */
  zoomMove?: number
  /** 加特林预转时间（秒） */
  spinUp?: number
  sound: CfWeaponSound
  model: CfWeaponModel
  desc: string
  /** 是否出现在挑战模式的武器选择里 */
  selectable: boolean
}

/* ============================== 弹道表 ============================== */

/** 把 12 发左右的弹道片段补成 CF 式的循环弹道 */
function cyclePattern(pitch: readonly number[], yaw: readonly number[]): CfRecoilPattern {
  return { pitch, yaw }
}

/* AK-47：CF 经典的「7」字弹道——先直上，再右压，最后回摆左侧 */
const AK_PATTERN = cyclePattern(
  [0.72, 0.86, 0.96, 0.93, 0.88, 0.82, 0.76, 0.7, 0.62, 0.56, 0.52, 0.48],
  [0.0, 0.04, 0.08, 0.14, 0.26, 0.34, 0.38, 0.3, -0.06, -0.32, -0.44, -0.36],
)

/* M4A1：抬枪更直、横向摆动更小，像「T」 */
const M4_PATTERN = cyclePattern(
  [0.6, 0.72, 0.8, 0.78, 0.74, 0.7, 0.66, 0.6, 0.55, 0.5, 0.46, 0.42],
  [0.0, 0.03, 0.06, 0.12, 0.2, 0.24, 0.18, 0.05, -0.12, -0.24, -0.3, -0.2],
)

/* 加特林：持续小幅抖动，靠射速和弹量压制 */
const GATLING_PATTERN = cyclePattern(
  [0.3, 0.34, 0.32, 0.36, 0.31, 0.35, 0.33, 0.37, 0.3, 0.34, 0.32, 0.36],
  [0.1, -0.08, 0.14, -0.12, 0.06, -0.14, 0.16, -0.06, 0.12, -0.1, 0.08, -0.16],
)

/* 汤姆逊：老式冲锋枪的左右点头 */
const THOMPSON_PATTERN = cyclePattern(
  [0.44, 0.5, 0.54, 0.52, 0.5, 0.48, 0.44, 0.42, 0.4, 0.38, 0.36, 0.34],
  [0.0, 0.06, 0.12, 0.1, 0.02, -0.08, -0.14, -0.1, -0.02, 0.08, 0.12, 0.06],
)

/* 火麒麟：AK 的弹道，但枪身更稳、上扬更小 */
const HQ_AK_PATTERN = cyclePattern(
  [0.62, 0.74, 0.82, 0.8, 0.76, 0.7, 0.65, 0.6, 0.54, 0.49, 0.45, 0.42],
  [0.0, 0.03, 0.06, 0.1, 0.2, 0.27, 0.31, 0.24, -0.04, -0.26, -0.36, -0.3],
)

/* ============================== 武器表 ============================== */

export const CF_WEAPONS: readonly CfWeaponSpec[] = [
  {
    id: 'ak47',
    name: 'AK-47',
    cn: 'AK-47 突击步枪',
    tag: 'rifle',
    slot: 'primary',
    rarity: 'standard',
    damage: 36,
    rpm: 600,
    automatic: true,
    magazine: 30,
    reserve: 90,
    reloadTime: 2.35,
    drawTime: 0.65,
    spread: 0.16,
    moveSpread: 2.6,
    airSpread: 8.5,
    bloom: 0.34,
    bloomMax: 2.6,
    bloomRecovery: 7,
    recoil: AK_PATTERN,
    kick: 1,
    armorPenetration: 0.78,
    headshotMultiplier: 4,
    legMultiplier: 0.75,
    falloffStart: 22,
    falloffEnd: 65,
    minDamageRatio: 0.62,
    pellets: 1,
    sound: { body: 92, crack: 1050, noise: 0.11, tail: 0.2, gain: 0.62, flavor: 'ak' },
    model: {
      body: '#2b2a27', metal: '#3a3f45', furniture: '#7a4522', accent: '#b8783a',
      barrel: 1, mag: 'curved', stock: 'wood', scope: false,
    },
    desc: 'CF 的招牌步枪。首发几乎无散布，三连点最稳；一梭子扫射会画出标志性的 7 字弹道。',
    selectable: true,
  },
  {
    id: 'm4a1',
    name: 'M4A1',
    cn: 'M4A1 卡宾枪',
    tag: 'rifle',
    slot: 'primary',
    rarity: 'standard',
    damage: 31,
    rpm: 667,
    automatic: true,
    magazine: 30,
    reserve: 90,
    reloadTime: 2.5,
    drawTime: 0.6,
    spread: 0.12,
    moveSpread: 2.3,
    airSpread: 8,
    bloom: 0.26,
    bloomMax: 2.1,
    bloomRecovery: 8.5,
    recoil: M4_PATTERN,
    kick: 0.82,
    armorPenetration: 0.72,
    headshotMultiplier: 3.8,
    legMultiplier: 0.75,
    falloffStart: 24,
    falloffEnd: 70,
    minDamageRatio: 0.66,
    pellets: 1,
    sound: { body: 120, crack: 1350, noise: 0.095, tail: 0.16, gain: 0.56, flavor: 'm4' },
    model: {
      body: '#2f3439', metal: '#4a525a', furniture: '#20252a', accent: '#6b7783',
      barrel: 1.05, mag: 'straight', stock: 'buffer', scope: false,
    },
    desc: '后坐更温柔的制式卡宾枪。压枪容易、连发稳定，适合中距离持续输出。',
    selectable: true,
  },
  {
    id: 'barrett',
    name: 'Barrett M82A1',
    cn: '巴雷特 重狙',
    tag: 'sniper',
    slot: 'primary',
    rarity: 'rare',
    damage: 210,
    rpm: 38,
    automatic: false,
    magazine: 10,
    reserve: 30,
    reloadTime: 3.4,
    drawTime: 1.05,
    spread: 0.05,
    moveSpread: 5,
    airSpread: 12,
    bloom: 1.4,
    bloomMax: 5,
    bloomRecovery: 4,
    recoil: cyclePattern([4.2], [0.35]),
    kick: 1.45,
    armorPenetration: 1,
    headshotMultiplier: 6,
    legMultiplier: 0.9,
    falloffStart: 140,
    falloffEnd: 260,
    minDamageRatio: 0.8,
    pellets: 1,
    zoomFov: 0.34,
    zoomSpread: 0.02,
    zoomRecoil: 0.86,
    zoomMove: 0.42,
    sound: { body: 52, crack: 760, noise: 0.2, tail: 0.5, gain: 0.82, flavor: 'barrett' },
    model: {
      body: '#3a3a34', metal: '#4f5452', furniture: '#4a4f45', accent: '#8a8f7a',
      barrel: 1.5, mag: 'box', stock: 'none', scope: true,
    },
    desc: '右键开镜，一枪一个。巨大的后坐力与漫长的拉栓间隔是它的代价。',
    selectable: true,
  },
  {
    id: 'gatling',
    name: 'M134 Gatling',
    cn: '加特林 机枪',
    tag: 'machinegun',
    slot: 'primary',
    rarity: 'rare',
    damage: 26,
    rpm: 900,
    automatic: true,
    magazine: 200,
    reserve: 200,
    reloadTime: 4.6,
    drawTime: 1.15,
    spread: 0.55,
    moveSpread: 4.5,
    airSpread: 11,
    bloom: 0.18,
    bloomMax: 3.4,
    bloomRecovery: 6,
    recoil: GATLING_PATTERN,
    kick: 0.55,
    armorPenetration: 0.66,
    headshotMultiplier: 2.6,
    legMultiplier: 0.7,
    falloffStart: 18,
    falloffEnd: 55,
    minDamageRatio: 0.55,
    pellets: 1,
    spinUp: 0.45,
    sound: { body: 78, crack: 2200, noise: 0.07, tail: 0.1, gain: 0.5, flavor: 'gatling' },
    model: {
      body: '#33383d', metal: '#5b636b', furniture: '#22262a', accent: '#d9a441',
      barrel: 0.9, mag: 'drum', stock: 'none', scope: false,
    },
    desc: '按住左键先空转 0.45 秒，随后 900 发/分倾泻。移动与换弹都极慢，守点神器。',
    selectable: true,
  },
  {
    id: 'thompson',
    name: 'Thompson',
    cn: '汤姆逊 冲锋枪',
    tag: 'smg',
    slot: 'primary',
    rarity: 'standard',
    damage: 24,
    rpm: 720,
    automatic: true,
    magazine: 50,
    reserve: 100,
    reloadTime: 2.9,
    drawTime: 0.75,
    spread: 0.4,
    moveSpread: 2.2,
    airSpread: 9,
    bloom: 0.22,
    bloomMax: 2.8,
    bloomRecovery: 7.5,
    recoil: THOMPSON_PATTERN,
    kick: 0.7,
    armorPenetration: 0.62,
    headshotMultiplier: 3,
    legMultiplier: 0.75,
    falloffStart: 14,
    falloffEnd: 45,
    minDamageRatio: 0.5,
    pellets: 1,
    sound: { body: 104, crack: 1650, noise: 0.085, tail: 0.14, gain: 0.52, flavor: 'smg' },
    model: {
      body: '#34302b', metal: '#4a4640', furniture: '#6a4a2a', accent: '#8a6038',
      barrel: 0.9, mag: 'drum', stock: 'wood', scope: false,
    },
    desc: '50 发弹鼓的老兵冲锋枪，近身泼水，远距离伤害掉得厉害。',
    selectable: true,
  },
  {
    id: 'ak47_hq',
    name: 'AK-47 火麒麟',
    cn: 'AK-47 火麒麟',
    tag: 'rifle',
    slot: 'primary',
    rarity: 'hero',
    damage: 38,
    rpm: 620,
    automatic: true,
    magazine: 35,
    reserve: 105,
    reloadTime: 2.2,
    drawTime: 0.55,
    spread: 0.13,
    moveSpread: 2.2,
    airSpread: 8,
    bloom: 0.3,
    bloomMax: 2.3,
    bloomRecovery: 8,
    recoil: HQ_AK_PATTERN,
    kick: 0.9,
    armorPenetration: 0.82,
    headshotMultiplier: 4.2,
    legMultiplier: 0.75,
    falloffStart: 26,
    falloffEnd: 70,
    minDamageRatio: 0.66,
    pellets: 1,
    sound: { body: 86, crack: 980, noise: 0.115, tail: 0.24, gain: 0.64, flavor: 'ak' },
    model: {
      body: '#2a100a', metal: '#757a80', furniture: '#4a1409', accent: '#ff7a1a',
      barrel: 1.02, mag: 'curved', stock: 'wood', scope: false, skin: 'flame',
    },
    desc: '英雄级 AK。35 发弹匣、更稳的弹道和更小的上扬，枪身火焰会随呼吸流动。',
    selectable: true,
  },
  {
    id: 'm4a1_thunder',
    name: 'M4A1 雷神',
    cn: 'M4A1 雷神',
    tag: 'rifle',
    slot: 'primary',
    rarity: 'hero',
    damage: 33,
    rpm: 680,
    automatic: true,
    magazine: 32,
    reserve: 96,
    reloadTime: 2.35,
    drawTime: 0.55,
    spread: 0.1,
    moveSpread: 2,
    airSpread: 7.5,
    bloom: 0.23,
    bloomMax: 1.9,
    bloomRecovery: 9,
    recoil: cyclePattern(
      [0.58, 0.68, 0.74, 0.72, 0.68, 0.64, 0.6, 0.56, 0.52, 0.48, 0.44, 0.4],
      [0.0, 0.02, 0.05, 0.1, 0.17, 0.2, 0.15, 0.04, -0.1, -0.2, -0.25, -0.16],
    ),
    kick: 0.78,
    armorPenetration: 0.78,
    headshotMultiplier: 4,
    legMultiplier: 0.75,
    falloffStart: 27,
    falloffEnd: 75,
    minDamageRatio: 0.7,
    pellets: 1,
    sound: { body: 112, crack: 1280, noise: 0.1, tail: 0.18, gain: 0.6, flavor: 'm4' },
    model: {
      body: '#101a26', metal: '#9aa8b4', furniture: '#0c141c', accent: '#59c8ff',
      barrel: 1.05, mag: 'straight', stock: 'buffer', scope: false, skin: 'thunder',
    },
    desc: '英雄级 M4。32 发弹匣、近乎直线的弹道，枪身电弧随射速闪烁。',
    selectable: true,
  },
  {
    id: 'deagle',
    name: 'Desert Eagle',
    cn: '沙漠之鹰',
    tag: 'pistol',
    slot: 'secondary',
    rarity: 'standard',
    damage: 58,
    rpm: 240,
    automatic: false,
    magazine: 7,
    reserve: 35,
    reloadTime: 2.05,
    drawTime: 0.5,
    spread: 0.2,
    moveSpread: 2.8,
    airSpread: 9,
    bloom: 0.9,
    bloomMax: 3.5,
    bloomRecovery: 9,
    recoil: cyclePattern([2.35], [0.28]),
    kick: 1.15,
    armorPenetration: 0.92,
    headshotMultiplier: 4.5,
    legMultiplier: 0.75,
    falloffStart: 25,
    falloffEnd: 70,
    minDamageRatio: 0.6,
    pellets: 1,
    sound: { body: 64, crack: 980, noise: 0.14, tail: 0.28, gain: 0.7, flavor: 'deagle' },
    model: {
      body: '#8d949b', metal: '#c8cfd6', furniture: '#2a2e33', accent: '#e8eef4',
      barrel: 1, mag: 'straight', stock: 'none', scope: false,
    },
    desc: '手感最「CF」的手炮。单发 58、爆头必杀，但 7 发打完要等 2 秒换弹。',
    selectable: true,
  },
  {
    id: 'usp',
    name: 'USP',
    cn: 'USP 消音手枪',
    tag: 'pistol',
    slot: 'secondary',
    rarity: 'standard',
    damage: 30,
    rpm: 352,
    automatic: false,
    magazine: 12,
    reserve: 48,
    reloadTime: 2.15,
    drawTime: 0.5,
    spread: 0.16,
    moveSpread: 2.4,
    airSpread: 8,
    bloom: 0.5,
    bloomMax: 2.4,
    bloomRecovery: 9,
    recoil: cyclePattern([0.95], [0.1]),
    kick: 0.7,
    armorPenetration: 0.7,
    headshotMultiplier: 4,
    legMultiplier: 0.75,
    falloffStart: 22,
    falloffEnd: 55,
    minDamageRatio: 0.6,
    pellets: 1,
    sound: { body: 118, crack: 640, noise: 0.07, tail: 0.09, gain: 0.36, flavor: 'suppressed' },
    model: {
      body: '#2c3035', metal: '#aab3bb', furniture: '#1a1d21', accent: '#4da3ff',
      barrel: 0.95, mag: 'straight', stock: 'none', scope: false,
    },
    desc: '消音手枪，声音小、后坐低，12 发点射爆头很稳。',
    selectable: true,
  },
  {
    id: 'kukri',
    name: 'Kukri',
    cn: '尼泊尔军刀',
    tag: 'melee',
    slot: 'melee',
    rarity: 'standard',
    damage: 70,
    rpm: 170,
    automatic: false,
    magazine: 0,
    reserve: 0,
    reloadTime: 0,
    drawTime: 0.4,
    spread: 0,
    moveSpread: 0,
    airSpread: 0,
    bloom: 0,
    bloomMax: 0,
    bloomRecovery: 0,
    recoil: cyclePattern([0], [0]),
    kick: 0,
    armorPenetration: 0.9,
    headshotMultiplier: 2.4,
    legMultiplier: 0.9,
    falloffStart: 2.8,
    falloffEnd: 3.2,
    minDamageRatio: 0.8,
    pellets: 1,
    sound: { body: 200, crack: 1800, noise: 0.16, tail: 0.08, gain: 0.42, flavor: 'knife' },
    model: {
      body: '#5a3a22', metal: '#c7d2dd', furniture: '#3a2414', accent: '#d9a441',
      barrel: 1, mag: 'none', stock: 'none', scope: false, blade: 'kukri',
    },
    desc: 'CF 近战招牌。2.8 米内一刀 70，爆头两倍多；攻速快，贴身反打很凶。',
    selectable: true,
  },
  {
    id: 'shovel',
    name: 'Shovel',
    cn: '军用铁锹',
    tag: 'melee',
    slot: 'melee',
    rarity: 'standard',
    damage: 95,
    rpm: 105,
    automatic: false,
    magazine: 0,
    reserve: 0,
    reloadTime: 0,
    drawTime: 0.55,
    spread: 0,
    moveSpread: 0,
    airSpread: 0,
    bloom: 0,
    bloomMax: 0,
    bloomRecovery: 0,
    recoil: cyclePattern([0], [0]),
    kick: 0,
    armorPenetration: 0.85,
    headshotMultiplier: 2,
    legMultiplier: 0.9,
    falloffStart: 3.1,
    falloffEnd: 3.5,
    minDamageRatio: 0.8,
    pellets: 1,
    sound: { body: 150, crack: 1100, noise: 0.2, tail: 0.1, gain: 0.48, flavor: 'shovel' },
    model: {
      body: '#6a4a2a', metal: '#8f9aa4', furniture: '#4a321c', accent: '#b8783a',
      barrel: 1, mag: 'none', stock: 'none', scope: false, blade: 'shovel',
    },
    desc: '一锹 95，挥动慢但判定范围最远。没子弹时的最后体面。',
    selectable: true,
  },
]

export const CF_WEAPON_BY_ID: Record<string, CfWeaponSpec> = Object.fromEntries(
  CF_WEAPONS.map((weapon) => [weapon.id, weapon]),
)

export const CF_SLOT_ORDER: readonly CfSlot[] = ['primary', 'secondary', 'melee']

export interface CfLoadout {
  primary: string
  secondary: string
  melee: string
}

export const DEFAULT_CF_LOADOUT: CfLoadout = { primary: 'ak47', secondary: 'deagle', melee: 'kukri' }

export const CF_LOADOUT_SLOTS: readonly { slot: CfSlot; label: string; en: string }[] = [
  { slot: 'primary', label: '主武器', en: 'PRIMARY' },
  { slot: 'secondary', label: '副武器', en: 'SECONDARY' },
  { slot: 'melee', label: '近战', en: 'MELEE' },
]

export function weaponsForSlot(slot: CfSlot): CfWeaponSpec[] {
  return CF_WEAPONS.filter((weapon) => weapon.slot === slot && weapon.selectable)
}

export function getCfWeapon(id: string | null | undefined, fallbackSlot?: CfSlot): CfWeaponSpec {
  const weapon = id ? CF_WEAPON_BY_ID[id] : undefined
  if (weapon) return weapon
  if (fallbackSlot) {
    return weaponsForSlot(fallbackSlot)[0] ?? CF_WEAPONS[0]!
  }
  return CF_WEAPONS[0]!
}

/** 把 UI 传来的（可能不完整的）选择修正成一套合法配枪 */
export function resolveCfLoadout(partial?: Partial<CfLoadout> | null): CfLoadout {
  const pick = (slot: CfSlot, id: string | undefined): string => {
    const weapon = id ? CF_WEAPON_BY_ID[id] : undefined
    if (weapon && weapon.slot === slot) return weapon.id
    return weaponsForSlot(slot)[0]?.id ?? DEFAULT_CF_LOADOUT[slot]
  }
  return {
    primary: pick('primary', partial?.primary),
    secondary: pick('secondary', partial?.secondary),
    melee: pick('melee', partial?.melee),
  }
}

export const CF_SLOT_LABEL: Record<CfSlot, string> = {
  primary: '主武器',
  secondary: '副武器',
  melee: '近战',
}

export const CF_TAG_LABEL: Record<CfWeaponTag, string> = {
  rifle: '步枪',
  smg: '冲锋枪',
  sniper: '狙击枪',
  machinegun: '机枪',
  pistol: '手枪',
  melee: '近战',
}

/** 武器卡片用的五维评分（0~100），按 CF 手感取向换算 */
export function cfWeaponRating(weapon: CfWeaponSpec): {
  damage: number
  rate: number
  magazine: number
  accuracy: number
  control: number
} {
  const dps = weapon.damage * (weapon.pellets ?? 1) * (weapon.rpm / 60)
  // 伤害用对数刻度：36 的 AK 约 67 分，210 的巴雷特 100 分，避免近战/狙击把条拉爆
  const damageRating = Math.min(100, Math.round((Math.log10(Math.max(1, weapon.damage)) / Math.log10(210)) * 100))
  return {
    damage: damageRating,
    rate: Math.round(Math.min(100, weapon.rpm / 9)),
    magazine: Math.round(Math.min(100, weapon.magazine * (weapon.magazine > 100 ? 0.5 : 2))),
    accuracy: Math.round(Math.min(100, 100 - (weapon.spread + weapon.moveSpread) * 8)),
    control: Math.round(Math.min(100, 100 - dps / 16 - (weapon.bloomMax ?? 0) * 6)),
  }
}
