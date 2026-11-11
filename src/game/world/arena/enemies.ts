import * as THREE from 'three'

import { makeBarTexture, makeSoftDisc } from './battleTextures'
import { createSaltlineCreature, preloadSaltlineCreatures, type CreatureInstance } from './saltlineCreatures'
import { surfaceMaps } from './surfaceTextures'
import { clamp, createRandom, type Random } from './math'
import { ENEMY_SPECS } from './planets'
import type { EnemyKindId, EnemySpec, HitPart } from './types'

export interface EnemyFireRequest {
  origin: THREE.Vector3
  direction: THREE.Vector3
  spec: EnemySpec
}

export interface EnemyHooks {
  onFire?: (request: EnemyFireRequest) => void
  onMelee?: (damage: number, enemy: EnemyEntity) => void
  onKilled?: (enemy: EnemyEntity, headshot: boolean) => void
}

/**
 * EnemyManager 依赖的最小战场接口（结构化类型）：
 * 星球战场（Battlefield）与校园守卫战（CampusDefenseField）都满足该形状，
 * 使敌军 AI / 命中盒 / 死亡动画可跨场景复用。
 */
export interface BattleFieldLike {
  /** 阻挡视线与子弹的碰撞体（低模） */
  readonly blockers: THREE.Object3D[]
  /** 圆柱碰撞体列表（敌人绕障转向用） */
  readonly colliders: { x: number; z: number; radius: number }[]
  spawnPoint(rng: Random, minRadius?: number, maxRadius?: number): THREE.Vector3
  resolveCollisions(position: THREE.Vector3, radius?: number): void
  heightAt(x: number, z: number): number
}

export interface EnemyEntity {
  id: number
  spec: EnemySpec
  group: THREE.Group
  hp: number
  maxHp: number
  alive: boolean
  active: boolean
  spawnTimer: number
  dying: number
  attackTimer: number
  strafeDirection: number
  strafeTimer: number
  bobPhase: number
  attackAnimation: number
  hitFlash: number
  gunTip: THREE.Object3D | null
  arm: THREE.Object3D | null
  hitMeshes: THREE.Mesh[]
  healthBar: { background: THREE.Sprite; fill: THREE.Sprite; width: number } | null
  flash: THREE.Sprite | null
  losTimer: number
  hasLineOfSight: boolean
  bodyHeight: number
  /** saltline 烘焙模型的骨骼动画实例（程序化模型为 null） */
  creature?: CreatureInstance | null
}

interface Materials {
  armor: THREE.MeshStandardMaterial
  body: THREE.MeshStandardMaterial
  visor: THREE.MeshStandardMaterial
  metal: THREE.MeshStandardMaterial
  glow: THREE.MeshBasicMaterial
}

interface EnemyModel {
  group: THREE.Group
  hitMeshes: THREE.Mesh[]
  gunTip: THREE.Object3D | null
  arm: THREE.Object3D | null
  bodyHeight: number
  flash?: THREE.Sprite
  creature?: CreatureInstance | null
}

const FIRE_RANGE: Record<EnemyKindId, number> = { grunt: 26, skirmisher: 22, brute: 2.6, drone: 24 }
const PREFERRED_RANGE: Record<EnemyKindId, number> = { grunt: 14, skirmisher: 9, brute: 0, drone: 13 }

/**
 * 敌军管理器：建模、AI、开火、受击与死亡动画。
 * 命中判定使用独立命中盒网格，头部 ×4 伤害由 game 层计算。
 */
export class EnemyManager {
  private scene: THREE.Scene
  private battlefield: BattleFieldLike
  private hooks: EnemyHooks
  private enemies: EnemyEntity[] = []
  private rng: Random
  private materials = new Map<EnemyKindId, Materials>()
  private healthTexture: THREE.CanvasTexture
  private flashTexture: THREE.CanvasTexture
  private nextId = 1
  private raycaster = new THREE.Raycaster()
  private disposed = false

  constructor(scene: THREE.Scene, battlefield: BattleFieldLike, hooks: EnemyHooks = {}) {
    this.scene = scene
    this.battlefield = battlefield
    this.hooks = hooks
    this.rng = createRandom(20261019)
    this.healthTexture = makeBarTexture()
    this.flashTexture = makeSoftDisc('#ffb060', 0.4)
    for (const kind of Object.keys(ENEMY_SPECS) as EnemyKindId[]) this.materials.set(kind, this.createMaterials(ENEMY_SPECS[kind]))
    // 后台加载烘焙好的机械犬 / 侦察机，加载完之前先走程序化模型
    void preloadSaltlineCreatures()
  }

  private createMaterials(spec: EnemySpec): Materials {
    const armorMaps = surfaceMaps('armor')
    const bodyMaps = surfaceMaps('polymer')
    const metalMaps = surfaceMaps('gunmetal')
    return {
      armor: new THREE.MeshStandardMaterial({
        color: spec.armorColor,
        map: armorMaps.map,
        normalMap: armorMaps.normalMap,
        normalScale: new THREE.Vector2(armorMaps.normalScale * 0.65, armorMaps.normalScale * 0.65),
        roughnessMap: armorMaps.roughnessMap,
        roughness: 1,
        metalness: 0.6,
        envMapIntensity: 1.05,
      }),
      body: new THREE.MeshStandardMaterial({
        color: spec.color,
        map: bodyMaps.map,
        normalMap: bodyMaps.normalMap,
        normalScale: new THREE.Vector2(bodyMaps.normalScale * 0.55, bodyMaps.normalScale * 0.55),
        roughnessMap: bodyMaps.roughnessMap,
        roughness: 1,
        metalness: 0.22,
        envMapIntensity: 0.75,
      }),
      visor: new THREE.MeshStandardMaterial({
        color: '#050505',
        emissive: new THREE.Color(spec.visor),
        emissiveIntensity: 2.4,
        roughness: 0.05,
        metalness: 0.4,
        envMapIntensity: 1.6,
      }),
      metal: new THREE.MeshStandardMaterial({
        color: '#1d2329',
        map: metalMaps.map,
        normalMap: metalMaps.normalMap,
        roughnessMap: metalMaps.roughnessMap,
        roughness: 1,
        metalness: 0.85,
        envMapIntensity: 1.25,
      }),
      glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.visor) }),
    }
  }

  /* ---------------- 建模 ---------------- */

  private makeHealthBar(spec: EnemySpec) {
    const background = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.healthTexture, color: '#0b0f14', transparent: true, opacity: 0.75,
      depthTest: false, depthWrite: false,
    }))
    const fill = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.healthTexture, color: '#54e07a', transparent: true, opacity: 0.95,
      depthTest: false, depthWrite: false,
    }))
    const width = clamp(1.05 * Math.max(1, spec.scale), 0.9, 1.6)
    background.scale.set(width, 0.12, 1)
    fill.scale.set(width * 0.94, 0.075, 1)
    background.renderOrder = 20
    fill.renderOrder = 21
    background.visible = false
    fill.visible = false
    return { background, fill, width }
  }

  private buildHitbox(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: THREE.Vector3,
    part: HitPart,
    enemyId: number,
  ) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position)
    mesh.userData.enemyId = enemyId
    mesh.userData.part = part
    mesh.castShadow = true
    return mesh
  }

  private buildEnemyModel(kind: EnemyKindId, enemyId: number, spec: EnemySpec): EnemyModel {
    const materials = this.materials.get(kind)!
    const group = new THREE.Group()
    const hitMeshes: THREE.Mesh[] = []
    let gunTip: THREE.Object3D | null = null
    let arm: THREE.Object3D | null = null
    let bodyHeight = spec.height

    const add = (mesh: THREE.Mesh, parent: THREE.Object3D = group) => {
      mesh.castShadow = true
      parent.add(mesh)
      return mesh
    }
    const box = (w: number, h: number, d: number, material: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)

    // ── saltline 烘焙模型优先：机械犬接管近战重甲单位，四旋翼接管空中单位 ──
    // 模型未加载完时回落到下面的程序化建模，玩法不受影响
    const creatureKind = kind === 'brute' ? 'hound' : kind === 'drone' ? 'gull' : null
    if (creatureKind) {
      const creature = createSaltlineCreature(creatureKind, {
        height: spec.height,
        radius: spec.bodyRadius,
        hoverCenterY: spec.flying ? 2.15 : undefined,
      })
      if (creature) {
        group.add(creature.root)

        // 透明命中球：参与射线检测但不可见
        const hitMaterial = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
        const bodyHit = this.buildHitbox(
          new THREE.SphereGeometry(Math.max(spec.bodyRadius, creature.radius) * 1.05, 12, 10),
          hitMaterial,
          new THREE.Vector3(0, spec.height * 0.52, 0),
          'body',
          enemyId,
        )
        bodyHit.castShadow = false
        group.add(bodyHit)
        hitMeshes.push(bodyHit)

        const headHit = this.buildHitbox(
          new THREE.SphereGeometry(spec.headRadius * 1.2, 10, 8),
          hitMaterial,
          new THREE.Vector3(0, spec.height * (spec.flying ? 0.5 : 0.88), spec.bodyRadius * 0.95),
          'head',
          enemyId,
        )
        headHit.castShadow = false
        group.add(headHit)
        hitMeshes.push(headHit)

        gunTip = new THREE.Object3D()
        gunTip.position.set(0, spec.height * (spec.flying ? 0.45 : 0.62), spec.bodyRadius * 1.5)
        group.add(gunTip)

        return { group, hitMeshes, gunTip, arm, bodyHeight: spec.height, creature }
      }
    }

    if (kind === 'drone') {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), materials.armor)
      core.position.y = 2.15
      add(core)
      const coreHit = this.buildHitbox(new THREE.SphereGeometry(0.46, 12, 10), materials.body, new THREE.Vector3(0, 2.15, 0), 'body', enemyId)
      group.add(coreHit)
      hitMeshes.push(coreHit)

      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), materials.visor)
      eye.position.set(0, 2.2, 0.34)
      group.add(eye)
      const eyeHit = this.buildHitbox(new THREE.SphereGeometry(0.22, 10, 8), materials.visor, new THREE.Vector3(0, 2.2, 0.34), 'head', enemyId)
      group.add(eyeHit)
      hitMeshes.push(eyeHit)
      const droneHalo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.flashTexture, color: spec.visor, transparent: true, opacity: 0.7,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      droneHalo.position.set(0, 2.2, 0.36)
      droneHalo.scale.setScalar(1.1)
      group.add(droneHalo)

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.06, 6, 24), materials.glow)
      ring.rotation.x = Math.PI / 2
      ring.position.y = 2.05
      group.add(ring)
      ring.name = 'drone-ring'

      for (let i = 0; i < 3; i += 1) {
        const angle = (i / 3) * Math.PI * 2
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 4), materials.metal)
        fin.position.set(Math.cos(angle) * 0.62, 2.1, Math.sin(angle) * 0.62)
        fin.rotation.z = Math.PI / 2
        fin.rotation.y = -angle
        group.add(fin)
      }
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.6, 6), materials.metal)
      barrel.rotation.x = Math.PI / 2
      barrel.position.set(0, 2.05, 0.6)
      group.add(barrel)
      gunTip = new THREE.Object3D()
      gunTip.position.set(0, 2.05, 0.95)
      group.add(gunTip)
      bodyHeight = 2.6
      return { group, hitMeshes, gunTip, arm, bodyHeight }
    }

    const isBrute = kind === 'brute'
    const torsoWidth = isBrute ? 0.98 : 0.62
    const torsoHeight = isBrute ? 1.05 : 0.72
    const torsoY = isBrute ? 1.45 : 1.1
    const headY = isBrute ? 2.18 : 1.63
    const headRadius = isBrute ? 0.27 : 0.21

    // 腿
    for (const side of [-1, 1]) {
      const leg = box(isBrute ? 0.34 : 0.22, isBrute ? 0.95 : 0.74, isBrute ? 0.4 : 0.26, materials.body)
      leg.position.set(side * (isBrute ? 0.26 : 0.16), isBrute ? 0.48 : 0.37, 0)
      add(leg)
      const knee = box(isBrute ? 0.38 : 0.25, isBrute ? 0.18 : 0.13, isBrute ? 0.44 : 0.3, materials.armor)
      knee.position.set(side * (isBrute ? 0.26 : 0.16), isBrute ? 0.82 : 0.6, 0.02)
      add(knee)
      const foot = box(isBrute ? 0.4 : 0.26, isBrute ? 0.15 : 0.11, isBrute ? 0.56 : 0.36, materials.metal)
      foot.position.set(side * (isBrute ? 0.26 : 0.16), isBrute ? 0.08 : 0.055, isBrute ? 0.1 : 0.07)
      add(foot)
      const legHit = this.buildHitbox(
        new THREE.BoxGeometry(isBrute ? 0.4 : 0.28, isBrute ? 0.95 : 0.74, isBrute ? 0.46 : 0.32),
        materials.body,
        new THREE.Vector3(side * (isBrute ? 0.26 : 0.16), isBrute ? 0.48 : 0.37, 0),
        'leg',
        enemyId,
      )
      group.add(legHit)
      hitMeshes.push(legHit)
    }

    // 躯干与胸甲
    const torso = box(torsoWidth, torsoHeight, isBrute ? 0.56 : 0.4, materials.body)
    torso.position.y = torsoY
    add(torso)
    const chest = box(torsoWidth * 1.12, torsoHeight * 0.55, isBrute ? 0.64 : 0.46, materials.armor)
    chest.position.y = torsoY + 0.06
    add(chest)
    // 腰部束带，打断大块平面的呆板感
    const waist = box(torsoWidth * 0.82, isBrute ? 0.2 : 0.16, isBrute ? 0.54 : 0.38, materials.metal)
    waist.position.y = torsoY - torsoHeight * 0.54
    add(waist)
    // 胸口装甲条
    for (let band = 0; band < 2; band += 1) {
      const strip = box(torsoWidth * 0.92, 0.06, isBrute ? 0.68 : 0.5, materials.armor)
      strip.position.set(0, torsoY + torsoHeight * 0.18 + band * 0.16, 0)
      add(strip)
    }

    // 肩甲
    for (const side of [-1, 1]) {
      const pad = box(isBrute ? 0.42 : 0.26, isBrute ? 0.34 : 0.2, isBrute ? 0.52 : 0.36, materials.armor)
      pad.position.set(side * (torsoWidth / 2 + (isBrute ? 0.14 : 0.1)), torsoY + torsoHeight * 0.34, 0)
      pad.rotation.z = side * 0.18
      add(pad)
      const strip = box(isBrute ? 0.06 : 0.045, isBrute ? 0.26 : 0.18, isBrute ? 0.14 : 0.1, materials.visor)
      strip.position.set(side * (torsoWidth / 2 + (isBrute ? 0.12 : 0.09)), torsoY + torsoHeight * 0.3, isBrute ? 0.3 : 0.22)
      group.add(strip)
    }

    // 颈部
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.16, 8), materials.metal)
    neck.position.y = headY - headRadius - 0.04
    group.add(neck)

    // 头 + 发光面罩
    const head = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 14, 10), materials.body)
    head.position.y = headY
    head.scale.set(1, isBrute ? 0.85 : 1, 0.95)
    add(head)
    const headHit = this.buildHitbox(
      new THREE.SphereGeometry(headRadius * 1.18, 12, 10),
      materials.body,
      new THREE.Vector3(0, headY, 0),
      'head',
      enemyId,
    )
    group.add(headHit)
    hitMeshes.push(headHit)

    const visor = box(isBrute ? 0.34 : 0.24, isBrute ? 0.1 : 0.07, 0.08, materials.visor)
    visor.position.set(0, headY + 0.01, headRadius * 0.94)
    group.add(visor)
    // 面罩光晕：黑暗中也能一眼识别敌人
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.flashTexture, color: spec.visor, transparent: true,
      opacity: isBrute ? 0.55 : 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    halo.position.set(0, headY, headRadius * 0.7)
    halo.scale.setScalar(isBrute ? 1.5 : 1.05)
    group.add(halo)
    // 胸口能量核心
    const core = new THREE.Mesh(new THREE.SphereGeometry(isBrute ? 0.11 : 0.07, 10, 8), materials.visor)
    core.position.set(0, torsoY + 0.05, isBrute ? 0.36 : 0.25)
    group.add(core)
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(isBrute ? 0.19 : 0.13, 0.022, 5, 16), materials.metal)
    coreRing.position.copy(core.position)
    group.add(coreRing)

    // 躯干命中盒
    const torsoHit = this.buildHitbox(
      new THREE.BoxGeometry(torsoWidth * 1.16, torsoHeight * 1.05, isBrute ? 0.7 : 0.52),
      materials.armor,
      new THREE.Vector3(0, torsoY, 0),
      'body',
      enemyId,
    )
    group.add(torsoHit)
    hitMeshes.push(torsoHit)

    const armY = torsoY + torsoHeight * 0.12
    if (isBrute) {
      // 重装：粗壮双臂与金属拳套
      for (const side of [-1, 1]) {
        const armGroup = new THREE.Group()
        armGroup.position.set(side * (torsoWidth / 2 + 0.18), armY + 0.04, 0.02)
        armGroup.rotation.z = side * -0.08
        group.add(armGroup)
        const upper = box(0.3, 0.62, 0.34, materials.armor)
        upper.position.y = -0.18
        armGroup.add(upper)
        const forearm = box(0.36, 0.5, 0.4, materials.body)
        forearm.position.set(0, -0.64, 0.08)
        armGroup.add(forearm)
        const fist = box(0.42, 0.28, 0.46, materials.metal)
        fist.position.set(0, -0.9, 0.16)
        armGroup.add(fist)
        for (let spike = 0; spike < 3; spike += 1) {
          const claw = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), materials.metal)
          claw.position.set((spike - 1) * 0.13, -0.86, 0.4)
          claw.rotation.x = Math.PI / 2
          armGroup.add(claw)
        }
        if (side === 1) arm = armGroup
      }
      gunTip = null
      bodyHeight = 3.1
      return { group, hitMeshes, gunTip, arm, bodyHeight }
    }

    // 左臂
    const leftArm = box(0.18, 0.62, 0.22, materials.body)
    leftArm.position.set(-(torsoWidth / 2 + 0.12), armY - 0.08, 0.02)
    leftArm.rotation.z = 0.12
    add(leftArm)

    // 右臂 + 步枪
    const rightArmGroup = new THREE.Group()
    rightArmGroup.position.set(torsoWidth / 2 + 0.14, armY - 0.02, 0)
    group.add(rightArmGroup)
    arm = rightArmGroup
    const upperArm = box(0.18, 0.5, 0.2, materials.body)
    upperArm.position.y = -0.16
    rightArmGroup.add(upperArm)

    const gun = new THREE.Group()
    gun.position.set(0, -0.32, 0.24)
    rightArmGroup.add(gun)
    const receiver = box(0.12, 0.16, 0.62, materials.metal)
    receiver.position.z = 0.16
    gun.add(receiver)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.5, 6), materials.metal)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.02, 0.62)
    gun.add(barrel)
    const energyCell = box(0.09, 0.1, 0.2, materials.visor)
    energyCell.position.set(0, -0.02, -0.04)
    gun.add(energyCell)
    gunTip = new THREE.Object3D()
    gunTip.position.set(0, 0.02, 0.92)
    gun.add(gunTip)

    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.flashTexture, color: spec.visor, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    flash.position.copy(gunTip.position)
    flash.scale.setScalar(0.7)
    gun.add(flash)

    bodyHeight = spec.height
    return { group, hitMeshes, gunTip, arm, bodyHeight, flash }
  }

  /* ---------------- 生成 ---------------- */

  spawn(kind: EnemyKindId, hpScale = 1, speedScale = 1, damageScale = 1): EnemyEntity {
    const base = ENEMY_SPECS[kind]
    const spec: EnemySpec = {
      ...base,
      hp: base.hp * hpScale,
      speed: base.speed * speedScale,
      damage: base.damage * damageScale,
    }
    const position = this.battlefield.spawnPoint(this.rng)
    const id = this.nextId
    this.nextId += 1
    const model = this.buildEnemyModel(kind, id, spec)

    const group = model.group
    group.position.copy(position)
    group.scale.setScalar(spec.scale * 0.01)
    const healthBar = this.makeHealthBar(spec)
    healthBar.background.position.y = model.bodyHeight + 0.55
    healthBar.fill.position.y = model.bodyHeight + 0.55
    healthBar.fill.center.set(0, 0.5)
    healthBar.fill.position.x = -healthBar.width / 2 + 0.02
    group.add(healthBar.background, healthBar.fill)
    if (model.flash) {
      model.flash.visible = false
    }

    this.scene.add(group)

    // 空降光柱
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5 * spec.scale, 0.9 * spec.scale, 16, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: spec.visor, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    )
    beam.position.copy(position)
    beam.position.y += 8
    this.scene.add(beam)
    const beamStart = performance.now()

    const enemy: EnemyEntity = {
      id,
      spec,
      group,
      hp: spec.hp,
      maxHp: spec.hp,
      alive: true,
      active: false,
      spawnTimer: 0,
      dying: 0,
      attackTimer: this.rng.range(1.2, 2.4),
      strafeDirection: this.rng.sign(),
      strafeTimer: this.rng.range(0.8, 2.2),
      bobPhase: this.rng.next() * 6,
      attackAnimation: 0,
      hitFlash: 0,
      gunTip: model.gunTip,
      arm: model.arm,
      creature: model.creature ?? null,
      hitMeshes: model.hitMeshes,
      healthBar,
      flash: model.flash ?? null,
      losTimer: 0,
      hasLineOfSight: false,
      bodyHeight: model.bodyHeight,
    }

    // 光柱淡出
    const fade = () => {
      const elapsed = (performance.now() - beamStart) / 1000
      if (this.disposed || elapsed > 1.1) {
        this.scene.remove(beam)
        beam.geometry.dispose()
        ;(beam.material as THREE.Material).dispose()
        return
      }
      const material = beam.material as THREE.MeshBasicMaterial
      material.opacity = 0.55 * (1 - elapsed / 1.1)
      beam.scale.x = 1 + elapsed
      beam.scale.z = 1 + elapsed
      requestAnimationFrame(fade)
    }
    requestAnimationFrame(fade)

    this.enemies.push(enemy)
    return enemy
  }

  /* ---------------- 查询 ---------------- */

  /** 供对局层遍历（AI 队友索敌 / 据点争夺判定） */
  get list(): readonly EnemyEntity[] {
    return this.enemies
  }

  get aliveCount() {
    return this.enemies.filter((enemy) => enemy.alive && enemy.active).length
  }

  get remaining() {
    return this.enemies.filter((enemy) => enemy.alive).length
  }

  /** 雷达用：所有存活敌人的平面位置 */
  alivePositions(): { x: number; z: number; kind: 'enemy' }[] {
    return this.enemies
      .filter((enemy) => enemy.alive)
      .map((enemy) => ({ x: enemy.group.position.x, z: enemy.group.position.z, kind: 'enemy' as const }))
  }

  get hitMeshes(): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = []
    for (const enemy of this.enemies) {
      if (enemy.alive && enemy.active) meshes.push(...enemy.hitMeshes)
    }
    return meshes
  }

  findById(id: number) {
    return this.enemies.find((enemy) => enemy.id === id) ?? null
  }

  /** 哨戒炮用：射程内最近的存活敌人 */
  nearestEnemy(position: THREE.Vector3, maxRange: number): { enemy: EnemyEntity; distance: number } | null {
    let best: EnemyEntity | null = null
    let bestDistance = maxRange
    for (const enemy of this.enemies) {
      if (!enemy.alive || !enemy.active) continue
      const distance = enemy.group.position.distanceTo(position)
      if (distance < bestDistance) {
        best = enemy
        bestDistance = distance
      }
    }
    return best ? { enemy: best, distance: bestDistance } : null
  }

  /** 轨道天罚用：范围伤害 */
  damageInRadius(center: THREE.Vector3, radius: number, damage: number) {
    let hits = 0
    let kills = 0
    for (const enemy of [...this.enemies]) {
      if (!enemy.alive) continue
      const distance = enemy.group.position.distanceTo(center)
      if (distance > radius) continue
      const result = this.damage(enemy.id, damage, 'body')
      hits += 1
      if (result.killed) kills += 1
    }
    return { hits, kills }
  }

  /* ---------------- 受击 ---------------- */

  /** 对敌人造成伤害，返回击杀信息 */
  damage(id: number, amount: number, part: HitPart): { killed: boolean; killedEnemy: EnemyEntity | null; headshot: boolean } {
    const enemy = this.findById(id)
    if (!enemy || !enemy.alive) return { killed: false, killedEnemy: null, headshot: false }
    const headshot = part === 'head'
    enemy.hp = Math.max(0, enemy.hp - amount)
    enemy.hitFlash = 0.12
    if (enemy.hp <= 0) {
      enemy.alive = false
      enemy.dying = 0
      if (enemy.healthBar) {
        enemy.healthBar.background.visible = false
        enemy.healthBar.fill.visible = false
      }
      this.hooks.onKilled?.(enemy, headshot)
      return { killed: true, killedEnemy: enemy, headshot }
    }
    this.updateHealthBar(enemy)
    return { killed: false, killedEnemy: null, headshot }
  }

  private updateHealthBar(enemy: EnemyEntity) {
    const bar = enemy.healthBar
    if (!bar) return
    const ratio = clamp(enemy.hp / enemy.maxHp, 0, 1)
    bar.background.visible = ratio < 1
    bar.fill.visible = ratio < 1
    bar.fill.scale.x = Math.max(0.02, bar.width * 0.94 * ratio)
    const material = bar.fill.material as THREE.SpriteMaterial
    material.color.set(ratio > 0.55 ? '#54e07a' : ratio > 0.25 ? '#ffc247' : '#ff4d4d')
  }

  /* ---------------- AI ---------------- */

  private lineOfSight(enemy: EnemyEntity, playerPosition: THREE.Vector3) {
    const from = enemy.group.position.clone()
    from.y += enemy.bodyHeight * 0.62
    const to = playerPosition.clone()
    to.y += 1.15
    const direction = to.clone().sub(from)
    const distance = direction.length()
    if (distance <= 0.001) return true
    direction.normalize()
    this.raycaster.set(from, direction)
    this.raycaster.far = distance - 0.35
    const hits = this.raycaster.intersectObjects(this.battlefield.blockers, true)
    return hits.length === 0
  }

  private moveEnemy(enemy: EnemyEntity, playerPosition: THREE.Vector3, delta: number) {
    const spec = enemy.spec
    const position = enemy.group.position
    const toPlayer = new THREE.Vector3(playerPosition.x - position.x, 0, playerPosition.z - position.z)
    const distance = toPlayer.length()
    const preferred = PREFERRED_RANGE[spec.id]
    const activeRange = FIRE_RANGE[spec.id]

    const direction = new THREE.Vector3()
    if (distance > 0.01) toPlayer.divideScalar(distance)

    if (spec.id === 'brute') {
      direction.copy(toPlayer)
    } else if (!enemy.hasLineOfSight) {
      // 失去视线时绕行接近
      direction.copy(toPlayer)
      if (distance < preferred + 2) {
        direction.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(enemy.strafeDirection)
      }
    } else if (distance > preferred + 3) {
      direction.copy(toPlayer)
    } else if (distance < preferred - 3) {
      direction.copy(toPlayer).multiplyScalar(-1)
    } else {
      direction.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(enemy.strafeDirection)
    }

    // 与其它敌人分离，避免叠在一起
    for (const other of this.enemies) {
      if (other === enemy || !other.alive || !other.active) continue
      const dx = position.x - other.group.position.x
      const dz = position.z - other.group.position.z
      const separation = Math.hypot(dx, dz)
      const minimum = (spec.bodyRadius + other.spec.bodyRadius) * 1.8
      if (separation < minimum && separation > 0.001) {
        direction.x += (dx / separation) * 0.8
        direction.z += (dz / separation) * 0.8
      }
    }

    // 绕障转向：贴近圆柱碰撞体且前进方向顶着它时，叠加切向推力让敌人贴边滑过去，
    // 否则大建筑（大学校园里很常见）会把直线追击的敌人永远卡在墙面上
    for (const collider of this.battlefield.colliders) {
      const dx = position.x - collider.x
      const dz = position.z - collider.z
      const dist = Math.hypot(dx, dz)
      const feeler = collider.radius + spec.bodyRadius + 1.4
      if (dist >= feeler || dist < 0.001) continue
      const rx = dx / dist
      const rz = dz / dist
      // 前进方向是否朝向障碍中心（>0.2 视为顶墙）
      if (direction.x * -rx + direction.z * -rz <= 0.2) continue
      // 两个切向中选与前进方向更一致的一侧
      const tx = -rz
      const tz = rx
      const side = direction.x * tx + direction.z * tz >= 0 ? 1 : -1
      direction.x += tx * side * 1.5
      direction.z += tz * side * 1.5
    }

    if (direction.lengthSq() > 0.0001) {
      direction.normalize()
      position.x += direction.x * spec.speed * delta
      position.z += direction.z * spec.speed * delta
    }
    this.battlefield.resolveCollisions(position, spec.bodyRadius)

    // 高度：飞行单位悬停，地面单位贴合地形
    if (spec.flying) {
      const target = this.battlefield.heightAt(position.x, position.z) + 0.15 + Math.sin(enemy.bobPhase) * 0.22
      position.y += (target - position.y) * Math.min(1, delta * 4)
      enemy.bobPhase += delta * 1.4
    } else {
      position.y = this.battlefield.heightAt(position.x, position.z)
    }

    // 朝向玩家（模型正面为 +Z）
    const lookTarget = new THREE.Vector3(playerPosition.x, position.y + enemy.bodyHeight * 0.55, playerPosition.z)
    enemy.group.lookAt(lookTarget)
    if (spec.flying) {
      const ring = enemy.group.getObjectByName('drone-ring')
      if (ring) ring.rotation.z += delta * 3
    }

    // 行走 / 悬浮起伏
    if (!spec.flying) {
      enemy.bobPhase += delta * (spec.speed * 2.6)
      enemy.group.position.y += Math.abs(Math.sin(enemy.bobPhase)) * 0.035
    }

    // 烘焙模型的骨骼动画：步态 / 旋翼 / 炮塔朝向
    if (enemy.creature) {
      const moving = direction.lengthSq() > 0.0001
      // 传给云台的必须是「相对躯干」的偏角：躯干已经 lookAt 过玩家了，
      // 再把世界朝向塞进去会把颈子拧一整圈
      const targetYaw = Math.atan2(playerPosition.x - position.x, playerPosition.z - position.z)
      const relativeYaw = Math.atan2(
        Math.sin(targetYaw - enemy.group.rotation.y),
        Math.cos(targetYaw - enemy.group.rotation.y),
      )
      enemy.creature.update(delta, {
        moving,
        speed: Math.min(1, spec.speed / 2.6),
        aimYaw: relativeYaw,
        attack: enemy.attackAnimation,
      })
    }

    return { distance, activeRange }
  }

  update(delta: number, _elapsed: number, playerPosition: THREE.Vector3) {
    if (this.disposed) return
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      // 对局层可能在回调里清场（例如玩家阵亡直接结束回合），此时数组已缩短
      const enemy = this.enemies[i]
      if (!enemy) continue

      // 死亡动画
      if (!enemy.alive) {
        enemy.dying += delta
        const progress = Math.min(1, enemy.dying / 1.2)
        enemy.group.rotation.x = -progress * 1.35
        enemy.group.scale.setScalar(enemy.spec.scale * (1 - progress * 0.35))
        enemy.group.position.y -= delta * 0.55
        if (enemy.dying > 1.5) this.removeEnemy(enemy, i)
        continue
      }

      // 空降动画
      if (!enemy.active) {
        enemy.spawnTimer += delta
        const progress = Math.min(1, enemy.spawnTimer / 0.7)
        const eased = 1 - (1 - progress) ** 3
        enemy.group.scale.setScalar(enemy.spec.scale * (0.05 + eased * 0.95))
        if (progress >= 1) {
          enemy.active = true
          enemy.group.scale.setScalar(enemy.spec.scale)
        }
        continue
      }

      const { distance, activeRange } = this.moveEnemy(enemy, playerPosition, delta)

      // 视线检测节流
      enemy.losTimer -= delta
      if (enemy.losTimer <= 0) {
        enemy.losTimer = 0.28 + Math.random() * 0.12
        enemy.hasLineOfSight = this.lineOfSight(enemy, playerPosition)
      }

      // 受击闪白衰减 + 血条健康色
      if (enemy.hitFlash > 0) enemy.hitFlash = Math.max(0, enemy.hitFlash - delta)

      // 开火
      enemy.attackTimer -= delta
      if (enemy.attackTimer <= 0) {
        const canSee = enemy.hasLineOfSight
        if (enemy.spec.id === 'brute') {
          if (distance < 2.9) {
            enemy.attackAnimation = 0.35
            enemy.attackTimer = this.rng.range(1.6, 2.4)
            this.hooks.onMelee?.(enemy.spec.damage, enemy)
          } else {
            enemy.attackTimer = 0.4
          }
        } else if (canSee && distance < activeRange && enemy.gunTip) {
          const origin = new THREE.Vector3()
          enemy.gunTip.getWorldPosition(origin)
          const target = new THREE.Vector3(playerPosition.x, playerPosition.y + 1.15, playerPosition.z)
          const direction = target.sub(origin).normalize()
          const spread = enemy.spec.id === 'skirmisher' ? 0.035 : 0.05
          direction.x += (Math.random() - 0.5) * spread
          direction.y += (Math.random() - 0.5) * spread * 0.6
          direction.z += (Math.random() - 0.5) * spread
          this.hooks.onFire?.({ origin, direction: direction.normalize(), spec: enemy.spec })
          enemy.attackTimer = this.rng.range(enemy.spec.fireDelay[0], enemy.spec.fireDelay[1])
          enemy.attackAnimation = 0.18
          if (enemy.flash) {
            enemy.flash.visible = true
            enemy.flash.material.opacity = 0.95
            enemy.flash.scale.setScalar(0.6 + Math.random() * 0.3)
          }
        } else {
          enemy.attackTimer = 0.3
        }
      }

      // 开火动画
      if (enemy.flash && enemy.flash.material.opacity > 0) {
        enemy.flash.material.opacity = Math.max(0, enemy.flash.material.opacity - delta * 6)
        enemy.flash.visible = enemy.flash.material.opacity > 0.02
      }
      if (enemy.attackAnimation > 0) {
        enemy.attackAnimation = Math.max(0, enemy.attackAnimation - delta)
        if (enemy.arm) enemy.arm.rotation.x = -enemy.attackAnimation * 2.4
      } else if (enemy.arm) {
        enemy.arm.rotation.x += (0 - enemy.arm.rotation.x) * Math.min(1, delta * 10)
      }

      // 朝向微调
      if (enemy.healthBar) {
        enemy.healthBar.background.position.y = enemy.bodyHeight + 0.55
        enemy.healthBar.fill.position.y = enemy.bodyHeight + 0.55
      }
    }
  }

  private removeEnemy(enemy: EnemyEntity, index: number) {
    this.scene.remove(enemy.group)
    enemy.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const material = mesh.material as THREE.Material | undefined
      if (material && !this.isSharedMaterial(material)) material.dispose()
    })
    this.enemies.splice(index, 1)
  }

  private isSharedMaterial(material: THREE.Material) {
    for (const set of this.materials.values()) {
      if (material === set.armor || material === set.body || material === set.visor || material === set.metal || material === set.glow) return true
    }
    return false
  }

  clear() {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      // 对局层可能在回调里清场（例如玩家阵亡直接结束回合），此时数组已缩短
      const enemy = this.enemies[i]
      if (!enemy) continue
      this.scene.remove(enemy.group)
      enemy.group.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const material = mesh.material as THREE.Material | undefined
        if (material && !this.isSharedMaterial(material)) material.dispose()
      })
    }
    this.enemies.length = 0
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.clear()
    for (const set of this.materials.values()) {
      set.armor.dispose()
      set.body.dispose()
      set.visor.dispose()
      set.metal.dispose()
      set.glow.dispose()
    }
    this.materials.clear()
    this.healthTexture.dispose()
    this.flashTexture.dispose()
  }
}
