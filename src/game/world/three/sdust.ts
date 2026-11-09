import * as THREE from 'three'
import {
  makeGenericBuilding,
  makeDormBlock,
  makeGateArch,
  makeWindowedBox,
  buildLibrary,
  buildGymnasium,
  buildLabBuilding,
  buildCanteen,
  type BuildingData,
} from './buildings'
import {
  makeRoad,
  makeRoadDashes,
  makeRoadEdge,
  makePavementDisc,
  makeParkingLot,
  makeMountain,
  makeLamp,
  makePond,
  makeGround,
  makeCrosswalk,
  makeStopLine,
  makeMountainForest,
  makeBuildingAprons,
  plantTrees,
  mulberry32,
  type Water,
  type Rect,
} from './environment'
import {
  makePlayground,
  makeBench,
  makeFountain,
  makeFlagpole,
  makeBasketballCourt,
  makePavilion,
  makeBirds,
  makeHedge,
  makePlanter,
} from './props'
import { makeLabelSprite, makeSignTexture } from './textures'
import { paint, paintedStone, metalMaterial } from './materials'
import type { CircleCollider } from './controls'

export interface SdustBuild {
  buildingsGroup: THREE.Group
  labelsGroup: THREE.Group
  lampLights: { light: THREE.PointLight; bulb: THREE.Mesh }[]
  waters: Water[]
  /** 每帧回调（喷泉 / 旗帜 / 飞鸟等） */
  updates: ((t: number) => void)[]
  colliders: CircleCollider[]
}

/** 笔架山：中峰高耸、两侧次峰如笔架，山顶置"笔架山"石碑 */
function buildBijiashan(scene: THREE.Scene): { center: THREE.Vector2; radius: number } {
  const center = new THREE.Vector2(0, -212)
  const radius = 100
  // 山基（连绵山体）
  scene.add(makeMountain(center.x, center.y, 92, 18, '#4e7a3c'))
  scene.add(makeMountain(center.x - 55, center.y + 8, 52, 14, '#527f40'))
  scene.add(makeMountain(center.x + 58, center.y + 6, 50, 13, '#55834a'))
  // 三峰：中峰高、东西次峰低，形似笔架
  scene.add(makeMountain(center.x - 42, center.y - 4, 34, 27, '#4a7539'))
  scene.add(makeMountain(center.x, center.y - 10, 42, 40, '#4e7a3c'))
  scene.add(makeMountain(center.x + 44, center.y - 2, 32, 24, '#527f40'))
  // 山坡松林
  const peaks: [number, number, number, number][] = [
    [center.x - 42, center.y - 4, 34, 27],
    [center.x, center.y - 10, 42, 40],
    [center.x + 44, center.y - 2, 32, 24],
  ]
  peaks.forEach(([px, pz, pr, ph], i) => {
    for (const mesh of makeMountainForest(px, pz, pr, ph, { count: 90, seed: 8801 + i * 53 })) {
      scene.add(mesh)
    }
  })
  return { center, radius }
}

/** 墨水河：校友捐建、自西向东贯通校园的水系，中央大道处断开留给桥 */
function buildMoshuiRiver(scene: THREE.Scene, waters: Water[]): { z: number; gapHalf: number } {
  const z = -150
  const gapHalf = 15
  const westXs = [-352, -296, -240, -184, -128, -72]
  const eastXs = [72, 128, 184, 240, 296, 352]
  const put = (x: number, rx: number, rz: number, dz: number) => {
    const seg = makePond(new THREE.Vector2(x, z + dz), rx, rz)
    scene.add(seg.group)
    waters.push(seg.water)
  }
  // 河道主体 + 蜿蜒起伏
  westXs.forEach((x, i) => put(x, 42, 11 + (i % 2) * 2, i % 2 === 0 ? -2 : 2))
  eastXs.forEach((x, i) => put(x, 42, 11 + (i % 2) * 2, i % 2 === 0 ? 2 : -2))
  put(-26, 24, 12, -1)
  put(26, 24, 12, 1)
  return { z, gapHalf }
}

/** 墨水河大桥：中央大道跨河桥（桥板 + 栏杆 + 桥头堡） */
function buildMoshuiBridge(scene: THREE.Scene, z: number) {
  const g = new THREE.Group()
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(17, 1.2, 40),
    paintedStone('#aab0b6'),
  )
  deck.position.set(0, 0.35, z)
  deck.receiveShadow = true
  g.add(deck)
  for (const side of [-7.4, 7.4]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.1, 38),
      metalMaterial(),
    )
    rail.position.set(side, 1.5, z)
    rail.castShadow = true
    g.add(rail)
  }
  for (const side of [-21, 21]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 3.4, 2.2),
      paintedStone('#c9ced4'),
    )
    post.position.set(0, 1.2, z + side)
    post.castShadow = true
    g.add(post)
  }
  scene.add(g)
}

/** 名人园雕像：纪念为学校发展做出贡献的科学家（写意铜像） */
function makeScholarStatue(x: number, z: number, h: number): THREE.Group {
  const g = new THREE.Group()
  const stone = paintedStone('#b3ada1')
  const bronze = paint('#41484f', 0.42, 0.55)
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 1.7), stone)
  base.position.y = 0.45
  base.castShadow = true
  g.add(base)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, h, 14), bronze)
  body.position.y = 0.9 + h / 2
  body.castShadow = true
  g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 14), bronze)
  head.position.y = 0.9 + h + 0.26
  head.castShadow = true
  g.add(head)
  g.position.set(x, 0, z)
  return g
}

/** 图书信息中心：13 层双塔裙房，70 米校园新地标 */
function buildLibraryTower(): THREE.Group {
  const g = new THREE.Group()
  const podium = makeWindowedBox(46, 9.3, 26, 3, 0.4, { variant: 'glass', seed: 71, roofDetails: false })
  podium.position.y = 0
  g.add(podium)
  const tower = makeWindowedBox(24, 40.3, 17, 13, 0.5, {
    variant: 'glass',
    podium: false,
    seed: 72,
  })
  tower.position.set(0, 9.3, 0)
  g.add(tower)
  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(25.4, 1.4, 18.4),
    paintedStone('#c9cdd2'),
  )
  crown.position.set(0, 50.3, 0)
  crown.castShadow = true
  g.add(crown)
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.3, 9, 10),
    metalMaterial(),
  )
  mast.position.set(0, 55.4, 0)
  g.add(mast)
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 1.8),
    new THREE.MeshStandardMaterial({
      map: makeSignTexture('图书信息中心', '#1d3f66', '#e8f1fa'),
      roughness: 0.5,
      metalness: 0.1,
    }),
  )
  sign.position.set(0, 7.4, 13.2)
  g.add(sign)
  g.userData.building = {
    name: '图书信息中心',
    info: '校园新地标：总建筑面积约 7 万平方米，高 70 米，地上 13 层，馆藏文献数百万册。',
  } satisfies BuildingData
  return g
}

/**
 * 按山东科技大学青岛校区（前湾港路 579 号）布局搭建场景。
 * 坐标系：x 向东，z 向南；前湾港路为 z=0 的南侧主干道。
 * 标志地貌：校园中央笔架山 + 自西向东的墨水河，"山、海、泉"交汇的花园式校园。
 */
export function buildSdustCampus(scene: THREE.Scene): SdustBuild {
  const rand = mulberry32(19510509) // 建校年份作随机种子
  const buildingsGroup = new THREE.Group()
  const labelsGroup = new THREE.Group()
  const propsGroup = new THREE.Group()
  scene.add(buildingsGroup, labelsGroup, propsGroup)

  const lampLights: { light: THREE.PointLight; bulb: THREE.Mesh }[] = []
  const waters: Water[] = []
  const updates: ((t: number) => void)[] = []
  const colliders: CircleCollider[] = []
  const treeRects: Rect[] = []
  const treeCircles: { x: number; z: number; r: number }[] = []
  const aprons: { x: number; z: number; w: number; d: number }[] = []

  makeGround(scene)

  /* ---------------- 道路网 ---------------- */
  const roadRects: Rect[] = []
  function addRoad(w: number, h: number, x: number, z: number, markings = false) {
    scene.add(makeRoad(w, h, x, z))
    roadRects.push([x - w / 2 - 1.5, x + w / 2 + 1.5, z - h / 2 - 1.5, z + h / 2 + 1.5])
    if (markings) {
      if (w >= h) {
        scene.add(makeRoadDashes(new THREE.Vector2(x - w / 2, z), new THREE.Vector2(x + w / 2, z)))
        scene.add(makeRoadEdge(new THREE.Vector2(x - w / 2, z), new THREE.Vector2(x + w / 2, z), h / 2 - 0.6))
        scene.add(makeRoadEdge(new THREE.Vector2(x - w / 2, z), new THREE.Vector2(x + w / 2, z), -(h / 2 - 0.6)))
      } else {
        scene.add(makeRoadDashes(new THREE.Vector2(x, z - h / 2), new THREE.Vector2(x, z + h / 2)))
        scene.add(makeRoadEdge(new THREE.Vector2(x, z - h / 2), new THREE.Vector2(x, z + h / 2), w / 2 - 0.6))
        scene.add(makeRoadEdge(new THREE.Vector2(x, z - h / 2), new THREE.Vector2(x, z + h / 2), -(w / 2 - 0.6)))
      }
    }
  }
  // 前湾港路（南侧主干道）+ 东西环校路
  addRoad(860, 18, 0, 0, true)
  addRoad(12, 300, -218, -150)
  addRoad(12, 300, 218, -150)
  // 中央大道（南门 → 山海广场 → 图书信息中心）
  addRoad(16, 96, 0, -66, true)
  // 图书馆环路 + 东西横路
  addRoad(300, 10, 0, -124)
  addRoad(10, 96, -120, -70)
  addRoad(10, 96, 120, -70)
  // 南部宿舍区横纵路
  addRoad(280, 8, -110, 34)
  addRoad(280, 8, -110, 84)
  addRoad(8, 60, -230, 59)
  addRoad(8, 60, 10, 59)
  // 运动区支路
  addRoad(120, 8, 160, -20)
  addRoad(8, 70, 214, -55)

  /* ---------------- 斑马线 / 停车线 ---------------- */
  const crossings: [number, number, number, number, 'x' | 'z'][] = [
    [0, 0, 4.0, 18, 'x'],
    [-218, -24, 3.4, 12, 'z'],
    [218, -24, 3.4, 12, 'z'],
    [0, -30, 4.0, 16, 'z'],
    [0, -90, 4.0, 16, 'z'],
    [-62, -124, 3.4, 10, 'x'],
    [62, -124, 3.4, 10, 'x'],
    [110, 34, 3.2, 8, 'x'],
    [110, 84, 3.2, 8, 'x'],
    [-110, 34, 3.2, 8, 'x'],
  ]
  for (const [cx, cz, cw, roadW, along] of crossings) {
    scene.add(makeCrosswalk(cx, cz, cw, roadW, along))
  }
  scene.add(makeStopLine(5.5, 4.5, 8, 'x'))
  scene.add(makeStopLine(-5.5, -4.5, 8, 'x'))
  scene.add(makeStopLine(4.5, -38, 7, 'z'))
  scene.add(makeStopLine(-4.5, -98, 7, 'z'))

  /* ---------------- 建筑注册 ---------------- */
  function place(
    g: THREE.Group,
    o: { x: number; z: number; rot?: number; labelY: number; labelScale?: number },
  ) {
    g.position.set(o.x, 0, o.z)
    g.rotation.y = o.rot ?? 0
    buildingsGroup.add(g)
    const data = g.userData.building as BuildingData
    const label = makeLabelSprite(data.name, o.labelScale ?? 12)
    label.position.set(o.x, o.labelY, o.z)
    labelsGroup.add(label)
    const box = new THREE.Box3().setFromObject(g)
    const size = new THREE.Vector3()
    box.getSize(size)
    colliders.push({
      x: (box.min.x + box.max.x) / 2,
      z: (box.min.z + box.max.z) / 2,
      r: Math.max(size.x, size.z) / 2 + 1.2,
    })
    aprons.push({
      x: (box.min.x + box.max.x) / 2,
      z: (box.min.z + box.max.z) / 2,
      w: size.x + 6.0,
      d: size.z + 6.0,
    })
    treeRects.push([box.min.x - 2.5, box.max.x + 2.5, box.min.z - 2.5, box.max.z + 2.5])
  }

  const dorm = (num: string, x: number, z: number, rot?: number) =>
    place(
      makeDormBlock({
        name: `${num}号公寓`,
        info: '学生公寓，标准四人间，楼下配有自助洗衣房与快递柜。',
      }),
      { x, z, rot, labelY: 16, labelScale: 7 },
    )

  /* ------ 校门与山海广场 ------ */
  place(makeGateArch('南门 · 前湾港路', 24), { x: 0, z: -8, labelY: 16, labelScale: 11 })
  place(makeGateArch('西门', 16), { x: -218, z: -8, rot: Math.PI / 2, labelY: 15, labelScale: 9 })
  place(makeGateArch('东门', 16), { x: 218, z: -8, rot: Math.PI / 2, labelY: 15, labelScale: 9 })

  // 山海广场：校训石 + 喷泉 + 国旗旗杆阵
  scene.add(makePavementDisc(0, -36, 18))
  const stone = new THREE.Mesh(
    new THREE.BoxGeometry(7, 3.2, 1.6),
    paintedStone('#8d939b'),
  )
  stone.position.set(0, 1.6, -46)
  stone.rotation.y = 0.08
  stone.castShadow = true
  propsGroup.add(stone)
  colliders.push({ x: 0, z: -46, r: 4 })
  const fountain = makeFountain(0, -30)
  propsGroup.add(fountain.group)
  updates.push(fountain.update)
  treeCircles.push({ x: 0, z: -33, r: 15 })
  const flagpole = makeFlagpole(-14, -36, 16, 'flag')
  propsGroup.add(flagpole.group)
  updates.push(flagpole.update)
  const guangchangLabel = makeLabelSprite('山海广场', 11)
  guangchangLabel.position.set(-16, 12, -36)
  labelsGroup.add(guangchangLabel)

  /* ------ 中央教学区（东西两翼） ------ */
  place(
    makeGenericBuilding({
      name: '矿业学院楼',
      info: '能源与矿业工程学院：采矿工程、矿业安全国家级一流专业所在地。',
      w: 40,
      d: 14,
      floors: 6,
    }),
    { x: -78, z: -52, labelY: 26 },
  )
  place(
    makeGenericBuilding({
      name: '安全学院楼',
      info: '安全与环境工程学院：从千米井下到新能源场站的应急安全科研基地。',
      w: 34,
      d: 13,
      floors: 5,
    }),
    { x: -150, z: -66, labelY: 24 },
  )
  place(
    makeGenericBuilding({
      name: '测绘学院楼',
      info: '测绘与空间信息学院：北斗导航与海洋测绘实验中心。',
      w: 32,
      d: 13,
      floors: 5,
    }),
    { x: -78, z: -96, labelY: 24 },
  )
  place(
    makeGenericBuilding({
      name: '机电学院楼',
      info: '机械电子工程学院：机器人与智能制造实验教学中心。',
      w: 40,
      d: 14,
      floors: 6,
    }),
    { x: 78, z: -52, labelY: 26 },
  )
  place(
    makeGenericBuilding({
      name: '计算机学院楼',
      info: '计算机科学与工程学院：人工智能与大数据科创平台。',
      w: 34,
      d: 13,
      floors: 5,
    }),
    { x: 150, z: -66, labelY: 24 },
  )
  place(
    makeGenericBuilding({
      name: '土木学院楼',
      info: '土木工程与建筑学院：结构工程与岩土工程实验室。',
      w: 32,
      d: 13,
      floors: 5,
    }),
    { x: 78, z: -96, labelY: 24 },
  )
  place(
    makeGenericBuilding({
      name: '音乐厅',
      info: '大学生艺术素养基地，交响乐与合唱排演厅。',
      w: 18,
      d: 12,
      floors: 3,
    }),
    { x: -40, z: -96, labelY: 14, labelScale: 9 },
  )
  place(
    makeGenericBuilding({
      name: '大学生活动中心',
      info: '百团大战的主场：社团活动、文化演出与创客空间。',
      w: 22,
      d: 12,
      floors: 4,
    }),
    { x: 40, z: -96, labelY: 17, labelScale: 9 },
  )

  /* ------ 图书信息中心（校园中心地标） ------ */
  scene.add(makePavementDisc(0, -110, 20))
  place(buildLibraryTower(), { x: 0, z: -112, labelY: 62, labelScale: 13 })
  treeCircles.push({ x: 0, z: -110, r: 18 })

  /* ------ 名人园 ------ */
  scene.add(makePavementDisc(64, -124, 12))
  const scholars: [string, number, number, number][] = [
    ['华罗庚', 56, -128, 2.6],
    ['李四光', 72, -128, 2.9],
    ['钱学森', 56, -119, 2.4],
    ['茅以升', 72, -119, 2.7],
  ]
  for (const [name, x, z, h] of scholars) {
    propsGroup.add(makeScholarStatue(x, z, h))
    const sLabel = makeLabelSprite(name, 6)
    sLabel.position.set(x, 5.2, z)
    labelsGroup.add(sLabel)
  }
  const mingrenLabel = makeLabelSprite('名人园', 10)
  mingrenLabel.position.set(64, 9, -124)
  labelsGroup.add(mingrenLabel)
  treeCircles.push({ x: 64, z: -124, r: 12 })

  /* ------ 绿化细节：绿篱 / 花钵 ------ */
  const hedges: [number, number, number, number][] = [
    [0, -55.5, 12, 0],
    [0, -16.5, 12, 0],
    [-20, -36, 12, Math.PI / 2],
    [20, -36, 12, Math.PI / 2],
    [-17, -112, 9, 0],
    [17, -112, 9, 0],
    [64, -136, 8, 0],
    [64, -111, 8, 0],
    [-64, -122, 8, Math.PI / 2],
  ]
  for (const [hx, hz, len, rot] of hedges) propsGroup.add(makeHedge(hx, hz, len, rot))
  for (const [px, pz] of [
    [-14, -14],
    [14, -14],
    [-14, 3],
    [14, 3],
    [-208, -14],
    [208, -14],
    [-54, -30],
    [54, -30],
    [80, -112],
    [-80, -112],
  ] as const) {
    propsGroup.add(makePlanter(px, pz))
  }

  /* ------ 地球科学馆 ------ */
  place(
    makeGenericBuilding({
      name: '地球科学馆',
      info: '山东省科普教育基地：矿物岩石、古生物化石与地质构造标本馆。',
      w: 22,
      d: 12,
      floors: 3,
    }),
    { x: -150, z: -108, labelY: 14, labelScale: 10 },
  )

  /* ------ 实验楼群（墨水河北岸） ------ */
  place(buildLabBuilding({ name: '矿业实验中心', info: '深部岩体力学与矿山灾害防控实验平台。' }), { x: -120, z: -186, labelY: 26 })
  place(buildLabBuilding({ name: '海洋测绘实验楼', info: '海洋测绘与无人船艇联合实验楼。' }), { x: 120, z: -186, rot: Math.PI, labelY: 26 })

  /* ------ 墨水河 + 笔架山 ------ */
  const river = buildMoshuiRiver(scene, waters)
  buildMoshuiBridge(scene, river.z)
  treeRects.push([-380, 380, river.z - 15, river.z + 15])
  const bijiashan = buildBijiashan(scene)
  // 山体不可进入：环山一圈碰撞体
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
    colliders.push({
      x: bijiashan.center.x + Math.cos(a) * (bijiashan.radius - 14),
      z: bijiashan.center.y + Math.sin(a) * (bijiashan.radius - 14),
      r: 22,
    })
  }
  treeCircles.push({ x: bijiashan.center.x, z: bijiashan.center.y, r: bijiashan.radius + 6 })
  const shanLabel = makeLabelSprite('笔 架 山', 15)
  shanLabel.position.set(bijiashan.center.x, 52, bijiashan.center.y - 10)
  labelsGroup.add(shanLabel)
  const heLabel = makeLabelSprite('墨 水 河', 12)
  heLabel.position.set(-200, 10, river.z - 4)
  labelsGroup.add(heLabel)

  // 河畔亭与长椅
  scene.add(makePavilion(-64, -132))
  const hexiLabel = makeLabelSprite('河畔亭', 8)
  hexiLabel.position.set(-64, 11, -132)
  labelsGroup.add(hexiLabel)
  for (const [bx, bz, br] of [
    [-30, -138, 0],
    [30, -138, 0],
    [90, -136, 0],
  ] as const) {
    const bench = makeBench(br)
    bench.position.set(bx, 0, bz)
    propsGroup.add(bench)
  }
  const birds = makeBirds(new THREE.Vector2(0, river.z), 6, [
    { x: -30, z: -138, y: 0.62 },
    { x: 30, z: -138, y: 0.62 },
    { x: 90, z: -136, y: 0.62 },
    { x: -64, z: -122 },
    { x: 64, z: -112 },
  ])
  propsGroup.add(birds.group)
  updates.push(birds.update)

  /* ------ 东南运动区 ------ */
  const t1 = makePlayground(152, 40)
  scene.add(t1)
  treeRects.push([124, 180, 12, 68])
  place(buildGymnasium({ name: '体育馆', info: '青岛校区体育馆：CBA 级木地板球场的校内赛事主场。' }), { x: 106, z: 30, labelY: 32 })
  place(
    makeGenericBuilding({
      name: '游泳馆',
      info: '50 米标准泳池，向全校师生开放。',
      w: 20,
      d: 12,
      floors: 2,
    }),
    { x: 104, z: 58, labelY: 12, labelScale: 9 },
  )
  for (const [cx, cz] of [
    [248, -30],
    [268, -30],
    [248, -6],
    [268, -6],
  ] as const) {
    scene.add(makeBasketballCourt(cx, cz))
    treeRects.push([cx - 9, cx + 9, cz - 7, cz + 7])
  }

  /* ------ 西部生活区（A 区公寓 + 餐厅 + 校医院） ------ */
  const aCols = [-190, -158, -126]
  let dormNo = 1
  for (const row of [16, 42, 68, 94]) {
    for (const col of aCols) {
      dorm(`${dormNo}`, col, row)
      dormNo += 1
    }
  }
  place(buildCanteen({ name: '第一餐厅', info: '西区主餐厅，鲁菜风味档口最受欢迎。' }), { x: -80, z: 34, rot: 0, labelY: 15 })
  place(buildCanteen({ name: '第二餐厅', info: '东区风味餐厅，清真档口与自选称重窗口。' }), { x: -80, z: 84, rot: 0, labelY: 15 })
  place(
    makeGenericBuilding({
      name: '校医院',
      info: '校医院：24 小时急诊与体检中心。',
      w: 14,
      d: 9,
      floors: 3,
    }),
    { x: -190, z: -14, labelY: 13, labelScale: 9 },
  )
  place(
    makeGenericBuilding({
      name: '学术交流中心',
      info: '学术会议与Guest学者公寓，含 600 座报告厅。',
      w: 26,
      d: 12,
      floors: 4,
    }),
    { x: -40, z: -14, labelY: 17, labelScale: 9 },
  )

  /* ------ 东部生活区（B 区公寓） ------ */
  const bCols = [150, 182, 214]
  let dormNoB = 9
  for (const row of [104, 128, 152]) {
    for (const col of bCols) {
      dorm(`${dormNoB}`, col, row)
      dormNoB += 1
    }
  }
  scene.add(makeParkingLot(120, 150, 30, 20))
  treeRects.push([103, 137, 138, 162])

  /* ------ 国家大学科技园（西北） ------ */
  for (const [px, pz, pw] of [
    [-252, -120, 34],
    [-252, -88, 34],
    [-252, -56, 26],
  ] as const) {
    const park = makeGenericBuilding({
      name: '大学科技园',
      info: '国家大学科技园：矿山装备、海洋测绘科技成果转化基地。',
      w: pw,
      d: 16,
      floors: 4,
    })
    place(park, { x: px, z: pz, labelY: 18, labelScale: 9 })
  }
  const parkLabel = makeLabelSprite('国家大学科技园', 11)
  parkLabel.position.set(-252, 30, -104)
  labelsGroup.add(parkLabel)

  /* ------ 停车场 ------ */
  scene.add(makeParkingLot(-30, -110, 26, 18))
  treeRects.push([-45, -15, -121, -99])

  /* ------ 北部背景山：小珠山余脉 ------ */
  const ridge: [number, number, number, number][] = [
    [-330, -300, 95, 52],
    [-120, -322, 110, 62],
    [90, -312, 100, 56],
    [300, -318, 90, 50],
    [-20, -292, 70, 24],
    [210, -290, 66, 22],
  ]
  ridge.forEach(([mx, mz, mr, mh], i) => {
    scene.add(makeMountain(mx, mz, mr, mh, i % 2 === 0 ? '#4e7a3c' : '#527f40'))
    for (const mesh of makeMountainForest(mx, mz, mr, mh, { count: 150, seed: 9400 + i * 61 })) {
      propsGroup.add(mesh)
    }
  })

  /* ------ 路灯 ------ */
  const addLamp = (x: number, z: number, rot: number, withLight: boolean) => {
    const lamp = makeLamp(x, z, rot, withLight)
    scene.add(lamp)
    const l = lamp.userData.lampLight as THREE.PointLight | null
    if (l) lampLights.push({ light: l, bulb: lamp.userData.bulb as THREE.Mesh })
  }
  for (const x of [-320, -218, -110, 0, 110, 218, 320]) {
    addLamp(x, -12, 0, true)
    addLamp(x, 12, Math.PI, x === 0 || x === -110)
  }
  for (const z of [-30, -58, -86]) {
    addLamp(-12, z, Math.PI / 2, z === -58)
    addLamp(12, z, -Math.PI / 2, false)
  }
  addLamp(-218, -60, Math.PI / 2, true)
  addLamp(218, -60, -Math.PI / 2, false)
  addLamp(-120, -118, 0, true)
  addLamp(120, -118, Math.PI, true)

  /* ------ 树木 ------ */
  roadRects.push([-430, 430, -11, 11])
  treeRects.push(...roadRects)
  treeRects.push([-380, 380, -170, -132]) // 墨水河河道
  treeRects.push([-120, 120, -270, -160]) // 笔架山山体
  treeCircles.push(
    { x: 0, z: -33, r: 17 },
    { x: 0, z: -110, r: 19 },
    { x: 64, z: -124, r: 12 },
    { x: bijiashan.center.x, z: bijiashan.center.y, r: bijiashan.radius + 6 },
  )
  plantTrees(propsGroup, rand, treeRects, treeCircles, {
    minX: -350,
    maxX: 350,
    minZ: -268,
    maxZ: 165,
    count: 660,
  })
  // 墨水河两岸垂柳列植
  plantTrees(propsGroup, rand, [], [], { minX: -350, maxX: -30, minZ: river.z - 18, maxZ: river.z - 13, count: 42 })
  plantTrees(propsGroup, rand, [], [], { minX: 30, maxX: 350, minZ: river.z - 18, maxZ: river.z - 13, count: 42 })
  plantTrees(propsGroup, rand, [], [], { minX: -350, maxX: 350, minZ: river.z + 13, maxZ: river.z + 18, count: 48 })

  /* ------ 前湾港路以南：城市街区与港口天际线 ------ */
  const surRects: Rect[] = []
  const surCircles: { x: number; z: number; r: number }[] = []
  function placeResidential(
    x: number,
    z: number,
    o?: { w?: number; d?: number; floors?: number; roofColor?: string; rot?: number },
  ) {
    const res = makeDormBlock({
      name: '住宅楼',
      info: '前湾港路南侧居民住宅。',
      w: o?.w ?? 18,
      d: o?.d ?? 9,
      floors: o?.floors ?? 5,
      roofColor: o?.roofColor,
    })
    res.userData.building = undefined // 周边住宅不参与建筑查询
    res.position.set(x, 0, z)
    if (o?.rot) res.rotation.y = o.rot
    buildingsGroup.add(res)
    const box = new THREE.Box3().setFromObject(res)
    surRects.push([box.min.x - 2, box.max.x + 2, box.min.z - 2, box.max.z + 2])
    colliders.push({
      x: (box.min.x + box.max.x) / 2,
      z: (box.min.z + box.max.z) / 2,
      r: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 1,
    })
  }

  const warmRoofs = ['#b0a08a', '#8f9aa8', '#a8b0a0', '#b09a8a']
  // 前湾港路南侧两排住宅
  for (let i = 0; i < 12; i++) {
    placeResidential(-300 + i * 55, 30, { roofColor: warmRoofs[i % 4]!, floors: 6 })
  }
  for (let i = 0; i < 11; i++) {
    placeResidential(-272 + i * 55, 48, { roofColor: warmRoofs[(i + 2) % 4]!, floors: 5 })
  }
  // 港城天际线（东南远端）
  const skyCols = [380, 425, 470]
  const skyRows = [40, 78, 116]
  for (const [ci, cx] of skyCols.entries()) {
    for (const [ri, rz] of skyRows.entries()) {
      placeResidential(cx!, rz!, {
        w: 20,
        d: 12,
        floors: 5 + ((ci + ri) % 3) * 2,
        roofColor: warmRoofs[(ci * 2 + ri) % 4]!,
      })
    }
  }
  place(
    makeGenericBuilding({
      name: '前湾港国际大厦',
      info: '青岛港前湾港区地标写字楼，远眺胶州湾码头桥吊。',
      w: 18,
      d: 13,
      floors: 18,
    }),
    { x: 425, z: -60, labelY: 62, labelScale: 10 },
  )

  // 社区标签
  const surLabels: [string, number, number, number, number][] = [
    ['前湾港路', -260, 12, 14, 12],
    ['港城国际社区', 425, 40, 130, 13],
    ['前湾港区', 425, 30, -100, 14],
  ]
  for (const [text, x, y, z, scale] of surLabels) {
    const s = makeLabelSprite(text, scale)
    s.position.set(x, y, z)
    labelsGroup.add(s)
  }

  // 周边绿化
  surRects.push([-430, 430, 16, 62])
  plantTrees(propsGroup, rand, surRects, surCircles, {
    minX: -420,
    maxX: 420,
    minZ: 18,
    maxZ: 60,
    count: 60,
  })

  /* ------ 建筑周边铺装（合并为 1 个 mesh） ------ */
  const apronMesh = makeBuildingAprons(aprons)
  if (apronMesh) scene.add(apronMesh)

  return { buildingsGroup, labelsGroup, lampLights, waters, updates, colliders }
}
