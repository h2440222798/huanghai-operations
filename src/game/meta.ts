import type { GameModeId, GameModeMeta } from './types'

export const GAME_MODES: Record<GameModeId, GameModeMeta> = {
  classic: {
    id: 'classic',
    name: '经典模式',
    en: 'CLASSIC',
    tagline: '团队竞技 · 40 击杀决胜负',
    description:
      '黄海校园被潜伏者占据。你和三名队友在校园里正面交火，先拿到 40 个击杀的一方获胜。死亡后 3 秒复活，拼的是枪法和推进节奏。',
    rules: ['目标击杀 40', '单局 6 分钟', '阵亡 3 秒复活', '队友 AI 协同作战'],
    accent: '#f2b544',
    objective: '击杀潜伏者，先到 40 分',
    duration: 360,
    icon: 'swords',
  },
  bomb: {
    id: 'bomb',
    name: '爆破模式',
    en: 'BOMB',
    tagline: 'C4 攻防 · 5 回合 3 胜',
    description:
      '你作为突击手进攻校园里的 A / B 两个爆破点。贴近包点按住 E 安放 C4，随后守住 45 秒等待引爆；潜伏者会扑上来拆弹。',
    rules: ['5 回合 3 胜', '每回合 2 分 10 秒', '包点内按住 E 安放 C4', 'C4 引爆 45 秒倒计时'],
    accent: '#ff6b3d',
    objective: '安放 C4 并守住爆破点',
    duration: 130,
    icon: 'bomb',
  },
  bio: {
    id: 'bio',
    name: '生化模式',
    en: 'BIOCHEMICAL',
    tagline: '感染爆发 · 存活 4 分钟',
    description:
      '实验泄漏，校园里全是感染体。你只有一条命：被近身撕咬、被腐蚀弹命中都会掉血，血量归零即被感染。撑满 4 分钟等到救援直升机。',
    rules: ['单条性命，无复活', '存活 4 分钟即胜利', '每 50 秒刷新强化母体', '击杀掉落医疗包 / 弹药'],
    accent: '#7ce07a',
    objective: '抵挡感染体，坚持 4 分钟',
    duration: 240,
    icon: 'biohazard',
  },
  challenge: {
    id: 'challenge',
    name: '挑战模式',
    en: 'CHALLENGE',
    tagline: '30 波守卫战 · 守住校园',
    description:
      '经典的 CF 守卫挑战：30 波怪兽分批冲进校园，每 10 波刷新 BOSS。清空全部 30 波即通关，考验压枪、走位和补给管理。',
    rules: ['共 30 波', '每 10 波 BOSS', '波间 6 秒补给', '阵亡即失败'],
    accent: '#6fb7ff',
    objective: '清空 30 波怪兽',
    duration: 1500,
    icon: 'target',
  },
  delta: {
    id: 'delta',
    name: '三角洲大战场',
    en: 'DELTA',
    tagline: '三点争夺 · 300 票征服',
    description:
      '三角洲行动式的征服战：A / B / C 三个据点，占领后持续消耗敌方票数。你带一支四人小队推进，红方会不断增援反扑。',
    rules: ['双方各 300 票', '击杀 -2 票 / 阵亡 -3 票', '占领据点持续扣票', '票数归零或时间结束定胜负'],
    accent: '#5ad2c8',
    objective: '占领并守住三个据点',
    duration: 480,
    icon: 'map',
  },
}

export const MODE_ORDER: GameModeId[] = ['classic', 'bomb', 'bio', 'challenge', 'delta']

export function getModeMeta(id: GameModeId): GameModeMeta {
  return GAME_MODES[id] ?? GAME_MODES.classic
}
