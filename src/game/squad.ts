import * as THREE from 'three'

import type { BattleEffects } from './world/arena/effects'
import type { EnemyEntity } from './world/arena/enemies'

export interface SquadMember {
  name: string
  index: number
  group: THREE.Group
  legL: THREE.Mesh
  legR: THREE.Mesh
  torso: THREE.Group
  killCount: number
  fireTimer: number
  target: THREE.Vector3
  alive: boolean
}

export interface AllySquadOptions {
  scene: THREE.Scene
  /** 索敌：返回当前存活敌人列表 */
  listEnemies: () => readonly EnemyEntity[]
  /** 对敌人造成伤害（由对局引擎记账，避免抢玩家击杀） */
  damageEnemy: (enemyId: number, amount: number) => void
  effects: BattleEffects
}

const NAMES = ['雷子', '老陈', '阿豪', '小叶', '铁蛋', '小北']

/**
 * 友军小队（经典模式 / 三角洲模式）。
 *
 * 只做轻量行为：向最近的目标点推进、对 45m 内最近的敌人点射。
 * 不做寻路网格，靠 ArenaField 的圆形碰撞推离绕开建筑——校园里足够自然。
 */
export class AllySquad {
  private members: SquadMember[] = []
  private options: AllySquadOptions
  private objectives: THREE.Vector3[] = []
  private scene: THREE.Scene
  private rng = Math.random
  private bodyMat: THREE.MeshStandardMaterial
  private armorMat: THREE.MeshStandardMaterial
  private visorMat: THREE.MeshBasicMaterial
  private vestMat: THREE.MeshStandardMaterial

  constructor(options: AllySquadOptions) {
    this.options = options
    this.scene = options.scene
    this.bodyMat = new THREE.MeshStandardMaterial({ color: '#2b3a52', roughness: 0.72, metalness: 0.24 })
    this.armorMat = new THREE.MeshStandardMaterial({ color: '#3f5f8a', roughness: 0.55, metalness: 0.4 })
    this.visorMat = new THREE.MeshBasicMaterial({ color: '#66d4ff' })
    this.vestMat = new THREE.MeshStandardMaterial({ color: '#22303f', roughness: 0.85, metalness: 0.15 })
  }

  get count() {
    return this.members.filter((m) => m.alive).length
  }

  get list() {
    return this.members
  }

  spawn(count: number, center: THREE.Vector3, radius = 11) {
    for (let i = 0; i < count; i += 1) {
      const member = this.buildMember(NAMES[i % NAMES.length]!, i)
      const angle = (i / count) * Math.PI * 2 + 0.6
      member.group.position.set(center.x + Math.cos(angle) * radius, 0, center.z + Math.sin(angle) * radius)
      member.target = center.clone()
      this.scene.add(member.group)
      this.members.push(member)
    }
  }

  setObjectives(points: THREE.Vector3[]) {
    this.objectives = points
    for (const member of this.members) {
      if (this.objectives.length === 0) continue
      const pick = this.objectives[Math.floor(this.rng() * this.objectives.length)]
      if (pick) member.target = pick.clone()
    }
  }

  update(dt: number, playerPos: THREE.Vector3, field: { resolveCollisions: (p: THREE.Vector3, r?: number) => void }) {
    const enemies = this.options.listEnemies()
    for (const member of this.members) {
      if (!member.alive) continue
      const pos = member.group.position

      // 选路：优先最近的可争夺据点；没有据点就跟在玩家侧后方
      if (this.objectives.length > 0) {
        let best = member.target
        let bestDistance = Infinity
        for (const point of this.objectives) {
          const d = pos.distanceTo(point)
          if (d < bestDistance) {
            bestDistance = d
            best = point
          }
        }
        // 靠得太近就换一个点，避免四个人挤成一个球
        if (bestDistance < 7) {
          const alt = this.objectives.find((p) => p.distanceTo(pos) > 16)
          if (alt) best = alt
        }
        member.target = best
      } else {
        const offset = new THREE.Vector3(Math.cos(member.index * 1.7) * 7, 0, Math.sin(member.index * 1.7) * 7)
        member.target = playerPos.clone().add(offset)
      }

      const toTarget = member.target.clone().sub(pos).setY(0)
      const distance = toTarget.length()
      let moving = false
      if (distance > 5.5) {
        const dir = toTarget.normalize()
        pos.addScaledVector(dir, Math.min(6.4 * dt, distance))
        field.resolveCollisions(pos, 0.45)
        member.group.rotation.y = Math.atan2(dir.x, dir.z)
        moving = true
      }

      // 索敌与开火
      let target: EnemyEntity | null = null
      let targetDistance = 46
      for (const enemy of enemies) {
        if (!enemy.alive) continue
        const d = enemy.group.position.distanceTo(pos)
        if (d < targetDistance) {
          targetDistance = d
          target = enemy
        }
      }

      member.fireTimer -= dt
      if (target) {
        const dir = target.group.position.clone().sub(pos).setY(0)
        if (dir.lengthSq() > 1e-4) member.group.rotation.y = Math.atan2(dir.x, dir.z)
        if (member.fireTimer <= 0) {
          member.fireTimer = 0.9 + this.rng() * 0.85
          const from = pos.clone().add(new THREE.Vector3(0, 1.4, 0))
          const to = target.group.position.clone().add(new THREE.Vector3(0, 1.1, 0))
          this.options.effects.tracer(from, to, '#8fd8ff', 0.05)
          this.options.effects.impact(to, new THREE.Vector3(0, 1, 0), '#b8e0ff', false)
          if (this.rng() < 0.5) {
            this.options.damageEnemy(target.id, 6 + this.rng() * 5)
          }
        }
      }

      // 简易步行动画
      const swing = moving ? Math.sin(performance.now() * 0.012 + member.index) * 0.45 : 0
      member.legL.rotation.x = swing
      member.legR.rotation.x = -swing
      member.torso.position.y = 1.0 + (moving ? Math.abs(Math.sin(performance.now() * 0.012)) * 0.04 : 0)
    }
  }

  private buildMember(name: string, index: number): SquadMember {
    const group = new THREE.Group()

    const legs = new THREE.Group()
    const legGeometry = new THREE.BoxGeometry(0.22, 0.78, 0.26)
    const legL = new THREE.Mesh(legGeometry, this.bodyMat)
    legL.position.set(-0.13, 0.39, 0)
    const legR = new THREE.Mesh(legGeometry, this.bodyMat)
    legR.position.set(0.13, 0.39, 0)
    legs.add(legL, legR)
    group.add(legs)

    const torso = new THREE.Group()
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.62, 0.34), this.armorMat)
    chest.position.y = 0.34
    torso.add(chest)

    // 战术背心 + 肩甲，避免远看只是一块蓝板
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.42, 0.4), this.vestMat)
    vest.position.set(0, 0.36, 0.01)
    torso.add(vest)

    const shoulderGeo = new THREE.BoxGeometry(0.18, 0.18, 0.3)
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(shoulderGeo, this.armorMat)
      pad.position.set(side * 0.36, 0.58, 0)
      torso.add(pad)

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.46, 0.16), this.bodyMat)
      arm.position.set(side * 0.36, 0.3, side === -1 ? 0.06 : 0.12)
      arm.rotation.x = side === -1 ? -0.55 : -0.2
      torso.add(arm)
    }

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), this.bodyMat)
    head.position.y = 0.86
    torso.add(head)

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), this.armorMat)
    helmet.position.y = 0.9
    torso.add(helmet)

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.04), this.visorMat)
    visor.position.set(0, 0.88, 0.16)
    torso.add(visor)

    // 步枪：斜挎在身前
    const rifle = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.1, 0.86),
      new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.5, metalness: 0.6 }),
    )
    rifle.position.set(0.24, 0.42, 0.32)
    rifle.rotation.x = 0.16
    torso.add(rifle)

    // 头顶蓝方标识
    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.12),
      new THREE.MeshBasicMaterial({ color: '#4da3ff' }),
    )
    marker.position.y = 1.15
    torso.add(marker)

    torso.position.y = 0.78
    group.add(torso)
    group.position.y = 0
    group.rotation.y = index * 0.7

    return {
      name,
      index,
      group,
      legL,
      legR,
      torso,
      killCount: 0,
      fireTimer: 0.4 + index * 0.2,
      target: new THREE.Vector3(),
      alive: true,
    }
  }

  dispose() {
    for (const member of this.members) {
      member.group.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
      })
      member.group.removeFromParent()
    }
    this.members = []
    this.bodyMat.dispose()
    this.armorMat.dispose()
    this.visorMat.dispose()
    this.vestMat.dispose()
  }
}
