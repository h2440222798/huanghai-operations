import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export type CampusMode = 'orbit' | 'fps'

/** 圆形碰撞体（第一人称漫游的简易建筑碰撞） */
export interface CircleCollider {
  x: number
  z: number
  r: number
}

/** 第一人称活动范围（不对称：北到山、南到海、东西到周边小区） */
export interface FpsBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const EYE_HEIGHT = 1.7
const WALK_SPEED = 9
const RUN_SPEED = 26
const GRAVITY = 20
const JUMP_SPEED = 9
const MAX_JUMPS = 4 // 四段跳
const GLIDE_FALL_SPEED = 2.2 // 滑翔时的下降终速
const GLIDE_SPEED_BOOST = 1.7 // 滑翔时的水平加速倍率

/** 第一人称控制器：指针锁定 + WASD 移动 + 四段跳 / 滑翔 + 圆形碰撞体推离 */
export class FirstPersonController {
  yaw = 0
  pitch = 0
  enabled = false
  /** Esc 退出 / 指针锁定丢失时通知外层切回环绕模式 */
  onLockLost: (() => void) | null = null

  private keys = new Set<string>()
  private velocity = new THREE.Vector3()
  private vy = 0 // 垂直速度
  /** 是否在地面（守卫战枪模摆动/散布需要读取） */
  grounded = true

  /** 当前水平速度（守卫战移动散布 / 敌方命中率闪避需要读取） */
  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z)
  }
  private jumpsUsed = 0
  private gliding = false
  private baseFov: number
  /** 开镜时的倍率 / 灵敏度 / 移速缩放（守卫战狙击枪使用） */
  fovScale = 1
  lookScale = 1
  moveScale = 1
  /** 战斗中把漫游速度压到射击游戏的步行 / 冲刺区间（漫游本身是 9 / 26 m/s） */
  speedScale = 1
  /** 鼠标灵敏度倍率（大厅可调） */
  sensitivity = 1
  private fovLerp = 6
  /** 指针锁定瞬间 Chromium 会给出一帧巨大的 movement 跳变，此时段内丢弃鼠标输入 */
  private ignoreMouseUntil = 0
  private domElement: HTMLElement
  private colliders: CircleCollider[]
  private bounds: FpsBounds

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    colliders: CircleCollider[],
    bounds: FpsBounds,
  ) {
    this.domElement = domElement
    this.colliders = colliders
    this.bounds = bounds
    this.baseFov = camera.fov

    camera.rotation.order = 'YXZ'

    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    // 第一人称但未锁定时，点击画面重新请求锁定
    domElement.addEventListener('click', this.onClick)
  }

  /** 进入第一人称：请求指针锁定并把相机放到视线高度；requestInitialLock=false 供先弹 UI 再锁定的场景（守卫战） */
  activate(camera: THREE.PerspectiveCamera, requestInitialLock = true) {
    camera.position.y = EYE_HEIGHT
    // 由当前朝向推算偏航角保证视角连续；俯仰角归平，避免把环绕的俯视角度带进来
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    this.yaw = Math.atan2(-dir.x, -dir.z)
    this.pitch = 0
    this.velocity.set(0, 0, 0)
    this.vy = 0
    this.grounded = true
    this.jumpsUsed = 0
    this.gliding = false
    this.enabled = true
    this.fovScale = 1
    this.lookScale = 1
    this.moveScale = 1
    this.fovLerp = 6
    this.ignoreMouseUntil = performance.now() + 350
    if (requestInitialLock) this.requestLock()
  }

  /** 开镜：fov 缩放 / 鼠标灵敏度缩放 / 移速缩放；平时传 1,1,1 复位 */
  setAim(fovScale: number, lookScale = 1, moveScale = 1) {
    this.fovScale = THREE.MathUtils.clamp(fovScale, 0.15, 3)
    this.lookScale = THREE.MathUtils.clamp(lookScale, 0.1, 2)
    this.moveScale = THREE.MathUtils.clamp(moveScale, 0.2, 2)
    // 开镜收放要快，CF 的镜是「啪」一下切过去的
    this.fovLerp = this.fovScale < 0.98 ? 22 : 14
  }

  /** 收枪 / 退出守卫战时把开镜状态彻底复位（包括相机 FOV） */
  resetAim(camera?: THREE.PerspectiveCamera) {
    this.fovScale = 1
    this.lookScale = 1
    this.moveScale = 1
    this.fovLerp = 6
    if (camera && Math.abs(camera.fov - this.baseFov) > 0.01) {
      camera.fov = this.baseFov
      camera.updateProjectionMatrix()
    }
  }

  deactivate() {
    this.enabled = false
    this.gliding = false
    if (document.pointerLockElement === this.domElement) document.exitPointerLock()
  }

  /** 请求指针锁定；被拒绝时保持第一人称（键盘可用），可点击画面重试 */
  private requestLock() {
    try {
      const req = this.domElement.requestPointerLock() as unknown as Promise<void> | undefined
      if (req && typeof req.catch === 'function') req.catch(() => {})
    } catch {
      /* 忽略，用户可点击画面重试 */
    }
  }

  private tryJump() {
    if (this.grounded || this.jumpsUsed < MAX_JUMPS) {
      this.vy = JUMP_SPEED
      this.jumpsUsed++
      this.grounded = false
      this.gliding = false
    }
  }

  private toggleGlide() {
    // 仅在下落段可以展开 / 收起滑翔
    if (this.grounded || this.vy >= 0) return
    this.gliding = !this.gliding
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return
    // 防止空格 / 方向键触发页面滚动或已聚焦按钮的默认行为
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
    this.keys.add(e.code)
    if (e.repeat) return
    if (e.code === 'Space') this.tryJump()
    else if (e.code === 'KeyG') this.toggleGlide()
    else if (e.code === 'Escape' && document.pointerLockElement !== this.domElement) {
      this.onLockLost?.()
    }
  }
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }
  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled || document.pointerLockElement !== this.domElement) return
    if (performance.now() < this.ignoreMouseUntil) return
    // 单帧鼠标位移钳制，防止锁定瞬间的大跳变把视角甩向天空
    const mx = THREE.MathUtils.clamp(e.movementX, -150, 150)
    const my = THREE.MathUtils.clamp(e.movementY, -150, 150)
    this.yaw -= mx * 0.0022 * this.lookScale * this.sensitivity
    this.pitch -= my * 0.0022 * this.lookScale * this.sensitivity
    const lim = Math.PI / 2 - 0.05
    this.pitch = THREE.MathUtils.clamp(this.pitch, -lim, lim)
  }
  private onPointerLockChange = () => {
    if (document.pointerLockElement === this.domElement) {
      // 锁定刚建立时同样丢弃一小段鼠标事件
      this.ignoreMouseUntil = performance.now() + 250
      return
    }
    // Esc 退出指针锁定时通知外层切回环绕模式
    if (this.enabled) this.onLockLost?.()
  }
  private onClick = () => {
    if (this.enabled && document.pointerLockElement !== this.domElement) this.requestLock()
  }

  update(camera: THREE.PerspectiveCamera, dt: number) {
    if (!this.enabled) return

    // 滑翔状态合法性：落地或上升段自动收起
    if (this.grounded || this.vy >= 0) this.gliding = false
    const gliding = this.gliding

    // ---- 水平移动 ----
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const right = new THREE.Vector3(-forward.z, 0, forward.x)
    const wish = new THREE.Vector3()
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) wish.add(forward)
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) wish.sub(forward)
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) wish.add(right)
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) wish.sub(right)

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const speed = (sprint ? RUN_SPEED : WALK_SPEED) * (gliding ? GLIDE_SPEED_BOOST : 1) * this.moveScale * this.speedScale
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed)

    // 平滑加速/减速，空中操控性略低
    const responsiveness = this.grounded ? 10 : gliding ? 5 : 3.5
    this.velocity.lerp(wish, 1 - Math.exp(-dt * responsiveness))
    camera.position.addScaledVector(this.velocity, dt)

    // ---- 垂直运动（重力 / 跳跃 / 滑翔） ----
    if (!this.grounded) {
      this.vy -= GRAVITY * dt
      if (gliding && this.vy < -GLIDE_FALL_SPEED) this.vy = -GLIDE_FALL_SPEED
    }
    camera.position.y += this.vy * dt
    if (camera.position.y <= EYE_HEIGHT) {
      // 落地
      camera.position.y = EYE_HEIGHT
      this.vy = 0
      this.grounded = true
      this.jumpsUsed = 0
      this.gliding = false
    } else {
      this.grounded = false
    }
    camera.position.y = Math.min(camera.position.y, 160)

    // ---- 碰撞：把相机推出圆形碰撞体 ----
    for (const c of this.colliders) {
      const dx = camera.position.x - c.x
      const dz = camera.position.z - c.z
      const d2 = dx * dx + dz * dz
      const min = c.r + 0.7
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2)
        camera.position.x = c.x + (dx / d) * min
        camera.position.z = c.z + (dz / d) * min
      }
    }
    // 校园及周边边界
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, this.bounds.minX, this.bounds.maxX)
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, this.bounds.minZ, this.bounds.maxZ)

    // ---- 速度感：冲刺 / 滑翔时动态视野；开镜时以镜倍率为准 ----
    const moving = this.velocity.lengthSq() > 4
    const fovBonus = gliding ? 13 : sprint && moving ? 8 : 0
    const targetFov = Math.max(8, (this.baseFov + fovBonus) * this.fovScale)
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * this.fovLerp)
      camera.updateProjectionMatrix()
    }

    camera.rotation.set(this.pitch, this.yaw, 0)
  }

  dispose() {
    this.deactivate()
    this.keys.clear()
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    this.domElement.removeEventListener('click', this.onClick)
    this.onLockLost = null
  }
}

/** 漫游控制器：封装环绕 / 第一人称两种模式的切换 */
export class CampusControls {
  orbit: OrbitControls
  fps: FirstPersonController
  mode: CampusMode = 'orbit'
  onModeChange: ((m: CampusMode) => void) | null = null

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    colliders: CircleCollider[],
    bounds: FpsBounds,
  ) {
    this.orbit = new OrbitControls(camera, domElement)
    this.orbit.enableDamping = true
    this.orbit.dampingFactor = 0.06
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.03
    this.orbit.minDistance = 8
    this.orbit.maxDistance = 460
    this.orbit.target.set(0, 6, 60)

    this.fps = new FirstPersonController(camera, domElement, colliders, bounds)
    this.fps.onLockLost = () => this.setMode('orbit', camera)
  }

  setMode(mode: CampusMode, camera?: THREE.PerspectiveCamera, options?: { lock?: boolean }) {
    if (mode === this.mode) return
    if (mode === 'fps') {
      if (!camera) return
      this.orbit.enabled = false
      this.fps.activate(camera, options?.lock !== false)
    } else {
      this.fps.deactivate()
      this.fps.resetAim(camera)
      this.orbit.enabled = true
      // 环绕目标放在水平视线前方（忽略俯仰），保证切回环绕时镜头不会朝天
      if (camera) {
        const dir = new THREE.Vector3()
        camera.getWorldDirection(dir)
        dir.y = 0
        if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1)
        dir.normalize()
        const target = camera.position.clone().addScaledVector(dir, 32)
        target.y = Math.max(camera.position.y + 4, 3)
        this.orbit.target.copy(target)
      }
    }
    this.mode = mode
    this.onModeChange?.(mode)
  }

  update(camera: THREE.PerspectiveCamera, dt: number) {
    if (this.mode === 'orbit') this.orbit.update()
    else this.fps.update(camera, dt)
  }

  dispose() {
    this.orbit.dispose()
    this.fps.dispose()
    this.onModeChange = null
  }
}
