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
  makeSea,
  makeBeach,
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
import { makePlayground, makeBench, makePavilion, makeBirds, makeHedge, makePlanter } from './props'
import { makeLabelSprite, makeSignTexture } from './textures'
import { paint, paintedStone } from './materials'
import type { CircleCollider } from './controls'

export interface QdhhBuild {
  buildingsGroup: THREE.Group
  labelsGroup: THREE.Group
  lampLights: { light: THREE.PointLight; bulb: THREE.Mesh }[]
  waters: Water[]
  /** 每帧回调（飞鸟等） */
  updates: ((t: number) => void)[]
  colliders: CircleCollider[]
}

/** L 形教学楼（知韵楼 / 知信楼的标志性轮廓） */
function lShapeBuilding(
  name: string,
  info: string,
  main: [number, number, number], // w, d, floors
  wing: [number, number, number],
  wingOffset: [number, number],
): THREE.Group {
  const g = new THREE.Group()
  const parts: { size: [number, number, number]; pos: [number, number] }[] = [
    { size: main, pos: [0, 0] },
    { size: wing, pos: wingOffset },
  ]
  for (const p of parts) {
    const h = p.size[2] * 3.1
    const body = makeWindowedBox(p.size[0], h, p.size[1], p.size[2], 0.42, {
      variant: 'tile',
      seed: p.pos[0] * 31 + p.pos[1] * 17,
    })
    body.position.set(p.pos[0], 0, p.pos[1])
    g.add(body)
    const parapet = new THREE.Mesh(
      new THREE.BoxGeometry(p.size[0] + 0.8, 0.7, p.size[1] + 0.8),
      paintedStone('#c9c6be'),
    )
    parapet.position.set(p.pos[0], h + 0.35, p.pos[1])
    parapet.castShadow = true
    g.add(parapet)
  }
  const h0 = main[2] * 3.1
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 1.4),
    new THREE.MeshStandardMaterial({ map: makeSignTexture(name, '#274a68', '#f4e6b8'), roughness: 0.6 }),
  )
  sign.position.set(0, h0 * 0.6, main[1] / 2 + 0.06)
  g.add(sign)
  g.userData.building = { name, info } satisfies BuildingData
  return g
}

/** 孔子雕像：基座 + 身躯 + 头部（写意风格） */
function makeConfuciusStatue(x: number, z: number): THREE.Group {
  const g = new THREE.Group()
  const stone = paintedStone('#a8a294')
  const bronze = paint('#3d444d', 0.45, 0.55)
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 3.4), stone)
  base.position.y = 0.8
  base.castShadow = true
  base.receiveShadow = true
  g.add(base)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 2.9, 16), bronze)
  body.position.y = 3.0
  body.castShadow = true
  g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 16), bronze)
  head.position.y = 4.75
  head.castShadow = true
  g.add(head)
  const scroll = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.5), bronze)
  scroll.position.set(0, 3.4, 0.75)
  g.add(scroll)
  g.position.set(x, 0, z)
  return g
}

/** 科技广场雕塑：环 + 球 */
function makeTechSculpture(x: number, z: number): THREE.Group {
  const g = new THREE.Group()
  const mat = paint('#2f7fd4', 0.3, 0.6)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.22, 12, 48), mat)
  ring.position.y = 4.2
  ring.rotation.y = 0.6
  ring.castShadow = true
  g.add(ring)
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 20), mat)
  sphere.position.y = 4.2
  sphere.castShadow = true
  g.add(sphere)
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.45, 3.4, 12),
    paintedStone('#d3d1cb'),
  )
  pillar.position.y = 1.7
  pillar.castShadow = true
  g.add(pillar)
  g.position.set(x, 0, z)
  return g
}

/**
 * 按青岛黄海学院 2024 官方校园地图搭建场景。
 * 坐标系：x 向东，z 向南；胶州湾东路为 z=0 的主干道。
 */
export function buildQdhhCampus(scene: THREE.Scene): QdhhBuild {
  const rand = mulberry32(20240901)
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
  // 胶州湾东路（主干道）/ 灵海路 / 玉皇路 / 八一路
  addRoad(760, 18, 0, 0, true)
  addRoad(760, 12, 0, 160)
  addRoad(12, 180, -32, 80)
  addRoad(12, 180, 130, 80)
  // 北区：纵路 + 横路 + 连接路
  addRoad(10, 44, 118, -27)
  addRoad(330, 10, 55, -98)
  addRoad(8, 70, 56, -44)
  // 西区：横路 + 两条纵路
  addRoad(325, 10, -170, -30)
  addRoad(8, 24, -68, -20)
  addRoad(8, 24, -155, -20)
  // 南区：两横两纵
  addRoad(152, 8, 49, 42)
  addRoad(152, 8, 49, 95)
  addRoad(8, 146, -5, 78)
  addRoad(8, 92, 110, 54)

  /* ---------------- 斑马线 / 停车线 ---------------- */
  const crossings: [number, number, number, number, 'x' | 'z'][] = [
    [118, 0, 3.6, 18, 'x'],
    [-68, 0, 3.6, 18, 'x'],
    [-32, 0, 3.6, 18, 'x'],
    [130, 0, 3.6, 18, 'x'],
    [196, 0, 3.6, 18, 'x'],
    [83, 160, 3.6, 12, 'x'],
    [-32, 78, 3.4, 12, 'z'],
    [130, 78, 3.4, 12, 'z'],
    [112, -98, 3.2, 10, 'z'],
    [118, -27, 3.2, 10, 'z'],
  ]
  for (const [cx, cz, cw, roadW, along] of crossings) {
    scene.add(makeCrosswalk(cx, cz, cw, roadW, along))
  }
  scene.add(makeStopLine(122.5, 4.5, 8, 'x'))
  scene.add(makeStopLine(113.5, -4.5, 8, 'x'))
  scene.add(makeStopLine(-63.5, 4.5, 8, 'x'))
  scene.add(makeStopLine(78.5, 164, 5, 'x'))

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

  const dorm = (num: number, x: number, z: number, rot?: number) =>
    place(
      makeDormBlock({
        name: `${num}#公寓`,
        info: `学生公寓${num}号楼，标准四人间。`,
      }),
      { x, z, rot, labelY: 16, labelScale: 7 },
    )

  /* ------ 西区宿舍群（8# ~ 21#） ------ */
  dorm(21, -300, -138)
  dorm(20, -294, -116)
  dorm(19, -288, -94)
  dorm(18, -282, -72)
  dorm(13, -196, -156)
  dorm(14, -134, -160)
  dorm(12, -222, -130)
  dorm(11, -166, -124)
  dorm(10, -160, -96)
  dorm(15, -108, -100)
  dorm(17, -124, -72)
  dorm(16, -74, -74)
  dorm(9, -100, -48)
  dorm(8, -48, -50)

  /* ------ 北区 ------ */
  // J5 知韵楼 / J6 知信楼：L 形轮廓
  const j5 = lShapeBuilding(
    'J5 知韵楼',
    '北区文科学院教学楼，L 形围合出南向庭院。',
    [30, 14, 5],
    [10, 18, 5],
    [14, 8],
  )
  place(j5, { x: -70, z: -84, labelY: 24 })
  const j6 = lShapeBuilding(
    'J6 知信楼',
    '北区公共教学楼，紧邻山体公园与第一体育场。',
    [24, 12, 4],
    [9, 14, 4],
    [11, 6],
  )
  place(j6, { x: -96, z: -44, labelY: 19 })

  // T1 第一体育场
  const t1 = makePlayground(0, -56)
  scene.add(t1)
  treeRects.push([-32, 32, -78, -34])

  // 小西湖
  const xihu = makePond(new THREE.Vector2(42, -32), 9, 12)
  scene.add(xihu.group)
  waters.push(xihu.water)
  treeCircles.push({ x: 42, z: -32, r: 13 })

  place(buildGymnasium({ name: 'G5 体育馆', info: '北区体育馆，球壳穹顶结构，承办校内篮球、羽毛球赛事。' }), { x: 36, z: -58, labelY: 32 })

  place(
    makeGenericBuilding({
      name: 'G4 雷锋纪念馆',
      info: '全校学雷锋主题教育基地，陈列志愿服务事迹展。',
      w: 14,
      d: 9,
      floors: 2,
    }),
    { x: 68, z: -20, labelY: 10, labelScale: 9 },
  )

  place(
    makeGenericBuilding({
      name: 'J4 知行楼',
      info: '北区主教学楼，"知行合一"为办学理念，实训机房与阶梯教室所在地。',
      w: 46,
      d: 14,
      floors: 6,
    }),
    { x: 112, z: -64, labelY: 28 },
  )

  // 孔子广场 + 雕像
  scene.add(makePavementDisc(104, -32, 13))
  const statue = makeConfuciusStatue(104, -32)
  propsGroup.add(statue)
  treeCircles.push({ x: 104, z: -32, r: 14 })
  colliders.push({ x: 104, z: -32, r: 3 })
  const kongziLabel = makeLabelSprite('孔子广场', 11)
  kongziLabel.position.set(104, 10, -32)
  labelsGroup.add(kongziLabel)

  place(
    makeGenericBuilding({
      name: 'G3 博物馆',
      info: '校园博物馆，奇石与地方文化常设展。',
      w: 16,
      d: 10,
      floors: 2,
    }),
    { x: 140, z: -36, labelY: 11, labelScale: 10 },
  )

  place(buildLibrary({ name: 'G1 东区图书馆', info: '东区图书馆：双翼柱廊式建筑，馆藏图书 180 万册。' }), { x: 196, z: -70, labelY: 30 })

  place(
    makeGenericBuilding({
      name: 'B1 办公楼',
      info: '校行政办公楼，各职能部门集中办公。',
      w: 24,
      d: 12,
      floors: 6,
    }),
    { x: 146, z: -70, labelY: 26, labelScale: 10 },
  )

  place(
    makeGenericBuilding({
      name: 'G2 方塘书屋',
      info: '北区分馆"半亩方塘一鉴开"，屋旁引水成塘。',
      w: 14,
      d: 10,
      floors: 3,
    }),
    { x: 176, z: -108, labelY: 15, labelScale: 10 },
  )
  const fangtang = makePond(new THREE.Vector2(202, -116), 7, 6)
  scene.add(fangtang.group)
  waters.push(fangtang.water)

  // 山体公园（西区）
  scene.add(makeMountain(-140, -60, 22, 9, '#55834a'))
  treeCircles.push({ x: -140, z: -60, r: 20 })

  // 观海亭（西区小高地，可远眺灵山湾）
  const pavilion = makePavilion(-230, -88)
  scene.add(pavilion)
  const guanhaiLabel = makeLabelSprite('观海亭', 9)
  guanhaiLabel.position.set(-230, 12, -88)
  labelsGroup.add(guanhaiLabel)

  /* ------ 南区 ------ */
  dorm(7, -22, 26)
  dorm(6, 28, 26)
  dorm(3, -22, 58)
  dorm(5, 28, 58)
  dorm(4, 88, 58)
  dorm(2, -22, 83)
  dorm(1, -22, 112)

  place(buildCanteen({ name: 'C2 文苑餐厅', info: '南区风味餐厅，汇聚各地特色档口。' }), { x: 62, z: 72, rot: Math.PI / 2, labelY: 15 })

  place(
    makeGenericBuilding({
      name: 'J3 知诚楼',
      info: '南区教学楼，紧邻孔子文化长廊。',
      w: 12,
      d: 22,
      floors: 5,
    }),
    { x: 95, z: 20, labelY: 22 },
  )

  place(buildLabBuilding({ name: 'S1 一号实验楼', info: '工科实验中心：物理 / 计算机 / 图形学实验室。' }), { x: 160, z: 30, labelY: 26 })
  place(buildLabBuilding({ name: 'S2 二号实验楼', info: '工科实验中心二区，智能制造与机器人实验室。' }), { x: 202, z: 30, rot: -Math.PI / 2, labelY: 26 })

  // 科技广场 + 雕塑
  scene.add(makePavementDisc(165, 52, 9))
  propsGroup.add(makeTechSculpture(165, 52))
  treeCircles.push({ x: 165, z: 52, r: 10 })
  const kejiLabel = makeLabelSprite('科技广场', 10)
  kejiLabel.position.set(165, 10, 52)
  labelsGroup.add(kejiLabel)

  /* ---------------- 绿化细节：绿篱 / 花钵 ---------------- */
  const hedges: [number, number, number, number][] = [
    [104, -46.5, 10, 0],
    [104, -17.5, 10, 0],
    [90, -32, 10, Math.PI / 2],
    [118, -32, 10, Math.PI / 2],
    [165, 40.5, 8, 0],
    [165, 63.5, 8, 0],
    [154.5, 52, 8, Math.PI / 2],
    [175.5, 52, 8, Math.PI / 2],
    [196, -60.5, 22, 0],
    [-48, 98, 8, Math.PI / 2],
  ]
  for (const [hx, hz, len, rot] of hedges) propsGroup.add(makeHedge(hx, hz, len, rot))
  for (const [px, pz] of [
    [108, -8],
    [128, -8],
    [108, 9],
    [128, 9],
    [74, 166],
    [92, 166],
    [-48, 145],
    [145, 140],
    [-150, -16],
    [184, -60],
  ] as const) {
    propsGroup.add(makePlanter(px, pz))
  }

  // T2 第二体育场
  const t2 = makePlayground(184, 102)
  scene.add(t2)
  treeRects.push([156, 212, 82, 122])

  place(
    makeGenericBuilding({
      name: '附属口腔医院',
      info: '青岛黄海学院附属口腔医院，对外接诊的校办医院。',
      w: 18,
      d: 12,
      floors: 5,
    }),
    { x: 210, z: 75, labelY: 21, labelScale: 9 },
  )

  place(
    makeGenericBuilding({
      name: 'J1 知新楼',
      info: '南区主教学楼，"温故而知新"，一层设有自助学习中心。',
      w: 34,
      d: 16,
      floors: 5,
    }),
    { x: 65, z: 108, labelY: 24 },
  )
  place(
    makeGenericBuilding({
      name: 'J2 知明楼',
      info: '南区教学楼，与知新楼隔草坪相望。',
      w: 18,
      d: 14,
      floors: 5,
    }),
    { x: 110, z: 108, labelY: 24 },
  )

  place(buildCanteen({ name: 'C1 学苑餐厅', info: '南区主餐厅，可容纳 3000 人同时就餐。' }), { x: 12, z: 130, labelY: 15 })
  place(
    makeGenericBuilding({
      name: 'B2 招生办',
      info: '招生就业处，新生报到咨询窗口。',
      w: 12,
      d: 9,
      floors: 3,
    }),
    { x: 36, z: 134, labelY: 13, labelScale: 9 },
  )
  place(
    makeGenericBuilding({
      name: 'B3 安保处',
      info: '安全保卫处与校园监控指挥中心。',
      w: 12,
      d: 9,
      floors: 3,
    }),
    { x: 90, z: 130, labelY: 13, labelScale: 9 },
  )
  scene.add(makePavementDisc(145, 132, 8))

  // 商业街（玉皇路西侧的一排小商铺）
  const shopRoofs = ['#c96f4a', '#4a8ac9', '#5da65e', '#c9a24a', '#9a6fc9']
  for (let i = 0; i < 5; i++) {
    const shop = makeGenericBuilding({
      name: '商业街',
      info: '校园商业街：超市、书店、奶茶与打印服务。',
      w: 8,
      d: 6,
      floors: 2,
      accentColor: shopRoofs[i]!,
    })
    shop.position.set(-48, 0, 104 + i * 7.5)
    buildingsGroup.add(shop)
    treeRects.push([-54, -42, 100, 142])
  }
  const streetLabel = makeLabelSprite('商业街', 9)
  streetLabel.position.set(-48, 14, 121)
  labelsGroup.add(streetLabel)

  // 人才公寓（山海嘉园）
  place(
    makeDormBlock({
      name: '人才公寓 · 山海嘉园',
      info: '教工人才公寓"山海嘉园"，可远眺灵山湾海景。',
      w: 36,
      d: 14,
      floors: 8,
      roofColor: '#7a5a9a',
    }),
    { x: 272, z: 72, labelY: 32, labelScale: 10 },
  )

  // 附属幼儿园（彩色屋顶）
  place(
    makeGenericBuilding({
      name: '附属幼儿园',
      info: '青岛黄海学院附属幼儿园。',
      w: 16,
      d: 10,
      floors: 2,
      litRatio: 0.5,
      accentColor: '#e8a23c',
    }),
    { x: 320, z: 86, labelY: 11, labelScale: 9 },
  )

  // 东区宿舍群（11# ~ 18#）
  const eastRows: [number, number][] = [
    [18, 13],
    [17, 13],
    [16, 13],
    [15, 13],
    [14, 34],
    [13, 34],
    [12, 34],
    [11, 34],
    [10, 55],
    [9, 55],
    [8, 55],
  ]
  const eastCols = [228, 256, 284, 312]
  eastRows.forEach(([num, z], i) => {
    dorm(num, eastCols[i % 4]!, z)
  })

  /* ------ 校门 ------ */
  place(makeGateArch('北区大门', 18), { x: 118, z: -4, labelY: 15, labelScale: 10 })
  place(makeGateArch('北区东大门', 16), { x: 196, z: -48, rot: Math.PI / 2, labelY: 15, labelScale: 10 })
  place(makeGateArch('西区西门', 14), { x: -155, z: -12, labelY: 15, labelScale: 10 })
  place(makeGateArch('西区大门', 16), { x: -68, z: -12, labelY: 15, labelScale: 10 })
  place(makeGateArch('南区大门', 20), { x: 83, z: 160, labelY: 15, labelScale: 11 })

  // 停车场
  scene.add(makeParkingLot(248, -48, 30, 22))
  treeRects.push([231, 265, -61, -35])

  /* ------ 龙山山体（北屏障） ------ */
  scene.add(makeMountain(-260, -205, 70, 40, '#4e7a3c'))
  scene.add(makeMountain(-90, -225, 85, 50, '#527f40'))
  scene.add(makeMountain(80, -215, 80, 45, '#4e7a3c'))
  scene.add(makeMountain(240, -228, 70, 38, '#55834a'))
  scene.add(makeMountain(-180, -178, 40, 16, '#4a7539'))
  scene.add(makeMountain(0, -185, 45, 18, '#4a7539'))
  scene.add(makeMountain(160, -180, 40, 15, '#4a7539'))
  scene.add(makeMountain(300, -190, 45, 17, '#4a7539'))
  // 山坡松林
  const mountainForests: [number, number, number, number][] = [
    [-260, -205, 70, 40],
    [-90, -225, 85, 50],
    [80, -215, 80, 45],
    [240, -228, 70, 38],
  ]
  mountainForests.forEach(([mx, mz, mr, mh], i) => {
    for (const mesh of makeMountainForest(mx, mz, mr, mh, { count: 170, seed: 7100 + i * 37 })) {
      propsGroup.add(mesh)
    }
  })

  /* ------ 长椅 / 飞鸟 ------ */
  for (const [bx, bz, br] of [
    [92, -24, 0.4],
    [116, -24, -0.4],
    [30, -22, 0],
    [52, -22, 0],
    [56, 64, 1.57],
  ] as const) {
    const bench = makeBench(br)
    bench.position.set(bx, 0, bz)
    propsGroup.add(bench)
  }
  const birds = makeBirds(new THREE.Vector2(42, -32), 5, [
    { x: 26, z: -32 },
    { x: 58, z: -32 },
    { x: 42, z: -50 },
    { x: 42, z: -14 },
    { x: 92, z: -24, y: 0.62 },
  ])
  propsGroup.add(birds.group)
  updates.push(birds.update)

  /* ------ 路灯 ------ */
  const addLamp = (x: number, z: number, rot: number, withLight: boolean) => {
    const lamp = makeLamp(x, z, rot, withLight)
    scene.add(lamp)
    const l = lamp.userData.lampLight as THREE.PointLight | null
    if (l) lampLights.push({ light: l, bulb: lamp.userData.bulb as THREE.Mesh })
  }
  // 胶州湾东路（主路，带光源）
  for (const x of [-280, -170, -60, 60, 170, 280]) {
    addLamp(x, -12, 0, true)
    addLamp(x, 12, Math.PI, false)
  }
  // 灵海路
  for (const x of [-150, 0, 150, 300]) addLamp(x, 153, 0, x === 0 || x === 150)
  // 玉皇路 / 八一路
  addLamp(-38, 60, Math.PI / 2, true)
  addLamp(-38, 130, Math.PI / 2, false)
  addLamp(124, 60, -Math.PI / 2, false)
  addLamp(124, 130, -Math.PI / 2, true)
  // 北区
  addLamp(112, -40, 0, true)
  addLamp(56, -70, Math.PI / 2, false)

  /* ------ 树木 ------ */
  // 城市道路也纳入排除
  roadRects.push([-380, 380, -11, 11], [-380, 380, 152, 168])
  treeRects.push(...roadRects)
  treeRects.push([-380, 380, -168, -130]) // 龙山山脚线以北不种树
  treeCircles.push(
    { x: 0, z: -56, r: 32 },
    { x: 184, z: 102, r: 30 },
    { x: -140, z: -60, r: 20 },
    { x: 104, z: -32, r: 14 },
    { x: 165, z: 52, r: 10 },
  )
  plantTrees(propsGroup, rand, treeRects, treeCircles, {
    minX: -345,
    maxX: 345,
    minZ: -160,
    maxZ: 150,
    count: 600,
  })
  // 山脚列植补充
  plantTrees(propsGroup, rand, [], [], { minX: -330, maxX: 330, minZ: -168, maxZ: -158, count: 85 })

  /* ------ 校园周边：灵山湾大海 + 沙滩 + 住宅小区 ------ */
  const SHORE_Z = 208

  // 大海与沙滩
  const sea = makeSea(SHORE_Z)
  scene.add(sea.mesh)
  waters.push(sea)
  scene.add(makeBeach(0, 203, 1520, 22))

  // 玉皇路 / 八一路 向南延伸到海边
  scene.add(makeRoad(12, 34, -32, 181))
  scene.add(makeRoad(12, 34, 130, 181))

  const surRects: Rect[] = []
  const surCircles: { x: number; z: number; r: number }[] = []
  function placeResidential(
    x: number,
    z: number,
    o?: { w?: number; d?: number; floors?: number; roofColor?: string; rot?: number },
  ) {
    const res = makeDormBlock({
      name: '住宅楼',
      info: '校园周边居民住宅。',
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
  // 灵山湾·海景公寓（灵海路南侧，两排海景房，中间留出观海绿廊）
  for (let i = 0; i < 8; i++) {
    placeResidential(-280 + i * 26, 173, { roofColor: warmRoofs[i % 4]!, floors: 6 })
  }
  for (let i = 0; i < 7; i++) {
    placeResidential(-268 + i * 26, 185, { roofColor: warmRoofs[(i + 2) % 4]!, floors: 5 })
  }
  // 东方海岸小区（东南）已移除：
  // 校园初始环绕机位在 (210, 110, 330)，进场时会被钳制到 z≈186，
  // 正好落在这两排住宅的碰撞体中间，第一帧就被推挤+边界钳制来回拉扯，表现为「刚出场动不了」。
  // 原小区占地留空，避免树木直接长在出生点视野里。
  surRects.push([160, 330, 160, 198])
  // 西海岸花园（校园西侧）
  const surWestCols = [-500, -464, -428]
  const surWestRows = [-70, -30, 10, 50, 90]
  for (const [ci, cx] of surWestCols.entries()) {
    for (const [ri, rz] of surWestRows.entries()) {
      placeResidential(cx!, rz!, {
        w: 22,
        d: 11,
        floors: 6,
        roofColor: warmRoofs[(ci + ri) % 4]!,
      })
    }
  }
  // 东方海岸城（校园东侧）+ 标志性高楼
  const surEastCols = [430, 470, 510]
  const surEastRows = [-50, -10, 30, 70]
  for (const [ci, cx] of surEastCols.entries()) {
    for (const [ri, rz] of surEastRows.entries()) {
      placeResidential(cx!, rz!, {
        w: 22,
        d: 11,
        floors: 6,
        roofColor: warmRoofs[(ci * 2 + ri) % 4]!,
      })
    }
  }
  place(
    makeGenericBuilding({
      name: '海岸明珠大厦',
      info: '周边地标写字楼。',
      w: 16,
      d: 12,
      floors: 14,
    }),
    { x: 470, z: -95, labelY: 50, labelScale: 10 },
  )

  // 社区标签
  const surLabels: [string, number, number, number, number][] = [
    ['灵山湾 · 海景公寓', -185, 15, 178, 14],
    ['西海岸花园', -464, 26, 10, 13],
    ['东方海岸城', 470, 26, 20, 13],
    ['灵 山 湾', 0, 30, 330, 26],
  ]
  for (const [text, x, y, z, scale] of surLabels) {
    const s = makeLabelSprite(text, scale)
    s.position.set(x, y, z)
    labelsGroup.add(s)
  }

  // 海边不可入水：沿海岸线布置一排隐形碰撞体
  for (let x = -600; x <= 600; x += 40) {
    colliders.push({ x, z: 216, r: 24 })
  }

  // 周边绿化
  surRects.push([-45, -19, 160, 198], [118, 142, 160, 198], [-380, 380, 186, 216])
  plantTrees(propsGroup, rand, surRects, surCircles, {
    minX: -350,
    maxX: 350,
    minZ: 167,
    maxZ: 185,
    count: 80,
  })
  plantTrees(propsGroup, rand, surRects, surCircles, {
    minX: -560,
    maxX: -390,
    minZ: -110,
    maxZ: 120,
    count: 75,
  })
  plantTrees(propsGroup, rand, surRects, surCircles, {
    minX: 395,
    maxX: 555,
    minZ: -120,
    maxZ: 110,
    count: 75,
  })

  /* ------ 建筑周边铺装（合并为 1 个 mesh） ------ */
  const apronMesh = makeBuildingAprons(aprons)
  if (apronMesh) scene.add(apronMesh)

  return { buildingsGroup, labelsGroup, lampLights, waters, updates, colliders }
}
