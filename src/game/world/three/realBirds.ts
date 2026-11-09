import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'

/**
 * 真实小鸟模型（GLB）
 *
 * 模型来源与许可见 public/models/birds/README.md：
 * - Gull / Sparrow / Bluebird / Eagle：Poly Pizza，CC BY 3.0
 * - Stork：three.js examples（MIT）
 *
 * 加载后按物种归一化尺寸，并为海鸥注入一个很小的顶点着色器，让翅膀上下扇动。
 * 全部模型只下载一次；切换校园时复用缓存，只克隆节点。
 */

export type BirdKind = 'gull' | 'sparrow' | 'bluebird' | 'stork' | 'eagle'

interface BirdConfig {
  file: string
  /** 归一化后的最大尺寸（米） */
  size: number
  /** 模型自身朝向：+1 表示 +x 为鸟头方向，-1 表示 -x */
  forward: 1 | -1
  /** 是否用顶点着色器做扇翅（静态海鸥模型） */
  flap?: boolean
}

const CONFIG: Record<BirdKind, BirdConfig> = {
  gull: { file: 'Gull', size: 1.7, forward: 1, flap: true },
  sparrow: { file: 'Sparrow', size: 0.4, forward: -1 },
  bluebird: { file: 'Bluebird', size: 0.46, forward: -1 },
  stork: { file: 'Stork', size: 1.9, forward: -1 },
  eagle: { file: 'Eagle', size: 3.0, forward: 1 },
}

interface BirdAsset {
  scene: THREE.Object3D
  animations: THREE.AnimationClip[]
  size: THREE.Vector3
}

const BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`

let assetsPromise: Promise<Map<BirdKind, BirdAsset>> | null = null

function loadBirdAssets(): Promise<Map<BirdKind, BirdAsset>> {
  if (assetsPromise) return assetsPromise
  assetsPromise = (async () => {
    THREE.Cache.enabled = true
    const loader = new GLTFLoader()
    const entries = await Promise.all(
      (Object.keys(CONFIG) as BirdKind[]).map(async (kind) => {
        const cfg = CONFIG[kind]
        try {
          const gltf = await loader.loadAsync(`${BASE}models/birds/${cfg.file}.glb`)
          gltf.scene.updateMatrixWorld(true)
          const box = new THREE.Box3().setFromObject(gltf.scene)
          const size = new THREE.Vector3()
          box.getSize(size)
          const asset: BirdAsset = {
            scene: gltf.scene,
            animations: gltf.animations,
            size,
          }
          return [kind, asset] as const
        } catch (error) {
          console.warn(`[campus-birds] 加载 ${cfg.file}.glb 失败`, error)
          return null
        }
      }),
    )
    return new Map(entries.filter((entry): entry is readonly [BirdKind, BirdAsset] => entry !== null))
  })()
  return assetsPromise
}

interface FlapState {
  uniforms: Record<string, THREE.IUniform> | null
}

function installGullFlap(
  material: THREE.MeshStandardMaterial,
  size: THREE.Vector3,
  phase: number,
  states: FlapState[],
) {
  const halfSpan = Math.max(Math.abs(size.z) * 0.5, 1e-3)
  const amplitude = Math.max(size.z * 0.09, 1e-2)
  const state: FlapState = { uniforms: null }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBirdTime = { value: 0 }
    shader.uniforms.uBirdPhase = { value: phase }
    shader.uniforms.uBirdAmp = { value: amplitude }
    shader.uniforms.uBirdSpan = { value: halfSpan }
    shader.vertexShader =
      'uniform float uBirdTime;\nuniform float uBirdPhase;\nuniform float uBirdAmp;\nuniform float uBirdSpan;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float wingMask = smoothstep(0.18, 0.9, abs(position.z) / uBirdSpan);
        transformed.y += sin(uBirdTime * 6.2 + uBirdPhase) * wingMask * uBirdAmp;`,
      )
    state.uniforms = shader.uniforms
  }
  material.customProgramCacheKey = () => 'campus-gull-flap'
  material.needsUpdate = true
  states.push(state)
}

interface CloneResult {
  root: THREE.Object3D
  materials: THREE.Material[]
  flaps: FlapState[]
}

function cloneBird(asset: BirdAsset, kind: BirdKind, phase: number): CloneResult {
  const root = cloneSkeleton(asset.scene)
  const cfg = CONFIG[kind]
  const maxDim = Math.max(asset.size.x, asset.size.y, asset.size.z) || 1
  root.scale.setScalar(cfg.size / maxDim)
  const materials: THREE.Material[] = []
  const flaps: FlapState[] = []
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    const original = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const cloned = original.map((material) => {
      const mat = (material as THREE.MeshStandardMaterial).clone()
      mat.side = THREE.DoubleSide
      mat.envMapIntensity = 0.65
      if (cfg.flap) installGullFlap(mat, asset.size, phase, flaps)
      materials.push(mat)
      return mat
    })
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!
  })
  root.updateMatrixWorld(true)
  return { root, materials, flaps }
}

/** 将模型原点放到包围盒中心（飞行用） */
function centerFlying(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const center = new THREE.Vector3()
  box.getCenter(center)
  root.position.sub(center)
}

/** 将模型放平并让脚落在 y=0（站立用） */
function centerPerched(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  root.position.x -= (box.min.x + box.max.x) / 2
  root.position.z -= (box.min.z + box.max.z) / 2
  root.position.y -= box.min.y
}

interface Flyer {
  pivot: THREE.Group
  kind: BirdKind
  radius: number
  height: number
  speed: number
  phase: number
  direction: number
  bob: number
  bank: number
  mixer: THREE.AnimationMixer | null
  flaps: FlapState[]
}

interface PerchedBird {
  pivot: THREE.Group
  phase: number
  baseYaw: number
  baseY: number
}

export interface BirdFlock {
  group: THREE.Group
  update: (t: number) => void
  dispose: () => void
  birdCount: number
}

export interface BirdFlockOptions {
  center: THREE.Vector2
  count: number
  /** 站立小鸟的位置（世界坐标），y 默认落在地面 */
  perches?: { x: number; z: number; y?: number }[]
}

export async function createBirdFlock(options: BirdFlockOptions): Promise<BirdFlock | null> {
  const assets = await loadBirdAssets()
  if (assets.size === 0) return null

  const group = new THREE.Group()
  group.name = 'campusBirdFlock'
  const flyers: Flyer[] = []
  const perched: PerchedBird[] = []
  const ownedMaterials: THREE.Material[] = []
  const mixers: THREE.AnimationMixer[] = []
  let birdCount = 0

  const addFlyer = (
    kind: BirdKind,
    i: number,
    radius: number,
    height: number,
    speed: number,
    bank: number,
    bob: number,
  ) => {
    const asset = assets.get(kind)
    if (!asset) return
    const phase = (i * 2.399) % (Math.PI * 2)
    const clone = cloneBird(asset, kind, phase)
    centerFlying(clone.root)
    const pivot = new THREE.Group()
    pivot.add(clone.root)
    group.add(pivot)
    ownedMaterials.push(...clone.materials)
    let mixer: THREE.AnimationMixer | null = null
    if (asset.animations.length > 0) {
      mixer = new THREE.AnimationMixer(clone.root)
      const action = mixer.clipAction(asset.animations[0]!)
      action.timeScale = 0.85 + (i % 3) * 0.08
      action.play()
      mixers.push(mixer)
    }
    flyers.push({
      pivot,
      kind,
      radius,
      height,
      speed,
      phase,
      direction: i % 2 === 0 ? 1 : -1,
      bob,
      bank,
      mixer,
      flaps: clone.flaps,
    })
    birdCount++
  }

  // 海鸥：绕校园/水面盘旋
  const gullCount = Math.max(3, Math.round(options.count))
  for (let i = 0; i < gullCount; i++) {
    addFlyer(
      'gull',
      i,
      26 + (i % 3) * 8 + Math.floor(i / 3) * 3,
      28 + (i % 4) * 4,
      0.12 + (i % 5) * 0.018,
      0.18 + (i % 3) * 0.05,
      2.2,
    )
  }
  // 白鹳：贴着水面低飞（带原模型的翅膀动画），小半径避免穿过建筑
  for (let i = 0; i < 2; i++) {
    addFlyer('stork', i + 7, 9 + i * 2, 7.5 + i * 2, 0.2, 0.1, 0.9)
  }
  // 鹰：高空大半径盘旋
  addFlyer('eagle', 11, 95, 60, 0.045, 0.22, 3.5)

  // 站立的小鸟：麻雀 / 蓝鸲，优先放在传入的草地/长椅附近
  const perchSpots = options.perches ?? []
  const kinds: BirdKind[] = ['sparrow', 'bluebird', 'sparrow', 'bluebird', 'sparrow']
  perchSpots.forEach((spot, i) => {
    const kind = kinds[i % kinds.length]!
    const asset = assets.get(kind)
    if (!asset) return
    const phase = i * 1.71
    const clone = cloneBird(asset, kind, phase)
    centerPerched(clone.root)
    const baseY = spot.y ?? 0.03
    const pivot = new THREE.Group()
    pivot.position.set(spot.x, baseY, spot.z)
    pivot.rotation.y = (i * 1.37) % (Math.PI * 2)
    pivot.add(clone.root)
    group.add(pivot)
    ownedMaterials.push(...clone.materials)
    perched.push({
      pivot,
      phase,
      baseYaw: pivot.rotation.y,
      baseY,
    })
    birdCount++
  })

  let lastT = 0
  const update = (t: number) => {
    const dt = lastT === 0 ? 0 : Math.min(0.05, Math.max(0, t - lastT))
    lastT = t
    for (const flyer of flyers) {
      const a = flyer.phase + t * flyer.speed * flyer.direction
      const x = options.center.x + Math.cos(a) * flyer.radius
      const z = options.center.y + Math.sin(a) * flyer.radius
      const y = flyer.height + Math.sin(t * 0.65 + flyer.phase) * flyer.bob
      flyer.pivot.position.set(x, y, z)
      const vx = -Math.sin(a) * flyer.direction
      const vz = Math.cos(a) * flyer.direction
      const forward = CONFIG[flyer.kind].forward
      flyer.pivot.rotation.y = Math.atan2(-vz, vx) + (forward === 1 ? 0 : Math.PI)
      flyer.pivot.rotation.z = -flyer.direction * flyer.bank
      flyer.pivot.rotation.x = Math.sin(t * 0.8 + flyer.phase) * 0.04
      for (const flap of flyer.flaps) {
        if (flap.uniforms) flap.uniforms.uBirdTime!.value = t
      }
      flyer.mixer?.update(dt)
    }
    for (const bird of perched) {
      bird.pivot.rotation.y = bird.baseYaw + Math.sin(t * 0.8 + bird.phase) * 0.35
      bird.pivot.position.y = bird.baseY + Math.max(0, Math.sin(t * 2.1 + bird.phase * 2)) * 0.012
    }
  }

  const dispose = () => {
    for (const mixer of mixers) mixer.stopAllAction()
    for (const material of ownedMaterials) material.dispose()
    group.clear()
  }

  return { group, update, dispose, birdCount }
}
