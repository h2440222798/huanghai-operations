import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

import {
  asphaltMaterial,
  barkMaterial,
  grassMaterial,
  leafMaterial,
  metalMaterial,
  paint,
  paverMaterial,
  plazaMaterial,
  sandMaterial,
  stoneMaterial,
  wetSandMaterial,
} from './materials'
import { crosswalkTexture } from './pbrTextures'
import { scaleUv } from './procedural'

/** 确定性伪随机数（mulberry32），保证每次刷新校园布局一致 */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 树木种植的排除区域：矩形 [minX, maxX, minZ, maxZ] */
export type Rect = [number, number, number, number]

/* ------------------------------ 水面着色器 ------------------------------ */

const waterVertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  varying vec3 vNormalW;

  // 多组不同方向 / 频率 / 相位的正弦波叠加
  float waveH(vec2 p, float t) {
    float h = 0.0;
    h += sin(p.x * 0.26 + t * 1.05) * 0.15;
    h += sin((p.x * 0.55 + p.y * 0.80) + t * 1.60) * 0.10;
    h += sin((p.x * -0.52 + p.y * 0.68) * 1.35 - t * 1.25) * 0.08;
    h += sin(p.y * 0.95 + t * 2.10) * 0.05;
    return h;
  }

  void main() {
    vUv = uv;
    vec3 pos = position;
    float h = waveH(pos.xz, uTime);
    pos.y += h;
    // 波高函数解析求导 → 平滑法线（避免逐像素重建的棋盘感）
    float e = 0.55;
    float hx = waveH(pos.xz + vec2(e, 0.0), uTime);
    float hz = waveH(pos.xz + vec2(0.0, e), uTime);
    vec3 n = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
    vNormalW = normalize(mat3(modelMatrix) * n);
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const waterFragmentShader = /* glsl */ `
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uNight;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  varying vec3 vNormalW;

  void main() {
    // 椭圆水岸：uv 中心化到 [-1,1]，平面网格超出部分丢弃
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;

    // 高频细碎波纹扰动法线（世界坐标下滚动）
    vec3 n = normalize(vNormalW);
    float w1 = sin(vWorldPos.x * 2.1 + uTime * 2.4) * sin(vWorldPos.z * 1.8 - uTime * 2.1);
    float w2 = sin(vWorldPos.x * 3.6 - uTime * 3.0) * sin(vWorldPos.z * 3.2 + uTime * 2.7);
    n = normalize(n + vec3(w1 * 0.055 + w2 * 0.035, 0.0, w1 * 0.045 - w2 * 0.045));

    vec3 v = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);

    // 深浅水色：湖心深、岸边浅碧
    vec3 base = mix(uShallowColor, uDeepColor, smoothstep(0.5, 0.92, r));
    vec3 col = mix(base, uSkyColor, clamp(fresnel * 1.5, 0.0, 0.7));

    // 太阳 / 月亮方向的高光与细碎闪光（夜晚减弱）
    float lightAmt = 1.0 - uNight * 0.8;
    vec3 hv = normalize(v + normalize(uSunDir));
    float ndh = max(dot(n, hv), 0.0);
    col += vec3(1.0, 0.97, 0.88) * pow(ndh, 160.0) * 1.8 * lightAmt;
    col += vec3(1.0) * pow(ndh, 24.0) * 0.12 * lightAmt;

    // 岸边泡沫：边缘环带 + 随时间涌动的波纹
    float foamEdge = smoothstep(0.84, 0.99, r);
    float band = 0.5 + 0.5 * sin(r * 44.0 - uTime * 2.2 + sin(atan(p.y, p.x) * 5.0) * 1.3);
    float foam = foamEdge * (0.14 + 0.4 * band) * (1.0 - uNight * 0.78);
    col = mix(col, vec3(0.93, 0.97, 1.0), clamp(foam, 0.0, 0.62));

    gl_FragColor = vec4(col, 0.94);
  }
`

export interface Water {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
}

/** 椭圆水面（含湖底与沙滩环），用于小西湖 / 方塘等水体 */
export function makePond(center: THREE.Vector2, rx: number, rz: number): { group: THREE.Group; water: Water } {
  const group = new THREE.Group()
  const geo = new THREE.PlaneGeometry(rx * 2, rz * 2, 72, 52)
  geo.rotateX(-Math.PI / 2)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color('#12586e') },
      uShallowColor: { value: new THREE.Color('#3fa3a4') },
      uSkyColor: { value: new THREE.Color('#9ec7e8') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uNight: { value: 0 },
    },
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    transparent: true,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.position.set(center.x, 0.22, center.y)
  mesh.renderOrder = 2
  group.add(mesh)

  // 湖底淤泥
  const bed = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    paint('#17343d', 0.95),
  )
  bed.rotation.x = -Math.PI / 2
  bed.scale.set(rx * 1.01, rz * 1.01, 1)
  bed.position.set(center.x, 0.06, center.y)
  group.add(bed)

  // 石砌驳岸
  const rimGeo = new THREE.RingGeometry(1.0, 1.09, 56).rotateX(-Math.PI / 2)
  scaleUv(rimGeo, rx * 0.7, rz * 0.7)
  const rim = new THREE.Mesh(rimGeo, stoneMaterial())
  rim.scale.set(rx, 1, rz)
  rim.position.set(center.x, 0.1, center.y)
  rim.receiveShadow = true
  group.add(rim)

  // 沙滩环
  const sandGeo = new THREE.RingGeometry(1.07, 1.2, 56).rotateX(-Math.PI / 2)
  scaleUv(sandGeo, rx * 0.5, rz * 0.5)
  const sand = new THREE.Mesh(sandGeo, sandMaterial())
  sand.scale.set(rx, 1, rz)
  sand.position.set(center.x, 0.07, center.y)
  sand.receiveShadow = true
  group.add(sand)

  return { group, water: { mesh, material } }
}

/* ------------------------------ 道路 ------------------------------ */

/** 稳定的微小 y 偏移：让交叉路口的两条路不会 z-fighting */
let roadSerial = 0
function roadJitter(_x: number, _z: number, _w: number, _h: number) {
  return (roadSerial++ % 16) * 0.0025
}

/**
 * 道路：沥青路面 + 两侧人行道。
 * 人行道铺装比路面低约 5cm，路口处两条路通过极小的 y 偏移避免闪面。
 */
export function makeRoad(
  w: number,
  h: number,
  x: number,
  z: number,
  options: { sidewalk?: boolean; sidewalkWidth?: number } = {},
): THREE.Group {
  const g = new THREE.Group()
  const jitter = roadJitter(x, z, w, h)
  const roadY = 0.17 + jitter
  const walkY = 0.118 + jitter * 0.6
  const sidewalk = options.sidewalk !== false
  const sw = options.sidewalkWidth ?? 3.2

  if (sidewalk) {
    const horizontal = w >= h
    const walkW = horizontal ? w : w + sw * 2
    const walkH = horizontal ? h + sw * 2 : h
    const walkGeo = new THREE.PlaneGeometry(walkW, walkH).rotateX(-Math.PI / 2)
    scaleUv(walkGeo, walkW / 3.2, walkH / 3.2)
    const walk = new THREE.Mesh(walkGeo, paverMaterial())
    walk.position.set(x, walkY, z)
    walk.receiveShadow = true
    g.add(walk)
  }

  const roadGeo = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2)
  scaleUv(roadGeo, w / 8, h / 8)
  const road = new THREE.Mesh(roadGeo, asphaltMaterial())
  road.position.set(x, roadY, z)
  road.receiveShadow = true
  g.add(road)
  return g
}

/** 道路中央黄色虚线（from → to） */
export function makeRoadDashes(from: THREE.Vector2, to: THREE.Vector2, y = 0.245): THREE.Group {
  const g = new THREE.Group()
  const mat = paint('#e8c93a', 0.65, 0)
  const dir = new THREE.Vector2(to.x - from.x, to.y - from.y)
  const len = dir.length()
  dir.normalize()
  const angle = Math.atan2(dir.y, dir.x)
  for (let d = 3; d < len - 3; d += 9) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.3), mat)
    dash.rotation.x = -Math.PI / 2
    dash.rotation.z = -angle
    dash.position.set(from.x + dir.x * d, y, from.y + dir.y * d)
    g.add(dash)
  }
  return g
}

/** 路缘白线（offset 为横向偏移） */
export function makeRoadEdge(from: THREE.Vector2, to: THREE.Vector2, offset: number, y = 0.24): THREE.Mesh {
  const dir = new THREE.Vector2(to.x - from.x, to.y - from.y)
  const len = dir.length()
  dir.normalize()
  const n = new THREE.Vector2(-dir.y, dir.x)
  const mat = paint('#dfe2e6', 0.7, 0)
  const line = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.25), mat)
  line.rotation.x = -Math.PI / 2
  line.rotation.z = -Math.atan2(dir.y, dir.x)
  line.position.set((from.x + to.x) / 2 + n.x * offset, y, (from.y + to.y) / 2 + n.y * offset)
  return line
}

let crosswalkMat: THREE.MeshStandardMaterial | null = null

/**
 * 斑马线：贴图铺在路面上（透明底 + 白条 + 磨损）。
 * along='x' 表示道路沿 x 方向，行人沿 z 穿越。
 */
export function makeCrosswalk(
  x: number,
  z: number,
  width: number,
  roadWidth: number,
  along: 'x' | 'z' = 'x',
): THREE.Mesh {
  if (!crosswalkMat) {
    crosswalkMat = new THREE.MeshStandardMaterial({
      map: crosswalkTexture(),
      transparent: true,
      alphaTest: 0.12,
      roughness: 0.72,
      metalness: 0,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  }
  const geo = new THREE.PlaneGeometry(width, roadWidth).rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(geo, crosswalkMat)
  mesh.position.set(x, 0.252, z)
  if (along === 'z') mesh.rotation.y = Math.PI / 2
  mesh.receiveShadow = true
  return mesh
}

/** 停车线（路口白色粗实线） */
export function makeStopLine(
  x: number,
  z: number,
  length: number,
  along: 'x' | 'z' = 'x',
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(along === 'x' ? 0.45 : length, along === 'x' ? length : 0.45)
  geo.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(geo, paint('#eef0ec', 0.7, 0))
  mesh.position.set(x, 0.248, z)
  return mesh
}

/** 圆形广场铺装 */
export function makePavementDisc(x: number, z: number, r: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(r, 56).rotateX(-Math.PI / 2)
  scaleUv(geo, r / 1.6, r / 1.6)
  const mesh = new THREE.Mesh(geo, plazaMaterial())
  mesh.position.set(x, 0.135, z)
  mesh.receiveShadow = true
  return mesh
}

export interface ApronRect {
  x: number
  z: number
  w: number
  d: number
}

/**
 * 建筑周边硬质铺装：把每栋楼脚下 1~2 米的草地换成铺装，
 * 既遮住“楼直接从草里长出来”的接缝，也让校园更像经过设计的场地。
 * 所有楼一起合并成一个 mesh，draw call 只增加 1。
 */
export function makeBuildingAprons(rects: ApronRect[]): THREE.Mesh | null {
  if (rects.length === 0) return null
  const geos: THREE.BufferGeometry[] = []
  rects.forEach((r, i) => {
    const geo = new THREE.PlaneGeometry(r.w, r.d).rotateX(-Math.PI / 2)
    scaleUv(geo, r.w / 3.2, r.d / 3.2)
    // 每块铺装抬高一丝，避免相邻建筑铺装重叠时闪面
    geo.translate(r.x, 0.09 + (i % 16) * 0.0014, r.z)
    geos.push(geo)
  })
  const merged = mergeGeometries(geos, false)
  if (!merged) return null
  const mesh = new THREE.Mesh(merged, paverMaterial())
  mesh.name = 'buildingAprons'
  mesh.receiveShadow = true
  return mesh
}

/** 停车场：沥青面 + 白色车位线 */
export function makeParkingLot(x: number, z: number, w: number, d: number): THREE.Group {
  const g = new THREE.Group()
  const lotGeo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)
  scaleUv(lotGeo, w / 8, d / 8)
  const lot = new THREE.Mesh(lotGeo, asphaltMaterial())
  lot.position.set(x, 0.15, z)
  lot.receiveShadow = true
  g.add(lot)
  const lineMat = paint('#e8e8e6', 0.8, 0)
  const count = Math.floor(w / 3)
  for (let i = 0; i <= count; i++) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 2.4), lineMat)
    line.rotation.x = -Math.PI / 2
    line.position.set(x - w / 2 + i * 3, 0.17, z - d / 2 + 1.4)
    g.add(line)
    const line2 = line.clone()
    line2.position.z = z + d / 2 - 1.4
    g.add(line2)
  }
  return g
}

/* ------------------------------ 山体 ------------------------------ */

/** 低多边形山体（龙山 / 虎山 / 山体公园），按高度混合林地和岩石色 */
export function makeMountain(x: number, z: number, r: number, h: number, color = '#4e7a3c'): THREE.Mesh {
  const geo = new THREE.ConeGeometry(r, h, 11, 4)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  // 顶点色只做明暗 / 冷暖调制，真正的绿色来自草地贴图
  const low = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.55)
  const high = new THREE.Color('#e8e6d8')
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / h + 0.5, 0, 1)
    const c = low.clone().lerp(high, Math.pow(t, 2.4) * 0.7)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  scaleUv(geo, 8, 4)
  const mat = new THREE.MeshStandardMaterial({
    map: grassMaterial().map,
    normalMap: grassMaterial().normalMap,
    roughnessMap: grassMaterial().roughnessMap,
    metalnessMap: grassMaterial().metalnessMap,
    roughness: 1,
    metalness: 1,
    vertexColors: true,
    flatShading: true,
    envMapIntensity: 0.6,
  })
  mat.normalScale.set(0.5, 0.5)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, h / 2 - 0.5, z)
  mesh.rotation.y = Math.random() * Math.PI
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** 在山体锥面上撒一片松树，让远山不是光秃秃的圆锥 */
export function makeMountainForest(
  x: number,
  z: number,
  r: number,
  h: number,
  options: { count?: number; seed?: number } = {},
): THREE.InstancedMesh[] {
  const rng = mulberry32(options.seed ?? 20261022)
  const style: TreeStyle = { trunkH: 3.0, trunkR: 0.27, leafColor: '#2f5528', kind: 'pine' }
  const count = options.count ?? 180
  const positions: { x: number; z: number; y: number; s: number; rot: number }[] = []
  for (let i = 0; i < count; i++) {
    const u = 0.24 + rng() * 0.68
    const a = rng() * Math.PI * 2
    const rr = r * u * 0.94
    positions.push({
      x: x + Math.cos(a) * rr,
      z: z + Math.sin(a) * rr,
      y: h * (1 - u) - 0.5,
      s: 0.45 + rng() * 0.62,
      rot: rng() * Math.PI * 2,
    })
  }
  return makeTrees(style, positions)
}

/* ------------------------------ 树木 ------------------------------ */

export interface TreeStyle {
  trunkH: number
  trunkR: number
  leafColor: string
  kind: 'round' | 'pine'
}

/** 创建一批实例化树木（树干 + 树冠分离的 InstancedMesh），并按实例做颜色变化 */
export function makeTrees(
  style: TreeStyle,
  positions: { x: number; z: number; y?: number; s: number; rot: number }[],
): THREE.InstancedMesh[] {
  const trunkGeo = new THREE.CylinderGeometry(style.trunkR * 0.62, style.trunkR, style.trunkH, 7)
  trunkGeo.translate(0, style.trunkH / 2, 0)
  scaleUv(trunkGeo, 2, style.trunkH / 1.6)
  const trunks = new THREE.InstancedMesh(trunkGeo, barkMaterial(), positions.length)

  let crownGeo: THREE.BufferGeometry
  if (style.kind === 'pine') {
    crownGeo = new THREE.ConeGeometry(style.trunkR * 9, style.trunkH * 2.2, 9)
    crownGeo.translate(0, style.trunkH + style.trunkH * 0.95, 0)
    scaleUv(crownGeo, 3, 2)
  } else {
    crownGeo = new THREE.IcosahedronGeometry(style.trunkR * 8.2, 1)
    crownGeo.scale(1, 0.92, 1)
    crownGeo.translate(0, style.trunkH + style.trunkR * 5.6, 0)
    scaleUv(crownGeo, 2.5, 2.5)
  }
  const crowns = new THREE.InstancedMesh(crownGeo, leafMaterial(), positions.length)

  const matrix = new THREE.Matrix4()
  const quat = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const color = new THREE.Color()
  const white = new THREE.Color('#ffffff')
  // 贴图本身是绿色，实例色只做接近白色的深浅 / 冷暖变化
  const base = new THREE.Color(style.leafColor).lerp(white, 0.82)
  positions.forEach((p, i) => {
    // 轻微倾斜 + 非均匀缩放，避免整片树林像复制粘贴的棒棒糖
    const tiltX = (((i * 31) % 100) / 100 - 0.5) * 0.1
    const tiltZ = (((i * 61) % 100) / 100 - 0.5) * 0.1
    euler.set(tiltX, p.rot, tiltZ)
    quat.setFromEuler(euler)
    const sx = p.s * (0.84 + (((i * 29) % 100) / 100) * 0.34)
    const sy = p.s * (0.9 + (((i * 17) % 100) / 100) * 0.24)
    const sz = p.s * (0.84 + (((i * 43) % 100) / 100) * 0.34)
    matrix.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), quat, new THREE.Vector3(sx, sy, sz))
    trunks.setMatrixAt(i, matrix)
    crowns.setMatrixAt(i, matrix)

    const shift = 0.82 + ((i * 37) % 100) / 100 * 0.35
    const warm = ((i * 53) % 100) / 100 * 0.12
    color.copy(base).multiplyScalar(shift)
    color.r = Math.min(1, color.r + warm * 0.25)
    color.g = Math.min(1, color.g + warm * 0.35)
    crowns.setColorAt(i, color)
  })
  trunks.instanceMatrix.needsUpdate = true
  crowns.instanceMatrix.needsUpdate = true
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true
  trunks.castShadow = true
  crowns.castShadow = true
  trunks.receiveShadow = true
  return [trunks, crowns]
}

/** 路灯：灯杆 + 灯头 + （可选）真实点光源 */
export function makeLamp(x: number, z: number, rotY: number, withLight: boolean): THREE.Group {
  const g = new THREE.Group()
  const poleMat = metalMaterial()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 5.6, 10), poleMat)
  pole.position.y = 2.8
  pole.castShadow = true
  g.add(pole)
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 8), poleMat)
  arm.rotation.z = Math.PI / 2
  arm.position.set(0.8, 5.5, 0)
  g.add(arm)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.2, 0.42), poleMat)
  head.position.set(1.55, 5.5, 0)
  head.castShadow = true
  g.add(head)
  const bulb = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.08, 0.3),
    new THREE.MeshStandardMaterial({
      color: '#fff4d6',
      emissive: '#ffd98a',
      emissiveIntensity: 0,
      roughness: 0.4,
    }),
  )
  bulb.position.set(1.55, 5.38, 0)
  g.add(bulb)
  if (withLight) {
    const light = new THREE.PointLight('#ffd9a0', 0, 34, 1.8)
    light.position.set(1.55, 4.9, 0)
    g.add(light)
    g.userData.lampLight = light
  }
  g.position.set(x, 0, z)
  g.rotation.y = rotY
  g.userData.bulb = bulb
  return g
}

/** 批量种树：在给定范围内随机撒点并避开排除区域 */
export function plantTrees(
  parent: THREE.Group,
  rand: () => number,
  rects: Rect[],
  circles: { x: number; z: number; r: number }[],
  opts: { minX: number; maxX: number; minZ: number; maxZ: number; count: number },
): THREE.InstancedMesh[] {
  const styles: TreeStyle[] = [
    { trunkH: 4.4, trunkR: 0.34, leafColor: '#4f7a35', kind: 'round' },
    { trunkH: 3.6, trunkR: 0.29, leafColor: '#5f8d40', kind: 'round' },
    { trunkH: 3.2, trunkR: 0.31, leafColor: '#38632e', kind: 'pine' },
  ]
  const buckets: { x: number; z: number; s: number; rot: number }[][] = [[], [], []]
  const isFree = (x: number, z: number) => {
    for (const c of circles) {
      const dx = x - c.x
      const dz = z - c.z
      if (dx * dx + dz * dz < c.r * c.r) return false
    }
    for (const [a, b, c2, d] of rects) {
      if (x > a && x < b && z > c2 && z < d) return false
    }
    return true
  }
  let planted = 0
  for (let i = 0; i < opts.count * 8 && planted < opts.count; i++) {
    const x = opts.minX + rand() * (opts.maxX - opts.minX)
    const z = opts.minZ + rand() * (opts.maxZ - opts.minZ)
    if (!isFree(x, z)) continue
    const s = 0.72 + rand() * 0.55
    buckets[(rand() * 3) | 0]!.push({ x, z, s, rot: rand() * Math.PI * 2 })
    planted++
  }
  const instances: THREE.InstancedMesh[] = []
  buckets.forEach((bucket, i) => {
    if (bucket.length === 0) return
    for (const mesh of makeTrees(styles[i]!, bucket)) {
      parent.add(mesh)
      instances.push(mesh)
    }
  })
  return instances
}

/** 草地地面：大尺度色块 + 细草纹理 + 法线凹凸 */
export function makeGround(scene: THREE.Scene): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2)
  scaleUv(geo, 1600 / 26, 1600 / 26)
  const ground = new THREE.Mesh(geo, grassMaterial())
  ground.receiveShadow = true
  scene.add(ground)
  return ground
}

/* ------------------------------ 大海 ------------------------------ */

const seaVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uShoreZ;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  // 大尺度涌浪（离岸越远浪越大；local z=-408 为岸线）
  float waveH(vec2 p, float t) {
    float ramp = smoothstep(-408.0, -330.0, p.y);
    float h = 0.0;
    h += sin(p.x * 0.055 + t * 0.85) * 0.45;
    h += sin((p.x * 0.11 - p.y * 0.07) + t * 1.25) * 0.30;
    h += sin(p.y * 0.16 + t * 1.65) * 0.22;
    h += sin((p.x * 0.23 + p.y * 0.17) - t * 2.05) * 0.12;
    // 远处整体抬高海面，保证波谷也不露出地面
    return h * ramp + ramp * 1.05;
  }

  void main() {
    vec3 pos = position;
    float h = waveH(pos.xz, uTime);
    pos.y += h;
    float e = 1.2;
    float hx = waveH(pos.xz + vec2(e, 0.0), uTime);
    float hz = waveH(pos.xz + vec2(0.0, e), uTime);
    vec3 n = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
    vNormalW = normalize(mat3(modelMatrix) * n);
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const seaFragmentShader = /* glsl */ `
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uShoreZ;
  uniform float uNight;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  void main() {
    float dist = max(vWorldPos.z - uShoreZ, 0.0);
    vec3 n = normalize(vNormalW);
    // 细碎波纹扰动
    float w1 = sin(vWorldPos.x * 0.9 + uTime * 1.8) * sin(vWorldPos.z * 0.7 - uTime * 1.5);
    float w2 = sin(vWorldPos.x * 1.7 - uTime * 2.2) * sin(vWorldPos.z * 1.4 + uTime * 1.9);
    n = normalize(n + vec3(w1 * 0.03 + w2 * 0.02, 0.0, w1 * 0.025 - w2 * 0.025));

    vec3 v = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);

    // 近岸碧绿 → 远海深蓝
    vec3 base = mix(uShallowColor, uDeepColor, smoothstep(10.0, 320.0, dist));
    vec3 col = mix(base, uSkyColor, clamp(fresnel * 1.35, 0.0, 0.72));

    // 日光 / 月光海面波光（夜晚减弱）
    float lightAmt = 1.0 - uNight * 0.82;
    vec3 hv = normalize(v + normalize(uSunDir));
    float ndh = max(dot(n, hv), 0.0);
    col += vec3(1.0, 0.97, 0.88) * pow(ndh, 120.0) * 1.6 * lightAmt;
    col += vec3(1.0) * pow(ndh, 20.0) * 0.10 * lightAmt;

    // 近岸涌浪白色泡沫带（向岸推进，用低频扰动打散规则的条纹）
    float shoreT = 1.0 - smoothstep(0.0, 30.0, dist);
    float band = 0.5 + 0.5 * sin(dist * 0.9 - uTime * 1.4 + sin(vWorldPos.x * 0.06) * 2.2);
    float breakup = 0.5 + 0.5 * sin(vWorldPos.x * 0.31 + uTime * 0.7 + sin(vWorldPos.z * 0.12) * 3.0);
    float foam = shoreT * smoothstep(0.42, 0.95, band * 0.75 + breakup * 0.35) * 0.55 * (1.0 - uNight * 0.8);
    col = mix(col, vec3(0.95, 0.98, 1.0), clamp(foam, 0.0, 0.6));

    gl_FragColor = vec4(col, 0.96);
  }
`

/**
 * 大海：自岸线向远方铺开的大面积水面。
 * 与池塘共用同一组 uniform 名，昼夜系统可直接驱动。
 */
export function makeSea(shoreZ: number): Water {
  const geo = new THREE.PlaneGeometry(1700, 820, 150, 72)
  geo.rotateX(-Math.PI / 2)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShoreZ: { value: shoreZ },
      uDeepColor: { value: new THREE.Color('#0e4a68') },
      uShallowColor: { value: new THREE.Color('#3f9fa8') },
      uSkyColor: { value: new THREE.Color('#9ec7e8') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uNight: { value: 0 },
    },
    vertexShader: seaVertexShader,
    fragmentShader: seaFragmentShader,
    transparent: true,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.position.set(0, 0.14, shoreZ + 408)
  mesh.renderOrder = 2
  return { mesh, material }
}

/** 沙滩：干沙 + 靠近水线的湿沙带 */
export function makeBeach(x: number, z: number, w: number, d: number): THREE.Group {
  const g = new THREE.Group()
  const dryGeo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)
  scaleUv(dryGeo, w / 6, d / 6)
  const dry = new THREE.Mesh(dryGeo, sandMaterial())
  dry.position.set(x, 0.05, z)
  dry.receiveShadow = true
  g.add(dry)

  const wetD = Math.max(2, d * 0.28)
  const wetGeo = new THREE.PlaneGeometry(w, wetD).rotateX(-Math.PI / 2)
  scaleUv(wetGeo, w / 5, wetD / 5)
  const wet = new THREE.Mesh(wetGeo, wetSandMaterial())
  wet.position.set(x, 0.062, z + d * 0.28)
  wet.receiveShadow = true
  g.add(wet)
  return g
}
