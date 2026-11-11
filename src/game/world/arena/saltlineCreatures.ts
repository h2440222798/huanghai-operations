import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

/**
 * 从参考实现里烘出来的两台敌方机械体（程序化几何 + 骨骼 + 顶点色，均已烘焙成 glb）：
 *  - hound：四足机械犬，20 根骨骼（root / body / neck / head / turret / gun / 4×3 腿节）
 *  - gull ：四旋翼侦察机，13 根骨骼（root / body / 4 rotor / gimbalYaw / ball / lamp / gun / 3 strobe）
 *
 * 顶点色带 HDR（最大 6~11），原始实现用 t 大于 1 的通道做自发光细节，
 * 这里把它拆成 baseColor（钳到 1）+ emissive（超出部分），避免整块泛白。
 */

export type CreatureKind = 'hound' | 'gull'

interface CreatureTemplate {
  root: THREE.Object3D
  bones: Map<string, THREE.Bone>
  /** 模型原始包围盒高度，用来换算成 spec.height */
  height: number
  radius: number
  /** 包围盒底部 Y（贴地用） */
  minY: number
  /** 包围盒中心 Y（悬停用） */
  centerY: number
  /** 模型自身朝向与 +Z 的偏差（弧度） */
  yawOffset: number
}

const ASSET_DIR = `${import.meta.env.BASE_URL}models/saltline/`
const TEMPLATES = new Map<CreatureKind, CreatureTemplate>()
let pending: Promise<void> | null = null

/** 把顶点色拆成 baseColor + emissive，让超过 1 的部分以自发光形式保留下来 */
function patchMaterials(meshes: THREE.SkinnedMesh[]) {
  for (const mesh of meshes) {
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    const geometry = mesh.geometry
    const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined

    let hasHdr = false
    if (colorAttr) {
      const arr = colorAttr.array as Float32Array
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i] ?? 0
        if (v > 1.001) {
          hasHdr = true
          break
        }
      }
    }

    const material = new THREE.MeshStandardMaterial({
      // 顶点色本身偏亮（线性均值 0.7），直接乘白会在这个曝光下糊成一片，
      // 压一档并轻微偏冷，让装甲板之间能分出层次
      color: 0xb9bec9,
      vertexColors: !!colorAttr,
      metalness: 0.34,
      roughness: 0.58,
      envMapIntensity: 0.95,
    })
    material.name = source?.name || 'saltline_shell'

    if (hasHdr && colorAttr) {
      // 超白通道按比例抽成 emissive，剩下的钳到 1 留在 baseColor
      const arr = colorAttr.array as Float32Array
      const emissive = new Float32Array(arr.length)
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i] ?? 0
        if (v > 1) {
          // 原模型的超白像素是给自家管线用的，直接搬过来会在这条泛光链上糊成光球，
          // 压到 0.45 以内只当作灯带/面板点缀
          emissive[i] = Math.min(0.45, (v - 1) * 0.16)
          arr[i] = 1
        }
      }
      colorAttr.needsUpdate = true
      geometry.setAttribute('color', colorAttr)
      // 注意：three 的 totalEmissiveRadiance 初值就是 emissive 本身，
      // 这里必须留黑，只让下面注入的 aGlow 累加，否则整只模型恒亮一片白
      material.emissive = new THREE.Color(0x000000)
      material.emissiveIntensity = 1
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
            attribute vec3 aGlow;
            varying vec3 vGlow;`,
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vGlow = aGlow;`,
          )
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            varying vec3 vGlow;`,
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            totalEmissiveRadiance += vGlow;`,
          )
      }
      geometry.setAttribute('aGlow', new THREE.BufferAttribute(emissive, 3))
    }

    mesh.material = material
    mesh.castShadow = true
    mesh.receiveShadow = true
    // 蒙皮后包围盒不准，直接关掉剔除避免贴脸消失
    mesh.frustumCulled = false
  }
}

function indexBones(root: THREE.Object3D) {
  const bones = new Map<string, THREE.Bone>()
  root.traverse((node) => {
    if ((node as THREE.Bone).isBone) bones.set(node.name, node as THREE.Bone)
  })
  return bones
}

function measure(meshes: THREE.SkinnedMesh[]) {
  // 参考模型里混了枪口曳光一类拉得很远的辅助几何（无人机那段沿 +Z 拉到 9 个单位），
  // 直接取包围盒会把整机缩成一个小点，所以先按「质心中位距离」剔一次离群点。
  const points: THREE.Vector3[] = []
  const attr = new THREE.Vector3()
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) continue
    for (let i = 0; i < position.count; i++) {
      points.push(attr.clone().fromBufferAttribute(position, i))
    }
  }
  if (!points.length) {
    return { height: 1, radius: 0.5, minY: 0, centerY: 0.5 }
  }

  const centroid = new THREE.Vector3()
  for (const p of points) centroid.add(p)
  centroid.divideScalar(points.length)

  const distances = points.map((p) => p.distanceTo(centroid))
  const sorted = [...distances].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length * 0.5)] ?? 1
  const limit = Math.max(median * 2.6, 0.05)

  const box = new THREE.Box3()
  for (let i = 0; i < points.length; i++) {
    if (distances[i]! <= limit) box.expandByPoint(points[i]!)
  }
  if (box.isEmpty()) box.setFromPoints(points)

  const size = new THREE.Vector3()
  box.getSize(size)
  return {
    height: Math.max(0.001, size.y),
    radius: Math.max(0.001, Math.max(size.x, size.z) * 0.5),
    minY: box.min.y,
    centerY: box.min.y + size.y * 0.5,
  }
}

async function loadTemplate(kind: CreatureKind): Promise<CreatureTemplate | null> {
  const loader = new GLTFLoader()
  try {
    const gltf = await loader.loadAsync(`${ASSET_DIR}${kind}.glb`)
    const root = gltf.scene
    const meshes: THREE.SkinnedMesh[] = []
    root.traverse((node) => {
      if ((node as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(node as THREE.SkinnedMesh)
    })
    if (!meshes.length) return null
    patchMaterials(meshes)
    const { height, radius, minY, centerY } = measure(meshes)
    // 参考实现里犬是头朝 -Z 建模的，这里记下偏差供实例化时纠正
    const yawOffset = kind === 'hound' ? Math.PI : 0
    return { root, bones: indexBones(root), height, radius, minY, centerY, yawOffset }
  } catch (error) {
    console.warn(`[saltline] ${kind} 模型加载失败，回退到程序化模型`, error)
    return null
  }
}

/** 预加载（构造 EnemyManager 时调用一次，失败不影响玩法） */
export function preloadSaltlineCreatures(): Promise<void> {
  if (!pending) {
    pending = Promise.all([loadTemplate('hound'), loadTemplate('gull')]).then(([hound, gull]) => {
      if (hound) TEMPLATES.set('hound', hound)
      if (gull) TEMPLATES.set('gull', gull)
    })
  }
  return pending
}

export function hasSaltlineCreature(kind: CreatureKind) {
  return TEMPLATES.has(kind)
}

export interface CreatureAnimState {
  /** 是否在移动（决定步态是否推进） */
  moving: boolean
  /** 相对速度，0~1，影响步频与幅度 */
  speed: number
  /** 朝玩家方向的偏航（给炮塔 / 云台用），可选 */
  aimYaw?: number
  /** 攻击动画剩余时间（0~1） */
  attack?: number
}

export interface CreatureInstance {
  kind: CreatureKind
  root: THREE.Group
  /** 命中点用的包围球半径 */
  radius: number
  update(dt: number, state: CreatureAnimState): void
}

function makeHoundAnim(b: Map<string, THREE.Bone>, root: THREE.Group) {
  const legs = [
    { abduct: b.get('abdFL'), thigh: b.get('thighFL'), shin: b.get('shinFL'), phase: 0 },
    { abduct: b.get('abdFR'), thigh: b.get('thighFR'), shin: b.get('shinFR'), phase: Math.PI },
    { abduct: b.get('abdRL'), thigh: b.get('thighRL'), shin: b.get('shinRL'), phase: Math.PI },
    { abduct: b.get('abdRR'), thigh: b.get('thighRR'), shin: b.get('shinRR'), phase: 0 },
  ]
  const rest = legs.map((leg) => ({
    thighX: leg.thigh ? leg.thigh.rotation.x : 0,
    shinX: leg.shin ? leg.shin.rotation.x : 0,
  }))
  const body = b.get('body')
  const bodyRestY = body ? body.position.y : 0
  const bodyRestX = body ? body.rotation.x : 0
  const neck = b.get('neck')
  const neckRest = neck ? neck.rotation.y : 0
  const neckRestX = neck ? neck.rotation.x : 0

  let phase = 0
  return (dt: number, state: CreatureAnimState) => {
    const stride = state.moving ? 1 : 0
    // 步频：静止时慢速换气，移动时跟速度走
    phase += dt * (state.moving ? 6.2 + state.speed * 5.4 : 1.1)
    const amp = state.moving ? 0.46 + state.speed * 0.22 : 0.05

    legs.forEach((leg, i) => {
      const swing = Math.sin(phase + leg.phase) * amp * stride
      const lift = Math.max(0, Math.sin(phase + leg.phase + Math.PI * 0.5)) * 0.34 * stride
      const base = rest[i]!
      if (leg.thigh) leg.thigh.rotation.x = base.thighX + swing
      if (leg.shin) leg.shin.rotation.x = base.shinX - swing * 1.15 - lift * 0.85
      if (leg.abduct) leg.abduct.rotation.z = Math.sin(phase + leg.phase) * 0.045 * stride
    })

    if (body) {
      // 双支撑相位下沉，四足动物走起来才有重量感
      const bob = Math.cos(phase * 2) * 0.035 * stride
      body.position.y = bodyRestY + bob
      body.rotation.z = Math.sin(phase) * 0.02 * stride
      // 近战扑咬：躯干前倾，配合颈部下压
      const bite = Math.min(1, (state.attack ?? 0) / 0.35)
      body.rotation.x = bodyRestX + bite * 0.22
    }
    if (neck) {
      const target = state.aimYaw ? THREE.MathUtils.clamp(state.aimYaw, -0.7, 0.7) : 0
      neck.rotation.y = neckRest + target
      neck.rotation.x = neckRestX - Math.min(1, (state.attack ?? 0) / 0.35) * 0.55
    }
    // 呼吸 / 待机微动
    if (!state.moving) root.position.y = Math.sin(phase * 0.9) * 0.012
  }
}

function makeGullAnim(b: Map<string, THREE.Bone>, root: THREE.Group) {
  const rotors = ['rotor0', 'rotor1', 'rotor2', 'rotor3'].map((name) => b.get(name)).filter(Boolean) as THREE.Bone[]
  const body = b.get('body')
  const bodyRest = body ? body.rotation.clone() : null
  const gimbal = b.get('gimbalYaw')
  const gimbalRest = gimbal ? gimbal.rotation.y : 0

  let spin = 0
  let phase = 0
  return (dt: number, state: CreatureAnimState) => {
    // 旋翼转速跟速度挂钩：悬停时也在转，只是慢
    spin += dt * (30 + state.speed * 55)
    const dir = spin % (Math.PI * 2)
    rotors.forEach((rotor, i) => {
      rotor.rotation.y = dir * (i % 2 === 0 ? 1 : -1)
    })

    phase += dt * 2.4
    if (body && bodyRest) {
      body.rotation.x = bodyRest.x + Math.sin(phase) * 0.035
      body.rotation.z = bodyRest.z + Math.cos(phase * 0.8) * 0.045
      root.position.y = Math.sin(phase * 1.3) * 0.06
    }
    if (gimbal) {
      const target = state.aimYaw ? THREE.MathUtils.clamp(state.aimYaw, -1.1, 1.1) : 0
      gimbal.rotation.y = gimbalRest + target
    }
  }
}

/** 实例化一台敌方机械体；未加载完成时返回 null，调用方回退到原程序化模型 */
export function createSaltlineCreature(
  kind: CreatureKind,
  options: { height: number; radius: number; hoverCenterY?: number },
): CreatureInstance | null {
  const template = TEMPLATES.get(kind)
  if (!template) return null

  const cloned = cloneSkinned(template.root)
  const root = new THREE.Group()
  root.add(cloned)

  // 地面单位按身高换算（四足有明确站高），飞行单位按旋翼跨度换算
  // —— 无人机机身很扁，拿身高当基准会被压成指甲盖大小
  const flying = options.hoverCenterY != null
  const scale = flying
    ? (options.radius * 1.6) / template.radius
    : options.height / template.height
  cloned.scale.setScalar(scale)
  cloned.rotation.y = template.yawOffset
  // 地面单位把脚底压到 0，飞行单位把机腹中心抬到 hoverCenterY
  cloned.position.y =
    options.hoverCenterY != null
      ? options.hoverCenterY - template.centerY * scale
      : -template.minY * scale

  // 骨骼必须取自克隆体（SkeletonUtils.clone 会重建 Bone 实例）
  const clonedBones = indexBones(cloned)
  const anim = kind === 'hound' ? makeHoundAnim(clonedBones, root) : makeGullAnim(clonedBones, root)

  return {
    kind,
    root,
    radius: Math.max(options.radius, template.radius * scale),
    update(dt, state) {
      anim(dt, state)
    },
  }
}
