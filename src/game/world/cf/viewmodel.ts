import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

import { cfClamp, cfDamp } from './math'
import type { CfWeaponSpec } from './weapons'

export interface CfViewModelState {
  moving: boolean
  speed: number
  grounded: boolean
  reloading: boolean
  zoomed: boolean
  /** 加特林枪管转速 0~1 */
  spin: number
}

interface CfParts {
  muzzle: THREE.Object3D
  magazine: THREE.Object3D | null
  bolt: THREE.Object3D | null
  pump: THREE.Object3D | null
  barrels: THREE.Object3D | null
  blade: THREE.Object3D | null
  flash: THREE.Sprite
  flashLight: THREE.PointLight
  skinMaterials: THREE.MeshStandardMaterial[]
}

interface Shell {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  spin: THREE.Vector3
  life: number
}

const PRESETS: Record<string, { x: number; y: number; z: number; scale: number; rotY: number }> = {
  rifle: { x: 0.225, y: -0.2, z: -0.62, scale: 1.16, rotY: 0.06 },
  smg: { x: 0.215, y: -0.195, z: -0.6, scale: 1.1, rotY: 0.06 },
  machinegun: { x: 0.245, y: -0.215, z: -0.66, scale: 1.08, rotY: 0.05 },
  sniper: { x: 0.235, y: -0.2, z: -0.68, scale: 1.08, rotY: 0.05 },
  pistol: { x: 0.15, y: -0.135, z: -0.5, scale: 0.92, rotY: 0.045 },
  melee: { x: 0.175, y: -0.16, z: -0.5, scale: 1.12, rotY: 0.02 },
}

/**
 * CF 风格第一人称枪模。
 *
 * 与「太阳系战场」的 CS 视图模型不同：
 *  · 枪身更靠近镜头、占屏更大，右手持握点更靠中（CF 的经典构图）；
 *  · 换弹是「压枪身 → 退弹匣 → 插弹匣 → 拉枪机」四段；
 *  · 后坐是枪身后撞 + 上跳，英雄级武器带火焰 / 电弧皮肤；
 *  · 狙击开镜直接收枪，只留 HUD 镜圈。
 */
export class CfViewModel {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.01, 12)

  private root = new THREE.Group()
  private weapon = new THREE.Group()
  private spec: CfWeaponSpec
  private parts: CfParts | null = null

  private materials: THREE.Material[] = []
  private geometries: THREE.BufferGeometry[] = []
  private textures: THREE.Texture[] = []
  private shared: {
    rough: THREE.CanvasTexture
    wood: THREE.CanvasTexture
    flame: THREE.CanvasTexture
    thunder: THREE.CanvasTexture
    glow: THREE.CanvasTexture
  }

  private preset = PRESETS.rifle!
  private baseY = 0
  private recoil = 0
  private recoilVelocity = 0
  private reloadTimer = 0
  private reloadDuration = 1
  private drawTimer = 0
  private drawDuration = 0.5
  private flashTimer = 0
  private mechTimer = 0
  private mechDuration = 0
  private meleeTimer = 0
  private meleeDuration = 0.3
  private landKick = 0
  private swayX = 0
  private swayY = 0
  private spin = 0
  private time = 0
  private shells: Shell[] = []
  private disposed = false

  constructor(renderer?: THREE.WebGLRenderer) {
    this.shared = {
      rough: makeRoughnessTexture(),
      wood: makeWoodTexture(),
      flame: makeFlameTexture(),
      thunder: makeThunderTexture(),
      glow: makeGlowTexture(),
    }
    this.textures.push(this.shared.rough, this.shared.wood, this.shared.flame, this.shared.thunder, this.shared.glow)

    this.camera.position.set(0, 0, 0)
    this.scene.add(this.root)
    this.root.add(this.weapon)

    // 三点布光：CF 的枪模通常比场景亮一档，才能看清金属高光
    this.scene.add(new THREE.HemisphereLight('#dcecff', '#1b2028', 1.55))
    const key = new THREE.DirectionalLight('#fff1da', 2.95)
    key.position.set(-1.1, 1.5, 1.2)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight('#8fc4ff', 1)
    fill.position.set(1.4, 0.15, 0.9)
    this.scene.add(fill)
    const rim = new THREE.DirectionalLight('#ffb070', 1.35)
    rim.position.set(0.5, -0.5, -1.1)
    this.scene.add(rim)

    if (renderer) {
      const env = createStudioEnvironment(renderer)
      if (env) {
        this.textures.push(env)
        this.scene.environment = env
        this.scene.environmentIntensity = 1.5
      }
    }

    this.spec = { ...placeholderSpec }
  }

  /* ============================== 建模 ============================== */

  private track<T extends THREE.Material>(material: T): T {
    this.materials.push(material)
    return material
  }

  private trackGeo<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry)
    return geometry
  }

  private clearModel() {
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.geometries = []
    this.materials = []
    this.parts = null
    this.weapon.clear()
  }

  setWeapon(spec: CfWeaponSpec) {
    this.spec = spec
    this.reloadTimer = 0
    this.mechTimer = 0
    this.flashTimer = 0
    this.recoil = 0
    this.recoilVelocity = 0
    this.meleeTimer = 0
    this.build()
  }

  private build() {
    this.clearModel()
    const spec = this.spec
    const style = spec.model
    const preset = PRESETS[spec.tag] ?? PRESETS.rifle!
    this.preset = preset
    this.root.position.set(preset.x, preset.y, preset.z)
    this.root.rotation.set(0.014, preset.rotY, 0.006)
    this.root.scale.setScalar(preset.scale)

    const metal = this.track(new THREE.MeshStandardMaterial({
      color: style.metal,
      metalness: 0.98,
      roughness: 1,
      roughnessMap: this.shared.rough,
      envMapIntensity: 1.65,
    }))
    const body = this.track(new THREE.MeshStandardMaterial({
      color: style.body,
      metalness: 0.35,
      roughness: 0.82,
      roughnessMap: this.shared.rough,
      envMapIntensity: 0.9,
    }))
    const furniture = this.track(new THREE.MeshStandardMaterial({
      color: style.furniture,
      metalness: 0.06,
      roughness: 0.88,
      roughnessMap: this.shared.rough,
      envMapIntensity: 0.5,
    }))
    if (style.stock === 'wood' || style.blade === 'kukri') furniture.map = this.shared.wood
    const accent = this.track(new THREE.MeshStandardMaterial({
      color: style.accent,
      metalness: 0.55,
      roughness: 0.62,
      roughnessMap: this.shared.rough,
      envMapIntensity: 1.1,
    }))
    const gold = this.track(new THREE.MeshStandardMaterial({
      color: '#d9a441',
      metalness: 1,
      roughness: 0.28,
      envMapIntensity: 1.9,
    }))
    const glove = this.track(new THREE.MeshStandardMaterial({
      color: '#262c31',
      metalness: 0.08,
      roughness: 0.85,
    }))
    const glass = this.track(new THREE.MeshStandardMaterial({
      color: '#0b2f4a',
      metalness: 0.9,
      roughness: 0.12,
      emissive: '#2d86c8',
      emissiveIntensity: 0.5,
      envMapIntensity: 2.2,
    }))
    const bladeSteel = this.track(new THREE.MeshStandardMaterial({
      color: style.metal,
      metalness: 1,
      roughness: 0.22,
      envMapIntensity: 2.1,
    }))
    const skinMaterials: THREE.MeshStandardMaterial[] = []
    if (style.skin === 'flame') {
      body.emissive.set('#ff3c00')
      body.emissiveMap = this.shared.flame
      body.emissiveIntensity = 0.38
      furniture.emissive.set('#ff4a00')
      furniture.emissiveMap = this.shared.flame
      furniture.emissiveIntensity = 0.26
      accent.emissive.set('#ff8a1a')
      accent.emissiveIntensity = 0.75
      skinMaterials.push(body, furniture, accent)
    } else if (style.skin === 'thunder') {
      body.emissive.set('#1e7bff')
      body.emissiveMap = this.shared.thunder
      body.emissiveIntensity = 0.45
      accent.emissive.set('#59c8ff')
      accent.emissiveIntensity = 0.7
      skinMaterials.push(body, accent)
    }

    const mats = { metal, body, furniture, accent, gold, glove, glass, bladeSteel }

    // 建模工具：全部以「握把中心」为原点，枪管朝 -Z
    const group = this.weapon
    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      x: number, y: number, z: number,
      rx = 0, ry = 0, rz = 0,
      parent: THREE.Object3D = group,
    ) => {
      const mesh = new THREE.Mesh(this.trackGeo(geometry), material)
      mesh.position.set(x, y, z)
      mesh.rotation.set(rx, ry, rz)
      parent.add(mesh)
      return mesh
    }
    const box = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent?: THREE.Object3D) =>
      add(new THREE.BoxGeometry(w, h, d), material, x, y, z, rx, ry, rz, parent)
    const rbox = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent?: THREE.Object3D) =>
      add(new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.2), material, x, y, z, rx, ry, rz, parent)
    const cyl = (r1: number, r2: number, length: number, material: THREE.Material, x: number, y: number, z: number, segments = 12, parent?: THREE.Object3D) =>
      add(new THREE.CylinderGeometry(r1, r2, length, segments), material, x, y, z, Math.PI / 2, 0, 0, parent ?? group)

    const addHands = (gripZ: number, foregripZ: number | null, gripY = -0.1, foreY = -0.095) => {
      // 右手从射手一侧（画面前方）包住握把：掌背朝向镜头
      rbox(0.056, 0.08, 0.092, glove, 0.03, gripY, gripZ + 0.02, 0.18, 0, 0.05)
      // 四指绕到握把前方
      box(0.052, 0.018, 0.055, glove, 0.004, gripY + 0.022, gripZ - 0.035, 0.12, 0, 0)
      // 拇指压在握把左侧
      rbox(0.02, 0.052, 0.03, glove, -0.026, gripY + 0.008, gripZ - 0.012, 0, 0, 0.24)
      if (foregripZ !== null) {
        // 左手：托住护木（从上方视角只能看到手指）
        rbox(0.062, 0.072, 0.09, glove, -0.014, foreY, foregripZ, 0.12, 0, -0.16)
        box(0.03, 0.014, 0.066, glove, -0.014, foreY + 0.03, foregripZ - 0.035, 0.12, 0, -0.16)
      }
    }

    const addPistolHands = () => {
      // 双手握持：右手包住握把，左手托住右手
      rbox(0.058, 0.078, 0.088, glove, 0.022, -0.135, -0.15, 0.24, 0, 0.06)
      rbox(0.052, 0.065, 0.075, glove, -0.026, -0.155, -0.13, 0.18, 0, -0.22)
      box(0.036, 0.016, 0.05, glove, 0.004, -0.1, -0.175, 0.2, 0, 0)
    }

    let muzzleZ = -0.95
    let magazine: THREE.Object3D | null = null
    let bolt: THREE.Object3D | null = null
    let pump: THREE.Object3D | null = null
    let barrels: THREE.Object3D | null = null
    let blade: THREE.Object3D | null = null

    if (spec.tag === 'melee') {
      if (style.blade === 'shovel') {
        // 军用铁锹：D 形握把 + 木柄 + 梯形铲面
        box(0.11, 0.022, 0.026, mats.metal, 0, 0.012, -0.03)
        box(0.018, 0.022, 0.12, mats.metal, -0.045, 0.012, -0.09)
        box(0.018, 0.022, 0.12, mats.metal, 0.045, 0.012, -0.09)
        cyl(0.014, 0.016, 0.5, mats.furniture, 0, 0.005, -0.3)
        cyl(0.024, 0.024, 0.05, mats.metal, 0, 0.005, -0.56)
        const shovelShape = new THREE.Shape()
        shovelShape.moveTo(-0.072, 0)
        shovelShape.lineTo(0.072, 0)
        shovelShape.lineTo(0.088, 0.15)
        shovelShape.lineTo(0, 0.22)
        shovelShape.lineTo(-0.088, 0.15)
        shovelShape.closePath()
        const scoop = add(
          new THREE.ExtrudeGeometry(shovelShape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 2, curveSegments: 4 }),
          mats.metal, 0, 0.005, -0.57, -Math.PI / 2 - 0.35, 0, 0,
        )
        box(0.15, 0.014, 0.014, mats.accent, 0, -0.075, -0.75, -0.35, 0, 0)
        addHands(-0.18, -0.42, -0.02)
        blade = scoop
        muzzleZ = -0.84
      } else {
        // 尼泊尔：弯刀刃用 Shape 挤出，刀柄后压
        const shape = new THREE.Shape()
        shape.moveTo(0, 0)
        shape.bezierCurveTo(0.05, 0.045, 0.062, 0.16, 0.042, 0.24)
        shape.quadraticCurveTo(0.028, 0.31, 0.0, 0.35)
        shape.quadraticCurveTo(-0.022, 0.3, -0.024, 0.22)
        shape.quadraticCurveTo(-0.026, 0.09, 0, 0)
        const bladeMesh = add(
          new THREE.ExtrudeGeometry(shape, { depth: 0.007, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.002, bevelSegments: 2, curveSegments: 12 }),
          mats.bladeSteel, 0, -0.01, -0.2, -Math.PI / 2, 0, 0,
        )
        box(0.006, 0.012, 0.26, mats.accent, -0.014, -0.006, -0.34, 0, 0, 0)
        rbox(0.034, 0.045, 0.11, mats.furniture, 0, -0.012, -0.14)
        rbox(0.07, 0.014, 0.028, mats.gold, 0, -0.012, -0.2)
        addHands(-0.13, null, -0.03)
        blade = bladeMesh
        muzzleZ = -0.62
      }
      this.finishParts(muzzleZ, null, null, null, null, null, blade, skinMaterials)
      return
    }

    if (spec.tag === 'pistol') {
      const big = spec.id === 'deagle'
      // 套筒 / 枪管
      rbox(big ? 0.062 : 0.052, big ? 0.072 : 0.058, big ? 0.3 : 0.26, mats.metal, 0, 0.012, -0.32)
      rbox(big ? 0.056 : 0.048, 0.052, big ? 0.2 : 0.16, mats.body, 0, -0.032, -0.26)
      // 握把
      rbox(big ? 0.05 : 0.046, 0.14, big ? 0.075 : 0.068, mats.furniture, 0, -0.115, -0.18, 0.22, 0, 0)
      // 枪管与准星
      if (big) {
        box(0.05, 0.03, 0.12, mats.metal, 0, 0.036, -0.46)
        box(0.012, 0.02, 0.02, mats.accent, 0, 0.052, -0.5)
        box(0.07, 0.008, 0.2, mats.gold, 0, 0.05, -0.32)
      } else {
        cyl(0.02, 0.02, 0.15, mats.metal, 0, 0.012, -0.5)
        box(0.012, 0.016, 0.016, mats.accent, 0, 0.042, -0.43)
      }
      // 扳机护圈
      add(new THREE.TorusGeometry(0.03, 0.006, 6, 14, Math.PI), mats.accent, 0, -0.062, -0.25, 0, Math.PI / 2, 0)
      // 弹匣动画对象（手枪整个握把下沉）
      magazine = new THREE.Group()
      group.add(magazine)
      rbox(0.04, 0.1, 0.05, mats.metal, 0, -0.16, -0.17, 0.22, 0, 0, magazine)
      bolt = add(new THREE.BoxGeometry(0.016, 0.02, 0.05), mats.accent, 0.036, 0.03, -0.28)
      addPistolHands()
      muzzleZ = big ? -0.56 : -0.62
    } else if (spec.tag === 'sniper') {
      // 巴雷特：长枪管 + 巨型制退器 + 大倍镜 + 两脚架
      rbox(0.082, 0.1, 0.46, mats.body, 0, 0, -0.34)
      rbox(0.07, 0.06, 0.24, mats.metal, 0, 0.062, -0.32)
      cyl(0.02, 0.024, 0.72 * style.barrel, mats.metal, 0, 0.015, -0.82)
      box(0.09, 0.09, 0.08, mats.metal, 0, 0.015, -1.19)
      box(0.11, 0.02, 0.02, mats.accent, 0, 0.06, -1.19)
      // 镜
      cyl(0.038, 0.038, 0.34, mats.metal, 0, 0.118, -0.36)
      cyl(0.05, 0.05, 0.05, mats.metal, 0, 0.118, -0.54)
      cyl(0.05, 0.05, 0.05, mats.metal, 0, 0.118, -0.18)
      cyl(0.043, 0.043, 0.012, mats.glass, 0, 0.118, -0.565)
      box(0.02, 0.06, 0.035, mats.body, 0, 0.086, -0.3)
      box(0.02, 0.06, 0.035, mats.body, 0, 0.086, -0.42)
      // 弹匣 / 枪托 / 脚架
      magazine = new THREE.Group()
      group.add(magazine)
      rbox(0.06, 0.16, 0.09, mats.metal, 0, -0.13, -0.3, 0.06, 0, 0, magazine)
      rbox(0.075, 0.11, 0.2, mats.body, 0, -0.028, -0.045, -0.04, 0, 0)
      rbox(0.078, 0.118, 0.024, mats.furniture, 0, -0.03, 0.058, -0.04, 0, 0)
      box(0.012, 0.16, 0.012, mats.metal, -0.055, -0.13, -0.72, -0.35, 0, 0)
      box(0.012, 0.16, 0.012, mats.metal, 0.055, -0.13, -0.72, 0.35, 0, 0)
      bolt = new THREE.Group()
      group.add(bolt)
      cyl(0.009, 0.009, 0.11, mats.metal, 0.07, 0.02, -0.42, 10, bolt)
      add(new THREE.SphereGeometry(0.018, 8, 6), mats.metal, 0.115, 0.02, -0.42, 0, 0, 0, bolt)
      addHands(-0.18, -0.66, -0.09)
      muzzleZ = -1.32
    } else if (spec.tag === 'machinegun') {
      // 加特林：六管旋转 + 弹鼓 + 提把
      rbox(0.11, 0.12, 0.32, mats.body, 0, 0, -0.26)
      barrels = new THREE.Group()
      barrels.position.set(0, 0.015, -0.5)
      group.add(barrels)
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2
        cyl(
          0.011, 0.011, 0.72 * style.barrel, mats.metal,
          Math.cos(angle) * 0.035, Math.sin(angle) * 0.035, -0.3, 8, barrels,
        )
      }
      cyl(0.062, 0.062, 0.05, mats.metal, 0, 0.015, -0.66, 16)
      cyl(0.062, 0.062, 0.05, mats.metal, 0, 0.015, -0.16, 16)
      // 弹鼓
      const drum = cyl(0.09, 0.09, 0.08, mats.body, -0.12, -0.12, -0.16, 20)
      drum.rotation.set(0, 0, Math.PI / 2)
      cyl(0.09, 0.09, 0.012, mats.accent, -0.12, -0.12, -0.2, 20).rotation.set(0, 0, Math.PI / 2)
      // 提把
      rbox(0.04, 0.02, 0.26, mats.metal, 0, 0.09, -0.24)
      box(0.02, 0.06, 0.02, mats.metal, 0, 0.06, -0.36)
      box(0.02, 0.06, 0.02, mats.metal, 0, 0.06, -0.12)
      addHands(-0.16, -0.5, -0.1)
      muzzleZ = -1.24
    } else if (spec.tag === 'smg') {
      // 汤姆逊：木质枪托 + 弹鼓 + 散热片
      rbox(0.07, 0.085, 0.34, mats.body, 0, 0, -0.28)
      cyl(0.016, 0.016, 0.34 * style.barrel, mats.metal, 0, 0.015, -0.63)
      for (let i = 0; i < 3; i += 1) cyl(0.026, 0.026, 0.02, mats.metal, 0, 0.015, -0.5 - i * 0.06, 10)
      rbox(0.072, 0.085, 0.18, mats.furniture, 0, -0.005, -0.035, -0.03, 0, 0)
      rbox(0.074, 0.09, 0.022, mats.furniture, 0, -0.006, 0.06, -0.03, 0, 0)
      box(0.05, 0.06, 0.12, mats.furniture, 0, -0.055, -0.42)
      magazine = new THREE.Group()
      group.add(magazine)
      const drum = cyl(0.095, 0.095, 0.06, mats.metal, 0, -0.13, -0.3, 18, magazine)
      drum.rotation.set(0, 0, Math.PI / 2)
      rbox(0.05, 0.1, 0.06, mats.body, 0, -0.1, -0.16, 0.2, 0, 0)
      addHands(-0.17, -0.4)
      muzzleZ = -0.82
    } else {
      // AK / M4：CF 的两把看家步枪
      const ak = spec.id === 'ak47' || spec.id === 'ak47_hq'
      rbox(0.072, 0.088, 0.36, mats.body, 0, 0, -0.3)
      rbox(0.064, 0.026, 0.26, mats.metal, 0, 0.058, -0.3, -0.02, 0, 0)
      // 护木
      rbox(0.076, 0.078, ak ? 0.24 : 0.26, ak ? mats.furniture : mats.body, 0, -0.004, -0.57)
      if (ak) {
        for (let i = 0; i < 3; i += 1) box(0.08, 0.01, 0.016, mats.body, 0, 0.03, -0.49 - i * 0.055, 0.2, 0, 0)
        cyl(0.014, 0.014, 0.34, mats.metal, 0, 0.046, -0.66)
      } else {
        for (let i = 0; i < 4; i += 1) box(0.082, 0.008, 0.02, mats.metal, 0, 0.034, -0.48 - i * 0.05)
        box(0.03, 0.06, 0.03, mats.metal, 0, 0.08, -0.44)
      }
      cyl(0.013, 0.015, 0.34 * style.barrel, mats.metal, 0, 0.018, -0.82)
      // 准星
      box(0.014, 0.055, 0.022, mats.metal, 0, 0.078, -0.94)
      box(0.02, 0.012, 0.03, mats.accent, 0, 0.058, -0.7)
      box(0.05, 0.016, 0.03, mats.metal, 0, 0.075, -0.16)
      // 制退器
      cyl(0.02, 0.02, 0.08, mats.metal, 0, 0.018, -1.0)
      if (ak) {
        // 弯弹匣：三段拼出弧度
        magazine = new THREE.Group()
        group.add(magazine)
        for (let i = 0; i < 3; i += 1) {
          box(0.05, 0.08, 0.09, mats.body, 0, -0.09 - i * 0.066, -0.35 + i * 0.024, -0.26 - i * 0.14, 0, 0, magazine)
        }
        // 木托 + 握把
        rbox(0.044, 0.066, 0.2, mats.furniture, 0, -0.014, -0.055, -0.04, 0, 0)
        box(0.04, 0.02, 0.12, mats.furniture, 0, 0.025, -0.07, -0.04, 0, 0)
        rbox(0.048, 0.074, 0.022, mats.furniture, 0, -0.014, 0.048, -0.04, 0, 0)
        rbox(0.052, 0.14, 0.065, mats.furniture, 0, -0.1, -0.16, 0.3, 0, 0)
        // 拉机柄
        bolt = add(new THREE.CylinderGeometry(0.005, 0.005, 0.032, 8), mats.metal, 0.038, 0.03, -0.24, 0, 0, Math.PI / 2)
      } else {
        magazine = new THREE.Group()
        group.add(magazine)
        box(0.048, 0.18, 0.085, mats.body, 0, -0.14, -0.34, -0.12, 0, 0, magazine)
        // 缓冲管枪托
        cyl(0.024, 0.024, 0.14, mats.metal, 0, 0.008, -0.005)
        rbox(0.058, 0.088, 0.1, mats.body, 0, -0.005, 0.07, -0.03, 0, 0)
        rbox(0.055, 0.09, 0.022, mats.body, 0, -0.008, 0.125)
        rbox(0.05, 0.13, 0.06, mats.body, 0, -0.1, -0.16, 0.3, 0, 0)
        // 提把 / 导轨
        rbox(0.03, 0.026, 0.3, mats.body, 0, 0.075, -0.3)
        add(new THREE.TorusGeometry(0.03, 0.006, 5, 12, Math.PI), mats.body, 0, 0.085, -0.43)
        bolt = add(new THREE.BoxGeometry(0.012, 0.02, 0.05), mats.metal, 0.042, 0.045, -0.22)
      }
      addHands(-0.17, -0.56)
      muzzleZ = -1.05
    }

    this.finishParts(muzzleZ, magazine, bolt, pump, barrels, null, blade, skinMaterials)
  }

  private finishParts(
    muzzleZ: number,
    magazine: THREE.Object3D | null,
    bolt: THREE.Object3D | null,
    pump: THREE.Object3D | null,
    barrels: THREE.Object3D | null,
    melee: THREE.Object3D | null,
    blade: THREE.Object3D | null,
    skinMaterials: THREE.MeshStandardMaterial[],
  ) {
    const muzzle = new THREE.Object3D()
    muzzle.position.set(0, 0.016, muzzleZ)
    this.weapon.add(muzzle)
    const flashMaterial = this.track(new THREE.SpriteMaterial({
      map: this.shared.glow,
      color: this.spec.model.skin === 'flame' ? '#ff9a3c' : '#ffc46a',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }))
    const flash = new THREE.Sprite(flashMaterial)
    flash.position.z = -0.02
    flash.scale.setScalar(0.36)
    muzzle.add(flash)
    const flashLight = new THREE.PointLight('#ffd08a', 0, 1.6, 2)
    flashLight.position.copy(muzzle.position)
    this.weapon.add(flashLight)
    this.parts = { muzzle, magazine, bolt, pump, barrels, blade: blade ?? melee, flash, flashLight, skinMaterials }
  }

  /* ============================== 动作 ============================== */

  startDraw() {
    this.drawDuration = Math.max(0.16, this.spec.drawTime)
    this.drawTimer = this.drawDuration
  }

  startReload(duration: number) {
    this.reloadDuration = Math.max(0.4, duration)
    this.reloadTimer = this.reloadDuration
  }

  cancelReload() {
    this.reloadTimer = 0
    if (this.parts?.magazine) {
      this.parts.magazine.position.set(0, 0, 0)
      this.parts.magazine.rotation.set(0, 0, 0)
    }
  }

  fire() {
    const tag = this.spec.tag
    const strength = this.spec.kick
    this.recoilVelocity += (tag === 'sniper' ? 3.6 : tag === 'pistol' ? 2.6 : tag === 'machinegun' ? 1.4 : 2.1) * strength
    this.flashTimer = tag === 'machinegun' ? 0.045 : 0.07
    if (this.parts) {
      this.parts.flash.material.rotation = Math.random() * Math.PI
      this.parts.flash.scale.setScalar((tag === 'sniper' ? 0.4 : 0.28) + Math.random() * 0.1)
    }
    // CF 的拉栓 / 泵动 / 套筒行程
    if (tag === 'sniper') {
      this.mechDuration = 0.62
      this.mechTimer = this.mechDuration
    } else if (tag === 'pistol') {
      this.mechDuration = 0.1
      this.mechTimer = this.mechDuration
    } else if (tag === 'machinegun') {
      this.mechDuration = 0
    }
    if (tag !== 'machinegun') this.spawnShell()
  }

  melee() {
    this.meleeDuration = this.spec.model.blade === 'shovel' ? 0.42 : 0.28
    this.meleeTimer = this.meleeDuration
  }

  land(impact: number) {
    this.landKick = Math.min(1.5, Math.abs(impact) * 0.16)
  }

  setSway(x: number, y: number) {
    this.swayX = cfClamp(x, -1, 1)
    this.swayY = cfClamp(y, -1, 1)
  }

  private spawnShell() {
    const material = new THREE.MeshBasicMaterial({ color: '#c8a34a' })
    const geometry = new THREE.CylinderGeometry(0.004, 0.004, 0.013, 6)
    const mesh = new THREE.Mesh(geometry, material)
    // 从抛壳口（枪身坐标系）换算到视图场景坐标，避免弹壳出现在镜头正前方
    this.weapon.updateWorldMatrix(true, false)
    const port = new THREE.Vector3(0.045, 0.025, -0.28)
    this.weapon.localToWorld(port)
    mesh.position.copy(port)
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    this.scene.add(mesh)
    this.shells.push({
      mesh,
      velocity: new THREE.Vector3(0.55 + Math.random() * 0.4, 0.5 + Math.random() * 0.4, 0.22 + Math.random() * 0.2),
      spin: new THREE.Vector3(14, 9, 18),
      life: 0.85,
    })
  }

  /* ============================== 每帧更新 ============================== */

  update(delta: number, state: CfViewModelState) {
    if (this.disposed) return
    this.time += delta
    const spec = this.spec
    const base = this.preset
    const group = this.weapon
    const root = this.root

    // 后坐弹簧：枪身后撞 + 上跳，CF 的枪模回弹比枪口恢复快
    this.recoilVelocity *= Math.exp(-delta * 15)
    this.recoil += this.recoilVelocity * delta * 6
    this.recoil *= Math.exp(-delta * 12)
    this.recoil = cfClamp(this.recoil, -0.5, 2)

    // 行走摆动 / 呼吸
    const speedRatio = cfClamp(state.speed / 7, 0, 1.2)
    const bobAmount = state.moving ? speedRatio : 0.12
    const breath = Math.sin(this.time * 1.55) * 0.0022
    const bobX = Math.cos(this.time * 4.2) * 0.0085 * bobAmount
    const bobY = Math.abs(Math.sin(this.time * 8.6)) * 0.0095 * bobAmount
    this.swayX = cfDamp(this.swayX, 0, 8, delta)
    this.swayY = cfDamp(this.swayY, 0, 8, delta)

    // 换弹：压枪身 → 退弹匣 → 插弹匣 → 拉枪机
    let reloadY = 0
    let reloadRotZ = 0
    let reloadRotX = 0
    let magOffset = 0
    let magRot = 0
    let boltPull = 0
    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - delta)
      const p = 1 - this.reloadTimer / this.reloadDuration
      const sink = p < 0.18 ? p / 0.18 : p < 0.82 ? 1 : (1 - p) / 0.18
      reloadY = -0.15 * sink
      reloadRotZ = 0.62 * sink
      reloadRotX = 0.3 * sink
      if (p > 0.2 && p < 0.5) magOffset = (p - 0.2) / 0.3
      else if (p >= 0.5 && p < 0.68) magOffset = 1
      else if (p >= 0.68 && p < 0.82) magOffset = 1 - (p - 0.68) / 0.14
      magRot = magOffset * 0.45
      if (p > 0.84) boltPull = Math.sin(((p - 0.84) / 0.16) * Math.PI)
    } else if (this.parts?.magazine) {
      this.parts.magazine.position.y = 0
      this.parts.magazine.rotation.z = 0
      this.parts.magazine.rotation.x = 0
    }

    // 切枪：从屏幕下方甩上来
    let drawY = 0
    let drawRotX = 0
    let drawRotZ = 0
    if (this.drawTimer > 0) {
      this.drawTimer = Math.max(0, this.drawTimer - delta)
      const p = 1 - this.drawTimer / this.drawDuration
      const eased = 1 - (1 - p) ** 3
      drawY = -(1 - eased) * 0.36
      drawRotX = (1 - eased) * 0.9
      drawRotZ = (1 - eased) * -0.35
      if (this.parts) {
        this.parts.flash.material.opacity = 0
        this.parts.flashLight.intensity = 0
      }
    }

    // 拉栓 / 泵动 / 套筒
    if (this.mechTimer > 0) {
      this.mechTimer = Math.max(0, this.mechTimer - delta)
      const p = 1 - this.mechTimer / Math.max(0.001, this.mechDuration)
      const travel = Math.sin(Math.min(1, p) * Math.PI)
      if (this.parts?.bolt) this.parts.bolt.position.z = travel * 0.075
      if (this.parts?.pump) this.parts.pump.position.z = -0.62 + travel * 0.1
      if (this.spec.tag === 'pistol' && this.parts?.bolt) this.parts.bolt.position.z = travel * 0.06
    } else {
      if (this.parts?.bolt) this.parts.bolt.position.z = cfDamp(this.parts.bolt.position.z, 0, 16, delta)
      if (this.parts?.pump) this.parts.pump.position.z = cfDamp(this.parts.pump.position.z, -0.62, 16, delta)
    }

    // 近战挥砍 / 劈砍
    let meleeRot = 0
    let meleeZ = 0
    let meleeY = 0
    if (this.meleeTimer > 0) {
      this.meleeTimer = Math.max(0, this.meleeTimer - delta)
      const p = 1 - this.meleeTimer / this.meleeDuration
      const swing = Math.sin(Math.min(1, p) * Math.PI)
      if (this.spec.model.blade === 'shovel') {
        meleeRot = swing * 1.9
        meleeY = -swing * 0.06
      } else {
        meleeRot = swing * 1.5
        meleeZ = -swing * 0.12
      }
    }

    // 加特林枪管旋转
    this.spin = cfDamp(this.spin, state.spin, 9, delta)
    if (this.parts?.barrels) this.parts.barrels.rotation.z += delta * this.spin * 38

    // 落地下沉
    this.landKick = cfDamp(this.landKick, 0, 8, delta)

    root.position.set(
      base.x + bobX + this.swayX * 0.022,
      base.y + breath - bobY + reloadY + drawY - this.landKick * 0.06 - this.recoil * 0.02 + meleeY,
      base.z + this.recoil * 0.09,
    )
    root.rotation.set(
      0.014 + reloadRotX + drawRotX + this.recoil * 0.13 + meleeRot * 0.55 - this.swayY * 0.05,
      base.rotY + this.swayX * 0.03,
      0.006 + reloadRotZ + drawRotZ - this.swayX * 0.07 + meleeRot * 0.45,
    )

    if (this.parts?.magazine) {
      const handle = this.parts.magazine
      if (magOffset > 0 && this.reloadTimer > 0) {
        handle.position.y = -0.24 * magOffset
        handle.position.z = 0.05 * magOffset
        handle.rotation.z = magRot
      } else if (this.reloadTimer <= 0) {
        handle.position.y = cfDamp(handle.position.y, 0, 18, delta)
        handle.position.z = cfDamp(handle.position.z, 0, 18, delta)
        handle.rotation.z = cfDamp(handle.rotation.z, 0, 18, delta)
      }
    }
    if (this.parts?.bolt && boltPull > 0) this.parts.bolt.position.z = boltPull * 0.08

    // 开镜隐藏枪模
    group.visible = !(state.zoomed && spec.zoomFov !== undefined)

    // 枪口火光
    this.flashTimer = Math.max(0, this.flashTimer - delta)
    if (this.parts) {
      const on = this.flashTimer > 0
      this.parts.flash.material.opacity = on ? 0.95 : 0
      this.parts.flash.visible = on
      this.parts.flashLight.intensity = on ? 3.2 : 0
    }

    // 英雄级皮肤动画：火焰向上流动、电弧闪烁
    if (this.parts?.skinMaterials.length) {
      if (spec.model.skin === 'flame') {
        for (const material of this.parts.skinMaterials) {
          if (material.emissiveMap) material.emissiveMap.offset.y = (this.time * 0.22) % 1
          material.emissiveIntensity = 0.34 + Math.sin(this.time * 6.2) * 0.1
        }
      } else if (spec.model.skin === 'thunder') {
        for (const material of this.parts.skinMaterials) {
          if (material.emissiveMap) material.emissiveMap.offset.x = (this.time * 0.5) % 1
          material.emissiveIntensity = 0.38 + Math.abs(Math.sin(this.time * 9.5)) * 0.5
        }
      }
    }

    // 抛壳
    for (let i = this.shells.length - 1; i >= 0; i -= 1) {
      const shell = this.shells[i]!
      shell.life -= delta
      shell.velocity.y -= 7 * delta
      shell.mesh.position.addScaledVector(shell.velocity, delta)
      shell.mesh.rotation.x += shell.spin.x * delta
      shell.mesh.rotation.z += shell.spin.z * delta
      if (shell.life <= 0 || shell.mesh.position.y < -0.7) {
        this.scene.remove(shell.mesh)
        shell.mesh.geometry.dispose()
        ;(shell.mesh.material as THREE.Material).dispose()
        this.shells.splice(i, 1)
      }
    }
  }

  resize(width: number, height: number) {
    this.camera.aspect = Math.max(0.1, width / Math.max(1, height))
    this.camera.updateProjectionMatrix()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.clearModel()
    for (const shell of this.shells) {
      this.scene.remove(shell.mesh)
      shell.mesh.geometry.dispose()
      ;(shell.mesh.material as THREE.Material).dispose()
    }
    this.shells = []
    for (const texture of this.textures) texture.dispose()
    this.textures = []
  }
}

/* ============================== 程序化贴图 ============================== */

function makeRoughnessTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#8a8a8a'
  ctx.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 900; i += 1) {
    const shade = 90 + Math.random() * 70
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 3, 1 + Math.random() * 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(2, 2)
  return texture
}

function makeWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const base = ctx.createLinearGradient(0, 0, 256, 64)
  base.addColorStop(0, '#c9b39a')
  base.addColorStop(0.5, '#b99d80')
  base.addColorStop(1, '#d2bfa8')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 256, 64)
  for (let i = 0; i < 70; i += 1) {
    const y = Math.random() * 64
    ctx.strokeStyle = `rgba(${70 + Math.random() * 40},${42 + Math.random() * 24},20,${0.12 + Math.random() * 0.3})`
    ctx.lineWidth = 0.6 + Math.random() * 1.6
    ctx.beginPath()
    ctx.moveTo(-10, y)
    ctx.bezierCurveTo(70, y + (Math.random() - 0.5) * 8, 180, y + (Math.random() - 0.5) * 8, 266, y + (Math.random() - 0.5) * 5)
    ctx.stroke()
  }
  for (let i = 0; i < 3; i += 1) {
    const x = 30 + Math.random() * 196
    const y = 12 + Math.random() * 40
    ctx.strokeStyle = 'rgba(60,34,16,0.5)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.ellipse(x, y, 5 + Math.random() * 6, 2 + Math.random() * 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

function makeFlameTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  // 底色接近纯黑：只有火舌区域参与自发光，枪身本身仍是深红金属
  ctx.fillStyle = '#080100'
  ctx.fillRect(0, 0, 256, 128)
  for (let i = 0; i < 22; i += 1) {
    const x = Math.random() * 256
    const baseY = 118
    const h = 24 + Math.random() * 74
    const w = 8 + Math.random() * 20
    const flame = ctx.createLinearGradient(0, baseY, 0, baseY - h)
    flame.addColorStop(0, 'rgba(255,90,10,0.0)')
    flame.addColorStop(0.25, `rgba(255,${80 + Math.random() * 50},10,0.75)`)
    flame.addColorStop(0.62, `rgba(255,${150 + Math.random() * 60},40,0.85)`)
    flame.addColorStop(1, 'rgba(255,230,140,0)')
    ctx.fillStyle = flame
    ctx.beginPath()
    ctx.moveTo(x - w / 2, baseY)
    ctx.quadraticCurveTo(x - w * 0.8, baseY - h * 0.55, x + (Math.random() - 0.5) * w, baseY - h)
    ctx.quadraticCurveTo(x + w * 0.7, baseY - h * 0.5, x + w / 2, baseY)
    ctx.closePath()
    ctx.fill()
  }
  // 几缕金色火星，滚动时更像流动的火焰
  for (let i = 0; i < 40; i += 1) {
    ctx.fillStyle = `rgba(255,${180 + Math.random() * 60},80,${0.25 + Math.random() * 0.5})`
    ctx.fillRect(Math.random() * 256, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 3)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function makeThunderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#03070f'
  ctx.fillRect(0, 0, 256, 128)
  for (let i = 0; i < 14; i += 1) {
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(180,240,255,0.9)' : 'rgba(60,150,255,0.7)'
    ctx.lineWidth = 1 + Math.random() * 2
    ctx.beginPath()
    let x = Math.random() * 256
    let y = 0
    ctx.moveTo(x, y)
    while (y < 128) {
      y += 6 + Math.random() * 14
      x += (Math.random() - 0.5) * 26
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.translate(64, 64)
  // 八角星芒 + 白热核心，比单纯的圆盘更像枪口焰
  for (let i = 0; i < 8; i += 1) {
    ctx.save()
    ctx.rotate((i / 8) * Math.PI * 2)
    const spike = ctx.createLinearGradient(0, 0, 0, -62)
    spike.addColorStop(0, 'rgba(255,240,190,0.95)')
    spike.addColorStop(0.55, 'rgba(255,160,60,0.55)')
    spike.addColorStop(1, 'rgba(255,100,20,0)')
    ctx.fillStyle = spike
    ctx.beginPath()
    ctx.moveTo(-5, 0)
    ctx.lineTo(0, -62)
    ctx.lineTo(5, 0)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 40)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.28, 'rgba(255,240,190,0.95)')
  core.addColorStop(0.62, 'rgba(255,160,60,0.55)')
  core.addColorStop(1, 'rgba(255,90,10,0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(0, 0, 40, 0, Math.PI * 2)
  ctx.fill()
  return new THREE.CanvasTexture(canvas)
}

/** 程序化「摄影棚」环境：给枪械金属提供柔和的反射与轮廓光 */
function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 256
    const ctx = canvas.getContext('2d')!
    const sky = ctx.createLinearGradient(0, 0, 0, 256)
    sky.addColorStop(0, '#dcecff')
    sky.addColorStop(0.42, '#8fa8c0')
    sky.addColorStop(0.55, '#4a5158')
    sky.addColorStop(1, '#15181c')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, 512, 256)
    // 顶部柔光箱
    const box = ctx.createRadialGradient(150, 40, 4, 150, 40, 120)
    box.addColorStop(0, 'rgba(255,255,255,1)')
    box.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = box
    ctx.fillRect(0, 0, 512, 160)
    // 侧面冷光
    const cool = ctx.createRadialGradient(420, 90, 6, 420, 90, 110)
    cool.addColorStop(0, 'rgba(120,190,255,0.9)')
    cool.addColorStop(1, 'rgba(120,190,255,0)')
    ctx.fillStyle = cool
    ctx.fillRect(300, 0, 212, 200)
    const texture = new THREE.CanvasTexture(canvas)
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.SRGBColorSpace
    const pmrem = new THREE.PMREMGenerator(renderer)
    const env = pmrem.fromEquirectangular(texture).texture
    pmrem.dispose()
    texture.dispose()
    return env
  } catch {
    return null
  }
}

const placeholderSpec: CfWeaponSpec = {
  id: 'placeholder',
  name: 'AK-47',
  cn: 'AK-47',
  tag: 'rifle',
  slot: 'primary',
  rarity: 'standard',
  damage: 1,
  rpm: 60,
  automatic: false,
  magazine: 1,
  reserve: 0,
  reloadTime: 1,
  drawTime: 0.5,
  spread: 0,
  moveSpread: 0,
  airSpread: 0,
  bloom: 0,
  bloomMax: 0,
  bloomRecovery: 0,
  recoil: { pitch: [0], yaw: [0] },
  kick: 1,
  armorPenetration: 0.5,
  headshotMultiplier: 1,
  legMultiplier: 1,
  falloffStart: 10,
  falloffEnd: 20,
  minDamageRatio: 0.5,
  pellets: 1,
  sound: { body: 100, crack: 1000, noise: 0.1, tail: 0.1, gain: 0.5, flavor: 'ak' },
  model: { body: '#333333', metal: '#666666', furniture: '#5a3a22', accent: '#888888', barrel: 1, mag: 'curved', stock: 'wood', scope: false },
  desc: '',
  selectable: false,
}
