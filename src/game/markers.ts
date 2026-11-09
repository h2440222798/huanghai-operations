import * as THREE from 'three'

export type Owner = 'ally' | 'enemy' | 'neutral'

export const OWNER_COLOR: Record<Owner, string> = {
  ally: '#4da3ff',
  enemy: '#ff5a4d',
  neutral: '#e6e6e6',
}

export const OWNER_LABEL: Record<Owner, string> = {
  ally: '蓝方控制',
  enemy: '红方控制',
  neutral: '中立',
}

/** 用 canvas 画中文标签贴图（THREE.Sprite 不支持文字） */
export function makeLabelTexture(text: string, color = '#ffffff', sub = ''): THREE.CanvasTexture {
  const width = 512
  const height = sub ? 200 : 140
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, width, height)
    const radius = 20
    ctx.fillStyle = 'rgba(6, 10, 18, 0.74)'
    ctx.strokeStyle = color
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(radius, 2)
    ctx.arcTo(width - 2, 2, width - 2, height - 2, radius)
    ctx.arcTo(width - 2, height - 2, 2, height - 2, radius)
    ctx.arcTo(2, height - 2, 2, 2, radius)
    ctx.arcTo(2, 2, width - 2, 2, radius)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.font = 'bold 64px "Microsoft YaHei", "PingFang SC", sans-serif'
    ctx.fillText(text, width / 2, sub ? 62 : height / 2 + 2)
    if (sub) {
      ctx.fillStyle = 'rgba(232, 240, 255, 0.82)'
      ctx.font = '500 40px "Microsoft YaHei", "PingFang SC", sans-serif'
      ctx.fillText(sub, width / 2, 140)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

export function makeLabelSprite(text: string, color = '#ffffff', sub = ''): THREE.Sprite {
  const texture = makeLabelTexture(text, color, sub)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  const height = sub ? 2.6 : 2.1
  sprite.scale.set(height * 2.3, height, 1)
  sprite.renderOrder = 20
  return sprite
}

export interface AreaMarkerOptions {
  position: THREE.Vector3
  radius: number
  label: string
  sub?: string
  owner?: Owner
}

/**
 * 地面区域标记：外圈 + 半透明光柱 + 悬浮中文标签 + 内圈进度盘。
 * 用于爆破点 A/B 与三角洲模式的据点 A/B/C。
 */
export class AreaMarker {
  readonly group = new THREE.Group()
  readonly position: THREE.Vector3
  readonly radius: number
  private ringMat: THREE.MeshBasicMaterial
  private beamMat: THREE.MeshBasicMaterial
  private discMat: THREE.MeshBasicMaterial
  private disc: THREE.Mesh
  private label: THREE.Sprite
  private owner: Owner
  private progress = 0

  constructor(scene: THREE.Scene, options: AreaMarkerOptions) {
    this.position = options.position.clone()
    this.radius = options.radius
    this.owner = options.owner ?? 'neutral'

    this.ringMat = new THREE.MeshBasicMaterial({ color: OWNER_COLOR[this.owner], transparent: true, opacity: 0.9 })
    const ring = new THREE.Mesh(new THREE.RingGeometry(this.radius - 0.5, this.radius, 72), this.ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.08
    ring.renderOrder = 2
    this.group.add(ring)

    this.discMat = new THREE.MeshBasicMaterial({
      color: OWNER_COLOR[this.owner],
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
    })
    const discGeometry = new THREE.CircleGeometry(this.radius - 0.6, 64)
    discGeometry.rotateX(-Math.PI / 2)
    this.disc = new THREE.Mesh(discGeometry, this.discMat)
    this.disc.position.y = 0.05
    this.disc.renderOrder = 1
    this.group.add(this.disc)

    this.beamMat = new THREE.MeshBasicMaterial({
      color: OWNER_COLOR[this.owner],
      transparent: true,
      opacity: 0.07,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(this.radius * 0.92, this.radius * 0.98, 26, 40, 1, true),
      this.beamMat,
    )
    beam.position.y = 13
    this.group.add(beam)

    this.label = makeLabelSprite(options.label, OWNER_COLOR[this.owner], options.sub ?? '')
    this.label.position.set(0, 7.4, 0)
    this.group.add(this.label)

    this.group.position.set(this.position.x, 0, this.position.z)
    scene.add(this.group)
  }

  setOwner(owner: Owner) {
    if (this.owner === owner) return
    this.owner = owner
    const color = OWNER_COLOR[owner]
    this.ringMat.color.set(color)
    this.beamMat.color.set(color)
    this.discMat.color.set(color)
    const material = this.label.material as THREE.SpriteMaterial
    const oldMap = material.map
    material.map = makeLabelTexture(this.labelText ?? '', color, this.labelSub ?? '')
    material.needsUpdate = true
    oldMap?.dispose()
  }

  private labelText = ''
  private labelSub = ''

  /** 玩家贴近时隐藏悬浮牌，避免大牌子糊在镜头上 */
  setLabelVisible(visible: boolean) {
    this.label.visible = visible
  }

  setLabel(text: string, sub = '') {
    if (this.labelText === text && this.labelSub === sub) return
    this.labelText = text
    this.labelSub = sub
    const material = this.label.material as THREE.SpriteMaterial
    const oldMap = material.map
    material.map = makeLabelTexture(text, OWNER_COLOR[this.owner], sub)
    material.needsUpdate = true
    oldMap?.dispose()
  }

  /** 0~1：据点争夺进度 */
  setProgress(value: number) {
    const p = Math.min(1, Math.max(0, value))
    this.progress = p
    this.disc.scale.setScalar(0.35 + p * 0.65)
    this.discMat.opacity = 0.08 + p * 0.16
  }

  update(dt: number, time: number) {
    const pulse = 0.72 + Math.sin(time * 2.4 + this.position.x * 0.1) * 0.12
    this.ringMat.opacity = pulse
    const material = this.label.material as THREE.SpriteMaterial
    material.opacity = 0.85 + Math.sin(time * 3) * 0.1
    this.label.position.y = 7.4 + Math.sin(time * 1.6 + this.position.z * 0.08) * 0.25
    void dt
    void this.progress
  }

  dispose() {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material?.dispose()
    })
    this.group.removeFromParent()
  }
}

/** C4 实体：小箱子 + 闪烁红灯 */
export class BombProp {
  readonly group = new THREE.Group()
  private light: THREE.PointLight
  private ledMat: THREE.MeshBasicMaterial

  constructor(scene: THREE.Scene) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.34, 0.42),
      new THREE.MeshStandardMaterial({ color: '#2d2f36', roughness: 0.6, metalness: 0.35 }),
    )
    body.position.y = 0.2
    this.group.add(body)

    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.16, 0.03),
      new THREE.MeshStandardMaterial({ color: '#c9a54a', emissive: '#4a3410', emissiveIntensity: 1.2 }),
    )
    panel.position.set(0, 0.24, 0.22)
    this.group.add(panel)

    this.ledMat = new THREE.MeshBasicMaterial({ color: '#ff3b30' })
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), this.ledMat)
    led.position.set(0.14, 0.3, 0.23)
    this.group.add(led)

    this.light = new THREE.PointLight('#ff3b30', 4, 9, 2)
    this.light.position.set(0, 0.7, 0)
    this.group.add(this.light)

    this.group.visible = false
    scene.add(this.group)
  }

  place(position: THREE.Vector3) {
    this.group.position.set(position.x, 0, position.z)
    this.group.visible = true
  }

  update(time: number, armed: boolean) {
    if (!this.group.visible) return
    const blink = armed ? (Math.sin(time * 9) + 1) / 2 : 0.25
    this.ledMat.color.setRGB(1, 0.1 + blink * 0.35, 0.08)
    this.light.intensity = 1.4 + blink * 7
  }

  hide() {
    this.group.visible = false
  }

  dispose() {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | undefined
      material?.dispose()
    })
    this.group.removeFromParent()
  }
}

/** 爆炸视觉：地面冲击环 + 球形闪光 */
export class BlastWave {
  readonly group = new THREE.Group()
  private ring: THREE.Mesh
  private ringMat: THREE.MeshBasicMaterial
  private sphere: THREE.Mesh
  private sphereMat: THREE.MeshBasicMaterial
  private life = 0
  private maxLife = 1.1

  constructor(scene: THREE.Scene) {
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#ffb066', transparent: true, opacity: 0 })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.4, 64), this.ringMat)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.2
    this.group.add(this.ring)

    this.sphereMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0 })
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 20), this.sphereMat)
    this.group.add(this.sphere)

    this.group.visible = false
    scene.add(this.group)
  }

  fire(position: THREE.Vector3) {
    this.group.position.copy(position).setY(0)
    this.life = this.maxLife
    this.group.visible = true
  }

  update(dt: number) {
    if (this.life <= 0) return
    this.life -= dt
    const t = 1 - Math.max(0, this.life) / this.maxLife
    this.ring.scale.setScalar(1 + t * 26)
    this.ringMat.opacity = (1 - t) * 0.9
    this.sphere.scale.setScalar(1 + t * 9)
    this.sphereMat.opacity = (1 - t) * 0.55
    if (this.life <= 0) this.group.visible = false
  }

  dispose() {
    this.ring.geometry.dispose()
    this.sphere.geometry.dispose()
    this.ringMat.dispose()
    this.sphereMat.dispose()
    this.group.removeFromParent()
  }
}
