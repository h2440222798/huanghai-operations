import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

import {
  facadeMaterial,
  glassMaterial,
  metalMaterial,
  paintedStone,
  paint,
  roofMaterial,
  solarPanelMaterial,
  stoneMaterial,
  storefrontMaterial,
  tintedRoof,
} from './materials'
import { makeSignTexture, makeClockTexture } from './textures'
import { type FacadeVariant } from './pbrTextures'
import { offsetBoxUv, scaleBoxUv, scaleUv } from './procedural'

/** 按建筑名称确定立面风格：图书馆用幕墙，实验楼偏混凝土，宿舍偏砖墙 */
export function facadeVariantFor(name: string): FacadeVariant {
  const hash = hashString(name)
  if (name.includes('图书馆') || name.includes('图书')) return 'glass'
  if (name.includes('实验') || name.includes('科技')) return hash % 3 === 0 ? 'tile' : 'concrete'
  if (name.includes('公寓') || name.includes('宿舍') || name.includes('住宅')) {
    return hash % 3 === 0 ? 'tile' : 'brick'
  }
  const list: FacadeVariant[] = ['tile', 'brick', 'concrete', 'tile', 'concrete', 'brick']
  return list[hash % list.length]!
}

export interface BuildingData {
  name: string
  info: string
}

export interface BuildingOptions {
  name: string
  info: string
  /** 夜晚窗户点亮的比例（目前只影响立面变体的选择，自发光图案已烘焙在贴图内） */
  litRatio?: number
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)

/**
 * 一栋带窗户贴图的楼体。
 *
 * 立面使用 2×2 窗单元的可平铺 PBR 贴图，UV 按「窗单元数」缩放：
 * 楼再宽、再高，窗户也不会被拉伸；所有楼共享同一套立面材质。
 * 底层单独做石材 + 落地玻璃门厅，楼顶加设备间 / 水箱 / 空调机组 / 光伏板。
 */
export function makeWindowedBox(
  w: number,
  h: number,
  d: number,
  floors: number,
  _litRatio = 0.42,
  options: {
    variant?: FacadeVariant
    podium?: boolean
    roofDetails?: boolean
    seed?: number
  } = {},
): THREE.Group {
  const group = new THREE.Group()
  const variant = options.variant ?? 'tile'
  const facade = facadeMaterial(variant)
  const roof = roofMaterial()
  const stone = paintedStone('#d7d3ca')
  const totalFloors = Math.max(1, floors)
  const floorH = h / totalFloors
  const podium = options.podium !== false && totalFloors >= 2
  const podiumH = podium ? floorH : 0
  const bodyH = h - podiumH
  const upperFloors = Math.max(1, totalFloors - (podium ? 1 : 0))

  const colsX = Math.max(2, Math.round(w / 3.2))
  const colsZ = Math.max(2, Math.round(d / 3.2))
  const uX = colsX / 2
  const uZ = colsZ / 2
  const v = upperFloors / 2

  // 上部楼体：窗户贴图按窗单元缩放
  const bodyGeo = new THREE.BoxGeometry(w, bodyH, d)
  scaleBoxUv(bodyGeo, [
    [uZ, v],
    [uZ, v],
    [w / 4, d / 4],
    [w / 4, d / 4],
    [uX, v],
    [uX, v],
  ])
  // 同一套立面材质在不同楼上错开 1 个窗格 / 1 层，避免亮灯图案完全一样
  const pattern = options.seed ?? 0
  offsetBoxUv(
    bodyGeo,
    [0, 1, 4, 5],
    (pattern % 2) * 0.5,
    (Math.floor(pattern / 2) % 2) * 0.5,
  )
  const body = new THREE.Mesh(bodyGeo, [facade, facade, roof, roof, facade, facade])
  body.position.y = podiumH + bodyH / 2
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  // 底层门厅：石材壁柱 + 落地玻璃 + 室内暖光
  if (podium) {
    const pw = w + 0.3
    const pd = d + 0.3
    const podiumGeo = new THREE.BoxGeometry(pw, podiumH, pd)
    const store = storefrontMaterial()
    scaleBoxUv(podiumGeo, [
      [pd / 6, 1],
      [pd / 6, 1],
      [1, 1],
      [1, 1],
      [pw / 6, 1],
      [pw / 6, 1],
    ])
    const base = new THREE.Mesh(podiumGeo, [store, store, stone, stone, store, store])
    base.position.y = podiumH / 2
    base.castShadow = true
    base.receiveShadow = true
    group.add(base)

    // 入口雨棚（小楼不做过多的附属构件，控制 draw call）
    if (w >= 14) {
      const canopy = new THREE.Mesh(box(Math.min(w * 0.42, 12), 0.34, 3.2), metalMaterial())
      canopy.position.set(0, podiumH + 0.17, d / 2 + 1.5)
      canopy.castShadow = true
      group.add(canopy)
    }
  }

  if (options.roofDetails !== false && totalFloors >= 3 && w >= 12 && d >= 9) {
    addRoofClutter(group, w, d, h, options.seed ?? Math.round(w * 97 + h * 31 + d * 13))
  }
  return group
}

/* ------------------------------ 屋顶设备 ------------------------------ */

function boxGeo(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotY = 0,
  rotX = 0,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d)
  if (rotX) geo.rotateX(rotX)
  if (rotY) geo.rotateY(rotY)
  geo.translate(x, y, z)
  return geo
}

function cylGeo(
  rTop: number,
  rBottom: number,
  h: number,
  x: number,
  y: number,
  z: number,
  segments = 14,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, segments)
  geo.translate(x, y, z)
  return geo
}

function addMeshFromGeos(group: THREE.Group, geos: THREE.BufferGeometry[], material: THREE.Material) {
  if (geos.length === 0) return
  const merged = mergeGeometries(geos, false)
  if (!merged) return
  const mesh = new THREE.Mesh(merged, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

/** 屋顶设备：设备间、水箱、空调外机、通风管、光伏板（合并成少量 draw call） */
function addRoofClutter(group: THREE.Group, w: number, d: number, h: number, seed: number) {
  const rng = mulberryLocal(seed)
  const stoneGeos: THREE.BufferGeometry[] = []
  const metalGeos: THREE.BufferGeometry[] = []
  const darkGeos: THREE.BufferGeometry[] = []
  const solarGeos: THREE.BufferGeometry[] = []
  const rw = Math.max(1, w - 3.2)
  const rd = Math.max(1, d - 3.2)

  // 楼梯间 / 设备间
  const pw = Math.min(5.2, w * 0.28)
  const pd = Math.min(4.6, d * 0.4)
  const ph = Math.min(3.2, h * 0.14) + 1.4
  const px = -w * 0.27 + rng() * 1.4
  const pz = -d * 0.22 + rng() * 1.2
  stoneGeos.push(boxGeo(pw, ph, pd, px, h + ph / 2, pz))
  stoneGeos.push(boxGeo(pw + 0.5, 0.22, pd + 0.5, px, h + 0.11, pz))
  darkGeos.push(boxGeo(1.0, 2.1, 0.12, px, h + 1.05, pz + pd / 2 + 0.02))

  // 水箱
  const tankCount = rng() > 0.4 ? 2 : 1
  for (let i = 0; i < tankCount; i++) {
    const tx = w * 0.22 + rng() * Math.max(0.5, rw * 0.18)
    const tz = -rd * 0.25 + rng() * rd * 0.5
    const r = 0.9 + rng() * 0.5
    const th = 1.6 + rng() * 0.6
    metalGeos.push(cylGeo(r, r, th, tx, h + th / 2 + 0.5, tz))
    metalGeos.push(cylGeo(r + 0.08, r + 0.08, 0.16, tx, h + 0.58, tz))
    for (const sx of [-0.7, 0.7]) {
      for (const sz of [-0.7, 0.7]) {
        stoneGeos.push(boxGeo(0.16, 0.55, 0.16, tx + sx * r * 0.8, h + 0.27, tz + sz * r * 0.8))
      }
    }
  }

  // 空调外机
  const acCount = 3 + ((rng() * 4) | 0)
  for (let i = 0; i < acCount; i++) {
    const ax = (rng() - 0.5) * rw
    const az = (rng() - 0.5) * rd
    const aw = 1.6 + rng() * 0.9
    const ah = 0.9 + rng() * 0.5
    const ad = 1.2 + rng() * 0.5
    metalGeos.push(boxGeo(aw, ah, ad, ax, h + ah / 2 + 0.1, az, rng() * 0.2))
    darkGeos.push(cylGeo(aw * 0.28, aw * 0.28, 0.06, ax, h + ah + 0.12, az, 12))
  }

  // 通风管
  const ventCount = 2 + ((rng() * 3) | 0)
  for (let i = 0; i < ventCount; i++) {
    const vx = (rng() - 0.5) * rw
    const vz = (rng() - 0.5) * rd
    const vh = 0.8 + rng() * 0.8
    metalGeos.push(cylGeo(0.22, 0.24, vh, vx, h + vh / 2, vz, 10))
    darkGeos.push(cylGeo(0.32, 0.32, 0.08, vx, h + vh + 0.04, vz, 10))
  }

  // 光伏板（约一半的大楼有）
  if (w >= 18 && d >= 11 && rng() > 0.45) {
    const panelW = 3.6
    const panelD = 2.2
    const cols = Math.max(1, Math.floor(rw / (panelW + 0.7)))
    const rows = Math.max(1, Math.min(2, Math.floor(rd / (panelD + 1))))
    const startX = -((cols - 1) * (panelW + 0.7)) / 2 + 1
    const startZ = rd / 2 - 2.4
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        solarGeos.push(
          boxGeo(
            panelW,
            0.12,
            panelD,
            startX + c * (panelW + 0.7),
            h + 1.15,
            startZ - r * (panelD + 1),
            0,
            -0.42,
          ),
        )
        stoneGeos.push(
          boxGeo(0.12, 0.85, 0.12, startX + c * (panelW + 0.7) - panelW * 0.35, h + 0.42, startZ - r * (panelD + 1) + 0.6),
        )
        stoneGeos.push(
          boxGeo(0.12, 0.9, 0.12, startX + c * (panelW + 0.7) + panelW * 0.35, h + 0.45, startZ - r * (panelD + 1) + 0.6),
        )
      }
    }
  }

  addMeshFromGeos(group, stoneGeos, paintedStone('#cfcbc2'))
  addMeshFromGeos(group, metalGeos, metalMaterial())
  addMeshFromGeos(group, darkGeos, paint('#2a2e33', 0.55, 0.2))
  addMeshFromGeos(group, solarGeos, solarPanelMaterial())
}

function mulberryLocal(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 收集组内所有窗户材质（夜晚统一调 emissiveIntensity） */
export function collectWindowMaterials(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const mats: THREE.MeshStandardMaterial[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = (o as THREE.Mesh).material
      const list = Array.isArray(m) ? m : [m]
      for (const mm of list) {
        const sm = mm as THREE.MeshStandardMaterial
        if (sm.emissiveMap && !mats.includes(sm)) mats.push(sm)
      }
    }
  })
  return mats
}

function finish(g: THREE.Group, opts: BuildingOptions): THREE.Group {
  g.userData.building = { name: opts.name, info: opts.info } satisfies BuildingData
  return g
}

/** 三棱柱（楣饰山花）：宽 w、高 h、厚 d */
function triangularPrism(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  const A = [-hw, 0, hd], B = [hw, 0, hd], C = [0, h, hd]
  const D = [-hw, 0, -hd], E = [hw, 0, -hd], F = [0, h, -hd]
  const verts = [
    ...A, ...B, ...C,
    ...B, ...E, ...F, ...B, ...F, ...C,
    ...E, ...D, ...F,
    ...D, ...A, ...C, ...D, ...C, ...F,
  ]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.computeVertexNormals()
  return geo
}

/** 台阶（叠放的盒子） */
function steps(w: number, levels = 3, stepH = 0.32, stepD = 0.5): THREE.Group {
  const g = new THREE.Group()
  const mat = stoneMaterial()
  for (let i = 0; i < levels; i++) {
    const m = new THREE.Mesh(box(w - i * 0.9, stepH, stepD * (levels - i)), mat)
    m.position.set(0, (stepH * (i + 1)) / 2, (stepD * (levels - i)) / 2 - (stepD * levels) / 2)
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
  }
  return g
}

const SIGN_MATERIALS = new Map<string, THREE.MeshStandardMaterial>()

function signMaterial(text: string, bg: string, fg: string) {
  const key = `${text}|${bg}|${fg}`
  const hit = SIGN_MATERIALS.get(key)
  if (hit) return hit
  const mat = new THREE.MeshStandardMaterial({
    map: makeSignTexture(text, bg, fg),
    roughness: 0.5,
    metalness: 0.1,
    envMapIntensity: 0.5,
  })
  SIGN_MATERIALS.set(key, mat)
  return mat
}

function signPlane(text: string, w: number, h: number, bg = '#274a68', fg = '#f4e6b8') {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), signMaterial(text, bg, fg))
}

/* ------------------------------ 图书馆 ------------------------------ */
export function buildLibrary(opts: BuildingOptions): THREE.Group {
  const g = new THREE.Group()
  // 主体 + 两翼：玻璃幕墙 + 米色石材
  const main = makeWindowedBox(34, 24, 16, 7, 0.42, { variant: 'glass', seed: 11 })
  main.position.z = -2
  g.add(main)
  const wingL = makeWindowedBox(14, 18, 14, 5, 0.42, { variant: 'tile', seed: 12 })
  wingL.position.set(-24, 0, 0)
  const wingR = makeWindowedBox(14, 18, 14, 5, 0.42, { variant: 'tile', seed: 13 })
  wingR.position.set(24, 0, 0)
  g.add(wingL, wingR)

  // 正面柱廊（大理石质感）
  const colMat = paintedStone('#f0eadc')
  for (let i = 0; i < 6; i++) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, 10, 18), colMat)
    col.position.set(-10 + i * 4, 5, 9.5)
    col.castShadow = true
    g.add(col)
  }
  const entablature = new THREE.Mesh(box(25, 1.6, 3), colMat)
  entablature.position.set(0, 10.8, 9.5)
  entablature.castShadow = true
  g.add(entablature)
  const pediment = new THREE.Mesh(triangularPrism(25, 3, 3), colMat)
  pediment.position.set(0, 11.6, 9.5)
  pediment.castShadow = true
  g.add(pediment)

  const sign = signPlane('图 书 馆', 12, 1.9)
  sign.position.set(0, 15.2, 9.6)
  g.add(sign)

  const st = steps(14, 3)
  st.position.z = 11.2
  g.add(st)
  return finish(g, opts)
}

/* ------------------------------ 教学楼 ------------------------------ */
export function buildTeachingBuilding(opts: BuildingOptions): THREE.Group {
  const g = new THREE.Group()
  const body = makeWindowedBox(30, 20, 13, 6, 0.4, { variant: 'tile', seed: 21 })
  g.add(body)
  const parapet = new THREE.Mesh(box(31, 0.8, 14), paintedStone('#c9c6be'))
  parapet.position.y = 20.4
  parapet.castShadow = true
  g.add(parapet)

  const porch = new THREE.Mesh(box(8, 4.2, 3), paintedStone('#e2ddd2'))
  porch.position.set(0, 2.1, 8)
  porch.castShadow = true
  g.add(porch)
  const porchRoof = new THREE.Mesh(box(9.5, 0.4, 4.2), metalMaterial())
  porchRoof.position.set(0, 4.4, 8.3)
  porchRoof.castShadow = true
  g.add(porchRoof)

  const sign = signPlane(opts.name, 9, 1.5)
  sign.position.set(0, 3.9, 9.56)
  g.add(sign)

  const st = steps(9, 2)
  st.position.z = 9.6
  g.add(st)
  return finish(g, opts)
}

/* ------------------------------ 实验楼 ------------------------------ */
export function buildLabBuilding(opts: BuildingOptions): THREE.Group {
  const g = new THREE.Group()
  const body = makeWindowedBox(26, 16, 14, 5, 0.4, { variant: 'concrete', seed: 31 })
  g.add(body)
  const stair = makeWindowedBox(8, 20, 8, 6, 0.4, { variant: 'concrete', seed: 32 })
  stair.position.set(10, 0, 0)
  g.add(stair)

  const sign = signPlane(opts.name, 10, 1.5)
  sign.position.set(-3, 4.2, 7.06)
  g.add(sign)

  const porch = new THREE.Mesh(box(8, 3.8, 2.6), paintedStone('#e2ddd2'))
  porch.position.set(-3, 1.9, 8.2)
  porch.castShadow = true
  g.add(porch)

  const st = steps(8, 2)
  st.position.z = 9.6
  g.add(st)
  return finish(g, opts)
}

/* ------------------------------ 学生宿舍 ------------------------------ */
export function buildDormitory(opts: BuildingOptions): THREE.Group {
  const g = new THREE.Group()
  const body = makeWindowedBox(26, 18, 11, 6, 0.55, { variant: 'brick', seed: 41 })
  g.add(body)
  const rail = new THREE.Mesh(box(26.4, 0.9, 0.3), paintedStone('#e6e1d6'))
  rail.position.set(0, 1.4, 5.65)
  g.add(rail)
  const roof = new THREE.Mesh(box(27, 1, 12), tintedRoof('#a8503f'))
  roof.position.y = 18.5
  roof.castShadow = true
  g.add(roof)

  const sign = signPlane(opts.name, 8, 1.4, '#7d3a2f', '#f4e6b8')
  sign.position.set(0, 4.4, 5.61)
  g.add(sign)

  const porch = new THREE.Mesh(box(6, 3.6, 2.2), paintedStone('#e2ddd2'))
  porch.position.set(0, 1.8, 6.4)
  porch.castShadow = true
  g.add(porch)

  const st = steps(6, 2)
  st.position.z = 7.5
  g.add(st)
  return finish(g, opts)
}

/* ------------------------------ 食堂 ------------------------------ */
export function buildCanteen(opts: BuildingOptions): THREE.Group {
  const g = new THREE.Group()
  const body = makeWindowedBox(24, 9, 15, 2, 0.5, { variant: 'tile', seed: 51 })
  g.add(body)
  const roof = new THREE.Mesh(box(25.5, 1.1, 16.5), tintedRoof('#7d8a94'))
  roof.position.y = 9.4
  roof.castShadow = true
  g.add(roof)

  const glass = new THREE.Mesh(box(14, 5.5, 0.4), glassMaterial('#8fc3e8'))
  glass.position.set(0, 2.75, 7.72)
  g.add(glass)

  const sign = signPlane(opts.name, 10, 1.6, '#7d3a2f', '#f4e6b8')
  sign.position.set(0, 7.6, 7.76)
  g.add(sign)

  const st = steps(12, 2)
  st.position.z = 7.8
  g.add(st)
  return finish(g, opts)
}

/* ------------------------------ 体育馆（穹顶） ------------------------------ */
export function buildGymnasium(opts: BuildingOptions): THREE.Group {
  const g = new THREE.Group()
  const R = 15
  // 底层玻璃幕墙（开口圆柱，UV 按幕墙单元缩放）
  const baseGeo = new THREE.CylinderGeometry(R, R + 0.6, 9, 48, 1, true)
  const circumference = 2 * Math.PI * R
  scaleUv(baseGeo, circumference / 6.2, 9 / 6.2)
  const base = new THREE.Mesh(baseGeo, facadeMaterial('glass'))
  base.position.y = 4.5
  base.castShadow = true
  base.receiveShadow = true
  g.add(base)

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(R, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    metalMaterial(),
  )
  dome.position.y = 9
  dome.castShadow = true
  g.add(dome)

  const spire = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 14, 14),
    metalMaterial(),
  )
  spire.position.y = 9 + R
  g.add(spire)

  const entrance = new THREE.Mesh(box(10, 6, 4), paintedStone('#e2ddd2'))
  entrance.position.set(0, 3, R + 1.4)
  entrance.castShadow = true
  g.add(entrance)

  const sign = signPlane(opts.name, 9, 1.6)
  sign.position.set(0, 5.2, R + 3.46)
  g.add(sign)

  g.add(steps(10, 2))
  return finish(g, opts)
}

/* ------------------------------ 校门 ------------------------------ */
export function buildGate(opts: BuildingOptions): THREE.Group {
  const g = new THREE.Group()
  const houseMat = paintedStone('#e0dbcf')
  for (const sx of [-11, 11]) {
    const house = new THREE.Mesh(box(7, 7.5, 7), houseMat)
    house.position.set(sx, 3.75, 0)
    house.castShadow = true
    house.receiveShadow = true
    g.add(house)
    const roof = new THREE.Mesh(box(8, 0.8, 8), tintedRoof('#7d3a2f'))
    roof.position.set(sx, 7.9, 0)
    roof.castShadow = true
    g.add(roof)
    const win = new THREE.Mesh(box(4.6, 1.8, 0.2), glassMaterial('#315a80'))
    win.position.set(sx, 4.6, 3.56)
    g.add(win)
  }
  const beam = new THREE.Mesh(box(30, 2.6, 3.4), paintedStone('#d9d4c8'))
  beam.position.y = 9.5
  beam.castShadow = true
  g.add(beam)
  const signMat = new THREE.MeshStandardMaterial({
    map: makeSignTexture('青岛黄海学院', '#8c1f28', '#f7d774'),
    roughness: 0.45,
    metalness: 0.1,
  })
  for (const side of [1, -1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.1), signMat)
    sign.position.set(0, 9.5, side * 1.76)
    if (side < 0) sign.rotation.y = Math.PI
    g.add(sign)
  }
  const crest = new THREE.Mesh(box(4, 0.7, 2), paint('#8c1f28', 0.55, 0.05))
  crest.position.y = 11.15
  g.add(crest)
  return finish(g, opts)
}

/* ------------------------------ 钟楼 ------------------------------ */
export function buildClockTower(opts: BuildingOptions): THREE.Group {
  const g = new THREE.Group()
  const stoneMat = paintedStone('#e2ddd0')
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 18, 4, 1), stoneMat)
  shaft.rotation.y = Math.PI / 4
  shaft.position.y = 9
  shaft.castShadow = true
  shaft.receiveShadow = true
  g.add(shaft)

  const faceMat = new THREE.MeshStandardMaterial({
    map: makeClockTexture(),
    roughness: 0.5,
    metalness: 0.05,
    envMapIntensity: 0.4,
  })
  const faces: THREE.Group[] = []
  for (let i = 0; i < 4; i++) {
    const face = new THREE.Group()
    const disk = new THREE.Mesh(new THREE.CircleGeometry(1.7, 28), faceMat)
    face.add(disk)
    const hourHand = new THREE.Mesh(box(0.12, 0.85, 0.06), paint('#222222', 0.4, 0.3))
    hourHand.geometry.translate(0, 0.42, 0)
    hourHand.position.z = 0.05
    const minuteHand = new THREE.Mesh(box(0.09, 1.25, 0.06), paint('#222222', 0.4, 0.3))
    minuteHand.geometry.translate(0, 0.62, 0)
    minuteHand.position.z = 0.09
    face.add(hourHand, minuteHand)
    face.userData.hands = { hour: hourHand, minute: minuteHand }
    const a = (i * Math.PI) / 2
    face.position.set(Math.sin(a) * 1.55, 15.4, Math.cos(a) * 1.55)
    face.rotation.y = a
    faces.push(face)
    g.add(face)
  }
  g.userData.clockFaces = faces

  const cornice = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.8, 4), stoneMat)
  cornice.rotation.y = Math.PI / 4
  cornice.position.y = 19.4
  cornice.castShadow = true
  g.add(cornice)

  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 4.2, 4), tintedRoof('#7d3a2f'))
  roof.rotation.y = Math.PI / 4
  roof.position.y = 21.9
  roof.castShadow = true
  g.add(roof)

  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 12, 12),
    paint('#d9b23a', 0.25, 0.85),
  )
  finial.position.y = 24.2
  g.add(finial)
  return finish(g, opts)
}

/* ==================== 通用建筑工厂（供数据驱动布局调用） ==================== */

export interface GenericBuildingOptions {
  name: string
  info: string
  /** 平面尺寸 */
  w: number
  d: number
  floors: number
  litRatio?: number
  /** 入口朝向（+z 为正面） */
  porch?: boolean
  variant?: FacadeVariant
  roofDetails?: boolean
  /** 女儿墙 / 檐口的强调色 */
  accentColor?: string
}

/** 通用教学楼/办公楼：窗户楼体 + 女儿墙 + 门牌 */
export function makeGenericBuilding(o: GenericBuildingOptions): THREE.Group {
  const g = new THREE.Group()
  const h = o.floors * 3.1
  const variant = o.variant ?? facadeVariantFor(o.name)
  g.add(
    makeWindowedBox(o.w, h, o.d, o.floors, o.litRatio ?? 0.42, {
      variant,
      seed: hashString(o.name),
    }),
  )
  const parapet = new THREE.Mesh(
    box(o.w + 1, 0.8, o.d + 1),
    paintedStone(o.accentColor ?? '#cac7bf'),
  )
  parapet.position.y = h + 0.4
  parapet.castShadow = true
  g.add(parapet)
  g.userData.parapet = parapet
  if (o.porch !== false) {
    const porch = new THREE.Mesh(box(Math.min(8, o.w * 0.32), 3.4, 2), paintedStone('#e2ddd2'))
    porch.position.set(0, 1.7, o.d / 2 + 0.8)
    porch.castShadow = true
    g.add(porch)
    const canopy = new THREE.Mesh(box(Math.min(9, o.w * 0.36), 0.3, 2.8), metalMaterial())
    canopy.position.set(0, 3.55, o.d / 2 + 1.2)
    canopy.castShadow = true
    g.add(canopy)
  }
  const signW = Math.min(Math.max(o.w * 0.5, 6), 12)
  const sign = signPlane(o.name, signW, 1.4)
  sign.position.set(0, Math.max(h * 0.62, 3.9), o.d / 2 + 0.06)
  g.add(sign)
  g.userData.building = { name: o.name, info: o.info } satisfies BuildingData
  return g
}

/** 学生宿舍楼：较窄的窗户楼体 + 彩色屋顶 + 楼号牌 */
export function makeDormBlock(o: {
  name: string
  info: string
  w?: number
  d?: number
  floors?: number
  litRatio?: number
  roofColor?: string
  variant?: FacadeVariant
  roofDetails?: boolean
}): THREE.Group {
  const w = o.w ?? 22
  const d = o.d ?? 10
  const floors = o.floors ?? 4
  const g = new THREE.Group()
  const h = floors * 3.0
  g.add(
    makeWindowedBox(w, h, d, floors, o.litRatio ?? 0.5, {
      variant: o.variant ?? facadeVariantFor(o.name),
      roofDetails: o.roofDetails ?? false,
      seed: hashString(o.name) + Math.round(w * 13 + d * 7),
    }),
  )
  const roof = new THREE.Mesh(box(w + 1.4, 0.9, d + 1.4), tintedRoof(o.roofColor ?? '#a8503f'))
  roof.position.y = h + 0.45
  roof.castShadow = true
  g.add(roof)
  const porch = new THREE.Mesh(box(5, 3, 1.8), paintedStone('#e2ddd2'))
  porch.position.set(0, 1.5, d / 2 + 0.7)
  porch.castShadow = true
  g.add(porch)
  g.userData.building = { name: o.name, info: o.info } satisfies BuildingData
  return g
}

/** 校门牌坊：双柱 + 横梁 + 校名/门名匾额（跨在路上） */
export function makeGateArch(name: string, width: number): THREE.Group {
  const g = new THREE.Group()
  const pillarMat = paintedStone('#e0dbcf')
  for (const sx of [-width / 2, width / 2]) {
    const p = new THREE.Mesh(box(2.2, 8, 2.2), pillarMat)
    p.position.set(sx, 4, 0)
    p.castShadow = true
    g.add(p)
    const cap = new THREE.Mesh(box(2.9, 0.4, 2.9), paintedStone('#cfcac0'))
    cap.position.set(sx, 8.2, 0)
    cap.castShadow = true
    g.add(cap)
  }
  const beam = new THREE.Mesh(box(width + 2.2, 2.2, 2.6), paintedStone('#d9d4c8'))
  beam.position.y = 9.1
  beam.castShadow = true
  g.add(beam)
  const signMat = new THREE.MeshStandardMaterial({
    map: makeSignTexture(name, '#8c1f28', '#f7d774'),
    roughness: 0.45,
    metalness: 0.1,
  })
  for (const side of [1, -1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.72, 1.7), signMat)
    sign.position.set(0, 9.1, side * 1.36)
    if (side < 0) sign.rotation.y = Math.PI
    g.add(sign)
  }
  const crest = new THREE.Mesh(box(3, 0.6, 1.6), paint('#8c1f28', 0.55, 0.05))
  crest.position.y = 10.5
  g.add(crest)
  g.userData.building = { name, info: `${name}：连接城市道路与校园的主要出入口。` } satisfies BuildingData
  return g
}

function hashString(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
