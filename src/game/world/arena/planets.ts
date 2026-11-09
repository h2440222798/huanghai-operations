import { waveEnemyCount } from './math'
import type {
  DifficultyLevel, DifficultyProfile, EnemyKindId, EnemySpec, PlanetBattle, PlanetBattleId,
} from './types'

/**
 * 星际大战战场配置
 * 每颗天体拥有独立的地表、天空、天候灾害、重力与敌军编成。
 */

/** 难度倍率表：同时影响敌军数量、血量、伤害、天候频率与玩家增援次数 */
export const DIFFICULTY_PROFILES: Record<DifficultyLevel, DifficultyProfile> = {
  1: {
    level: 1, label: '新兵', en: 'Recruit', stars: '★☆☆☆☆', color: '#7ce09a',
    enemyCountMul: 0.8, enemyHpMul: 0.85, enemySpeedMul: 0.92, enemyDamageMul: 0.8,
    hazardIntervalMul: 1.15, hazardDamageMul: 0.8, lives: 3, scoreMul: 0.8,
  },
  2: {
    level: 2, label: '普通', en: 'Standard', stars: '★★☆☆☆', color: '#5aa8ff',
    enemyCountMul: 1, enemyHpMul: 1, enemySpeedMul: 1, enemyDamageMul: 1,
    hazardIntervalMul: 1, hazardDamageMul: 1, lives: 3, scoreMul: 1,
  },
  3: {
    level: 3, label: '困难', en: 'Hard', stars: '★★★☆☆', color: '#ffc247',
    enemyCountMul: 1.15, enemyHpMul: 1.2, enemySpeedMul: 1.05, enemyDamageMul: 1.2,
    hazardIntervalMul: 0.92, hazardDamageMul: 1.2, lives: 2, scoreMul: 1.25,
  },
  4: {
    level: 4, label: '噩梦', en: 'Nightmare', stars: '★★★★☆', color: '#ff8a5a',
    enemyCountMul: 1.3, enemyHpMul: 1.4, enemySpeedMul: 1.1, enemyDamageMul: 1.4,
    hazardIntervalMul: 0.85, hazardDamageMul: 1.4, lives: 2, scoreMul: 1.6,
  },
  5: {
    level: 5, label: '地狱', en: 'Hell', stars: '★★★★★', color: '#ff5a4a',
    enemyCountMul: 1.5, enemyHpMul: 1.65, enemySpeedMul: 1.16, enemyDamageMul: 1.6,
    hazardIntervalMul: 0.78, hazardDamageMul: 1.6, lives: 1, scoreMul: 2,
  },
}

export function difficultyProfile(level: number): DifficultyProfile {
  const clamped = Math.min(5, Math.max(1, Math.round(level))) as DifficultyLevel
  return DIFFICULTY_PROFILES[clamped]
}

export const ENEMY_SPECS: Record<EnemyKindId, EnemySpec> = {
  grunt: {
    id: 'grunt',
    name: '异星步兵',
    role: '标准突击单位',
    hp: 100,
    speed: 2.4,
    damage: 9,
    fireDelay: [1.5, 2.6],
    projectileSpeed: 34,
    ranged: true,
    flying: false,
    height: 1.8,
    bodyRadius: 0.42,
    headRadius: 0.24,
    scale: 1,
    color: '#2a2440',
    armorColor: '#4a3d6e',
    visor: '#ff5a36',
    score: 100,
  },
  skirmisher: {
    id: 'skirmisher',
    name: '迅捷猎手',
    role: '高速侧翼单位',
    hp: 68,
    speed: 3.7,
    damage: 7,
    fireDelay: [0.95, 1.7],
    projectileSpeed: 48,
    ranged: true,
    flying: false,
    height: 1.68,
    bodyRadius: 0.34,
    headRadius: 0.2,
    scale: 0.92,
    color: '#241d33',
    armorColor: '#3d3560',
    visor: '#ffb03a',
    score: 130,
  },
  brute: {
    id: 'brute',
    name: '重装撕裂者',
    role: '近战重甲单位',
    hp: 280,
    speed: 1.65,
    damage: 28,
    fireDelay: [2.2, 3.2],
    projectileSpeed: 24,
    ranged: false,
    flying: false,
    height: 2.6,
    bodyRadius: 0.62,
    headRadius: 0.3,
    scale: 1.3,
    color: '#2a1a22',
    armorColor: '#4f2831',
    visor: '#ff3b3b',
    score: 220,
  },
  drone: {
    id: 'drone',
    name: '浮游炮台',
    role: '空中火力单位',
    hp: 62,
    speed: 4.3,
    damage: 6,
    fireDelay: [1.1, 2.1],
    projectileSpeed: 30,
    ranged: true,
    flying: true,
    height: 1.4,
    bodyRadius: 0.42,
    headRadius: 0.26,
    scale: 1,
    color: '#1c2a33',
    armorColor: '#2f5566',
    visor: '#54e8ff',
    score: 150,
  },
}

export const PLANET_ORDER: PlanetBattleId[] = [
  'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'sun',
]

export const PLANET_BATTLES: Record<PlanetBattleId, PlanetBattle> = {
  sun: {
    id: 'sun',
    name: '太阳',
    en: 'Sun',
    codename: '日冕要塞',
    tagline: '在恒星表层迎击入侵舰队',
    brief: '敌军把母舰停进了日冕层。炙热的等离子风暴每 9 秒横扫一次战场，只有持续移动才能活下来。',
    accent: '#ffb03a',
    accentSoft: 'rgba(255, 176, 58, .16)',
    difficulty: 5,
    gravity: 27.9,
    fog: { color: '#ff7a1e', near: 30, far: 210 },
    sky: {
      top: '#2a0700',
      horizon: '#ff7d1a',
      bottom: '#ffcf6b',
      sunColor: '#fff3c4',
      sunSize: 90,
      sunDir: [0.25, 0.3, -1],
      stars: 0,
      nebula: false,
      moons: [],
    },
    ground: {
      style: 'lava', base: '#3a1206', dark: '#120402', light: '#ff8a2a',
      amplitude: 0.9, frequency: 0.06, roughness: 0.72, metalness: 0.12, craters: 8,
    },
    props: { rock: 16, crystal: 10, wreck: 6, pillar: 10, tree: 0, ruin: 0, platform: 0, color: '#5a2410', accent: '#ff9f3a' },
    particles: { kind: 'spark', color: '#ffb45a', count: 720, speed: 1.4, size: 0.055 },
    hazard: {
      kind: 'flare', label: '日冕耀斑', desc: '周期性 Plasma 爆发，红色预警圈内会被灼伤',
      interval: 9, damage: 24, radius: 7.5, warning: '日冕耀斑即将爆发 — 离开红色区域', color: '#ff7a2a',
    },
    lighting: { sun: '#ffd27a', sunIntensity: 3.2, ambient: '#ff7a2a', ambientIntensity: 0.75 },
    enemies: { pool: ['grunt', 'brute', 'skirmisher'], start: 4, perWave: 2, waves: 3, hpScale: 1.15, speedScale: 1.05 },
    weapons: ['ak47', 'deagle', 'm3', 'mp5', 'm4a1'],
    tips: ['重力是地球的 2.8 倍，跳跃会非常低', '耀斑预警出现后立刻横向转移', '高伤害武器优先，敌人护甲很厚'],
  },
  mercury: {
    id: 'mercury',
    name: '水星',
    en: 'Mercury',
    codename: '焦土前哨',
    tagline: '在昼夜交界线上的狙击决斗',
    brief: '水星前哨站已失守，敌军狙击手占据了陨石坑制高点。低重力让跳跃变得轻盈，也让你更容易成为靶子。',
    accent: '#c9a98f',
    accentSoft: 'rgba(201, 169, 143, .16)',
    difficulty: 1,
    gravity: 3.7,
    fog: { color: '#1b1210', near: 70, far: 340 },
    sky: {
      top: '#000000',
      horizon: '#2b1c14',
      bottom: '#0a0605',
      sunColor: '#fff6df',
      sunSize: 64,
      sunDir: [0.62, 0.34, -0.78],
      stars: 4200,
      nebula: false,
      moons: [],
    },
    ground: {
      style: 'rock', base: '#7d6a5c', dark: '#3a3029', light: '#c9b6a2',
      amplitude: 1.9, frequency: 0.035, roughness: 0.92, metalness: 0.04, craters: 46,
    },
    props: { rock: 30, crystal: 0, wreck: 5, pillar: 6, tree: 0, ruin: 0, platform: 0, color: '#8a7768', accent: '#d8c4ae' },
    particles: { kind: 'dust', color: '#b9a48f', count: 460, speed: 0.5, size: 0.045 },
    hazard: {
      kind: 'meteor', label: '陨石雨', desc: '没有大气层，陨石会直接砸在战场上',
      interval: 7.5, damage: 26, radius: 6.5, warning: '陨石雨来袭 — 注意落点', color: '#ffb47a',
    },
    lighting: { sun: '#fff4dc', sunIntensity: 3, ambient: '#2a2622', ambientIntensity: 0.55 },
    enemies: { pool: ['drone', 'grunt', 'skirmisher'], start: 4, perWave: 2, waves: 3, hpScale: 1, speedScale: 1 },
    weapons: ['awp', 'm4a1', 'usp', 'deagle', 'ak47'],
    tips: ['低重力：可以跳到岩石顶部占据高点', '没有空气，枪声之外一片死寂', '陨石落点有 1.4 秒预警圈'],
  },
  venus: {
    id: 'venus',
    name: '金星',
    en: 'Venus',
    codename: '硫酸云海',
    tagline: '在能见度不足 40 米的酸雾中推进',
    brief: '金星殖民穹顶被击穿，硫酸雾正灌进战场。视野极差，敌人会从雾里突然出现——听声辨位比眼睛更可靠。',
    accent: '#e8c46e',
    accentSoft: 'rgba(232, 196, 110, .16)',
    difficulty: 2,
    gravity: 8.87,
    fog: { color: '#b8791f', near: 6, far: 96 },
    sky: {
      top: '#4a2c08',
      horizon: '#e0a53a',
      bottom: '#7a4a10',
      sunColor: '#ffe9b0',
      sunSize: 24,
      sunDir: [0.2, 0.42, -0.9],
      stars: 0,
      nebula: false,
      moons: [],
    },
    ground: {
      style: 'toxic', base: '#6a5122', dark: '#2f2410', light: '#c9a860',
      amplitude: 1.25, frequency: 0.05, roughness: 0.86, metalness: 0.06, craters: 14,
    },
    props: { rock: 18, crystal: 0, wreck: 8, pillar: 14, tree: 0, ruin: 4, platform: 0, color: '#7a6028', accent: '#d8b45a' },
    particles: { kind: 'rain', color: '#d8e070', count: 900, speed: 15, size: 0.05 },
    hazard: {
      kind: 'acid', label: '硫酸雨', desc: '腐蚀性降雨会造成持续伤害',
      interval: 6, damage: 16, radius: 8, warning: '硫酸雨即将倾泻 — 躲到掩体后方', color: '#d8e070',
    },
    lighting: { sun: '#ffd98a', sunIntensity: 2.2, ambient: '#8a6a20', ambientIntensity: 0.9 },
    enemies: { pool: ['grunt', 'skirmisher', 'brute'], start: 5, perWave: 2, waves: 3, hpScale: 1.05, speedScale: 1.02 },
    weapons: ['mp5', 'm3', 'glock18', 'ak47', 'm4a1'],
    tips: ['能见度极低，注意小地图红点', '酸雨预警时贴近石柱躲避', '近战霰弹枪在雾中非常强势'],
  },
  earth: {
    id: 'earth',
    name: '地球',
    en: 'Earth',
    codename: '最后的防线',
    tagline: '在沦陷的城市废墟中守住人类阵地',
    brief: '异星登陆舰坠毁在城郊，街区已经变成巷战现场。这是人类的家园——一步都不能再退。',
    accent: '#5aa8ff',
    accentSoft: 'rgba(90, 168, 255, .16)',
    difficulty: 2,
    gravity: 9.8,
    fog: { color: '#5c7080', near: 55, far: 280 },
    sky: {
      top: '#0b1d33',
      horizon: '#6a8aa3',
      bottom: '#1a2733',
      sunColor: '#ffe3b0',
      sunSize: 20,
      sunDir: [-0.52, 0.3, -0.8],
      stars: 420,
      nebula: false,
      moons: [{ color: '#e8e4d8', size: 7, dir: [-0.7, 0.55, 0.5], label: '月球' }],
    },
    ground: {
      style: 'ruin', base: '#44523c', dark: '#222b20', light: '#8c9a6a',
      amplitude: 0.55, frequency: 0.08, roughness: 0.94, metalness: 0.03, craters: 0,
    },
    props: { rock: 10, crystal: 0, wreck: 7, pillar: 5, tree: 24, ruin: 18, platform: 0, color: '#6a6f62', accent: '#9db07c' },
    particles: { kind: 'ash', color: '#9aa8b4', count: 380, speed: 0.7, size: 0.04 },
    hazard: {
      kind: 'storm', label: '雷暴', desc: '积雨云会向地面释放电弧',
      interval: 10, damage: 18, radius: 9, warning: '雷暴正在形成 — 远离孤立的金属残骸', color: '#7fc4ff',
    },
    lighting: { sun: '#ffd9a8', sunIntensity: 2.4, ambient: '#5c748a', ambientIntensity: 0.85 },
    enemies: { pool: ['grunt', 'skirmisher', 'brute', 'drone'], start: 5, perWave: 2, waves: 3, hpScale: 1, speedScale: 1 },
    weapons: ['m4a1', 'ak47', 'mp5', 'usp', 'awp'],
    tips: ['标准重力，熟悉的手感', '利用废墟墙体做掩护', '爆头伤害 ×4，瞄准发光面罩'],
  },
  mars: {
    id: 'mars',
    name: '火星',
    en: 'Mars',
    codename: '赤色荒原',
    tagline: '沙暴与低重力下的机动作战',
    brief: '火星殖民地的信号在三小时前中断。赤色沙暴中，敌军的能量武器把荒原照得忽明忽暗。',
    accent: '#ff7a4d',
    accentSoft: 'rgba(255, 122, 77, .16)',
    difficulty: 3,
    gravity: 3.71,
    fog: { color: '#c4774f', near: 40, far: 230 },
    sky: {
      top: '#3a1a10',
      horizon: '#d99a6a',
      bottom: '#5a2c1a',
      sunColor: '#ffe0b8',
      sunSize: 22,
      sunDir: [0.42, 0.4, -0.72],
      stars: 0,
      nebula: false,
      moons: [
        { color: '#c9b8a8', size: 4.2, dir: [0.65, 0.5, 0.45], label: '火卫一' },
        { color: '#a89a8c', size: 2.6, dir: [0.8, 0.3, 0.6], label: '火卫二' },
      ],
    },
    ground: {
      style: 'desert', base: '#a85a3a', dark: '#4a2114', light: '#e0a074',
      amplitude: 2.5, frequency: 0.03, roughness: 0.9, metalness: 0.02, craters: 26,
    },
    props: { rock: 28, crystal: 0, wreck: 9, pillar: 8, tree: 0, ruin: 6, platform: 0, color: '#b8683f', accent: '#f0a878' },
    particles: { kind: 'dust', color: '#e0a074', count: 820, speed: 2.2, size: 0.05 },
    hazard: {
      kind: 'storm', label: '沙暴', desc: '高速沙粒会撕裂护甲',
      interval: 8, damage: 14, radius: 12, warning: '沙暴逼近 — 寻找岩石背风面', color: '#e0a074',
    },
    lighting: { sun: '#ffd0a8', sunIntensity: 2.7, ambient: '#8a4a2a', ambientIntensity: 0.8 },
    enemies: { pool: ['grunt', 'skirmisher', 'brute'], start: 5, perWave: 2, waves: 3, hpScale: 1.02, speedScale: 1.04 },
    weapons: ['ak47', 'awp', 'deagle', 'm3', 'm4a1'],
    tips: ['低重力 + 起伏地形，适合打游击', '沙暴会降低能见度，贴身战更多', 'AWP 在开阔荒原上是王者'],
  },
  jupiter: {
    id: 'jupiter',
    name: '木星',
    en: 'Jupiter',
    codename: '风暴浮城',
    tagline: '在气态巨行星的浮空平台上死守',
    brief: '木星轨道站被改造成了敌军补给中枢。狂风、闪电和 2.5 倍重力，每一步都像灌了铅。',
    accent: '#ffb066',
    accentSoft: 'rgba(255, 176, 102, .16)',
    difficulty: 3,
    gravity: 24.79,
    fog: { color: '#c98b4a', near: 25, far: 175 },
    sky: {
      top: '#2a1408',
      horizon: '#e0a05a',
      bottom: '#8a4a20',
      sunColor: '#fff0c8',
      sunSize: 18,
      sunDir: [0.3, 0.35, -0.88],
      stars: 0,
      nebula: false,
      moons: [{ color: '#e8d8b8', size: 9, dir: [0.6, 0.45, 0.5], label: '木卫一' }],
      bands: { color: '#ffe0b0', speed: 0.004, count: 7 },
    },
    ground: {
      style: 'cloud', base: '#d8a870', dark: '#8a5a30', light: '#ffe0b0',
      amplitude: 1.05, frequency: 0.04, roughness: 0.72, metalness: 0.08, craters: 0,
    },
    props: { rock: 10, crystal: 0, wreck: 9, pillar: 12, tree: 0, ruin: 4, platform: 15, color: '#b08050', accent: '#ffd9a0' },
    particles: { kind: 'wind', color: '#ffd9a0', count: 700, speed: 19, size: 0.05 },
    hazard: {
      kind: 'lightning', label: '风暴闪电', desc: '超级风暴每几秒劈下巨型电弧',
      interval: 5.5, damage: 22, radius: 6, warning: '闪电锁定 — 离开预警圈', color: '#ffe08a',
    },
    lighting: { sun: '#ffd8a0', sunIntensity: 2.5, ambient: '#a06a30', ambientIntensity: 0.95 },
    enemies: { pool: ['drone', 'skirmisher', 'brute', 'grunt'], start: 5, perWave: 2, waves: 3, hpScale: 1.1, speedScale: 0.95 },
    weapons: ['p90', 'm4a1', 'deagle', 'm3', 'ak47'],
    tips: ['2.5 倍重力：跳跃几乎无用，别指望走位回血', '闪电预警圈很小，需要立刻横移', '浮空平台边缘没有护栏，小心坠落'],
  },
  saturn: {
    id: 'saturn',
    name: '土星',
    en: 'Saturn',
    codename: '冰环矿场',
    tagline: '在光环碎片之间穿行作战',
    brief: '土星环采矿场是敌军稀有金属的来源。冰晶在环日光照下折射出刺眼的光，冰面会突然开裂。',
    accent: '#ffe6a8',
    accentSoft: 'rgba(255, 230, 168, .16)',
    difficulty: 4,
    gravity: 10.44,
    fog: { color: '#b9c4cc', near: 45, far: 230 },
    sky: {
      top: '#1b2a33',
      horizon: '#d8cfae',
      bottom: '#5a6a70',
      sunColor: '#fff4d0',
      sunSize: 15,
      sunDir: [-0.35, 0.32, -0.88],
      stars: 1100,
      nebula: false,
      moons: [{ color: '#d8e4e8', size: 6, dir: [0.65, 0.5, 0.4], label: '土卫六' }],
      ring: { color: '#e8dcb8', tilt: 0.42, size: 190, opacity: 0.5 },
    },
    ground: {
      style: 'ice', base: '#cfe0e8', dark: '#6f8794', light: '#f4fbff',
      amplitude: 1.45, frequency: 0.045, roughness: 0.35, metalness: 0.15, craters: 12,
    },
    props: { rock: 16, crystal: 20, wreck: 6, pillar: 7, tree: 0, ruin: 0, platform: 11, color: '#9fc0cc', accent: '#eafcff' },
    particles: { kind: 'snow', color: '#eaf6ff', count: 900, speed: 3, size: 0.045 },
    hazard: {
      kind: 'quake', label: '冰层崩裂', desc: '冰面碎裂，裂缝周围会造成伤害',
      interval: 8, damage: 20, radius: 9, warning: '冰层崩裂 — 离开脚下裂纹', color: '#9fe8ff',
    },
    lighting: { sun: '#fff4d8', sunIntensity: 2.4, ambient: '#8aa8b8', ambientIntensity: 0.9 },
    enemies: { pool: ['grunt', 'drone', 'brute'], start: 5, perWave: 2, waves: 3, hpScale: 1.05, speedScale: 1 },
    weapons: ['awp', 'm4a1', 'usp', 'mp5', 'ak47'],
    tips: ['冰面反光强烈，敌人面罩是唯一亮点', '冰裂预警出现后立刻移动', '光环在天空形成巨大弧带'],
  },
  uranus: {
    id: 'uranus',
    name: '天王星',
    en: 'Uranus',
    codename: '冰晶深渊',
    tagline: '侧躺自转的冰巨星上，光都是斜的',
    brief: '天王星轨道镜阵是深空通讯的节点。甲烷冰晶在极低温度下像玻璃一样脆，风暴正从极区压下来。',
    accent: '#7fe8e0',
    accentSoft: 'rgba(127, 232, 224, .16)',
    difficulty: 4,
    gravity: 8.69,
    fog: { color: '#123a44', near: 14, far: 120 },
    sky: {
      top: '#04121a',
      horizon: '#3f9aa8',
      bottom: '#0a2630',
      sunColor: '#d8fbff',
      sunSize: 13,
      sunDir: [0.2, 0.28, -0.94],
      stars: 2000,
      nebula: true,
      moons: [{ color: '#cfe8e8', size: 5, dir: [0.62, 0.55, 0.5], label: '天卫三' }],
      ring: { color: '#9fe8e0', tilt: 1.2, size: 150, opacity: 0.26 },
    },
    ground: {
      style: 'ice', base: '#8fd6de', dark: '#2a5a66', light: '#e0fbff',
      amplitude: 1.05, frequency: 0.05, roughness: 0.28, metalness: 0.22, craters: 16,
    },
    props: { rock: 12, crystal: 24, wreck: 4, pillar: 8, tree: 0, ruin: 0, platform: 8, color: '#5fa8b4', accent: '#bff4ff' },
    particles: { kind: 'snow', color: '#bff4ff', count: 780, speed: 2.2, size: 0.038 },
    hazard: {
      kind: 'storm', label: '甲烷风暴', desc: '极区风暴会冻结未受保护的护甲',
      interval: 7, damage: 16, radius: 10, warning: '甲烷风暴推进 — 寻找冰柱掩护', color: '#7fe8e0',
    },
    lighting: { sun: '#d8fbff', sunIntensity: 2, ambient: '#2a6a78', ambientIntensity: 1 },
    enemies: { pool: ['skirmisher', 'drone', 'grunt', 'brute'], start: 5, perWave: 2, waves: 3, hpScale: 1.03, speedScale: 1.03 },
    weapons: ['mp5', 'awp', 'p90', 'glock18', 'm4a1'],
    tips: ['低温让枪械更容易卡壳——换弹间隔略长', '冰晶柱可被打碎，注意走位', '天空的环几乎垂直于地平线'],
  },
  neptune: {
    id: 'neptune',
    name: '海王星',
    en: 'Neptune',
    codename: '深蓝风暴眼',
    tagline: '太阳系边缘，风速 2100 km/h 的决战',
    brief: '这是人类舰队的最后一道防线。海王星风暴眼内，敌军母舰的护盾发生器正在充能——必须在此之前摧毁所有地面单位。',
    accent: '#6f9bff',
    accentSoft: 'rgba(111, 155, 255, .16)',
    difficulty: 5,
    gravity: 11.15,
    fog: { color: '#0a1a3a', near: 10, far: 135 },
    sky: {
      top: '#02040f',
      horizon: '#1b3f7a',
      bottom: '#040a18',
      sunColor: '#e0eaff',
      sunSize: 11,
      sunDir: [0.3, 0.4, -0.86],
      stars: 2600,
      nebula: true,
      moons: [{ color: '#cfe0f0', size: 5.5, dir: [-0.6, 0.5, 0.62], label: '海卫一' }],
      bands: { color: '#7fa3e8', speed: 0.007, count: 5 },
    },
    ground: {
      style: 'rock', base: '#2a3f6a', dark: '#0e1730', light: '#6a8fd0',
      amplitude: 1.7, frequency: 0.04, roughness: 0.7, metalness: 0.18, craters: 20,
    },
    props: { rock: 18, crystal: 16, wreck: 7, pillar: 12, tree: 0, ruin: 8, platform: 6, color: '#2f4a7a', accent: '#8fb0ff' },
    particles: { kind: 'rain', color: '#7fa3e8', count: 900, speed: 21, size: 0.05 },
    hazard: {
      kind: 'lightning', label: '超音速雷暴', desc: '2100 km/h 风暴中的巨型电弧',
      interval: 6, damage: 21, radius: 7, warning: '雷暴锁定 — 立即脱离预警圈', color: '#8fb0ff',
    },
    lighting: { sun: '#cfe0ff', sunIntensity: 1.9, ambient: '#1b3a6a', ambientIntensity: 1.05 },
    enemies: { pool: ['brute', 'skirmisher', 'drone', 'grunt'], start: 6, perWave: 2, waves: 3, hpScale: 1.15, speedScale: 1.06 },
    weapons: ['awp', 'ak47', 'deagle', 'p90', 'm4a1'],
    tips: ['最终战场，敌人数量最多', '雷暴密集，保持移动', '优先击杀重装单位，它们的近战伤害极高'],
  },
}

export function getPlanetBattle(id: string | undefined | null): PlanetBattle {
  if (id && id in PLANET_BATTLES) return PLANET_BATTLES[id as PlanetBattleId]
  return PLANET_BATTLES.earth
}

export function isPlanetBattleId(id: string | undefined | null): id is PlanetBattleId {
  return Boolean(id) && id! in PLANET_BATTLES
}

/** 星图顺序中下一颗天体（用于结算页“下一站”） */
export function nextPlanetBattleId(id: PlanetBattleId): PlanetBattleId {
  const index = PLANET_ORDER.indexOf(id)
  return PLANET_ORDER[(index + 1) % PLANET_ORDER.length] ?? 'earth'
}

export function totalEnemies(planet: PlanetBattle) {
  let total = 0
  for (let wave = 1; wave <= planet.enemies.waves; wave += 1) {
    total += waveEnemyCount(planet.enemies.start, planet.enemies.perWave, wave)
  }
  return total
}

/** 按难度倍率换算后的实际敌军总数（与 game.ts 的波次生成保持一致） */
export function totalEnemiesForDifficulty(planet: PlanetBattle, level = planet.difficulty) {
  const profile = difficultyProfile(level)
  let total = 0
  for (let wave = 1; wave <= planet.enemies.waves; wave += 1) {
    total += Math.max(1, Math.round(waveEnemyCount(planet.enemies.start, planet.enemies.perWave, wave) * profile.enemyCountMul))
  }
  return total
}
