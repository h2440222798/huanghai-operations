import * as THREE from 'three'

import {
  basketballCourtTexture,
  facadeMaps,
  surfaceMaps,
  storefrontMaps,
  soccerFieldTexture,
  type FacadeVariant,
  type SurfaceKind,
} from './pbrTextures'
import { setTextureAnisotropy } from './procedural'

/**
 * 校园材质库：所有建筑 / 地面 / 道具共享同一批 PBR 贴图与材质，
 * 避免几十栋楼各建一套贴图造成显存爆炸，也让夜景灯光只需要改一次材质。
 */

const MATERIALS = new Map<string, THREE.MeshStandardMaterial>()
const REGISTRY = new Set<THREE.MeshStandardMaterial>()
let detailEnabled = true

/** 渲染器就绪后调用：根据 GPU 能力设置各向异性过滤 */
export function prepareCampusMaterials(renderer: THREE.WebGLRenderer) {
  setTextureAnisotropy(renderer.capabilities.getMaxAnisotropy())
}

function register<T extends THREE.MeshStandardMaterial>(
  material: T,
  normalScale = 1,
  envIntensity = 1,
): T {
  material.userData.baseNormalScale = normalScale
  material.userData.baseEnvIntensity = envIntensity
  REGISTRY.add(material)
  return material
}

function cached(
  key: string,
  factory: () => THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  const hit = MATERIALS.get(key)
  if (hit) return hit
  const mat = factory()
  if (!detailEnabled) {
    mat.normalScale.setScalar(0)
    mat.envMapIntensity = 0.15
  }
  MATERIALS.set(key, mat)
  return mat
}

/* ------------------------------ 建筑立面 ------------------------------ */

/** 立面材质：瓷砖 / 红砖 / 混凝土 / 玻璃幕墙（四套共享贴图） */
export function facadeMaterial(variant: FacadeVariant): THREE.MeshStandardMaterial {
  return cached(`facade:${variant}`, () => {
    const set = facadeMaps(variant)
    const mat = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      roughnessMap: set.orm,
      metalnessMap: set.orm,
      roughness: 1,
      metalness: 1,
      emissiveMap: set.emissive,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0,
      envMapIntensity: 1.35,
      dithering: true,
    })
    mat.normalScale.set(set.normalScale, set.normalScale)
    return register(mat, set.normalScale, 1.35)
  })
}

/** 底层门厅材质：石材壁柱 + 落地玻璃 + 室内暖光 */
export function storefrontMaterial(): THREE.MeshStandardMaterial {
  return cached('storefront', () => {
    const set = storefrontMaps()
    const mat = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      roughnessMap: set.orm,
      metalnessMap: set.orm,
      roughness: 1,
      metalness: 1,
      emissiveMap: set.emissive,
      emissive: new THREE.Color('#ffddad'),
      emissiveIntensity: 0,
      envMapIntensity: 1,
      dithering: true,
    })
    mat.normalScale.set(0.9, 0.9)
    return register(mat, 0.9, 1)
  })
}

/* ------------------------------ 表面材质 ------------------------------ */

function surfaceMaterial(
  kind: SurfaceKind,
  normalMul = 1,
  envIntensity = 1,
  extra: THREE.MeshStandardMaterialParameters = {},
) {
  return cached(kind, () => {
    const set = surfaceMaps(kind)
    const mat = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      roughnessMap: set.orm,
      metalnessMap: set.orm,
      roughness: 1,
      metalness: 1,
      envMapIntensity: envIntensity,
      dithering: true,
      ...extra,
    })
    mat.normalScale.set(set.normalScale * normalMul, set.normalScale * normalMul)
    return register(mat, set.normalScale * normalMul, envIntensity)
  })
}

export const grassMaterial = () => surfaceMaterial('grass', 0.9, 1)
export const asphaltMaterial = () => surfaceMaterial('asphalt', 1, 0.85)
export const paverMaterial = () => surfaceMaterial('paver', 1, 1)
export const plazaMaterial = () => surfaceMaterial('plaza', 1, 1.05)
export const roofMaterial = () => surfaceMaterial('roof', 1, 0.9)
export const stoneMaterial = () => surfaceMaterial('stone', 1, 1)
export const sandMaterial = () => surfaceMaterial('sand', 1, 0.9)
export const trackMaterial = () => surfaceMaterial('track', 1, 0.75)
export const barkMaterial = () => surfaceMaterial('bark', 1.1, 0.5)
export const leafMaterial = () => surfaceMaterial('leaf', 1.1, 0.65)
export const woodMaterial = () => surfaceMaterial('wood', 1, 0.6)
export const metalMaterial = () => surfaceMaterial('metal', 0.8, 1.25)

/** 潮湿沙滩：更深的颜色 + 更低粗糙度，让水线附近有反光 */
export function wetSandMaterial(): THREE.MeshStandardMaterial {
  return cached('sand:wet', () => {
    const base = sandMaterial()
    const mat = base.clone()
    mat.color.set('#9f8d6d')
    mat.roughness = 0.55
    mat.envMapIntensity = 1.2
    mat.userData.baseNormalScale = base.userData.baseNormalScale
    mat.userData.baseEnvIntensity = 1.2
    REGISTRY.add(mat)
    return mat
  })
}

/** 屋顶 / 女儿墙的彩色涂层（共享屋面纹理，仅改色调） */
export function tintedRoof(color: string): THREE.MeshStandardMaterial {
  return cached(`roof:${color}`, () => {
    const base = roofMaterial()
    const mat = base.clone()
    mat.color.set(color)
    mat.userData.baseNormalScale = base.userData.baseNormalScale
    mat.userData.baseEnvIntensity = base.userData.baseEnvIntensity
    REGISTRY.add(mat)
    return mat
  })
}

/** 石灰 / 混凝土构件的浅色版本 */
export function paintedStone(color = '#ffffff'): THREE.MeshStandardMaterial {
  return cached(`stone:${color}`, () => {
    const set = surfaceMaps('stone')
    const mat = new THREE.MeshStandardMaterial({
      color,
      map: set.map,
      normalMap: set.normalMap,
      roughnessMap: set.orm,
      metalnessMap: set.orm,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 0.9,
      dithering: true,
    })
    mat.normalScale.set(set.normalScale, set.normalScale)
    return register(mat, set.normalScale, 0.9)
  })
}

/** 纯色涂料（道路标线、雕塑、栏杆等） */
export function paint(color: string, roughness = 0.7, metalness = 0): THREE.MeshStandardMaterial {
  return cached(`paint:${color}:${roughness}:${metalness}`, () => {
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness, dithering: true })
    return register(mat, 1, 0.6)
  })
}

/** 透明玻璃（入口雨棚、钟面等） */
export function glassMaterial(color = '#a9d2ea'): THREE.MeshPhysicalMaterial {
  const key = `glass:${color}`
  const hit = MATERIALS.get(key)
  if (hit) return hit as THREE.MeshPhysicalMaterial
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    transparent: true,
    opacity: 0.5,
    roughness: 0.08,
    metalness: 0.15,
    envMapIntensity: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    side: THREE.DoubleSide,
  })
  mat.userData.baseEnvIntensity = 1.6
  REGISTRY.add(mat as unknown as THREE.MeshStandardMaterial)
  if (!detailEnabled) mat.envMapIntensity = 0.15
  MATERIALS.set(key, mat as unknown as THREE.MeshStandardMaterial)
  return mat
}

/** 深色光伏板 / 幕墙玻璃（不透明高反射） */
export function solarPanelMaterial(): THREE.MeshStandardMaterial {
  return cached('solar', () => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#1c2c3e',
      roughness: 0.18,
      metalness: 0.55,
      envMapIntensity: 1.8,
    })
    return register(mat, 1, 1.8)
  })
}

/** 足球场材质（草皮条纹 + 白线） */
export function fieldMaterial(): THREE.MeshStandardMaterial {
  return cached('field', () => {
    const map = soccerFieldTexture()
    const normal = surfaceMaps('grass').normalMap
    const mat = new THREE.MeshStandardMaterial({
      map,
      normalMap: normal,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.6,
    })
    mat.normalScale.set(0.5, 0.5)
    return register(mat, 0.5, 0.6)
  })
}

/** 篮球场材质 */
export function courtMaterial(): THREE.MeshStandardMaterial {
  return cached('court', () => {
    const map = basketballCourtTexture()
    const normal = surfaceMaps('asphalt').normalMap
    const mat = new THREE.MeshStandardMaterial({
      map,
      normalMap: normal,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.7,
    })
    mat.normalScale.set(0.4, 0.4)
    return register(mat, 0.4, 0.7)
  })
}

/* ------------------------------ 材质细节开关 ------------------------------ */

/** 打开 / 关闭法线凹凸与环境反射（低端 GPU 或课堂对比演示用） */
export function setCampusMaterialDetail(on: boolean) {
  detailEnabled = on
  for (const mat of REGISTRY) {
    const baseNormal = (mat.userData.baseNormalScale as number | undefined) ?? 1
    const baseEnv = (mat.userData.baseEnvIntensity as number | undefined) ?? 1
    if (mat.normalMap) mat.normalScale.setScalar(on ? baseNormal : 0)
    mat.envMapIntensity = on ? baseEnv : 0.15
    mat.needsUpdate = true
  }
}

export function isCampusMaterialDetailOn() {
  return detailEnabled
}

/* ======================================================================== */
/*                         程序化天空环境反射 (PMREM)                        */
/* ======================================================================== */

export interface EnvironmentOptions {
  top: THREE.Color
  horizon: THREE.Color
  ground: THREE.Color
  sunDir: THREE.Vector3
  sunColor: THREE.Color
  /** 0 = 正午，1 = 日落 */
  dusk: number
  night: number
}

export interface CampusEnvironment {
  /** 根据太阳高度切换 / 生成环境贴图，并返回建议的环境光强度 */
  update(scene: THREE.Scene, hours: number, dayFactor: number, options: EnvironmentOptions): number
  dispose(): void
}

/**
 * 程序化等距柱状天空 → PMREM 环境贴图。
 * 玻璃幕墙、金属屋面、水面的反射都来自这里；白天 / 黄昏 / 夜晚各缓存一张。
 */
export function createCampusEnvironment(renderer: THREE.WebGLRenderer): CampusEnvironment {
  const generator = new THREE.PMREMGenerator(renderer)
  generator.compileEquirectangularShader()
  const targets = new Map<string, THREE.WebGLRenderTarget>()
  const sources: THREE.CanvasTexture[] = []
  let currentKey = ''

  function build(key: string, options: EnvironmentOptions) {
    const width = 512
    const height = 256
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    const top = `#${options.top.getHexString()}`
    const horizon = `#${options.horizon.getHexString()}`
    const ground = `#${options.ground.getHexString()}`

    const sky = ctx.createLinearGradient(0, 0, 0, height * 0.52)
    sky.addColorStop(0, top)
    sky.addColorStop(0.62, horizon)
    sky.addColorStop(1, horizon)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, width, height * 0.52)

    const earth = ctx.createLinearGradient(0, height * 0.52, 0, height)
    earth.addColorStop(0, horizon)
    earth.addColorStop(0.25, ground)
    earth.addColorStop(1, ground)
    ctx.fillStyle = earth
    ctx.fillRect(0, height * 0.52, width, height * 0.48)

    // 地平线大气光带
    const haze = ctx.createLinearGradient(0, height * 0.44, 0, height * 0.6)
    haze.addColorStop(0, 'rgba(255,255,255,0)')
    haze.addColorStop(0.5, `${horizon}aa`)
    haze.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = haze
    ctx.fillRect(0, height * 0.44, width, height * 0.16)

    // 云：给玻璃反射提供高光变化
    if (options.night < 0.6) {
      const rng = (() => {
        let s = 9871
        return () => {
          s = (s * 1664525 + 1013904223) % 4294967296
          return s / 4294967296
        }
      })()
      for (let i = 0; i < 14; i++) {
        const cx = rng() * width
        const cy = height * (0.08 + rng() * 0.26)
        const rx = 18 + rng() * 54
        const ry = 5 + rng() * 12
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx)
        g.addColorStop(0, `rgba(255,255,255,${0.18 + rng() * 0.22})`)
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        ctx.save()
        ctx.translate(cx, cy)
        ctx.scale(1, ry / rx)
        ctx.beginPath()
        ctx.arc(0, 0, rx, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    // 太阳 / 月亮：等距柱状投影下的高光，是玻璃反射的“灯”
    const dir = options.sunDir.clone().normalize()
    const u = (0.5 + Math.atan2(dir.x, -dir.z) / (Math.PI * 2) + 1) % 1
    const v = 0.5 - Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) / Math.PI
    const sx = u * width
    const sy = v * height
    const sunRadius = key === 'night' ? 14 : 46
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, sunRadius)
    const sunHex = `#${options.sunColor.getHexString()}`
    if (key === 'night') {
      sun.addColorStop(0, 'rgba(235,242,255,1)')
      sun.addColorStop(0.25, 'rgba(210,225,255,0.7)')
      sun.addColorStop(1, 'rgba(210,225,255,0)')
    } else {
      sun.addColorStop(0, '#ffffff')
      sun.addColorStop(0.12, sunHex)
      sun.addColorStop(0.4, `${sunHex}aa`)
      sun.addColorStop(1, `${sunHex}00`)
    }
    ctx.fillStyle = sun
    ctx.fillRect(sx - sunRadius, sy - sunRadius, sunRadius * 2, sunRadius * 2)

    // 星空（夜晚反射里有一点星点）
    if (key === 'night') {
      for (let i = 0; i < 220; i++) {
        const x = Math.random() * width
        const y = Math.random() * height * 0.45
        ctx.fillStyle = `rgba(230,240,255,${0.15 + Math.random() * 0.5})`
        ctx.fillRect(x, y, 1, 1)
      }
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.mapping = THREE.EquirectangularReflectionMapping
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    sources.push(tex)
    const target = generator.fromEquirectangular(tex)
    targets.set(key, target)
  }

  return {
    update(scene, _hours, dayFactor, options) {
      const key = options.dusk > 0.5 ? 'dusk' : dayFactor < 0.16 ? 'night' : 'day'
      if (!targets.has(key)) build(key, options)
      const target = targets.get(key)!
      if (key !== currentKey) {
        currentKey = key
        scene.environment = target.texture
      }
      const intensity = key === 'night' ? 0.24 : key === 'dusk' ? 0.7 : 0.24 + dayFactor * 0.5
      scene.environmentIntensity = intensity
      return intensity
    },
    dispose() {
      for (const target of targets.values()) target.dispose()
      for (const tex of sources) tex.dispose()
      targets.clear()
      generator.dispose()
    },
  }
}
