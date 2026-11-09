import * as THREE from 'three'

import { makeSoftDisc } from './battleTextures'
import { createRandom } from './math'

export type PickupKind = 'health' | 'armor' | 'ammo'

interface Tracer {
  line: THREE.Line
  material: THREE.LineBasicMaterial
  geometry: THREE.BufferGeometry
  life: number
}

interface Spark {
  points: THREE.Points
  material: THREE.PointsMaterial
  geometry: THREE.BufferGeometry
  velocities: THREE.Vector3[]
  life: number
  maxLife: number
}

interface Decal {
  mesh: THREE.Mesh
  life: number
}

interface Pickup {
  group: THREE.Group
  kind: PickupKind
  phase: number
}

interface Pulse {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  geometry: THREE.BufferGeometry
  life: number
  maxLife: number
  maxScale: number
}

const PICKUP_COLORS: Record<PickupKind, string> = {
  health: '#5ce07a',
  armor: '#5ab8ff',
  ammo: '#ffc247',
}

/** 世界特效：弹道曳光、命中火花、弹孔贴花、掉落补给 */
export class BattleEffects {
  readonly group = new THREE.Group()
  private scene: THREE.Scene
  private rng = createRandom(90210)
  private tracers: Tracer[] = []
  private sparks: Spark[] = []
  private decals: Decal[] = []
  private pickups: Pickup[] = []
  private pulses: Pulse[] = []
  private textures = new Map<string, THREE.Texture>()
  private disposed = false

  constructor(scene: THREE.Scene) {
    this.scene = scene
    scene.add(this.group)
  }

  private glowTexture(color: string) {
    const cached = this.textures.get(color)
    if (cached) return cached
    const texture = makeSoftDisc(color, 0.8)
    this.textures.set(color, texture)
    return texture
  }

  /** 玩家射击的曳光弹 */
  tracer(from: THREE.Vector3, to: THREE.Vector3, color = '#ffe6a8', life = 0.07) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to])
    const material = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const line = new THREE.Line(geometry, material)
    this.group.add(line)
    this.tracers.push({ line, material, geometry, life })
  }

  /** 地面能量脉冲：技能落地、治疗、护盾破碎等通用反馈 */
  pulse(position: THREE.Vector3, color: string, maxScale = 2.2, life = 0.5) {
    const geometry = new THREE.RingGeometry(0.55, 0.82, 40)
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.copy(position)
    mesh.position.y += 0.06
    this.group.add(mesh)
    this.pulses.push({ mesh, material, geometry, life, maxLife: life, maxScale })
  }

  /** 相位闪现：起点与落点各一圈脉冲，并拉出一条能量残影 */
  blink(from: THREE.Vector3, to: THREE.Vector3, color: string) {
    this.pulse(from, color, 1.8, 0.45)
    this.pulse(to, color, 2.8, 0.55)
    this.tracer(from.clone().setY(from.y + 0.9), to.clone().setY(to.y + 0.9), color, 0.28)
  }

  heal(position: THREE.Vector3, color = '#5ce07a') {
    this.pulse(position, color, 1.9, 0.55)
  }

  /** 敌方能量弹的曳光（更粗更慢） */
  energyBeam(from: THREE.Vector3, to: THREE.Vector3, color: string) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to])
    const material = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const line = new THREE.Line(geometry, material)
    this.group.add(line)
    this.tracers.push({ line, material, geometry, life: 0.09 })
  }

  /** 命中火花 + 弹孔 + 闪光 */
  impact(position: THREE.Vector3, normal: THREE.Vector3, color = '#ffd27a', big = false) {
    const count = big ? 14 : 7
    const positions = new Float32Array(count * 3)
    const velocities: THREE.Vector3[] = []
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = position.x
      positions[i * 3 + 1] = position.y
      positions[i * 3 + 2] = position.z
      const direction = normal.clone().add(new THREE.Vector3(
        this.rng.range(-0.9, 0.9),
        this.rng.range(-0.2, 1.1),
        this.rng.range(-0.9, 0.9),
      )).normalize()
      velocities.push(direction.multiplyScalar(this.rng.range(2.2, big ? 9 : 5.2)))
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      size: big ? 0.16 : 0.1,
      map: this.glowTexture('#ffd27a'),
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    this.group.add(points)
    this.sparks.push({ points, material, geometry, velocities, life: 0.38, maxLife: 0.38 })

    // 弹孔（贴在地表/墙面）
    const decal = new THREE.Mesh(
      new THREE.CircleGeometry(big ? 0.16 : 0.07, 8),
      new THREE.MeshBasicMaterial({
        color: '#0a0a0a', transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false,
      }),
    )
    decal.position.copy(position).addScaledVector(normal, 0.015)
    decal.lookAt(position.clone().add(normal))
    this.group.add(decal)
    this.decals.push({ mesh: decal, life: 9 })
    if (this.decals.length > 48) {
      const oldest = this.decals.shift()
      if (oldest) {
        this.group.remove(oldest.mesh)
        oldest.mesh.geometry.dispose()
        ;(oldest.mesh.material as THREE.Material).dispose()
      }
    }

    // 命中闪光
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture(color), color, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    flash.position.copy(position)
    flash.scale.setScalar(big ? 1.6 : 0.7)
    this.group.add(flash)
    const start = performance.now()
    const animate = () => {
      if (this.disposed) return
      const progress = (performance.now() - start) / 180
      if (progress >= 1) {
        this.group.remove(flash)
        flash.material.dispose()
        return
      }
      flash.material.opacity = 0.9 * (1 - progress)
      flash.scale.setScalar((big ? 1.6 : 0.7) * (1 + progress * 1.4))
      requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }

  /** 敌人被击杀时的能量溃散 */
  killBurst(position: THREE.Vector3, color: string) {
    this.impact(position, new THREE.Vector3(0, 1, 0), color, true)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.6, 32),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(position)
    ring.position.y += 0.2
    this.group.add(ring)
    const start = performance.now()
    const animate = () => {
      if (this.disposed) return
      const progress = (performance.now() - start) / 550
      if (progress >= 1) {
        this.group.remove(ring)
        ring.geometry.dispose()
        ;(ring.material as THREE.Material).dispose()
        return
      }
      ring.scale.setScalar(1 + progress * 5)
      ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - progress)
      requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }

  /** 补给掉落 */
  spawnPickup(position: THREE.Vector3, kind: PickupKind, planetAccent: string) {
    const color = PICKUP_COLORS[kind]
    const group = new THREE.Group()
    group.position.copy(position)
    group.position.y += 0.55

    const core = new THREE.Mesh(
      kind === 'health'
        ? new THREE.BoxGeometry(0.26, 0.26, 0.26)
        : kind === 'armor'
          ? new THREE.OctahedronGeometry(0.22, 0)
          : new THREE.CylinderGeometry(0.14, 0.14, 0.3, 8),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.4 }),
    )
    group.add(core)

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.025, 6, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    ring.rotation.x = Math.PI / 2
    group.add(ring)

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture(color), color, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    glow.scale.setScalar(1.5)
    group.add(glow)

    // 光柱，远处也能看见
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.3, 5, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: kind === 'health' ? color : planetAccent, transparent: true, opacity: 0.2,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    )
    beam.position.y = 2.3
    group.add(beam)

    this.group.add(group)
    this.pickups.push({ group, kind, phase: this.rng.next() * 6 })
  }

  /** 拾取：返回本次吃到的补给类型 */
  collectPickups(player: THREE.Vector3): PickupKind[] {
    const collected: PickupKind[] = []
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i]!
      const dx = pickup.group.position.x - player.x
      const dz = pickup.group.position.z - player.z
      const dy = pickup.group.position.y - player.y
      if (Math.hypot(dx, dz) < 1.25 && Math.abs(dy) < 2.2) {
        collected.push(pickup.kind)
        this.removePickup(i)
      }
    }
    return collected
  }

  get pickupPositions() {
    return this.pickups.map((pickup) => ({
      x: pickup.group.position.x,
      z: pickup.group.position.z,
      kind: 'pickup' as const,
    }))
  }

  private removePickup(index: number) {
    const pickup = this.pickups[index]
    if (!pickup) return
    this.group.remove(pickup.group)
    pickup.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const material = mesh.material as THREE.Material | undefined
      if (material) material.dispose()
    })
    this.pickups.splice(index, 1)
  }

  update(delta: number) {
    if (this.disposed) return

    for (let i = this.tracers.length - 1; i >= 0; i -= 1) {
      const tracer = this.tracers[i]!
      tracer.life -= delta
      tracer.material.opacity = Math.max(0, tracer.life / 0.07) * 0.95
      if (tracer.life <= 0) {
        this.group.remove(tracer.line)
        tracer.geometry.dispose()
        tracer.material.dispose()
        this.tracers.splice(i, 1)
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i]!
      spark.life -= delta
      const position = spark.geometry.attributes.position as THREE.BufferAttribute
      for (let p = 0; p < spark.velocities.length; p += 1) {
        const velocity = spark.velocities[p]!
        velocity.y -= 9.8 * delta
        position.setXYZ(
          p,
          position.getX(p) + velocity.x * delta,
          position.getY(p) + velocity.y * delta,
          position.getZ(p) + velocity.z * delta,
        )
      }
      position.needsUpdate = true
      spark.material.opacity = Math.max(0, spark.life / spark.maxLife)
      if (spark.life <= 0) {
        this.group.remove(spark.points)
        spark.geometry.dispose()
        spark.material.dispose()
        this.sparks.splice(i, 1)
      }
    }

    for (let i = this.decals.length - 1; i >= 0; i -= 1) {
      const decal = this.decals[i]!
      decal.life -= delta
      if (decal.life < 1) (decal.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, decal.life * 0.75)
      if (decal.life <= 0) {
        this.group.remove(decal.mesh)
        decal.mesh.geometry.dispose()
        ;(decal.mesh.material as THREE.Material).dispose()
        this.decals.splice(i, 1)
      }
    }

    for (const pickup of this.pickups) {
      pickup.phase += delta * 2
      pickup.group.position.y += Math.sin(pickup.phase) * delta * 0.12
      pickup.group.rotation.y += delta * 1.6
    }

    for (let i = this.pulses.length - 1; i >= 0; i -= 1) {
      const pulse = this.pulses[i]!
      pulse.life -= delta
      const progress = 1 - Math.max(0, pulse.life) / pulse.maxLife
      pulse.mesh.scale.setScalar(0.2 + progress * pulse.maxScale)
      pulse.material.opacity = Math.max(0, 1 - progress) * 0.9
      if (pulse.life <= 0) {
        this.group.remove(pulse.mesh)
        pulse.geometry.dispose()
        pulse.material.dispose()
        this.pulses.splice(i, 1)
      }
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const tracer of this.tracers) {
      tracer.geometry.dispose()
      tracer.material.dispose()
    }
    for (const spark of this.sparks) {
      spark.geometry.dispose()
      spark.material.dispose()
    }
    for (const decal of this.decals) {
      decal.mesh.geometry.dispose()
      ;(decal.mesh.material as THREE.Material).dispose()
    }
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) this.removePickup(i)
    for (const pulse of this.pulses) {
      pulse.geometry.dispose()
      pulse.material.dispose()
    }
    for (const texture of this.textures.values()) texture.dispose()
    this.textures.clear()
    this.tracers = []
    this.sparks = []
    this.decals = []
    this.pulses = []
    this.scene.remove(this.group)
  }
}
