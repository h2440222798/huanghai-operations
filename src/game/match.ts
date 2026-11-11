import * as THREE from 'three'

import { BattleEffects, type PickupKind } from './world/arena/effects'
import { EnemyManager, type EnemyEntity, type EnemyFireRequest } from './world/arena/enemies'
import { createRandom, type Random } from './world/arena/math'
import type { EnemyKindId, HitPart } from './world/arena/types'
import type { CircleCollider, FpsBounds } from './world/three/controls'
import {
  CF_SLOT_ORDER,
  CfAudio,
  CfViewModel,
  cfAccuracy,
  cfApplyArmor,
  cfApplyRecoilToDirection,
  cfClamp,
  cfDamage,
  cfDamp,
  cfRecoilForShot,
  cfSpread,
  cfSpreadPx,
  degToRad,
  getCfWeapon,
  killStreakLabel,
  killStreakMultiplier,
  resolveCfLoadout,
  type CfLoadout,
  type CfSlot,
  type CfViewModelState,
  type CfWeaponSpec,
  type CfWeaponTag,
} from './world/cf'

import { ArenaField } from './arena'
import { AreaMarker, BlastWave, BombProp, type Owner } from './markers'
import { AllySquad } from './squad'
import { getModeMeta } from './meta'
import { getModBalance, type ModBalance } from './mods/balance'
import { emitModEvent } from './mods/bus'
import type { BombState, CaptureState, FeedKind, GameModeId, MatchHud, MatchPhase, MatchResult, WaveState } from './types'
import { CF_ENEMY_HP_SCALE, PICKUP_CHANCE, TOTAL_WAVES, enemyAlias, makeWavePlan, type WavePlan } from './waves'

/* ============================== 对外接口 ============================== */

export interface MatchCallbacks {
  onHud: (state: MatchHud) => void
  onFeed: (text: string, kind: FeedKind) => void
  onBanner: (text: string, sub?: string, tone?: 'info' | 'warn' | 'good') => void
  onDamage: () => void
  onEnd: (result: MatchResult) => void
  requestLock: () => void
}

export interface MatchOptions extends MatchCallbacks {
  mode: GameModeId
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  colliders: CircleCollider[]
  bounds: FpsBounds
  isGrounded: () => boolean
  playerSpeed: () => number
  /** 第一人称朝向（雷达旋转用） */
  getYaw: () => number
  applyRecoil: (pitchDelta: number, yawDelta: number) => void
  setAim: (fovScale: number, lookScale: number, moveScale: number) => void
  /** 把玩家瞬移到某个平面坐标（复活 / 换回合） */
  teleport: (x: number, z: number, yaw?: number) => void
  loadout?: Partial<CfLoadout> | null
}

interface WeaponState {
  spec: CfWeaponSpec
  mag: number
  reserve: number
}

interface DeltaPoint {
  id: string
  label: string
  position: THREE.Vector3
  marker: AreaMarker
  owner: Owner
  /** 0 = 红方满控，50 = 中立，100 = 蓝方满控 */
  control: number
  playerInside: boolean
  enemyInside: number
}

const CLASSIC_TARGET = 40
const CLASSIC_TIME = 360
const BOMB_ROUNDS = 5
const BOMB_WINS_NEEDED = 3
const BOMB_ROUND_TIME = 130
const BOMB_TIMER = 45
const BOMB_PLANT_TIME = 3.4
const BOMB_DEFUSE_TIME = 10
const BOMB_SITE_RADIUS = 9
const BIO_SURVIVE = 240
const DELTA_TIME = 480
const DELTA_TICKETS = 300
const CAPTURE_RADIUS = 16

const SPEED_COOLDOWN = 0.32

export class MatchEngine {
  readonly mode: GameModeId
  private options: MatchOptions
  private meta: ReturnType<typeof getModeMeta>
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private field: ArenaField
  private enemies: EnemyManager
  private effects: BattleEffects
  private viewmodel: CfViewModel
  private audio: CfAudio
  private rng: Random = createRandom(20261109)
  private disposed = false

  /** 开局时锁定的创意工坊数值系数：中途装的 Mod 下一局生效 */
  private balance: ModBalance = getModBalance()
  /** 上一次向 Mod 广播 hud 事件的引擎时间 */
  private lastModHudAt = -1

  private phase: MatchPhase = 'briefing'
  private clock = CLASSIC_TIME
  private elapsed = 0
  private hudTimer = 0
  private bannerTimer = 0

  private inventory: Record<CfSlot, WeaponState>
  private slot: CfSlot = 'primary'
  private lastSlot: CfSlot = 'primary'

  private triggerHeld = false
  private hasFiredThisTrigger = false
  private fireCooldown = 0
  private drawTimer = 0
  private reloading = false
  private reloadTimer = 0
  private reloadDuration = 1
  private burstIndex = 0
  private bloom = 0
  private lastShotAt = -10
  private hitMarker = 0
  private headshotMarker = 0
  private zoomed = false
  private zoomAmount = 0
  private spin = 0
  private lastSpinSent = -1
  private playerSpeedXZ = 0

  private player = { health: 100, armor: 100, dead: false, respawnTimer: 0 }
  /** 最后一次受伤时刻：脱战 8 秒后缓慢回血，避免长局被零星流弹磨死 */
  private lastHurtAt = -99
  private stats = { kills: 0, headshots: 0, deaths: 0, shots: 0, hits: 0, score: 0 }
  private streak = 0
  private streakTimer = 0
  private keys = new Set<string>()
  private raycaster = new THREE.Raycaster()
  private muzzleLight: THREE.PointLight

  /* 模式状态 */
  private classic = { ally: 0, enemy: 0, spawnTimer: 0 }
  private bomb = {
    round: 1,
    wins: 0,
    losses: 0,
    state: 'idle' as BombState['state'],
    site: null as 'A' | 'B' | null,
    timer: 0,
    plantProgress: 0,
    defuseProgress: 0,
    inSite: false,
  }
  private bombSites: { id: 'A' | 'B'; marker: AreaMarker; position: THREE.Vector3 }[] = []
  private bombProp: BombProp | null = null
  private blast: BlastWave | null = null
  /** 爆破回合之间的过场（用引擎时间驱动，避免 setTimeout 与暂停/快进打架） */
  private bombGate = { timer: 0, next: null as null | 'next' | 'finish' }
  private bio = { survived: 0, spawnTimer: 0, bossTimer: 50, bossIndex: 0 }
  private challenge = {
    wave: 0,
    plan: null as WavePlan | null,
    queue: [] as { kind: EnemyKindId; hpScale: number; speedScale: number; damageScale: number }[],
    spawnTimer: 0,
    intermission: 0,
  }
  private delta = {
    ally: DELTA_TICKETS,
    enemy: DELTA_TICKETS,
    spawnTimer: 0,
    bleedTimer: 1,
    points: [] as DeltaPoint[],
  }

  private squad: AllySquad | null = null
  private allyBase = new THREE.Vector3()
  private enemyBase = new THREE.Vector3()
  private center = new THREE.Vector3()
  /** 友军造成的击杀不记到玩家头上 */
  private allyDamage = new Set<number>()

  constructor(options: MatchOptions) {
    this.options = options
    this.mode = options.mode
    this.meta = getModeMeta(options.mode)
    this.renderer = options.renderer
    this.scene = options.scene
    this.camera = options.camera

    const b = options.bounds
    this.center.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2)

    this.field = new ArenaField(this.scene, options.colliders, options.bounds, this.camera.position)
    this.enemies = new EnemyManager(this.scene, this.field, {
      onFire: (request) => this.onEnemyFire(request),
      onMelee: (damage) => this.hurtPlayer(damage, '近战'),
      onKilled: (enemy, headshot) => this.onEnemyKilled(enemy, headshot),
    })
    this.effects = new BattleEffects(this.scene)
    this.audio = new CfAudio()
    this.viewmodel = new CfViewModel(this.renderer)
    // 电影级管线里枪模进了 HDR 场景，灯光压一档才不会比世界亮一截
    this.viewmodel.setLightScale(0.52)

    this.muzzleLight = new THREE.PointLight('#ffcf8a', 0, 22, 2)
    this.scene.add(this.muzzleLight)

    const loadout = resolveCfLoadout(options.loadout)
    const primary = getCfWeapon(loadout.primary, 'primary')
    const secondary = getCfWeapon(loadout.secondary, 'secondary')
    const melee = getCfWeapon(loadout.melee, 'melee')
    this.inventory = {
      primary: { spec: primary, mag: primary.magazine, reserve: primary.reserve },
      secondary: { spec: secondary, mag: secondary.magazine, reserve: secondary.reserve },
      melee: { spec: melee, mag: 0, reserve: 0 },
    }
    this.viewmodel.setWeapon(primary)
    this.viewmodel.startDraw()
    this.drawTimer = primary.drawTime
    this.fireCooldown = primary.drawTime

    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('mousemove', this.onMouseMove)
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown)
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu)
    document.addEventListener('mouseup', this.onMouseUp)
    document.addEventListener('wheel', this.onWheel, { passive: true })

    this.setupMode()

    if (import.meta.env.DEV) {
      ;(window as unknown as { __match?: MatchEngine }).__match = this
    }
  }

  /* ============================== 模式初始化 ============================== */

  private setupMode() {
    this.allyBase = this.field.findOpenArea(this.center.x, this.center.z + 92, 8)
    this.enemyBase = this.field.findOpenArea(this.center.x, this.center.z - 92, 8)

    switch (this.mode) {
      case 'classic': {
        this.clock = CLASSIC_TIME
        this.teleportPlayer(this.allyBase, this.yawTo(this.allyBase, this.center))
        this.squad = new AllySquad({
          scene: this.scene,
          listEnemies: () => this.enemies.list,
          damageEnemy: (id, amount) => this.allyDamageEnemy(id, amount),
          effects: this.effects,
        })
        this.squad.spawn(3, this.allyBase, 12)
        break
      }
      case 'bomb': {
        this.clock = BOMB_ROUND_TIME
        this.buildBombSites()
        this.bombProp = new BombProp(this.scene)
        this.blast = new BlastWave(this.scene)
        const bombSpawn = this.field.findOpenArea(this.center.x + 10, this.center.z + 74, 6)
        this.teleportPlayer(bombSpawn, this.yawTo(bombSpawn, this.center))
        break
      }
      case 'bio': {
        this.clock = BIO_SURVIVE
        const bioSpawn = this.field.findOpenArea(this.center.x, this.center.z + 20, 8)
        this.teleportPlayer(bioSpawn, this.yawTo(bioSpawn, this.center))
        break
      }
      case 'challenge': {
        this.clock = 0
        const challengeSpawn = this.field.findOpenArea(this.center.x, this.center.z + 20, 8)
        this.teleportPlayer(challengeSpawn, this.yawTo(challengeSpawn, this.center))
        break
      }
      case 'delta': {
        this.clock = DELTA_TIME
        this.buildDeltaPoints()
        this.delta.ally = DELTA_TICKETS
        this.delta.enemy = DELTA_TICKETS
        this.teleportPlayer(this.allyBase, this.yawTo(this.allyBase, this.center))
        this.squad = new AllySquad({
          scene: this.scene,
          listEnemies: () => this.enemies.list,
          damageEnemy: (id, amount) => this.allyDamageEnemy(id, amount),
          effects: this.effects,
        })
        this.squad.spawn(4, this.allyBase, 13)
        this.squad.setObjectives(this.delta.points.map((p) => p.position))
        break
      }
      default:
        break
    }
  }

  private buildBombSites() {
    const definitions: { id: 'A' | 'B'; x: number; z: number }[] = [
      { id: 'A', x: this.center.x - 78, z: this.center.z - 6 },
      { id: 'B', x: this.center.x + 78, z: this.center.z - 26 },
    ]
    this.bombSites = definitions.map((def) => {
      const position = this.field.findOpenArea(def.x, def.z, BOMB_SITE_RADIUS + 2)
      const marker = new AreaMarker(this.scene, {
        position,
        radius: BOMB_SITE_RADIUS,
        label: `${def.id} 爆破点`,
        sub: '',
        owner: 'neutral',
      })
      return { id: def.id, marker, position }
    })
  }

  private buildDeltaPoints() {
    const definitions: { id: string; x: number; z: number }[] = [
      { id: 'A', x: this.center.x - 96, z: this.center.z + 34 },
      { id: 'B', x: this.center.x + 4, z: this.center.z - 18 },
      { id: 'C', x: this.center.x + 96, z: this.center.z + 34 },
    ]
    this.delta.points = definitions.map((def) => {
      const position = this.field.findOpenArea(def.x, def.z, CAPTURE_RADIUS + 2)
      const marker = new AreaMarker(this.scene, {
        position,
        radius: CAPTURE_RADIUS,
        label: `${def.id} 据点`,
        sub: '',
        owner: 'neutral',
      })
      return {
        id: def.id,
        label: `${def.id} 据点`,
        position,
        marker,
        owner: 'neutral' as Owner,
        control: 50,
        playerInside: false,
        enemyInside: 0,
      }
    })
  }

  private teleportPlayer(position: THREE.Vector3, yaw?: number) {
    this.options.teleport(position.x, position.z, yaw)
  }

  /** 计算朝向某点的 yaw（第一人称前进方向为 -sin(yaw), -cos(yaw)） */
  private yawTo(from: THREE.Vector3, to: THREE.Vector3) {
    return Math.atan2(-(to.x - from.x), -(to.z - from.z))
  }

  /* ============================== 生命周期 ============================== */

  begin() {
    this.audio.unlock()
    this.audio.setPaused(false)
    if (this.phase === 'briefing') {
      this.feed(`${this.meta.name}开始 · ${this.meta.objective}`, 'objective')
      this.startMatch()
    } else if (this.phase === 'paused') {
      this.phase = 'combat'
      this.audio.setPaused(false)
      this.pushHud()
    } else {
      return
    }
    this.options.requestLock()
  }

  private startMatch() {
    switch (this.mode) {
      case 'classic':
        this.phase = 'combat'
        this.clock = CLASSIC_TIME
        this.banner('团队竞技开始', '先拿下 40 个击杀', 'info')
        break
      case 'bomb':
        this.startBombRound(1, true)
        break
      case 'bio':
        this.phase = 'combat'
        this.clock = BIO_SURVIVE
        this.bio = { survived: 0, spawnTimer: 0, bossTimer: 50, bossIndex: 0 }
        this.banner('感染爆发', '存活 4 分钟等待救援', 'warn')
        this.audio.waveStart(false)
        break
      case 'challenge':
        this.phase = 'combat'
        this.challenge.wave = 0
        this.nextWave()
        break
      case 'delta':
        this.phase = 'combat'
        this.clock = DELTA_TIME
        this.banner('三角洲行动 · 征服战', '占领 A / B / C 三点，耗尽红方票数', 'info')
        break
      default:
        break
    }
    emitModEvent('match:start', {
      mode: this.mode,
      modeName: this.meta.name,
      loadout: {
        primary: this.inventory.primary.spec.id,
        secondary: this.inventory.secondary.spec.id,
        melee: this.inventory.melee.spec.id,
      },
    })
    this.pushHud()
  }

  pause() {
    if (this.phase !== 'combat') return
    // 暂停必须释放指针锁，否则鼠标事件被画布吃掉、遮罩上的按钮点不动
    if (document.pointerLockElement) document.exitPointerLock()
    this.phase = 'paused'
    this.triggerHeld = false
    this.hasFiredThisTrigger = false
    this.zoomed = false
    this.spin = 0
    this.audio.setPaused(true)
    this.pushHud()
  }

  update(dt: number) {
    if (this.disposed) return
    this.elapsed += dt
    this.playerSpeedXZ = this.options.playerSpeed()

    if (this.phase === 'combat') {
      this.clock = Math.max(0, this.clock - dt)
      this.updateMode(dt)
      this.enemies.update(dt, this.elapsed, this.camera.position)
      this.collectPickups()
      this.squad?.update(dt, this.camera.position, this.field)
    } else if (this.phase === 'intermission') {
      // 只有挑战模式用 intermission 等下一波，其它模式的中场各自处理
      if (this.mode === 'challenge') {
        this.challenge.intermission = Math.max(0, this.challenge.intermission - dt)
        if (this.challenge.intermission <= 0) this.nextWave()
      } else if (this.mode === 'bomb' && this.bombGate.next) {
        this.bombGate.timer -= dt
        if (this.bombGate.timer <= 0) {
          const action = this.bombGate.next
          this.bombGate.next = null
          if (action === 'finish') {
            this.finish(
              this.bomb.wins > this.bomb.losses,
              `爆破回合 ${this.bomb.wins} : ${this.bomb.losses}`,
            )
          } else {
            this.startBombRound(this.bomb.round + 1)
          }
        }
      }
    }

    this.updateWeapon(dt)
    this.updateAim(dt)
    this.viewmodel.update(dt, this.viewModelState())
    this.effects.update(dt)
    this.blast?.update(dt)
    this.updateMarkers(dt)

    // 脱战回血（不动护甲）
    if (
      this.phase === 'combat' &&
      !this.player.dead &&
      this.player.health > 0 &&
      this.player.health < 100 &&
      this.elapsed - this.lastHurtAt > 8
    ) {
      this.player.health = Math.min(100, this.player.health + 3.5 * this.balance.playerRegen * dt)
    }

    if (this.hitMarker > 0) this.hitMarker = Math.max(0, this.hitMarker - dt)
    if (this.headshotMarker > 0) this.headshotMarker = Math.max(0, this.headshotMarker - dt)
    if (this.streakTimer > 0) {
      this.streakTimer = Math.max(0, this.streakTimer - dt)
      if (this.streakTimer <= 0) this.streak = 0
    }
    if (this.bannerTimer > 0) this.bannerTimer = Math.max(0, this.bannerTimer - dt)

    if (this.muzzleLight.intensity > 0.01) this.muzzleLight.intensity *= Math.exp(-dt * 16)
    else this.muzzleLight.intensity = 0

    // 复活倒计时
    if (this.player.dead && this.player.respawnTimer > 0) {
      this.player.respawnTimer = Math.max(0, this.player.respawnTimer - dt)
      if (this.player.respawnTimer <= 0) this.respawnPlayer()
    }

    this.hudTimer += dt
    if (this.hudTimer >= 0.05) {
      this.hudTimer = 0
      this.pushHud()
    }
  }

  /**
   * 枪模叠加层交给后期渲染器，画进同一张 HDR 场景。
   * 这样枪身的曝光、泛光、色调和世界完全一致，而不是一张贴纸。
   */
  get overlay(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null {
    if (this.disposed) return null
    const dom = this.renderer.domElement
    this.viewmodel.resize(dom.clientWidth, dom.clientHeight)
    return { scene: this.viewmodel.scene, camera: this.viewmodel.camera }
  }

  renderOverlay() {
    if (this.disposed) return
    const dom = this.renderer.domElement
    this.viewmodel.resize(dom.clientWidth, dom.clientHeight)
    this.renderer.setViewport(0, 0, dom.clientWidth, dom.clientHeight)
    const prev = this.renderer.autoClear
    this.renderer.autoClear = false
    this.renderer.clearDepth()
    this.renderer.render(this.viewmodel.scene, this.viewmodel.camera)
    this.renderer.autoClear = prev
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('mousemove', this.onMouseMove)
    this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown)
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu)
    document.removeEventListener('mouseup', this.onMouseUp)
    document.removeEventListener('wheel', this.onWheel)
    this.audio.dispose()
    this.viewmodel.dispose()
    this.enemies.dispose()
    this.effects.dispose()
    this.field.dispose()
    this.squad?.dispose()
    this.bombSites.forEach((site) => site.marker.dispose())
    this.delta.points.forEach((point) => point.marker.dispose())
    this.bombProp?.dispose()
    this.blast?.dispose()
    this.muzzleLight.removeFromParent()
    this.options.setAim(1, 1, 1)
    const debugWindow = window as unknown as { __match?: MatchEngine }
    if (debugWindow.__match === this) delete debugWindow.__match
  }

  get currentPhase() {
    return this.phase
  }

  get enemyManager() {
    return this.enemies
  }

  /** 调试 / 自动化：把玩家送到指定平面坐标 */
  teleportTo(x: number, z: number) {
    this.options.teleport(x, z)
  }

  /** 调试 / 自动化：模式目标点（爆破点 / 据点） */
  get objectivePoints(): { id: string; x: number; z: number; owner?: Owner; progress?: number }[] {
    if (this.mode === 'bomb') {
      return this.bombSites.map((site) => ({ id: site.id, x: site.position.x, z: site.position.z }))
    }
    if (this.mode === 'delta') {
      return this.delta.points.map((point) => ({
        id: point.id,
        x: point.position.x,
        z: point.position.z,
        owner: point.owner,
        progress: point.control,
      }))
    }
    return []
  }

  /** 调试 / 自动化：直接结算，用于验收面板 */
  debugFinish(victory: boolean) {
    this.finish(victory, '调试结算')
  }

  /** 调试 / 自动化：当前模式快照 */
  get debugState() {
    return {
      mode: this.mode,
      phase: this.phase,
      clock: Math.round(this.clock),
      enemies: this.enemies.aliveCount,
      health: Math.round(this.player.health),
      kills: this.stats.kills,
      ally: this.mode === 'delta' ? Math.round(this.delta.ally) : this.classic.ally,
      enemy: this.mode === 'delta' ? Math.round(this.delta.enemy) : this.classic.enemy,
      bomb: this.bomb.state,
      bombTimer: Math.round(this.bomb.timer),
      plant: Math.round(this.bomb.plantProgress * 100),
      wins: this.bomb.wins,
      losses: this.bomb.losses,
      round: this.bomb.round,
      wave: this.challenge.wave,
    }
  }

  /* ============================== 模式主循环 ============================== */

  private updateMode(dt: number) {
    switch (this.mode) {
      case 'classic':
        this.updateClassic(dt)
        break
      case 'bomb':
        this.updateBomb(dt)
        break
      case 'bio':
        this.updateBio(dt)
        break
      case 'challenge':
        this.updateChallenge(dt)
        break
      case 'delta':
        this.updateDelta(dt)
        break
      default:
        break
    }
  }

  /* ---------------- 经典模式 ---------------- */

  private updateClassic(dt: number) {
    this.classic.spawnTimer -= dt
    if (this.classic.spawnTimer <= 0 && this.enemies.aliveCount < 5) {
      this.classic.spawnTimer = 1.6
      const kinds: EnemyKindId[] = ['grunt', 'grunt', 'skirmisher', 'brute']
      const kind = kinds[Math.floor(this.rng.next() * kinds.length)] ?? 'grunt'
      this.spawnEnemy(kind, { hpScale: 0.85, speedScale: 1.02, damageScale: 0.9 })
    }
    if (this.classic.ally >= CLASSIC_TARGET) {
      this.finish(true, '蓝方率先拿下 40 个击杀')
    } else if (this.classic.enemy >= CLASSIC_TARGET) {
      this.finish(false, '潜伏者先拿到 40 分')
    } else if (this.clock <= 0) {
      this.finish(this.classic.ally >= this.classic.enemy, '时间结束，按比分判定')
    }
  }

  /* ---------------- 爆破模式 ---------------- */

  private startBombRound(round: number, first = false) {
    this.bomb.round = round
    this.bomb.state = 'idle'
    this.bomb.site = null
    this.bomb.timer = 0
    this.bomb.plantProgress = 0
    this.bomb.defuseProgress = 0
    this.bomb.inSite = false
    this.clock = BOMB_ROUND_TIME
    this.phase = 'combat'
    this.player.dead = false
    this.player.health = 100
    this.player.armor = 100
    this.player.respawnTimer = 0
    this.bombProp?.hide()
    this.bombGate = { timer: 0, next: null }
    this.bombSites.forEach((site) => site.marker.setLabel(`${site.id} 爆破点`, ''))
    this.enemies.clear()
    this.teleportPlayer(this.field.findOpenArea(this.center.x + 10, this.center.z + 74, 6), 0)
    this.banner(`第 ${round} 回合`, `A / B 点任选，安放 C4 后引爆`, 'info')
    this.feed(`第 ${round} 回合开始 · 2 分 10 秒`, 'objective')
    this.audio.waveStart(false)
    if (!first) this.pushHud()
  }

  private updateBomb(dt: number) {
    const playerPos = this.camera.position
    // 判断玩家是否在某个包点内
    let inSite: { id: 'A' | 'B'; position: THREE.Vector3 } | null = null
    for (const site of this.bombSites) {
      if (Math.hypot(playerPos.x - site.position.x, playerPos.z - site.position.z) <= BOMB_SITE_RADIUS) {
        inSite = { id: site.id, position: site.position }
        break
      }
    }
    this.bomb.inSite = inSite !== null && this.bomb.state === 'idle'

    if (this.bomb.state === 'idle') {
      if (inSite && this.keys.has('KeyE')) {
        this.bomb.site = inSite.id
        this.bomb.plantProgress += dt / BOMB_PLANT_TIME
        if (this.bomb.plantProgress >= 1) {
          this.plantBomb(inSite.position, inSite.id)
        }
      } else if (this.bomb.plantProgress > 0) {
        this.bomb.plantProgress = Math.max(0, this.bomb.plantProgress - dt * 0.6)
      }
      this.clock = Math.max(0, this.clock - dt)
      if (this.clock <= 0) {
        this.endBombRound(false, '回合时间耗尽，C4 未安放')
        return
      }
      // 守包敌人持续增援
      if (this.enemies.aliveCount < 4 && this.rng.next() < dt * 0.9) {
        this.spawnEnemy(this.rng.next() < 0.6 ? 'grunt' : 'skirmisher', { hpScale: 0.8, damageScale: 0.9 })
      }
    } else if (this.bomb.state === 'planted') {
      this.bomb.timer = Math.max(0, this.bomb.timer - dt)
      const bombPos = this.bombProp?.group.position ?? this.camera.position

      // 敌人拆弹：站在 C4 旁边持续 7 秒
      let defusing = false
      for (const enemy of this.enemies.list) {
        if (!enemy.alive) continue
        if (enemy.group.position.distanceTo(bombPos) < 3.2) {
          defusing = true
          break
        }
      }
      if (defusing) {
        this.bomb.defuseProgress += dt / BOMB_DEFUSE_TIME
        if (this.bomb.defuseProgress >= 1) {
          this.endBombRound(false, 'C4 被潜伏者拆除')
          return
        }
      } else {
        this.bomb.defuseProgress = Math.max(0, this.bomb.defuseProgress - dt * 0.8)
      }

      // 守卫方不断增援
      if (this.enemies.aliveCount < 6 && this.rng.next() < dt * 1.2) {
        this.spawnEnemy(this.rng.next() < 0.5 ? 'grunt' : 'brute', { hpScale: 0.9, damageScale: 0.95 })
      }

      if (this.bomb.timer <= 0) {
        this.detonate()
        return
      }
    } else if (this.bomb.state === 'exploded' || this.bomb.state === 'defused') {
      // 结算动画期间静默
    }
  }

  private plantBomb(position: THREE.Vector3, site: 'A' | 'B') {
    this.bomb.state = 'planted'
    this.bomb.timer = BOMB_TIMER
    this.bomb.plantProgress = 1
    this.bomb.defuseProgress = 0
    this.bombProp?.place(position)
    this.bombSites.forEach((s) => s.marker.setLabel(`${s.id} 爆破点`, s.id === site ? 'C4 已安放' : '已失守'))
    this.audio.pickup()
    this.banner('C4 已安放', `${site} 点 · 守住 45 秒`, 'warn')
    this.feed(`C4 已在 ${site} 点安放，守住 45 秒！`, 'objective')
    this.stats.score += 250
  }

  private detonate() {
    this.bomb.state = 'exploded'
    const position = this.bombProp?.group.position.clone() ?? this.camera.position.clone()
    this.blast?.fire(position)
    this.audio.victory()
    this.bombProp?.hide()
    this.endBombRound(true, 'C4 引爆成功')
  }

  private endBombRound(won: boolean, reason: string) {
    if (this.phase !== 'combat') return
    this.phase = 'intermission'
    if (won) this.bomb.wins += 1
    else this.bomb.losses += 1
    this.enemies.clear()
    this.bomb.state = won ? 'exploded' : 'defused'
    this.triggerHeld = false
    if (won) {
      this.stats.score += 500
      this.banner('回合胜利', reason, 'good')
      this.feed(`回合胜利 · ${reason}`, 'streak')
      this.audio.victory()
    } else {
      this.banner('回合失败', reason, 'warn')
      this.feed(`回合失败 · ${reason}`, 'warn')
      this.audio.defeat()
    }
    this.pushHud()

    const decided =
      this.bomb.wins >= BOMB_WINS_NEEDED || this.bomb.losses >= BOMB_WINS_NEEDED || this.bomb.round >= BOMB_ROUNDS
    this.bombGate = { timer: decided ? 1.4 : 2.6, next: decided ? 'finish' : 'next' }
  }

  /* ---------------- 生化模式 ---------------- */

  private updateBio(dt: number) {
    this.bio.survived += dt
    this.bio.spawnTimer -= dt
    const aliveTarget = Math.min(5 + Math.floor(this.bio.survived / 22), 12)
    if (this.bio.spawnTimer <= 0 && this.enemies.aliveCount < aliveTarget) {
      this.bio.spawnTimer = 1.5
      const roll = this.rng.next()
      const kind: EnemyKindId = roll < 0.5 ? 'brute' : roll < 0.82 ? 'skirmisher' : 'grunt'
      this.spawnEnemy(kind, { hpScale: 0.7, speedScale: 1.02, damageScale: 0.6 })
    }

    this.bio.bossTimer -= dt
    if (this.bio.bossTimer <= 0) {
      this.bio.bossTimer = 55
      this.bio.bossIndex += 1
      this.spawnEnemy('brute', { hpScale: 7, speedScale: 0.95, damageScale: 1.5 })
      this.banner('母体出现', `第 ${this.bio.bossIndex} 只强化感染体正在靠近`, 'warn')
      this.feed('检测到高能感染体信号——母体出现！', 'warn')
      this.audio.waveStart(true)
    }

    if (this.bio.survived >= BIO_SURVIVE) {
      this.finish(true, '撑到救援抵达')
    }
  }

  /* ---------------- 挑战模式 ---------------- */

  private nextWave() {
    this.challenge.wave += 1
    this.challenge.plan = makeWavePlan(this.challenge.wave, this.balance.waveCount)
    this.challenge.queue = []
    for (const group of this.challenge.plan.groups) {
      for (let i = 0; i < group.count; i += 1) {
        this.challenge.queue.push({
          kind: group.kind,
          hpScale: group.hpScale,
          speedScale: group.speedScale,
          damageScale: group.damageScale,
        })
      }
    }
    for (let i = this.challenge.queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng.next() * (i + 1))
      const tmp = this.challenge.queue[i]!
      this.challenge.queue[i] = this.challenge.queue[j]!
      this.challenge.queue[j] = tmp
    }
    this.challenge.spawnTimer = 0.4
    this.phase = 'combat'
    this.audio.waveStart(this.challenge.plan.isBossWave)
    this.banner(this.challenge.plan.label, `${this.challenge.plan.total} 只怪兽来袭`, this.challenge.plan.isBossWave ? 'warn' : 'info')
    this.feed(`${this.challenge.plan.label} · ${this.challenge.plan.total} 只怪兽来袭`, this.challenge.plan.isBossWave ? 'warn' : 'info')
    emitModEvent('wave:start', {
      wave: this.challenge.wave,
      total: TOTAL_WAVES,
      isBossWave: this.challenge.plan.isBossWave,
      label: this.challenge.plan.label,
      count: this.challenge.plan.total,
    })
    this.pushHud()
  }

  private updateChallenge(dt: number) {
    if (this.challenge.queue.length > 0) {
      this.challenge.spawnTimer -= dt
      if (this.challenge.spawnTimer <= 0) {
        this.challenge.spawnTimer = this.challenge.plan?.isBossWave ? 0.4 : 0.55
        const order = this.challenge.queue.shift()!
        this.spawnEnemy(order.kind, {
          hpScale: order.hpScale,
          speedScale: order.speedScale,
          damageScale: order.damageScale,
        })
      }
    } else if (this.enemies.remaining === 0) {
      if (this.challenge.wave >= TOTAL_WAVES) {
        this.finish(true, '清空 30 波，校园守住了')
        return
      }
      const bonus = 100 + this.challenge.wave * 25
      this.stats.score += bonus
      this.phase = 'intermission'
      this.challenge.intermission = 6
      this.banner(`第 ${this.challenge.wave} 波清除`, `奖励 ${bonus} 分 · 6 秒后下一波`, 'good')
      this.feed(`第 ${this.challenge.wave} 波清除！奖励 ${bonus} 分，下一波 6 秒后来袭`, 'pickup')
      this.pushHud()
    }
  }

  /* ---------------- 三角洲大战场 ---------------- */

  private updateDelta(dt: number) {
    const playerPos = this.camera.position

    for (const point of this.delta.points) {
      const playerInside = Math.hypot(playerPos.x - point.position.x, playerPos.z - point.position.z) <= CAPTURE_RADIUS
      let enemyInside = 0
      for (const enemy of this.enemies.list) {
        if (!enemy.alive) continue
        if (enemy.group.position.distanceTo(point.position) <= CAPTURE_RADIUS) enemyInside += 1
      }
      // 友军也在推进占领
      let allyInside = 0
      for (const member of this.squad?.list ?? []) {
        if (member.group.position.distanceTo(point.position) <= CAPTURE_RADIUS) allyInside += 1
      }
      point.playerInside = playerInside
      point.enemyInside = enemyInside

      const allyPressure = (playerInside ? 1 : 0) * 1.6 + allyInside * 0.3
      const enemyPressure = enemyInside * 0.9
      const delta = allyPressure - enemyPressure
      if (delta > 0) point.control = Math.min(100, point.control + dt * 9 * delta)
      else if (delta < 0) point.control = Math.max(0, point.control + dt * 7 * delta)

      const nextOwner: Owner = point.control >= 82 ? 'ally' : point.control <= 18 ? 'enemy' : 'neutral'
      if (nextOwner !== point.owner) {
        point.owner = nextOwner
        point.marker.setOwner(nextOwner)
        point.marker.setLabel(`${point.id} 据点`, '')
        if (nextOwner === 'ally') {
          this.feed(`已占领 ${point.id} 据点`, 'pickup')
          this.stats.score += 150
          this.audio.pickup()
        } else if (nextOwner === 'enemy') {
          this.feed(`${point.id} 据点被红方占领`, 'warn')
        }
      }
      point.marker.setProgress(point.control / 100)
    }

    // 票数消耗
    this.delta.bleedTimer -= dt
    if (this.delta.bleedTimer <= 0) {
      this.delta.bleedTimer = 1
      for (const point of this.delta.points) {
        if (point.owner === 'ally') this.delta.enemy = Math.max(0, this.delta.enemy - 1)
        else if (point.owner === 'enemy') this.delta.ally = Math.max(0, this.delta.ally - 1)
      }
    }

    // 红方从己方据点增援
    this.delta.spawnTimer -= dt
    if (this.delta.spawnTimer <= 0 && this.enemies.aliveCount < 7) {
      this.delta.spawnTimer = 1.8
      const spawnPoint = this.pickEnemySpawnPoint()
      const kind: EnemyKindId = this.rng.next() < 0.55 ? 'grunt' : this.rng.next() < 0.6 ? 'skirmisher' : 'brute'
      this.spawnEnemy(kind, { hpScale: 0.85, speedScale: 1, damageScale: 0.9, at: spawnPoint })
    }

    if (this.delta.enemy <= 0) {
      this.finish(true, '红方票数耗尽')
    } else if (this.delta.ally <= 0) {
      this.finish(false, '蓝方票数耗尽')
    } else if (this.clock <= 0) {
      this.finish(this.delta.ally >= this.delta.enemy, '时间结束，按剩余票数判定')
    }
  }

  private pickEnemySpawnPoint(): THREE.Vector3 {
    const owned = this.delta.points.filter((p) => p.owner === 'enemy')
    const neutral = this.delta.points.filter((p) => p.owner === 'neutral')
    const pool = owned.length > 0 ? owned : neutral.length > 0 ? neutral : this.delta.points
    const pick = pool[Math.floor(this.rng.next() * pool.length)] ?? this.delta.points[0]
    if (!pick) return this.enemyBase.clone()
    return this.field.spawnAround(this.rng, pick.position, 8, 22)
  }

  /* ============================== 敌人生成与战斗回调 ============================== */

  private spawnEnemy(
    kind: EnemyKindId,
    options: { hpScale?: number; speedScale?: number; damageScale?: number; at?: THREE.Vector3 } = {},
  ) {
    const enemy = this.enemies.spawn(
      kind,
      (options.hpScale ?? 1) * CF_ENEMY_HP_SCALE * this.balance.enemyHealth,
      (options.speedScale ?? 1) * this.balance.enemySpeed,
      (options.damageScale ?? 1) * this.balance.enemyDamage,
    )
    if (options.at) {
      enemy.group.position.copy(options.at)
    }
    return enemy
  }

  private allyDamageEnemy(id: number, amount: number) {
    this.allyDamage.add(id)
    this.enemies.damage(id, amount * this.balance.allyDamage, 'body')
  }

  private onEnemyKilled(enemy: EnemyEntity, headshot: boolean) {
    const byAlly = this.allyDamage.has(enemy.id)
    this.allyDamage.delete(enemy.id)

    if (byAlly) {
      this.stats.score += Math.round(enemy.spec.score * 0.4)
      this.feed(`友军击杀 ${enemyAlias(this.mode, enemy.spec.id)}`, 'info')
      if (this.mode === 'classic') this.classic.ally += 1
      if (this.mode === 'delta') this.delta.enemy = Math.max(0, this.delta.enemy - 2)
      emitModEvent('enemy:killed', {
        mode: this.mode,
        kind: enemy.spec.id,
        name: enemyAlias(this.mode, enemy.spec.id),
        headshot: false,
        byAlly: true,
        streak: 0,
      })
      return
    }

    this.stats.kills += 1
    if (headshot) this.stats.headshots += 1

    this.streak += 1
    this.streakTimer = 3
    const label = killStreakLabel(this.streak)
    const waveBonus = this.mode === 'challenge' ? this.challenge.wave * 5 : 0
    const gain = Math.round(enemy.spec.score * (headshot ? 1.5 : 1) * killStreakMultiplier(this.streak) + waveBonus)
    this.stats.score += gain

    if (this.mode === 'classic') this.classic.ally += 1
    if (this.mode === 'delta') this.delta.enemy = Math.max(0, this.delta.enemy - 2)

    this.audio.kill()
    if (label) {
      this.audio.streak(this.streak)
      this.feed(`${label}！ 连杀 ×${this.streak}`, 'streak')
    }
    const alias = enemyAlias(this.mode, enemy.spec.id)
    this.feed(`[${this.activeSpec.name}] ${headshot ? '爆头击杀' : '击杀'} ${alias}${headshot ? ' 💥' : ''}`, headshot ? 'headshot' : 'kill')
    this.effects.killBurst(enemy.group.position.clone().setY(1.1), '#ff7a4d')
    emitModEvent('enemy:killed', {
      mode: this.mode,
      kind: enemy.spec.id,
      name: alias,
      headshot,
      byAlly: false,
      streak: this.streak,
    })

    const roll = this.rng.next()
    const pickupScale = this.balance.pickupChance
    let kind: PickupKind | null = null
    if (roll < PICKUP_CHANCE.health * pickupScale) kind = 'health'
    else if (roll < (PICKUP_CHANCE.health + PICKUP_CHANCE.armor) * pickupScale) kind = 'armor'
    else if (roll < (PICKUP_CHANCE.health + PICKUP_CHANCE.armor + PICKUP_CHANCE.ammo) * pickupScale) kind = 'ammo'
    if (kind) this.effects.spawnPickup(enemy.group.position.clone(), kind, '#4da3ff')
  }

  private onEnemyFire(request: EnemyFireRequest) {
    if (this.phase !== 'combat') return
    const from = request.origin.clone()
    const to = this.camera.position.clone()
    const distance = from.distanceTo(to)
    this.effects.tracer(from, to, '#ff9a5c', 0.09)
    this.audio.enemyShot(distance < 16)
    const dodge = cfClamp(this.playerSpeedXZ / 26, 0, 1) * 0.45
    const chance = cfClamp(0.6 - distance * 0.006 - dodge, 0.1, 0.68)
    if (this.rng.next() < chance) {
      this.hurtPlayer(request.spec.damage, '远程')
    } else {
      this.effects.impact(to.clone().add(new THREE.Vector3(0, -0.3, 0)), new THREE.Vector3(0, 1, 0), '#ffd27a', false)
    }
  }

  private hurtPlayer(rawDamage: number, source: string) {
    if (this.phase !== 'combat' || this.player.dead) return
    this.hurtPlayerRaw(rawDamage * this.balance.enemyDamage, source)
  }

  private hurtPlayerRaw(rawDamage: number, source: string) {
    this.lastHurtAt = this.elapsed
    const result = cfApplyArmor(rawDamage, this.player.health, this.player.armor, 0.7)
    this.player.health = result.health
    this.player.armor = result.armor
    this.audio.hurt()
    this.options.onDamage()
    emitModEvent('player:damaged', {
      amount: Math.round(rawDamage),
      source,
      health: Math.round(this.player.health),
      armor: Math.round(this.player.armor),
    })
    if (source === '近战' && this.rng.next() < 0.3) this.feed(`感染体撕咬 -${Math.round(rawDamage)}`, 'warn')
    if (this.player.health <= 0) {
      this.player.health = 0
      this.onPlayerDeath()
    }
  }

  private onPlayerDeath() {
    this.player.dead = true
    this.stats.deaths += 1
    this.triggerHeld = false
    this.hasFiredThisTrigger = false
    this.zoomed = false
    this.audio.defeat()

    switch (this.mode) {
      case 'classic':
        this.classic.enemy += 1
        this.player.respawnTimer = 3
        this.banner('你被击杀', '3 秒后复活', 'warn')
        this.feed(`你被击杀 · 潜伏者 +1 分`, 'warn')
        break
      case 'delta':
        this.delta.ally = Math.max(0, this.delta.ally - 3)
        this.player.respawnTimer = 4
        this.banner('你被击杀', '蓝方 -3 票 · 4 秒后复活', 'warn')
        this.feed('你被击杀 · 蓝方 -3 票', 'warn')
        break
      case 'bomb':
        this.bomb.state = 'idle'
        this.endBombRound(false, '你在回合中阵亡')
        break
      case 'bio':
        this.banner('已被感染', '救援没能赶上', 'warn')
        this.finish(false, '被感染体撕碎')
        break
      case 'challenge':
        this.banner('守卫失败', '你倒在了第 ' + this.challenge.wave + ' 波', 'warn')
        this.finish(false, `坚守到第 ${this.challenge.wave} 波`)
        break
      default:
        break
    }
  }

  private respawnPlayer() {
    this.player.dead = false
    this.player.health = 100
    this.player.armor = 100
    const base = this.mode === 'delta' ? this.pickAllySpawnPoint() : this.allyBase
    const angle = this.rng.next() * Math.PI * 2
    const spot = this.field.findOpenArea(base.x + Math.cos(angle) * 6, base.z + Math.sin(angle) * 6, 2)
    this.teleportPlayer(spot, this.yawTo(spot, this.center))
    this.audio.pickup()
  }

  private pickAllySpawnPoint(): THREE.Vector3 {
    const owned = this.delta.points.filter((p) => p.owner === 'ally')
    if (owned.length === 0) return this.allyBase
    const pick = owned[Math.floor(this.rng.next() * owned.length)]
    return pick ? pick.position.clone() : this.allyBase
  }

  private collectPickups() {
    const picked = this.effects.collectPickups(this.camera.position)
    for (const kind of picked) {
      this.audio.pickup()
      if (kind === 'health') {
        this.player.health = Math.min(100, this.player.health + 25)
        this.feed('拾取医疗包 +25 HP', 'pickup')
      } else if (kind === 'armor') {
        this.player.armor = Math.min(100, this.player.armor + 30)
        this.feed('拾取护甲 +30', 'pickup')
      } else {
        for (const state of [this.inventory.primary, this.inventory.secondary]) {
          if (state) state.reserve = Math.min(state.spec.reserve * 2, state.reserve + Math.ceil(state.spec.magazine * 1.5))
        }
        this.feed('拾取弹药箱', 'pickup')
      }
    }
  }

  private updateMarkers(dt: number) {
    const eye = this.camera.position
    if (this.mode === 'bomb') {
      for (const site of this.bombSites) {
        site.marker.update(dt, this.elapsed)
        site.marker.setLabelVisible(Math.hypot(eye.x - site.position.x, eye.z - site.position.z) > 16)
      }
      this.bombProp?.update(this.elapsed, this.phase === 'combat')
    }
    if (this.mode === 'delta') {
      for (const point of this.delta.points) {
        point.marker.update(dt, this.elapsed)
        point.marker.setLabelVisible(Math.hypot(eye.x - point.position.x, eye.z - point.position.z) > 22)
      }
    }
  }

  /* ============================== 武器 ============================== */

  private get activeState(): WeaponState {
    return this.inventory[this.slot] ?? this.inventory.primary
  }

  private get activeSpec(): CfWeaponSpec {
    return this.activeState.spec
  }

  private viewModelState(): CfViewModelState {
    return {
      moving: this.playerSpeedXZ > 1.5,
      speed: this.playerSpeedXZ,
      grounded: this.options.isGrounded(),
      reloading: this.reloading,
      zoomed: this.zoomAmount > 0.5,
      spin: this.activeSpec.spinUp ? this.spin : 0,
    }
  }

  private updateWeapon(dt: number) {
    const spec = this.activeSpec
    const state = this.activeState

    this.fireCooldown = Math.max(0, this.fireCooldown - dt)
    this.drawTimer = Math.max(0, this.drawTimer - dt)

    if (this.reloading) {
      this.reloadTimer -= dt
      if (this.reloadTimer <= 0) {
        this.reloading = false
        const need = spec.magazine - state.mag
        const take = Math.min(need, state.reserve)
        state.mag += take
        state.reserve -= take
      }
    }

    const sinceShot = this.elapsed - this.lastShotAt
    if (sinceShot > SPEED_COOLDOWN) this.burstIndex = 0
    if (sinceShot > 0.1) this.bloom = Math.max(0, this.bloom - spec.bloomRecovery * dt)

    if (spec.spinUp) {
      const want = this.triggerHeld && this.phase === 'combat'
      this.spin = cfDamp(this.spin, want ? 1 : 0, want ? 3.6 : 2.4, dt)
    } else {
      this.spin = cfDamp(this.spin, 0, 6, dt)
    }
    if (Math.abs(this.spin - this.lastSpinSent) > 0.03 || (this.spin < 0.01 && this.lastSpinSent > 0.01)) {
      this.audio.setSpin(this.slot === 'primary' ? this.spin : 0)
      this.lastSpinSent = this.spin
    }

    const canFire = this.phase === 'combat' && !this.reloading && this.drawTimer <= 0 && !this.player.dead
    const spinningUp = spec.spinUp !== undefined && this.spin < 0.9
    if (this.triggerHeld && canFire && !spinningUp) {
      const isMelee = this.slot === 'melee'
      const interval = 60 / spec.rpm
      const canStart = isMelee || spec.automatic || !this.hasFiredThisTrigger
      if (this.fireCooldown <= 0 && canStart) {
        this.fireWeapon()
        this.fireCooldown = interval
        this.hasFiredThisTrigger = true
      }
    }
  }

  private updateAim(dt: number) {
    const spec = this.activeSpec
    const canZoom = spec.zoomFov !== undefined && this.slot !== 'melee'
    const target = this.zoomed && canZoom && !this.reloading ? 1 : 0
    this.zoomAmount = cfDamp(this.zoomAmount, target, target > this.zoomAmount ? 18 : 12, dt)
    if (this.zoomAmount < 0.001) this.zoomAmount = 0
    const zoomFov = spec.zoomFov ?? 1
    const fovScale = 1 + (zoomFov - 1) * this.zoomAmount
    const lookScale = 1 - 0.5 * this.zoomAmount
    const moveScale = 1 - (1 - (spec.zoomMove ?? 1)) * this.zoomAmount
    this.options.setAim(fovScale, lookScale, moveScale)
  }

  private fireWeapon() {
    const state = this.activeState
    const spec = state.spec

    if (spec.slot === 'melee') {
      this.audio.melee(spec)
      this.viewmodel.melee()
      this.stats.shots += 1
      this.meleeAttack()
      this.lastShotAt = this.elapsed
      this.hasFiredThisTrigger = true
      return
    }

    if (state.mag <= 0) {
      this.audio.dryFire()
      this.triggerHeld = false
      this.hasFiredThisTrigger = true
      if (state.reserve > 0) this.startReload()
      else this.feed('弹药耗尽 · 切换副武器或拾取弹药箱', 'warn')
      return
    }

    state.mag -= 1
    this.stats.shots += 1
    this.lastShotAt = this.elapsed

    this.audio.shot(spec)
    this.viewmodel.fire()

    const raw = cfRecoilForShot(spec, this.burstIndex, this.zoomAmount > 0.5)
    const kick = {
      pitch: raw.pitch * (0.94 + this.rng.next() * 0.12),
      yaw: raw.yaw + (this.rng.next() - 0.5) * degToRad(0.12),
    }

    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
    const kicked = cfApplyRecoilToDirection(dir, right, up, kick)

    const spread = cfSpread(spec, {
      moving: this.playerSpeedXZ > 1.5,
      airborne: !this.options.isGrounded(),
      shotsFired: this.burstIndex,
      zoomed: this.zoomAmount > 0.5,
      bloom: this.bloom,
    })
    const spreadRad = degToRad(spread)
    const angle = this.rng.next() * Math.PI * 2
    const radius = Math.sqrt(this.rng.next()) * spreadRad
    const finalDir = new THREE.Vector3(kicked.x, kicked.y, kicked.z)
      .addScaledVector(right, Math.cos(angle) * radius)
      .addScaledVector(up, Math.sin(angle) * radius)
      .normalize()

    this.options.applyRecoil(kick.pitch, kick.yaw)

    this.burstIndex += 1
    this.bloom = Math.min(spec.bloomMax, this.bloom + spec.bloom)

    const origin = this.camera.position.clone()
    const muzzle = origin.clone()
      .addScaledVector(finalDir, 0.55)
      .addScaledVector(right, 0.16)
      .add(new THREE.Vector3(0, -0.12, 0))
    const tracerColor = spec.model.skin === 'flame' ? '#ff8a3c' : spec.model.skin === 'thunder' ? '#7fd4ff' : '#ffe6a8'

    this.raycaster.set(origin, finalDir)
    this.raycaster.far = 300
    const targets: THREE.Object3D[] = [...this.enemies.hitMeshes, ...this.field.blockers]
    const hits = this.raycaster.intersectObjects(targets, false)

    let end = origin.clone().addScaledVector(finalDir, 220)
    if (hits[0]) {
      const hit = hits[0]
      end = hit.point.clone()
      const normal = hit.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0)
      const enemyId = (hit.object.userData as { enemyId?: number }).enemyId
      if (enemyId !== undefined) {
        const part = ((hit.object.userData as { part?: HitPart }).part ?? 'body') as HitPart
        const damage = cfDamage(spec, part, hit.distance)
        const result = this.enemies.damage(enemyId, damage, part)
        this.stats.hits += 1
        this.hitMarker = 0.22
        if (part === 'head') {
          this.headshotMarker = 0.4
          this.stats.score += 15
        }
        this.audio.hit(part === 'head')
        this.effects.impact(end, normal, '#ff5a3c', false)
        if (result.killed) this.hitMarker = 0.3
      } else {
        this.effects.impact(end, normal, '#cfd8e3', false)
      }
    }

    this.effects.tracer(muzzle, end, tracerColor, 0.045)
    this.muzzleLight.position.copy(muzzle)
    this.muzzleLight.intensity = spec.tag === 'sniper' ? 9 : 4.5

    if (state.mag <= 0) this.startReload()
    this.pushHud()
  }

  private meleeAttack() {
    const spec = this.activeSpec
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    this.raycaster.set(this.camera.position, dir)
    this.raycaster.far = spec.falloffStart + 0.6
    const hits = this.raycaster.intersectObjects(this.enemies.hitMeshes, false)
    const hit = hits[0] as THREE.Intersection | undefined
    if (hit) {
      const enemyId = (hit.object.userData as { enemyId?: number }).enemyId
      if (enemyId !== undefined) {
        const part = ((hit.object.userData as { part?: HitPart }).part ?? 'body') as HitPart
        const damage = cfDamage(spec, part, hit.distance)
        const result = this.enemies.damage(enemyId, damage, part)
        this.stats.hits += 1
        this.hitMarker = 0.26
        if (part === 'head') this.headshotMarker = 0.4
        this.audio.hit(part === 'head')
        this.effects.impact(hit.point.clone(), new THREE.Vector3(0, 1, 0), '#ffd27a', false)
        if (result.killed) this.effects.killBurst(hit.point.clone(), '#ff7a4d')
        return
      }
    }
    const nearest = this.enemies.nearestEnemy(this.camera.position, spec.falloffStart + 0.6)
    if (!nearest) return
    const forward = dir.clone().setY(0).normalize()
    const toEnemy = nearest.enemy.group.position.clone().sub(this.camera.position).setY(0).normalize()
    if (forward.dot(toEnemy) <= 0.5) return
    this.enemies.damage(nearest.enemy.id, cfDamage(spec, 'body', nearest.distance), 'body')
    this.stats.hits += 1
    this.hitMarker = 0.22
    this.audio.hit(false)
  }

  private startReload() {
    const state = this.activeState
    const spec = state.spec
    if (spec.slot === 'melee' || this.reloading || this.drawTimer > 0) return
    if (state.mag >= spec.magazine || state.reserve <= 0) return
    this.reloading = true
    this.zoomed = false
    this.reloadDuration = spec.reloadTime + (state.mag === 0 ? 0.18 : 0)
    this.reloadTimer = this.reloadDuration
    this.viewmodel.startReload(this.reloadDuration)
    this.audio.reload(spec)
  }

  private switchSlot(slot: CfSlot) {
    if (slot === this.slot || !this.inventory[slot]) return
    const next = this.inventory[slot]
    this.lastSlot = this.slot
    this.slot = slot
    this.reloading = false
    this.viewmodel.cancelReload()
    this.viewmodel.setWeapon(next.spec)
    this.viewmodel.startDraw()
    this.zoomed = false
    this.zoomAmount = 0
    this.burstIndex = 0
    this.bloom = 0
    this.triggerHeld = false
    this.hasFiredThisTrigger = true
    this.drawTimer = next.spec.drawTime
    this.fireCooldown = next.spec.drawTime
    this.audio.switchWeapon()
    this.pushHud()
  }

  private toggleZoom() {
    const spec = this.activeSpec
    if (spec.zoomFov === undefined || this.reloading || this.drawTimer > 0) return
    this.zoomed = !this.zoomed
  }

  /* ============================== 输入 ============================== */

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.phase !== 'combat') return
    if (e.code === 'Digit1') this.switchSlot('primary')
    else if (e.code === 'Digit2') this.switchSlot('secondary')
    else if (e.code === 'Digit3') this.switchSlot('melee')
    else if (e.code === 'KeyQ') this.switchSlot(this.lastSlot)
    else if (e.code === 'KeyR') this.startReload()
    else this.keys.add(e.code)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.renderer.domElement) return
    if (this.phase !== 'combat') return
    this.viewmodel.setSway(cfClamp(e.movementX * 0.04, -1, 1), cfClamp(e.movementY * 0.04, -1, 1))
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.phase !== 'combat' || this.player.dead) return
    if (document.pointerLockElement !== this.renderer.domElement) return
    if (e.button === 0) {
      this.triggerHeld = true
      this.hasFiredThisTrigger = false
    } else if (e.button === 2) {
      this.toggleZoom()
    }
  }

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.triggerHeld = false
      this.hasFiredThisTrigger = true
    }
  }

  private onContextMenu = (e: Event) => {
    e.preventDefault()
  }

  private onWheel = (e: WheelEvent) => {
    if (this.phase !== 'combat') return
    if (document.pointerLockElement !== this.renderer.domElement) return
    const index = CF_SLOT_ORDER.indexOf(this.slot)
    const next = e.deltaY > 0
      ? CF_SLOT_ORDER[(index + 1) % CF_SLOT_ORDER.length]!
      : CF_SLOT_ORDER[(index + CF_SLOT_ORDER.length - 1) % CF_SLOT_ORDER.length]!
    this.switchSlot(next)
  }

  /* ============================== 结算与 HUD ============================== */

  private finish(victory: boolean, detail: string) {
    if (this.phase === 'victory' || this.phase === 'defeat') return
    this.phase = victory ? 'victory' : 'defeat'
    this.triggerHeld = false
    this.hasFiredThisTrigger = false
    this.zoomed = false
    this.spin = 0
    this.audio.setSpin(0)
    this.audio.setPaused(false)
    if (victory) this.audio.victory()
    else this.audio.defeat()
    if (document.pointerLockElement) document.exitPointerLock()

    const lines: { label: string; value: string }[] = []
    if (this.mode === 'classic') {
      lines.push({ label: '团队比分', value: `蓝 ${this.classic.ally} : 红 ${this.classic.enemy}` })
    } else if (this.mode === 'bomb') {
      lines.push({ label: '爆破回合', value: `${this.bomb.wins} : ${this.bomb.losses}` })
    } else if (this.mode === 'bio') {
      lines.push({ label: '存活时长', value: `${Math.floor(this.bio.survived)} 秒` })
    } else if (this.mode === 'challenge') {
      lines.push({ label: '坚守波次', value: `${this.challenge.wave} / ${TOTAL_WAVES}` })
    } else if (this.mode === 'delta') {
      lines.push({ label: '最终票数', value: `蓝 ${Math.ceil(this.delta.ally)} : 红 ${Math.ceil(this.delta.enemy)}` })
    }

    const summary: MatchResult = {
      mode: this.mode,
      victory,
      score: this.stats.score,
      kills: this.stats.kills,
      headshots: this.stats.headshots,
      deaths: this.stats.deaths,
      accuracy: cfAccuracy(this.stats.hits, this.stats.shots),
      time: Math.round(this.elapsed),
      detail,
      lines,
    }
    emitModEvent('match:end', summary)
    this.options.onEnd(summary)
    this.pushHud()
  }

  private feed(text: string, kind: FeedKind) {
    this.options.onFeed(text, kind)
  }

  private banner(text: string, sub?: string, tone: 'info' | 'warn' | 'good' = 'info') {
    this.bannerTimer = 2
    this.options.onBanner(text, sub, tone)
  }

  private pushHud() {
    const state = this.activeState
    const spec = state.spec
    const zoomedNow = this.zoomAmount > 0.5 && spec.zoomFov !== undefined
    const spread = cfSpread(spec, {
      moving: this.playerSpeedXZ > 1.5,
      airborne: !this.options.isGrounded(),
      shotsFired: this.burstIndex,
      zoomed: zoomedNow,
      bloom: this.bloom,
    })
    const spreadPx = cfSpreadPx(spread, this.camera.fov, this.renderer.domElement.clientHeight || 720)
    const streakActive = this.streakTimer > 0 && this.streak >= 2

    const hud: MatchHud = {
      mode: this.mode,
      modeName: this.meta.name,
      phase: this.phase,
      health: Math.ceil(this.player.health),
      armor: Math.ceil(this.player.armor),
      dead: this.player.dead,
      respawnIn: this.player.respawnTimer,
      weaponName: spec.name,
      weaponCn: spec.cn,
      weaponTag: spec.tag as CfWeaponTag,
      slot: this.slot,
      ammo: state.mag,
      reserve: state.reserve,
      magazineSize: spec.magazine,
      reloading: this.reloading,
      reloadProgress: this.reloading ? 1 - this.reloadTimer / Math.max(this.reloadDuration, 0.01) : 1,
      switching: this.drawTimer > 0,
      zoomed: zoomedNow,
      canZoom: spec.zoomFov !== undefined && spec.slot !== 'melee',
      lowAmmo: spec.slot !== 'melee' && state.mag <= Math.max(1, Math.ceil(spec.magazine * 0.25)),
      spin: this.spin,
      spreadPx,
      kills: this.stats.kills,
      headshots: this.stats.headshots,
      deaths: this.stats.deaths,
      score: this.stats.score,
      accuracy: cfAccuracy(this.stats.hits, this.stats.shots),
      elapsed: Math.round(this.elapsed),
      remaining: Math.max(0, this.clock),
      hitMarker: this.hitMarker,
      headshotMarker: this.headshotMarker,
      streak: streakActive ? this.streak : 0,
      streakLabel: streakActive ? killStreakLabel(this.streak) : '',
      streakRemaining: streakActive ? this.streakTimer / 3 : 0,
      objectiveTitle: this.meta.objective,
      objectiveDetail: '',
      objectiveProgress: null,
      allyLabel: '蓝方',
      enemyLabel: '红方',
      allyScore: 0,
      enemyScore: 0,
      allyTarget: CLASSIC_TARGET,
      radar: this.buildRadar(),
      playerX: this.camera.position.x,
      playerZ: this.camera.position.z,
      playerYaw: this.options.getYaw(),
    }

    this.fillModeHud(hud)
    this.options.onHud(hud)
    // Mod 的 hud 事件限制在 5Hz，避免每帧把所有订阅者都唤醒
    if (this.elapsed - this.lastModHudAt >= 0.2) {
      this.lastModHudAt = this.elapsed
      emitModEvent('hud', hud)
    }
  }

  private buildRadar(): MatchHud['radar'] {
    const blips: MatchHud['radar'] = []
    for (const enemy of this.enemies.list) {
      if (!enemy.alive) continue
      blips.push({ x: enemy.group.position.x, z: enemy.group.position.z, kind: 'enemy' })
    }
    for (const member of this.squad?.list ?? []) {
      blips.push({ x: member.group.position.x, z: member.group.position.z, kind: 'ally' })
    }
    if (this.mode === 'bomb') {
      for (const site of this.bombSites) {
        blips.push({ x: site.position.x, z: site.position.z, kind: 'objective' })
      }
      if (this.bomb.state === 'planted' && this.bombProp) {
        blips.push({ x: this.bombProp.group.position.x, z: this.bombProp.group.position.z, kind: 'bomb' })
      }
    }
    if (this.mode === 'delta') {
      for (const point of this.delta.points) {
        blips.push({ x: point.position.x, z: point.position.z, kind: 'objective' })
      }
    }
    return blips
  }

  private fillModeHud(hud: MatchHud) {
    switch (this.mode) {
      case 'classic': {
        hud.allyLabel = '蓝方'
        hud.enemyLabel = '潜伏者'
        hud.allyScore = this.classic.ally
        hud.enemyScore = this.classic.enemy
        hud.allyTarget = CLASSIC_TARGET
        hud.objectiveTitle = '团队竞技 · 先到 40 击杀'
        hud.objectiveDetail = `蓝方 ${this.classic.ally} / ${CLASSIC_TARGET} · 潜伏者 ${this.classic.enemy} / ${CLASSIC_TARGET}`
        hud.objectiveProgress = this.classic.ally / CLASSIC_TARGET
        break
      }
      case 'bomb': {
        hud.allyLabel = '回合胜'
        hud.enemyLabel = '回合负'
        hud.allyScore = this.bomb.wins
        hud.enemyScore = this.bomb.losses
        hud.allyTarget = BOMB_WINS_NEEDED
        const bombState: BombState = {
          state: this.bomb.state,
          site: this.bomb.site,
          timer: this.bomb.timer,
          plantProgress: this.bomb.plantProgress,
          defuseProgress: this.bomb.defuseProgress,
          inSite: this.bomb.inSite,
        }
        hud.bomb = bombState
        hud.objectiveTitle = `第 ${this.bomb.round} / ${BOMB_ROUNDS} 回合 · 爆破`
        if (this.bomb.state === 'planted') {
          hud.objectiveDetail = `${this.bomb.site} 点 C4 倒计时 ${Math.ceil(this.bomb.timer)} 秒`
          hud.objectiveProgress = 1 - this.bomb.timer / BOMB_TIMER
        } else if (this.bomb.plantProgress > 0) {
          hud.objectiveDetail = `正在安放 C4 · ${Math.round(this.bomb.plantProgress * 100)}%`
          hud.objectiveProgress = this.bomb.plantProgress
        } else {
          hud.objectiveDetail = this.bomb.inSite ? '按住 E 安放 C4' : '前往 A / B 爆破点'
          hud.objectiveProgress = null
        }
        break
      }
      case 'bio': {
        hud.allyLabel = '已存活'
        hud.enemyLabel = '击杀'
        hud.allyScore = Math.floor(this.bio.survived)
        hud.enemyScore = this.stats.kills
        hud.allyTarget = BIO_SURVIVE
        hud.objectiveTitle = '生存 · 等待救援'
        hud.objectiveDetail = `已存活 ${Math.floor(this.bio.survived)} / ${BIO_SURVIVE} 秒`
        hud.objectiveProgress = this.bio.survived / BIO_SURVIVE
        hud.survival = { survived: this.bio.survived, target: BIO_SURVIVE }
        break
      }
      case 'challenge': {
        const plan = this.challenge.plan
        const waveState: WaveState = {
          wave: Math.max(1, this.challenge.wave),
          totalWaves: TOTAL_WAVES,
          label: plan?.label ?? '准备',
          enemiesLeft: this.enemies.aliveCount,
          enemiesTotal: plan?.total ?? 0,
          intermission: this.challenge.intermission,
        }
        hud.wave = waveState
        hud.allyLabel = '波次'
        hud.enemyLabel = '击杀'
        hud.allyScore = this.challenge.wave
        hud.enemyScore = this.stats.kills
        hud.allyTarget = TOTAL_WAVES
        hud.objectiveTitle = `守卫挑战 · 第 ${waveState.wave} / ${TOTAL_WAVES} 波`
        hud.objectiveDetail = this.phase === 'intermission'
          ? `下一波 ${Math.ceil(this.challenge.intermission)} 秒后来袭`
          : `${plan?.label ?? ''} · 场上剩余 ${this.enemies.remaining} 只`
        hud.objectiveProgress = this.challenge.wave / TOTAL_WAVES
        break
      }
      case 'delta': {
        const captures: CaptureState[] = this.delta.points.map((p) => ({
          id: p.id,
          label: p.label,
          owner: p.owner,
          progress: p.control,
          playerInside: p.playerInside,
        }))
        hud.captures = captures
        hud.allyLabel = '蓝方'
        hud.enemyLabel = '红方'
        hud.allyScore = Math.ceil(this.delta.ally)
        hud.enemyScore = Math.ceil(this.delta.enemy)
        hud.allyTarget = DELTA_TICKETS
        const owned = captures.filter((c) => c.owner === 'ally').length
        hud.objectiveTitle = `征服战 · 控制据点 ${owned} / 3`
        hud.objectiveDetail = `蓝方 ${Math.ceil(this.delta.ally)} 票 · 红方 ${Math.ceil(this.delta.enemy)} 票`
        hud.objectiveProgress = 1 - this.delta.enemy / DELTA_TICKETS
        break
      }
      default:
        break
    }
  }
}
