import * as THREE from 'three'

import { cfClamp } from './world/cf'
import type { BattleFieldLike } from './world/arena/enemies'
import type { Random } from './world/arena/math'
import type { CircleCollider, FpsBounds } from './world/three/controls'

export interface ArenaCollider {
  x: number
  z: number
  radius: number
}

/**
 * 把校园的可行走区域包装成 EnemyManager 需要的最小战场接口：
 * 平地（heightAt=0）、建筑圆形碰撞体（阻挡 + 推离）、
 * 在校园边界内且不卡进建筑的刷怪位置。
 */
export class ArenaField implements BattleFieldLike {
  readonly blockers: THREE.Object3D[] = []
  readonly colliders: ArenaCollider[]
  readonly bounds: FpsBounds
  private group = new THREE.Group()
  private playerPos: THREE.Vector3

  constructor(scene: THREE.Scene, colliders: CircleCollider[], bounds: FpsBounds, playerPos: THREE.Vector3) {
    this.colliders = colliders.map((c) => ({ x: c.x, z: c.z, radius: c.r }))
    this.bounds = bounds
    this.playerPos = playerPos
    scene.add(this.group)
    // 每个建筑碰撞体生成一根不可见圆柱：给敌方视线 / 玩家子弹提供射线阻挡
    const material = new THREE.MeshBasicMaterial({ visible: false })
    for (const c of this.colliders) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(c.radius, c.radius, 44, 10), material)
      mesh.position.set(c.x, 22, c.z)
      this.group.add(mesh)
      this.blockers.push(mesh)
    }
  }

  /** 玩家位置沿用 camera.position 的引用，敌人刷新环带始终围绕玩家 */
  get player() {
    return this.playerPos
  }

  isOpen(x: number, z: number, clearance = 1.4): boolean {
    if (x < this.bounds.minX + 8 || x > this.bounds.maxX - 8) return false
    if (z < this.bounds.minZ + 8 || z > this.bounds.maxZ - 8) return false
    for (const c of this.colliders) {
      if (Math.hypot(c.x - x, c.z - z) < c.radius + clearance) return false
    }
    return true
  }

  /** 从期望点向外螺旋搜索一块空地（用于包点 / 据点 / 出生点选址） */
  findOpenArea(desiredX: number, desiredZ: number, clearance = 6, maxStep = 150): THREE.Vector3 {
    const startX = cfClamp(desiredX, this.bounds.minX + 14, this.bounds.maxX - 14)
    const startZ = cfClamp(desiredZ, this.bounds.minZ + 14, this.bounds.maxZ - 14)
    if (this.isOpen(startX, startZ, clearance)) return new THREE.Vector3(startX, 0, startZ)
    for (let radius = 8; radius <= maxStep; radius += 6) {
      const steps = Math.max(8, Math.round(radius / 3))
      for (let i = 0; i < steps; i += 1) {
        const angle = (i / steps) * Math.PI * 2
        const x = startX + Math.cos(angle) * radius
        const z = startZ + Math.sin(angle) * radius
        if (this.isOpen(x, z, clearance)) return new THREE.Vector3(x, 0, z)
      }
    }
    return new THREE.Vector3(startX, 0, startZ)
  }

  spawnPoint(rng: Random, minRadius = 28, maxRadius = 55): THREE.Vector3 {
    // 在玩家周围的环带里刷怪：全图随机会出现 200m 外的怪，追不上来
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const angle = rng.next() * Math.PI * 2
      const distance = minRadius + rng.next() * (maxRadius - minRadius)
      const x = this.playerPos.x + Math.cos(angle) * distance
      const z = this.playerPos.z + Math.sin(angle) * distance
      if (!this.isOpen(x, z, 1.6)) continue
      if (attempt < 40 && !this.hasClearPath(x, z, this.playerPos.x, this.playerPos.z)) continue
      return new THREE.Vector3(x, 0, z)
    }
    const fallback = this.findOpenArea(this.playerPos.x + maxRadius, this.playerPos.z, 2)
    return fallback
  }

  /** 以某个据点为中心刷怪（三角洲模式从敌方据点增援） */
  spawnAround(rng: Random, center: THREE.Vector3, minRadius = 10, maxRadius = 30): THREE.Vector3 {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const angle = rng.next() * Math.PI * 2
      const distance = minRadius + rng.next() * (maxRadius - minRadius)
      const x = center.x + Math.cos(angle) * distance
      const z = center.z + Math.sin(angle) * distance
      if (!this.isOpen(x, z, 2)) continue
      return new THREE.Vector3(x, 0, z)
    }
    return this.findOpenArea(center.x, center.z, 2)
  }

  /** 2D 线段是否不穿过任何建筑碰撞体（出生点通路检测） */
  private hasClearPath(x1: number, z1: number, x2: number, z2: number): boolean {
    const dx = x2 - x1
    const dz = z2 - z1
    const len2 = dx * dx + dz * dz
    if (len2 < 1e-6) return true
    for (const c of this.colliders) {
      const t = cfClamp(((c.x - x1) * dx + (c.z - z1) * dz) / len2, 0, 1)
      const px = x1 + dx * t
      const pz = z1 + dz * t
      if (Math.hypot(c.x - px, c.z - pz) < c.radius + 0.6) return false
    }
    return true
  }

  resolveCollisions(position: THREE.Vector3, radius = 0.42) {
    for (const c of this.colliders) {
      const dx = position.x - c.x
      const dz = position.z - c.z
      const d2 = dx * dx + dz * dz
      const min = c.radius + radius
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2)
        position.x = c.x + (dx / d) * min
        position.z = c.z + (dz / d) * min
      }
    }
    position.x = cfClamp(position.x, this.bounds.minX + 4, this.bounds.maxX - 4)
    position.z = cfClamp(position.z, this.bounds.minZ + 4, this.bounds.maxZ - 4)
  }

  heightAt() {
    return 0
  }

  dispose() {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
    })
    this.group.removeFromParent()
    this.blockers.length = 0
  }
}
