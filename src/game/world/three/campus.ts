import * as THREE from 'three'
import { createSky, type Sky } from './sky'
import { type Water } from './environment'
import { buildQdhhCampus, type QdhhBuild } from './qdhh'
import { buildSdustCampus } from './sdust'
import { collectWindowMaterials, type BuildingData } from './buildings'
import { CampusControls, type CampusMode, type CircleCollider } from './controls'
import {
  prepareCampusMaterials,
  setCampusMaterialDetail,
} from './materials'
import { createSkyEnvironment, type SkyEnvironment } from './cinematic/env'
import { CinematicPost, type PostQuality } from './cinematic/post'
import { ZhixinBuildingScene, type RoomData, type CourseSchedule } from './zhixinBuilding'
import { MatchEngine, type MatchCallbacks } from '../../match'
import type { CfLoadout } from '../cf'
import type { GameModeId } from '../../types'

export type { CampusMode }
export interface BuildingInfo extends BuildingData {}
export type CampusId = 'qdhh' | 'sdust'

interface CampusLayoutConfig {
  build: (scene: THREE.Scene) => QdhhBuild
  /** 初始与复位相机 */
  camera: { position: [number, number, number]; target: [number, number, number] }
  /** 第一人称 / 环绕的活动范围 */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** 小地图正交视口（覆盖全校园） */
  minimap: { halfW: number; halfH: number; centerZ: number }
  /** 「观鸟视角」相机位置与目标 */
  birdView: { position: [number, number, number]; target: [number, number, number] }
}

const CAMPUS_LAYOUTS: Record<CampusId, CampusLayoutConfig> = {
  qdhh: {
    build: buildQdhhCampus,
    camera: { position: [210, 110, 330], target: [10, 0, -10] },
    bounds: { minX: -600, maxX: 600, minZ: -160, maxZ: 198 },
    minimap: { halfW: 375, halfH: 268, centerZ: 20 },
    birdView: { position: [42, 22, 28], target: [42, 13, -32] },
  },
  sdust: {
    build: buildSdustCampus,
    camera: { position: [168, 118, 236], target: [0, 0, -96] },
    bounds: { minX: -560, maxX: 560, minZ: -296, maxZ: 168 },
    minimap: { halfW: 380, halfH: 262, centerZ: -70 },
    birdView: { position: [55, 26, -150], target: [-30, 12, -150] },
  },
}

export interface CampusCallbacks {
  onSelect?: (b: BuildingInfo | null) => void
  onFps?: (fps: number, pos: { x: number; y: number; z: number }) => void
  onTime?: (hours: number) => void
  onModeChange?: (m: CampusMode) => void
  /** 知新楼内部交互回调 */
  onRoomInteract?: (roomId: string, type: 'door' | 'light' | 'window' | 'blackboard', data: any) => void
  onEnterBuilding?: (buildingName: string) => void
  onExitBuilding?: () => void
}

export interface CampusAppOptions {
  campus?: CampusId
}

export interface CampusRenderQuality {
  pixelRatio: number
  shadowMapSize: number
}

export function resolveCampusQuality(
  viewportWidth: number,
  devicePixelRatio: number,
  maxTextureSize: number,
): CampusRenderQuality {
  const compact = viewportWidth <= 700
  const normalizedPixelRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1
  const textureLimit = Number.isFinite(maxTextureSize) && maxTextureSize > 0
    ? maxTextureSize
    : 1024

  return {
    pixelRatio: Math.min(normalizedPixelRatio, compact ? 1.25 : 2),
    shadowMapSize: Math.min(compact ? 2048 : 4096, textureLimit),
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

const lerpColor = (out: THREE.Color, a: string, b: string, t: number) =>
  out.set(a).lerp(new THREE.Color(b), THREE.MathUtils.clamp(t, 0, 1))

/**
 * 昼夜调色板：三种状态（日 / 黄昏 / 夜）之间做双段插值。
 * 颜色按 sRGB 书写，THREE.Color 会自动转到线性空间，交给 HDR 管线。
 */
const PALETTE = {
  sunDay: new THREE.Color('#fff3e0'),
  sunDusk: new THREE.Color('#ff8f42'),
  sunNight: new THREE.Color('#9fb6e0'),
  zenDay: new THREE.Color('#2c6cb8'),
  zenDusk: new THREE.Color('#26375f'),
  zenNight: new THREE.Color('#060c1a'),
  horDay: new THREE.Color('#e6f0f8'),
  horDusk: new THREE.Color('#ff7326'),
  horNight: new THREE.Color('#0a1424'),
  horAwayDay: new THREE.Color('#b9d3e6'),
  horAwayDusk: new THREE.Color('#6e7180'),
  horAwayNight: new THREE.Color('#091120'),
  groundDay: new THREE.Color('#3d3b32'),
  groundDusk: new THREE.Color('#241d1a'),
  groundNight: new THREE.Color('#080a0f'),
  cloudDarkDay: new THREE.Color('#8fa2b8'),
  cloudDarkDusk: new THREE.Color('#3a3f50'),
  cloudDarkNight: new THREE.Color('#0b1220'),
  cloudLitDay: new THREE.Color('#fff1dc'),
  cloudLitDusk: new THREE.Color('#ffa25c'),
  cloudLitNight: new THREE.Color('#1a2130'),
  hemiDusk: new THREE.Color('#9a6240'),
  waterDeepNight: new THREE.Color('#04121c'),
  waterShallowNight: new THREE.Color('#0a2630'),
}

/** 主应用：场景 / 相机 / 昼夜 / 交互 / 渲染循环（支持多校园布局） */
export class CampusApp {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private sky: Sky
  private controls: CampusControls
  private container: HTMLElement
  private callbacks: CampusCallbacks
  private layout: CampusLayoutConfig
  readonly campus: CampusId

  private buildingsGroup: THREE.Group
  private labelsGroup: THREE.Group
  private waters: Water[]
  private waterBases: { deep: THREE.Color; shallow: THREE.Color }[] = []
  private updates: ((t: number) => void)[]
  private lampLights: { light: THREE.PointLight; bulb: THREE.Mesh }[]
  private windowMats: THREE.MeshStandardMaterial[] = []

  private timeOfDay = 17.4
  private autoTime = true
  private sunDir = new THREE.Vector3(0, 1, 0)
  private moonDir = new THREE.Vector3(0, -1, 0)
  private raycaster = new THREE.Raycaster()
  private pointerDownPos: { x: number; y: number } | null = null
  private selectionRing: THREE.Mesh
  private environment: SkyEnvironment
  private materialDetail = true
  private cinematic = true

  /** 电影级后期（HDR + SSAO + 光束 + 泛光 + AgX） */
  private post: CinematicPost
  private postQuality: PostQuality
  private basePixelRatio = 1
  /** 自适应分辨率：帧率掉下来时按比例降内部分辨率 */
  private renderScale = 1
  private frameMs = 16
  private scaleCooldown = 0
  /** 供后期使用的大气 / 曝光参数，由 applyTime 维护 */
  private grade = {
    fogColor: new THREE.Color('#9fb4c6'),
    fogSun: new THREE.Color('#ffbe86'),
    fogDensity: 0.0016,
    fogHeight: 70,
    exposure: 0.62,
    bloom: 0.5,
    shafts: 0.5,
    night: 0,
    dusk: 0,
  }

  private minimapCamera: THREE.OrthographicCamera
  private minimapVisible = true
  private minimapMarker: THREE.Mesh
  private envGround = new THREE.Color()

  // 知新楼内部系统
  private zhixinScene: ZhixinBuildingScene | null = null
  private insideBuilding = false
  private currentRoomId: string | null = null

  private frameCount = 0
  private fpsTimer = 0
  private timeTimer = 0
  private timer = new THREE.Timer()
  private resizeObserver: ResizeObserver
  private disposed = false

  // 战斗（五模式共用一套对局引擎）
  private colliders: CircleCollider[] = []
  private match: MatchEngine | null = null
  private prevOnLockLost: (() => void) | null = null
  private minimapBeforeDefense = true

  constructor(container: HTMLElement, callbacks: CampusCallbacks = {}, options: CampusAppOptions = {}) {
    this.container = container
    this.callbacks = callbacks
    this.campus = options.campus ?? 'qdhh'
    this.layout = CAMPUS_LAYOUTS[this.campus]

    // ---- 渲染器 ----
    // 抗锯齿交给后期 FXAA：整个场景先渲染进 HDR 目标，MSAA 在这里用不上
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    })
    prepareCampusMaterials(this.renderer)
    const quality = resolveCampusQuality(
      container.clientWidth,
      window.devicePixelRatio,
      this.renderer.capabilities.maxTextureSize,
    )
    this.renderer.setPixelRatio(quality.pixelRatio)
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.basePixelRatio = quality.pixelRatio
    this.renderer.shadowMap.enabled = true
    // 半径 > 1 的 PCF 采样，配合后期 SSAO 出具"接触阴影"的感觉
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // 色调映射在后期合成里手动做（AgX + ACES 混合），这里必须关掉
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    container.appendChild(this.renderer.domElement)

    // ---- 相机 ----
    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.5,
      2600,
    )
    this.camera.position.set(...this.layout.camera.position)
    this.camera.lookAt(...this.layout.camera.target)

    // ---- 后期质量档位 ----
    const compact = container.clientWidth <= 820
    this.postQuality = compact ? 'medium' : 'ultra'
    this.post = new CinematicPost(this.renderer, this.camera, this.postQuality)
    this.post.setSize(
      container.clientWidth * quality.pixelRatio,
      container.clientHeight * quality.pixelRatio,
    )

    // 雾由后期按深度解析计算（three 的均匀雾做不出逆光地平线那层暖光）
    this.scene.fog = null

    // ---- 天空与光照 ----
    this.sky = createSky(this.scene)
    this.environment = createSkyEnvironment()
    this.sky.sunLight.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
    this.sky.sunLight.shadow.camera.top = 185
    this.sky.sunLight.shadow.camera.bottom = -185
    this.sky.sunLight.shadow.camera.left = -185
    this.sky.sunLight.shadow.camera.right = 185
    this.sky.sunLight.shadow.camera.updateProjectionMatrix()

    // ---- 校园布局（青岛黄海学院 / 山东科技大学） ----
    const layout = this.layout.build(this.scene)
    this.buildingsGroup = layout.buildingsGroup
    this.labelsGroup = layout.labelsGroup
    this.waters = layout.waters
    this.waterBases = this.waters.map((w) => ({
      deep: (w.material.uniforms.uDeepColor!.value as THREE.Color).clone(),
      shallow: (w.material.uniforms.uShallowColor!.value as THREE.Color).clone(),
    }))
    this.updates = layout.updates
    this.lampLights = layout.lampLights
    this.windowMats = collectWindowMaterials(layout.buildingsGroup)

    // ---- 控制器与碰撞 ----
    const colliders: CircleCollider[] = layout.colliders
    this.colliders = colliders
    this.controls = new CampusControls(this.camera, this.renderer.domElement, colliders, this.layout.bounds)
    this.controls.onModeChange = (m) => this.callbacks.onModeChange?.(m)

    // ---- 拾取 ----
    const dom = this.renderer.domElement
    dom.addEventListener('pointerdown', this.onPointerDown)
    dom.addEventListener('pointerup', this.onPointerUp)
    // 键盘事件绑定到 document，确保全局生效
    document.addEventListener('keydown', this.onKeyDown)

    // ---- 选中光环 ----
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.14, 48),
      new THREE.MeshBasicMaterial({
        color: '#4da3ff',
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    this.selectionRing.rotation.x = -Math.PI / 2
    this.selectionRing.position.y = 0.35
    this.selectionRing.visible = false
    this.scene.add(this.selectionRing)

    // ---- 小地图相机（俯视正交，固定展示全校园） ----
    const mini = this.layout.minimap
    this.minimapCamera = new THREE.OrthographicCamera(-mini.halfW, mini.halfW, mini.halfH, -mini.halfH, 10, 1400)
    this.minimapCamera.position.set(0, 600, mini.centerZ)
    this.minimapCamera.up.set(0, 0, -1)
    this.minimapCamera.lookAt(0, 0, mini.centerZ)
    this.minimapMarker = new THREE.Mesh(
      new THREE.ConeGeometry(4, 11, 4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ff5533' }),
    )
    this.scene.add(this.minimapMarker)

    // ---- 尺寸自适应 ----
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.timer.connect(document)

    // ---- 初始状态 ----
    this.applyTime(this.timeOfDay)
    if (import.meta.env.DEV) {
      // 开发期调试句柄：可在控制台里直接调 setTimeOfDay / setPostQuality
      ;(window as unknown as { __campusApp?: CampusApp }).__campusApp = this
    }
    this.renderer.setAnimationLoop(this.tick)
  }

  /* ------------------------- 昼夜系统 ------------------------- */

  setTimeOfDay(h: number) {
    this.timeOfDay = ((h % 24) + 24) % 24
    this.applyTime(this.timeOfDay)
  }

  getTimeOfDay() {
    return this.timeOfDay
  }

  setAutoTime(v: boolean) {
    this.autoTime = v
  }

  private applyTime(t: number, dt = 0.016) {
    const theta = ((t - 6) / 12) * Math.PI
    const e = Math.sin(theta) // 太阳高度 [-1, 1]
    // 太阳沿校园主轴线（-Z）东升西落：黄昏时正好挂在主路尽头，
    // 逆光、长影、地平线暖雾才成立（原先太阳在侧面，画面永远是平的）
    const sunDir = this.sunDir.set(Math.cos(theta) * 0.38, e, -0.92).normalize()
    const moonDir = this.moonDir.set(-Math.cos(theta) * 0.38, -e, -0.92).normalize()

    // 日落前后给足光：太阳只要还在地平线上就要有强逆光，而不是迅速变暗
    const dayF = smoothstep(-0.01, 0.26, e)
    const nightF = smoothstep(0.03, 0.24, -e)
    const duskGlow = THREE.MathUtils.clamp(1 - Math.abs(e) / 0.34, 0, 1)
    // 夜间设施（路灯/窗户）在黄昏时分就逐渐点亮
    const lampF = THREE.MathUtils.clamp(nightF + duskGlow * 0.8, 0, 1)

    // 太阳 / 月亮方向光
    this.sky.sunLight.intensity = dayF * 2.9 + duskGlow * 1.55
    lerpColor(this.sky.sunLight.color, '#fff3e0', '#ff8f42', duskGlow)
    this.sky.moonLight.intensity = nightF * 0.62
    lerpColor(this.sky.moonLight.color, '#9fb6e0', '#8fa8d8', dayF)

    // 半球环境光（补一点，避免背光面死黑；IBL 会再补一层）
    this.sky.hemiLight.intensity = 0.30 + dayF * 0.20 + duskGlow * 0.16
    lerpColor(this.sky.hemiLight.color, '#16202f', '#9dc0ea', dayF)
    this.sky.hemiLight.color.lerp(PALETTE.hemiDusk, duskGlow * 0.4)
    lerpColor(this.sky.hemiLight.groundColor, '#0a0d12', '#4a4030', dayF)

    // ---- 天空 ----
    const u = this.sky.uniforms
    u.uSunDir.value.copy(sunDir)
    u.uMoonDir.value.copy(moonDir)
    u.uSunCol.value
      .copy(PALETTE.sunNight)
      .lerp(PALETTE.sunDusk, Math.max(duskGlow, dayF * 0.7))
      .lerp(PALETTE.sunDay, dayF * 0.9)
    u.uZen.value
      .copy(PALETTE.zenNight)
      .lerp(PALETTE.zenDusk, Math.max(duskGlow * 0.8, dayF * 0.75))
      .lerp(PALETTE.zenDay, dayF)
    u.uHorAway.value
      .copy(PALETTE.horAwayNight)
      .lerp(PALETTE.horAwayDusk, Math.max(duskGlow * 0.7, dayF * 0.6))
      .lerp(PALETTE.horAwayDay, dayF)
    u.uHor.value
      .copy(PALETTE.horNight)
      .lerp(PALETTE.horDusk, THREE.MathUtils.clamp(duskGlow * 0.9 + dayF * 0.15, 0, 1))
      .lerp(PALETTE.horDay, dayF * 0.7)
    u.uGround.value
      .copy(PALETTE.groundNight)
      .lerp(PALETTE.groundDusk, Math.max(duskGlow * 0.7, dayF * 0.5))
      .lerp(PALETTE.groundDay, dayF)
    u.uCloudDark.value
      .copy(PALETTE.cloudDarkNight)
      .lerp(PALETTE.cloudDarkDusk, Math.max(duskGlow, dayF * 0.8))
      .lerp(PALETTE.cloudDarkDay, dayF * 0.9)
    u.uCloudLit.value
      .copy(PALETTE.cloudLitNight)
      .lerp(PALETTE.cloudLitDusk, Math.max(duskGlow, dayF * 0.5))
      .lerp(PALETTE.cloudLitDay, dayF * 0.8)
    u.uNight.value = nightF
    u.uSunDisk.value = e > -0.035 ? 1 : 0
    u.uCloud.value = 0.52 + duskGlow * 0.08
    u.uHaze.value = 0.32 + duskGlow * 0.45 + dayF * 0.12

    // ---- 后期：大气 / 曝光 / 光效 ----
    // 逆光时地平线是暖的，背光侧偏冷；后期的雾色也按这个规律取
    this.grade.fogColor
      .copy(u.uHorAway.value)
      .lerp(u.uZen.value, 0.22)
      .multiplyScalar(0.95)
    this.grade.fogSun.copy(u.uHor.value).multiplyScalar(1.55).lerp(u.uSunCol.value, 0.3)
    this.grade.fogDensity = 0.00070 + duskGlow * 0.00150 + nightF * 0.0004
    this.grade.fogHeight = 65 + dayF * 25
    this.grade.exposure = 0.98 + nightF * 0.62 + duskGlow * 0.22
    this.grade.bloom = 0.40 + duskGlow * 0.26 + nightF * 0.12
    this.grade.shafts = 0.14 + duskGlow * 0.55 + nightF * 0.08
    this.grade.night = nightF
    this.grade.dusk = duskGlow

    // ---- IBL：把当前天空烘成环境贴图（节流重算） ----
    const envTex = this.environment.update(this.renderer, this.sky, {
      night: nightF,
      dusk: duskGlow,
      dt,
    })
    if (envTex && this.scene.environment !== envTex) this.scene.environment = envTex
    this.scene.environmentIntensity = (this.materialDetail ? 1 : 0.5) * (0.55 + 0.30 * dayF + 1.85 * duskGlow)

    // ---- 星空 / 云 ----
    // 路灯与建筑窗户
    for (const lamp of this.lampLights) {
      lamp.light.intensity = lampF * 42
      ;((lamp.bulb as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity =
        lampF * 2.4
    }
    for (const m of this.windowMats) m.emissiveIntensity = lampF * 0.8

    // 水面反射的天空色与光源方向；夜晚压暗水体和高光
    const waterNight = THREE.MathUtils.clamp(1 - dayF * 1.25, 0, 1)
    for (let i = 0; i < this.waters.length; i++) {
      const water = this.waters[i]!
      const base = this.waterBases[i]
      ;(water.material.uniforms.uSkyColor!.value as THREE.Color)
        .copy(u.uHor.value)
        .lerp(u.uZen.value, 0.35)
      if (base) {
        ;(water.material.uniforms.uDeepColor!.value as THREE.Color)
          .copy(base.deep)
          .lerp(PALETTE.waterDeepNight, waterNight)
        ;(water.material.uniforms.uShallowColor!.value as THREE.Color)
          .copy(base.shallow)
          .lerp(PALETTE.waterShallowNight, waterNight)
      }
      ;(water.material.uniforms.uSunDir!.value as THREE.Vector3).copy(e > -0.02 ? sunDir : moonDir)
      water.material.uniforms.uNight!.value = Math.max(nightF, duskGlow * 0.6)
    }
  }
  /* ------------------------- 功能开关 ------------------------- */

  setLabelsVisible(v: boolean) {
    this.labelsGroup.visible = v
  }

  setMinimapVisible(v: boolean) {
    this.minimapVisible = v
  }

  setAutoRotate(v: boolean) {
    this.orbitControls.autoRotate = v
    this.orbitControls.autoRotateSpeed = 0.7
  }

  /** 打开 / 关闭法线凹凸与环境反射（用于低端 GPU 或课堂对比） */
  setMaterialDetail(v: boolean) {
    this.materialDetail = v
    setCampusMaterialDetail(v)
    this.applyTime(this.timeOfDay)
  }

  /** 关掉电影级后期（极低端设备或排查问题用），退回直接渲染 */
  setCinematic(v: boolean) {
    this.cinematic = v
  }

  private get orbitControls() {
    return this.controls.orbit
  }

  setMode(mode: CampusMode) {
    this.controls.setMode(mode, this.camera)
    // 从环绕机位切第一人称时，机位可能落在海边/住宅的碰撞体里；先找一块能站立的空地
    if (mode === 'fps' && !this.match) {
      this.camera.position.copy(this.findClearSpawn(this.camera.position.x, this.camera.position.z))
    }
  }

  getMode(): CampusMode {
    return this.controls.mode
  }

  resetView() {
    this.controls.setMode('orbit')
    this.camera.position.set(...this.layout.camera.position)
    this.camera.fov = 55
    this.camera.updateProjectionMatrix()
    this.orbitControls.target.set(...this.layout.camera.target)
    this.orbitControls.update()
  }

  /** 镜头推到湖面 / 河面上方看真实小鸟 */
  focusBirds() {
    this.controls.setMode('orbit')
    this.camera.position.set(...this.layout.birdView.position)
    this.camera.fov = 58
    this.camera.updateProjectionMatrix()
    this.orbitControls.target.set(...this.layout.birdView.target)
    this.orbitControls.update()
  }

  /* ------------------------- 拾取 ------------------------- */

  private onKeyDown = (e: KeyboardEvent) => {
    // 守卫战期间接管全部按键（1/2/3/Q/R 等由战斗层处理），校园交互键停用
    if (this.match) return

    // 调试日志
    console.log('[CampusApp] Key pressed:', e.key, 'Inside building:', this.insideBuilding, 'Mode:', this.controls.mode)

    if (!this.insideBuilding) {
      // 在室外第一人称模式下，按 E 进入知新楼
      if (e.key === 'e' || e.key === 'E') {
        if (this.controls.mode === 'fps') {
          const zhixinPos = new THREE.Vector3(65, 0, 108)
          const dist = this.camera.position.distanceTo(zhixinPos)
          console.log('[CampusApp] Distance to Zhixin Building:', dist.toFixed(2))

          if (dist < 30) {
            console.log('[CampusApp] Entering Zhixin Building...')
            this.enterZhixinBuilding()
          } else {
            console.log('[CampusApp] Too far from Zhixin Building. Walk closer!')
          }
        } else {
          console.log('[CampusApp] Must be in FPS mode to enter building')
        }
      }
    } else {
      // 在知新楼内部的交互
      if (e.key === 'e' || e.key === 'E') {
        console.log('[CampusApp] Interacting with nearest object...')
        this.interactWithNearestObject()
      }
      if (e.key === 'l' || e.key === 'L') {
        console.log('[CampusApp] Toggling nearest light...')
        this.toggleNearestLight()
      }
      if (e.key === 'q' || e.key === 'Q') {
        console.log('[CampusApp] Exiting building...')
        this.exitZhixinBuilding()
      }
      if (e.key === 'u' || e.key === 'U') {
        console.log('[CampusApp] Going upstairs...')
        this.goUpstairs()
      }
      if (e.key === 'd' || e.key === 'D') {
        console.log('[CampusApp] Going downstairs...')
        this.goDownstairs()
      }
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY }
  }

  private onPointerUp = (e: PointerEvent) => {
    if (!this.pointerDownPos) return
    const dx = e.clientX - this.pointerDownPos.x
    const dy = e.clientY - this.pointerDownPos.y
    this.pointerDownPos = null
    if (dx * dx + dy * dy > 25) return // 拖拽不算点击
    if (document.pointerLockElement) return // 第一人称锁定中不拾取

    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hits = this.raycaster.intersectObject(this.buildingsGroup, true)
    let target: THREE.Object3D | null = null
    for (const h of hits) {
      if (!(h.object as THREE.Mesh).isMesh) continue
      let o: THREE.Object3D | null = h.object
      while (o && o.parent !== this.buildingsGroup) o = o.parent
      if (o && o.userData.building) {
        target = o
        break
      }
    }
    this.select(target)
  }

  private select(target: THREE.Object3D | null) {
    if (target && target.userData.building) {
      const box = new THREE.Box3().setFromObject(target)
      const size = new THREE.Vector3()
      box.getSize(size)
      const center = new THREE.Vector3()
      box.getCenter(center)
      const r = (Math.max(size.x, size.z) / 2) * 1.2 + 2.5
      this.selectionRing.position.set(center.x, 0.35, center.z)
      this.selectionRing.visible = true
      this.selectionRing.userData.baseR = r
      this.selectionRing.scale.setScalar(r)
      this.callbacks.onSelect?.(target.userData.building as BuildingInfo)
    } else {
      this.selectionRing.visible = false
      this.callbacks.onSelect?.(null)
    }
  }

  clearSelection() {
    this.select(null)
  }

  /* ------------------------- 知新楼内部交互 ------------------------- */

  /** 进入知新楼内部 */
  private enterZhixinBuilding() {
    if (!this.zhixinScene) {
      this.zhixinScene = new ZhixinBuildingScene()
      this.zhixinScene.group.position.set(65, 0, 108)
      this.scene.add(this.zhixinScene.group)
    }
    this.insideBuilding = true
    this.zhixinScene.enter()
    this.callbacks.onEnterBuilding?.('J1 知新楼')

    // 相机传送到一楼走廊
    this.camera.position.set(65, 1.7, 108)
    this.buildingsGroup.visible = false // 隐藏外部建筑
  }

  /** 离开知新楼 */
  private exitZhixinBuilding() {
    if (this.zhixinScene) {
      this.zhixinScene.exit()
    }
    this.insideBuilding = false
    this.callbacks.onExitBuilding?.()
    this.buildingsGroup.visible = true

    // 相机传送到楼外
    this.camera.position.set(65, 1.7, 130)
  }

  /** 与最近的可交互对象交互 */
  private interactWithNearestObject() {
    if (!this.zhixinScene) return

    const camPos = this.camera.position
    let nearest: { roomId: string; type: string; dist: number } | null = null

    // 遍历所有房间找最近的交互物
    for (const [roomId, { mesh }] of this.zhixinScene.rooms) {
      for (const child of mesh.children) {
        if (child.userData.interactive) {
          const dist = camPos.distanceTo(child.position)
          if (dist < 3 && (!nearest || dist < nearest.dist)) {
            nearest = {
              roomId: child.userData.roomId as string,
              type: child.userData.interactive as string,
              dist,
            }
          }
        }
      }
    }

    if (nearest) {
      switch (nearest.type) {
        case 'door':
          const doorOpen = this.zhixinScene.toggleDoor(nearest.roomId)
          this.callbacks.onRoomInteract?.(nearest.roomId, 'door', { open: doorOpen })
          break
        case 'window':
          const windowOpen = this.zhixinScene.toggleWindow(nearest.roomId)
          this.callbacks.onRoomInteract?.(nearest.roomId, 'window', { open: windowOpen })
          break
        case 'blackboard':
          const course = this.zhixinScene.openBlackboard(nearest.roomId)
          this.callbacks.onRoomInteract?.(nearest.roomId, 'blackboard', course)
          break
      }
    }
  }

  /** 切换最近房间的灯光 */
  private toggleNearestLight() {
    if (!this.zhixinScene) return

    const camPos = this.camera.position
    let nearestRoomId: string | null = null
    let minDist = Infinity

    for (const [roomId, { mesh }] of this.zhixinScene.rooms) {
      const dist = camPos.distanceTo(mesh.position)
      if (dist < minDist) {
        minDist = dist
        nearestRoomId = roomId
      }
    }

    if (nearestRoomId && minDist < 10) {
      const lightsOn = this.zhixinScene.toggleLights(nearestRoomId)
      this.callbacks.onRoomInteract?.(nearestRoomId, 'light', { on: lightsOn })
    }
  }

  /** 上楼 */
  private goUpstairs() {
    if (!this.zhixinScene) return
    const floor = this.zhixinScene.goUpstairs()
    this.camera.position.y = (floor - 1) * 3.1 + 1.7
  }

  /** 下楼 */
  private goDownstairs() {
    if (!this.zhixinScene) return
    const floor = this.zhixinScene.goDownstairs()
    this.camera.position.y = (floor - 1) * 3.1 + 1.7
  }

  /* ------------------------- 多模式对局 ------------------------- */

  /**
   * 找一个不卡在建筑 / 海边碰撞体里的出生点。
   *
   * 环绕机位经常在校园边界外（例如 qdhh 初始机位 z=330），直接钳制到边界会落进
   * 周边住宅或海岸隐形碰撞体里，第一帧被「推出去 + 钳回来」反复拉扯，表现就是
   * 刚出场动不了。这里从期望点向外做环形搜索，实在找不到再全图网格兜底。
   */
  private findClearSpawn(desiredX: number, desiredZ: number): THREE.Vector3 {
    const b = this.layout.bounds
    const margin = 16
    const clampX = (x: number) => THREE.MathUtils.clamp(x, b.minX + margin, b.maxX - margin)
    const clampZ = (z: number) => THREE.MathUtils.clamp(z, b.minZ + margin, b.maxZ - margin)
    const x0 = clampX(desiredX)
    const z0 = clampZ(desiredZ)

    const clear = (x: number, z: number) => {
      if (x < b.minX + 8 || x > b.maxX - 8 || z < b.minZ + 8 || z > b.maxZ - 8) return false
      return this.colliders.every((c) => Math.hypot(c.x - x, c.z - z) >= c.r + 2.4)
    }
    if (clear(x0, z0)) return new THREE.Vector3(x0, 1.7, z0)

    // 由近到远环形搜索
    for (let radius = 6; radius <= 200; radius += 6) {
      const steps = Math.max(12, Math.round(radius / 2))
      for (let i = 0; i < steps; i += 1) {
        const angle = (i / steps) * Math.PI * 2
        const x = x0 + Math.cos(angle) * radius
        const z = z0 + Math.sin(angle) * radius
        if (clear(x, z)) return new THREE.Vector3(x, 1.7, z)
      }
    }

    // 兜底：全图 8m 网格，取离期望点最近的可站立点
    let best: { x: number; z: number; d: number } | null = null
    for (let x = b.minX + margin; x <= b.maxX - margin; x += 8) {
      for (let z = b.minZ + margin; z <= b.maxZ - margin; z += 8) {
        if (!clear(x, z)) continue
        const d = (x - x0) ** 2 + (z - z0) ** 2
        if (!best || d < best.d) best = { x, z, d }
      }
    }
    if (best) return new THREE.Vector3(best.x, 1.7, best.z)
    return new THREE.Vector3(x0, 1.7, z0)
  }

  get matchActive() {
    return this.match !== null
  }

  /** 兼容旧命名 */
  get defenseActive() {
    return this.match !== null
  }

  /**
   * 在当前校园场景中开启一局对战（经典 / 爆破 / 生化 / 挑战 / 三角洲）。
   * 若已有对局直接返回现有实例。
   */
  startMatch(
    mode: GameModeId,
    callbacks: MatchCallbacks,
    loadout?: Partial<CfLoadout> | null,
    config?: { autoStart?: boolean },
  ): MatchEngine {
    if (this.match) return this.match
    if (this.insideBuilding) this.exitZhixinBuilding()
    this.clearSelection()
    this.controls.setMode('fps', this.camera, { lock: false })
    // 环绕机位可能在校园边界外很远，先找一块真正能站立的空地
    const spawn = this.findClearSpawn(this.camera.position.x, this.camera.position.z)
    this.camera.position.copy(spawn)
    // 指针锁定丢失（Esc）→ 暂停对局而不是退回环绕模式
    this.prevOnLockLost = this.controls.fps.onLockLost
    this.controls.fps.onLockLost = () => this.match?.pause()
    // 战斗期间收起小地图，结束再恢复用户原来的选择
    this.minimapBeforeDefense = this.minimapVisible
    this.minimapVisible = false
    this.controls.fps.speedScale = 0.42

    this.match = new MatchEngine({
      mode,
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      colliders: this.colliders,
      bounds: this.layout.bounds,
      isGrounded: () => this.controls.fps.grounded,
      playerSpeed: () => this.controls.fps.horizontalSpeed,
      getYaw: () => this.controls.fps.yaw,
      applyRecoil: (pitchDelta: number, yawDelta: number) => {
        this.controls.fps.pitch = THREE.MathUtils.clamp(
          this.controls.fps.pitch + pitchDelta,
          -Math.PI / 2 + 0.05,
          Math.PI / 2 - 0.05,
        )
        this.controls.fps.yaw += yawDelta
      },
      setAim: (fovScale: number, lookScale: number, moveScale: number) => {
        this.controls.fps.setAim(fovScale, lookScale, moveScale)
      },
      teleport: (x: number, z: number, yaw?: number) => {
        this.camera.position.set(x, 1.7, z)
        this.controls.fps.yaw = yaw ?? this.controls.fps.yaw
        this.controls.fps.pitch = 0
      },
      loadout,
      ...callbacks,
    })
    // 先解除指针锁定，让模式简报 / 配枪面板可以点击；开始后由战斗层重新请求锁定
    if (document.pointerLockElement) document.exitPointerLock()
    if (config?.autoStart) this.match.begin()
    return this.match
  }

  /** 兼容旧接口：挑战模式 = 30 波守卫战 */
  startDefense(
    callbacks: MatchCallbacks,
    loadout?: Partial<CfLoadout> | null,
    config?: { autoStart?: boolean },
  ): MatchEngine {
    return this.startMatch('challenge', callbacks, loadout, config)
  }

  stopMatch() {
    if (!this.match) return
    this.match.dispose()
    this.match = null
    this.controls.fps.onLockLost = this.prevOnLockLost
    this.prevOnLockLost = null
    this.minimapVisible = this.minimapBeforeDefense
    this.controls.fps.speedScale = 1
    this.controls.setMode('orbit', this.camera)
  }

  stopDefense() {
    this.stopMatch()
  }

  /** briefing / paused 界面点击「开始 / 继续」 */
  resumeMatch() {
    this.match?.begin()
  }

  /** 大厅里设置鼠标灵敏度（1 = 默认） */
  setSensitivity(value: number) {
    this.controls.fps.sensitivity = THREE.MathUtils.clamp(value, 0.2, 3)
  }

  resumeDefense() {
    this.match?.begin()
  }

  /* ------------------------- 渲染循环 ------------------------- */

  private tick = () => {
    if (this.disposed) return
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.1)
    const t = this.timer.getElapsed()

    if (this.autoTime) {
      // 八分钟一整天：比原来慢 4 倍，避免对局中光线变化太快
      this.timeOfDay = (this.timeOfDay + dt * 0.05) % 24
      this.applyTime(this.timeOfDay, dt)
      this.timeTimer += dt
      if (this.timeTimer > 0.4) {
        this.timeTimer = 0
        this.callbacks.onTime?.(this.timeOfDay)
      }
    }
    this.sky.update(dt, this.camera)

    // 方向光跟着玩家走：260m 的阴影框在 2K/4K 贴图上依然保持足够精度
    const px = this.camera.position
    this.sky.sunLight.position.copy(px).addScaledVector(this.sunDir, 320)
    this.sky.sunLight.target.position.copy(px)
    this.sky.sunLight.target.updateMatrixWorld()
    this.sky.moonLight.position.copy(px).addScaledVector(this.moonDir, 320)
    this.sky.moonLight.target.position.copy(px)
    this.sky.moonLight.target.updateMatrixWorld()
    for (const water of this.waters) water.material.uniforms.uTime!.value = t
    for (const update of this.updates) update(t)
    this.controls.update(this.camera, dt)

    // 守卫战（CF 挑战模式）
    if (this.match) this.match.update(dt)

    // 知新楼内部更新
    if (this.zhixinScene && this.insideBuilding) {
      this.zhixinScene.update(dt)
    }

    // 选中光环呼吸
    if (this.selectionRing.visible) {
      const baseR = (this.selectionRing.userData.baseR as number) ?? 1
      this.selectionRing.scale.setScalar(baseR * (1 + Math.sin(t * 3) * 0.03))
      this.selectionRing.rotation.z += dt * 0.4
    }

    // 小地图标记跟随相机
    this.minimapMarker.position.set(this.camera.position.x, 40, this.camera.position.z)
    if (this.controls.mode === 'fps') {
      this.minimapMarker.rotation.y = this.controls.fps.yaw
    } else {
      const d = this.orbitControls.target.clone().sub(this.camera.position)
      this.minimapMarker.rotation.y = Math.atan2(-d.x, -d.z)
    }

    // ---- 渲染：HDR 场景 → SSAO / 光束 / 泛光 → AgX 合成 → FXAA ----
    this.updateRenderScale(dt)
    if (!this.cinematic) {
      this.renderer.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight)
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping
      this.renderer.toneMappingExposure = 0.95
      this.renderer.outputColorSpace = THREE.SRGBColorSpace
      this.renderer.setScissorTest(false)
      this.renderer.render(this.scene, this.camera)
      if (this.match) this.match.renderOverlay()
      this.renderer.toneMapping = THREE.NoToneMapping
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    } else {
      this.post.render(this.scene, this.camera, {
      time: t,
      dt,
      sunDir: this.sunDir,
      sunColor: this.sky.uniforms.uSunCol.value,
      sunOn: this.sky.uniforms.uSunDisk.value,
      fogColor: this.grade.fogColor,
      fogSun: this.grade.fogSun,
      fogDensity: this.grade.fogDensity,
      fogHeight: this.grade.fogHeight,
      exposure: this.grade.exposure,
      bloom: this.grade.bloom,
      shafts: this.grade.shafts,
      vignette: 0.30,
      grain: 0.020,
      saturation: 1.04,
      fade: 0,
      night: this.grade.night,
      }, this.match ? this.match.overlay : null)
    }

    // 小地图（右下角视口，固定全校园视角）
    if (this.minimapVisible) {
      const w = this.container.clientWidth
      const vw = 236
      const vh = 169
      const prevTone = this.renderer.toneMapping
      const prevSpace = this.renderer.outputColorSpace
      const skyVisible = this.sky.group.visible
      this.sky.group.visible = false
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping
      this.renderer.toneMappingExposure = 1.0
      this.renderer.outputColorSpace = THREE.SRGBColorSpace
      this.renderer.setScissorTest(true)
      this.renderer.setScissor(w - vw - 14, 14, vw, vh)
      this.renderer.setViewport(w - vw - 14, 14, vw, vh)
      this.renderer.clearDepth()
      this.renderer.render(this.scene, this.minimapCamera)
      this.renderer.setScissorTest(false)
      this.renderer.setViewport(0, 0, w, this.container.clientHeight)
      this.renderer.toneMapping = prevTone
      this.renderer.outputColorSpace = prevSpace
      this.sky.group.visible = skyVisible
    }

    // 第一人称枪模已经在前面的 HDR 阶段画进场景，这里不再单独叠加

    // FPS 统计
    this.frameCount++
    this.fpsTimer += dt
    if (this.fpsTimer >= 0.5) {
      const fpsNow = Math.round(this.frameCount / this.fpsTimer)
      this.callbacks.onFps?.(fpsNow, {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      })
      this.frameCount = 0
      this.fpsTimer = 0
    }
  }

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(this.basePixelRatio * this.renderScale)
    this.renderer.setSize(w, h)
    const pr = this.renderer.getPixelRatio()
    this.post.setSize(w * pr, h * pr)
  }

  /**
   * 自适应分辨率：后期链比原来贵不少，帧率掉下来时先降内部分辨率，
   * 而不是让玩家看幻灯片。抬升留了更长的冷却，避免来回抖。
   */
  private updateRenderScale(dt: number) {
    this.frameMs = this.frameMs * 0.92 + Math.min(dt, 0.2) * 1000 * 0.08
    if (this.disposed || !this.post) return
    this.scaleCooldown -= dt
    if (this.scaleCooldown > 0) return

    const cap = Math.min(1, this.post.renderScaleCap / Math.max(0.001, this.basePixelRatio))
    if (this.frameMs > 26 && this.renderScale > 0.62) {
      this.renderScale = Math.max(0.62, this.renderScale - 0.09)
      this.scaleCooldown = 1.6
      this.resize()
    } else if (this.frameMs < 13.5 && this.renderScale < cap) {
      this.renderScale = Math.min(cap, this.renderScale + 0.05)
      this.scaleCooldown = 4.0
      this.resize()
    }
  }

  dispose() {
    this.disposed = true
    this.stopDefense()
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp)
    document.removeEventListener('keydown', this.onKeyDown)
    this.timer.dispose()
    this.controls.dispose()
    this.environment.dispose()
    this.post.dispose()
    this.zhixinScene?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}
