import * as THREE from 'three'
import { paint, paintedStone } from './materials'
import { makeSignTexture } from './textures'

/** 知新楼内部房间类型 */
export type RoomType = 'classroom' | 'office' | 'lab' | 'corridor' | 'stairwell' | 'restroom'

/** 房间数据结构 */
export interface RoomData {
  id: string
  name: string
  type: RoomType
  floor: number
  /** 房间在楼层中的索引位置 */
  position: { x: number; z: number }
  /** 房间尺寸 */
  size: { w: number; d: number; h: number }
  /** 是否有窗户 */
  hasWindow: boolean
  /** 门的位置（相对房间中心） */
  doorPosition: { x: number; z: number }
  /** 当前灯光状态 */
  lightsOn: boolean
  /** 当前门状态 */
  doorOpen: boolean
  /** 窗户状态 */
  windowOpen: boolean
  /** 课表信息（教室专用） */
  schedule?: CourseSchedule[]
  /** 当前是否有课 */
  inClass?: boolean
  /** 学生数量 */
  studentCount?: number
}

/** 课程信息 */
export interface CourseSchedule {
  name: string
  teacher: string
  weekday: number // 1-7
  startTime: number // 小时，如 8.0
  endTime: number
  capacity: number
}

/** 知新楼完整配置 */
export interface ZhixinBuildingConfig {
  /** 楼层数 */
  floors: number
  /** 每层房间布局 */
  rooms: RoomData[]
  /** 走廊宽度 */
  corridorWidth: number
  /** 楼梯间位置 */
  stairwells: { x: number; z: number }[]
}

/** 生成知新楼默认配置：5层，中间办公室两侧教室 */
export function createZhixinBuildingConfig(): ZhixinBuildingConfig {
  const rooms: RoomData[] = []
  const FLOOR_HEIGHT = 3.1
  const ROOM_HEIGHT = 2.8

  // 虚拟课表数据（周一到周五）
  const sampleCourses: Omit<CourseSchedule, 'capacity'>[] = [
    { name: '计算机图形学', teacher: '胡西庆', weekday: 1, startTime: 8.0, endTime: 9.5 },
    { name: '数据结构与算法', teacher: '王老师', weekday: 1, startTime: 10.0, endTime: 11.5 },
    { name: 'Web 前端开发', teacher: '李老师', weekday: 2, startTime: 8.0, endTime: 9.5 },
    { name: '操作系统原理', teacher: '张老师', weekday: 2, startTime: 14.0, endTime: 15.5 },
    { name: '计算机网络', teacher: '刘老师', weekday: 3, startTime: 8.0, endTime: 9.5 },
    { name: '软件工程', teacher: '赵老师', weekday: 3, startTime: 10.0, endTime: 11.5 },
    { name: '人工智能导论', teacher: '孙老师', weekday: 4, startTime: 8.0, endTime: 9.5 },
    { name: '数据库系统', teacher: '周老师', weekday: 4, startTime: 14.0, endTime: 15.5 },
    { name: '移动应用开发', teacher: '吴老师', weekday: 5, startTime: 8.0, endTime: 9.5 },
  ]

  // 为每层楼生成房间布局
  for (let floor = 1; floor <= 5; floor++) {
    const floorY = (floor - 1) * FLOOR_HEIGHT

    // 西侧教室（4间）
    for (let i = 0; i < 4; i++) {
      const roomNum = (floor - 1) * 10 + i + 1
      const course = sampleCourses[((floor - 1) * 4 + i) % sampleCourses.length]!
      rooms.push({
        id: `${floor}0${i + 1}`,
        name: `${roomNum}教室`,
        type: 'classroom',
        floor,
        position: { x: -14 + i * 7, z: -6 },
        size: { w: 6.5, d: 7, h: ROOM_HEIGHT },
        hasWindow: true,
        doorPosition: { x: 0, z: 3.5 },
        lightsOn: false,
        doorOpen: false,
        windowOpen: false,
        schedule: [{ ...course, capacity: 60 }],
        inClass: false,
        studentCount: 0,
      })
    }

    // 中间办公室（6间）
    for (let i = 0; i < 6; i++) {
      const officeNum = (floor - 1) * 10 + 10 + i + 1
      rooms.push({
        id: `${floor}1${i + 1}`,
        name: `${officeNum}办公室`,
        type: 'office',
        floor,
        position: { x: -7 + i * 2.5, z: 0 },
        size: { w: 2.3, d: 3, h: ROOM_HEIGHT },
        hasWindow: false,
        doorPosition: { x: 0, z: 1.5 },
        lightsOn: false,
        doorOpen: false,
        windowOpen: false,
      })
    }

    // 东侧教室（4间）
    for (let i = 0; i < 4; i++) {
      const roomNum = (floor - 1) * 10 + 20 + i + 1
      const course = sampleCourses[((floor - 1) * 4 + i + 2) % sampleCourses.length]!
      rooms.push({
        id: `${floor}2${i + 1}`,
        name: `${roomNum}教室`,
        type: 'classroom',
        floor,
        position: { x: 0 + i * 7, z: 6 },
        size: { w: 6.5, d: 7, h: ROOM_HEIGHT },
        hasWindow: true,
        doorPosition: { x: 0, z: -3.5 },
        lightsOn: false,
        doorOpen: false,
        windowOpen: false,
        schedule: [{ ...course, capacity: 60 }],
        inClass: false,
        studentCount: 0,
      })
    }

    // 楼梯间（两侧各一个）
    rooms.push({
      id: `${floor}S1`,
      name: `${floor}层西楼梯`,
      type: 'stairwell',
      floor,
      position: { x: -17, z: 0 },
      size: { w: 3, d: 4, h: ROOM_HEIGHT },
      hasWindow: true,
      doorPosition: { x: 1.5, z: 0 },
      lightsOn: true, // 楼梯间常亮
      doorOpen: true, // 楼梯门常开
      windowOpen: false,
    })
    rooms.push({
      id: `${floor}S2`,
      name: `${floor}层东楼梯`,
      type: 'stairwell',
      floor,
      position: { x: 17, z: 0 },
      size: { w: 3, d: 4, h: ROOM_HEIGHT },
      hasWindow: true,
      doorPosition: { x: -1.5, z: 0 },
      lightsOn: true,
      doorOpen: true,
      windowOpen: false,
    })

    // 卫生间（每层东西两侧）
    rooms.push({
      id: `${floor}W1`,
      name: `${floor}层西卫生间`,
      type: 'restroom',
      floor,
      position: { x: -17, z: -6 },
      size: { w: 3, d: 3, h: ROOM_HEIGHT },
      hasWindow: true,
      doorPosition: { x: 1.5, z: 0 },
      lightsOn: true,
      doorOpen: true,
      windowOpen: false,
    })
    rooms.push({
      id: `${floor}W2`,
      name: `${floor}层东卫生间`,
      type: 'restroom',
      floor,
      position: { x: 17, z: 6 },
      size: { w: 3, d: 3, h: ROOM_HEIGHT },
      hasWindow: true,
      doorPosition: { x: -1.5, z: 0 },
      lightsOn: true,
      doorOpen: true,
      windowOpen: false,
    })
  }

  return {
    floors: 5,
    rooms,
    corridorWidth: 2.5,
    stairwells: [
      { x: -17, z: 0 },
      { x: 17, z: 0 },
    ],
  }
}

/** 房间内饰材质 */
const ROOM_MATERIALS = {
  floor: paint('#d8d4cc', 0.7, 0.1),
  ceiling: paint('#f4f2ed', 0.6, 0.1),
  wall: paint('#e8e6dd', 0.7, 0.1),
  door: paint('#8b6f47', 0.5, 0.2),
  window: new THREE.MeshStandardMaterial({
    color: '#b8d8f0',
    transparent: true,
    opacity: 0.3,
    roughness: 0.1,
    metalness: 0.1,
  }),
  blackboard: paint('#1a2a1a', 0.4, 0.0),
  desk: paint('#c9a56f', 0.6, 0.1),
}

/** 创建单个房间 3D 模型 */
export function createRoomMesh(room: RoomData): THREE.Group {
  const group = new THREE.Group()
  group.userData.room = room
  group.position.set(room.position.x, (room.floor - 1) * 3.1 + room.size.h / 2, room.position.z)

  // 地板
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(room.size.w, room.size.d),
    ROOM_MATERIALS.floor,
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -room.size.h / 2
  floor.receiveShadow = true
  group.add(floor)

  // 天花板
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(room.size.w, room.size.d),
    ROOM_MATERIALS.ceiling,
  )
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = room.size.h / 2
  group.add(ceiling)

  // 四面墙
  const wallH = room.size.h
  // 南墙（-Z）
  const southWall = new THREE.Mesh(
    new THREE.BoxGeometry(room.size.w, wallH, 0.2),
    ROOM_MATERIALS.wall,
  )
  southWall.position.set(0, 0, -room.size.d / 2)
  southWall.castShadow = true
  southWall.receiveShadow = true
  group.add(southWall)

  // 北墙（+Z）
  const northWall = new THREE.Mesh(
    new THREE.BoxGeometry(room.size.w, wallH, 0.2),
    ROOM_MATERIALS.wall,
  )
  northWall.position.set(0, 0, room.size.d / 2)
  northWall.castShadow = true
  northWall.receiveShadow = true
  group.add(northWall)

  // 西墙（-X）
  const westWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, wallH, room.size.d),
    ROOM_MATERIALS.wall,
  )
  westWall.position.set(-room.size.w / 2, 0, 0)
  westWall.castShadow = true
  westWall.receiveShadow = true
  group.add(westWall)

  // 东墙（+X）
  const eastWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, wallH, room.size.d),
    ROOM_MATERIALS.wall,
  )
  eastWall.position.set(room.size.w / 2, 0, 0)
  eastWall.castShadow = true
  eastWall.receiveShadow = true
  group.add(eastWall)

  // 门（可交互）
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 2.0, 0.1),
    ROOM_MATERIALS.door,
  )
  door.position.set(
    room.doorPosition.x,
    -room.size.h / 2 + 1.0,
    room.doorPosition.z,
  )
  door.castShadow = true
  door.userData.interactive = 'door'
  door.userData.roomId = room.id
  group.add(door)

  // 窗户（如果有）
  if (room.hasWindow) {
    const windowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.2),
      ROOM_MATERIALS.window,
    )
    // 窗户放在外墙上
    if (room.position.z > 0) {
      windowMesh.position.set(0, 0.3, room.size.d / 2 - 0.05)
      windowMesh.rotation.y = Math.PI
    } else {
      windowMesh.position.set(0, 0.3, -room.size.d / 2 + 0.05)
    }
    windowMesh.userData.interactive = 'window'
    windowMesh.userData.roomId = room.id
    group.add(windowMesh)
  }

  // 教室专属：黑板、课桌椅
  if (room.type === 'classroom') {
    // 黑板（可交互）
    const blackboard = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 1.5, 0.1),
      ROOM_MATERIALS.blackboard,
    )
    blackboard.position.set(0, 0.2, -room.size.d / 2 + 0.2)
    blackboard.castShadow = true
    blackboard.userData.interactive = 'blackboard'
    blackboard.userData.roomId = room.id
    group.add(blackboard)

    // 简化课桌椅阵列（6行10列）
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 10; col++) {
        const desk = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.6, 0.4),
          ROOM_MATERIALS.desk,
        )
        desk.position.set(
          -2.5 + col * 0.6,
          -room.size.h / 2 + 0.3,
          -room.size.d / 2 + 2.0 + row * 0.7,
        )
        desk.castShadow = true
        desk.receiveShadow = true
        group.add(desk)
      }
    }
  }

  // 办公室专属：办公桌、椅子
  if (room.type === 'office') {
    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.7, 0.6),
      ROOM_MATERIALS.desk,
    )
    desk.position.set(0, -room.size.h / 2 + 0.35, -0.5)
    desk.castShadow = true
    group.add(desk)

    const chair = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.8, 0.4),
      ROOM_MATERIALS.desk,
    )
    chair.position.set(0, -room.size.h / 2 + 0.4, 0.3)
    chair.castShadow = true
    group.add(chair)
  }

  // 灯光（房间天花板点光源）
  const roomLight = new THREE.PointLight('#fff9e8', 0, 8)
  roomLight.position.set(0, room.size.h / 2 - 0.3, 0)
  roomLight.castShadow = false
  roomLight.userData.roomLight = true
  roomLight.userData.roomId = room.id
  group.add(roomLight)

  // 根据当前状态设置灯光
  if (room.lightsOn) {
    roomLight.intensity = 1.2
  }

  return group
}

/** 创建楼层走廊 */
function createCorridor(floor: number, corridorWidth: number): THREE.Mesh {
  const CORRIDOR_LENGTH = 40
  const geometry = new THREE.PlaneGeometry(CORRIDOR_LENGTH, corridorWidth)
  const material = paint('#c8c4bb', 0.7, 0.1)
  const corridor = new THREE.Mesh(geometry, material)
  corridor.rotation.x = -Math.PI / 2
  corridor.position.set(0, (floor - 1) * 3.1, 0)
  corridor.receiveShadow = true
  return corridor
}

/** 创建楼梯模型 */
function createStairs(x: number, z: number, floors: number): THREE.Group {
  const group = new THREE.Group()
  const stairMaterial = paint('#a8a39a', 0.6, 0.1)

  for (let floor = 0; floor < floors; floor++) {
    const floorY = floor * 3.1
    // 每层楼梯有10级台阶
    for (let step = 0; step < 10; step++) {
      const stepMesh = new THREE.Mesh(
        new THREE.BoxGeometry(2.5, 0.15, 0.3),
        stairMaterial,
      )
      stepMesh.position.set(x, floorY + step * 0.31, z + step * 0.3)
      stepMesh.castShadow = true
      stepMesh.receiveShadow = true
      group.add(stepMesh)
    }
  }

  return group
}

/** 学生模型（简化为胶囊体 + 头部） */
function createStudentMesh(): THREE.Group {
  const student = new THREE.Group()
  const bodyMat = paint('#4a7abc', 0.6, 0.1)
  const headMat = paint('#f4d9b8', 0.5, 0.1)

  // 身体（胶囊体）
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.15, 0.6, 4, 8),
    bodyMat,
  )
  body.position.y = 0.5
  body.castShadow = true
  student.add(body)

  // 头部
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    headMat,
  )
  head.position.y = 0.95
  head.castShadow = true
  student.add(head)

  return student
}

/** 知新楼完整场景类 */
export class ZhixinBuildingScene {
  public group = new THREE.Group()
  public config: ZhixinBuildingConfig
  public rooms: Map<string, { data: RoomData; mesh: THREE.Group }> = new Map()
  public students: THREE.Group[] = []
  private currentFloor = 1
  private playerInside = false

  constructor() {
    this.config = createZhixinBuildingConfig()
    this.build()
  }

  private build() {
    // 创建所有房间
    for (const room of this.config.rooms) {
      const mesh = createRoomMesh(room)
      this.group.add(mesh)
      this.rooms.set(room.id, { data: room, mesh })
    }

    // 创建走廊
    for (let floor = 1; floor <= this.config.floors; floor++) {
      const corridor = createCorridor(floor, this.config.corridorWidth)
      this.group.add(corridor)
    }

    // 创建楼梯
    for (const stair of this.config.stairwells) {
      const stairs = createStairs(stair.x, stair.z, this.config.floors)
      this.group.add(stairs)
    }

    // 初始化学生（稍后根据课表动态生成）
    this.updateStudents()
  }

  /** 根据当前时间和课表更新学生 */
  updateStudents() {
    // 清除现有学生
    for (const student of this.students) {
      this.group.remove(student)
    }
    this.students = []

    // 遍历所有教室，检查是否有课
    for (const [id, { data: room, mesh }] of this.rooms) {
      if (room.type !== 'classroom' || !room.schedule) continue

      // 简化：假设当前是周一早上 8:30
      const currentWeekday = 1
      const currentTime = 8.5

      const activeCourse = room.schedule.find(
        (course) =>
          course.weekday === currentWeekday &&
          currentTime >= course.startTime &&
          currentTime < course.endTime,
      )

      if (activeCourse) {
        room.inClass = true
        room.lightsOn = true
        room.studentCount = Math.floor(activeCourse.capacity * 0.8) // 80% 出勤率

        // 生成学生模型
        for (let i = 0; i < room.studentCount; i++) {
          const student = createStudentMesh()
          const row = Math.floor(i / 10)
          const col = i % 10
          student.position.set(
            mesh.position.x - 2.5 + col * 0.6,
            mesh.position.y - room.size.h / 2,
            mesh.position.z - room.size.d / 2 + 2.0 + row * 0.7,
          )
          this.group.add(student)
          this.students.push(student)
        }

        // 更新房间灯光
        const roomLight = mesh.children.find(
          (child) => child.userData.roomLight,
        ) as THREE.PointLight | undefined
        if (roomLight) {
          roomLight.intensity = 1.2
        }
      } else {
        room.inClass = false
        room.studentCount = 0
      }
    }
  }

  /** 切换门状态 */
  toggleDoor(roomId: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false

    room.data.doorOpen = !room.data.doorOpen
    const door = room.mesh.children.find(
      (child) => child.userData.interactive === 'door',
    ) as THREE.Mesh | undefined

    if (door) {
      // 简单开门动画：旋转90度
      if (room.data.doorOpen) {
        door.rotation.y = Math.PI / 2
      } else {
        door.rotation.y = 0
      }
    }

    return room.data.doorOpen
  }

  /** 切换灯光状态 */
  toggleLights(roomId: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false

    room.data.lightsOn = !room.data.lightsOn
    const roomLight = room.mesh.children.find(
      (child) => child.userData.roomLight,
    ) as THREE.PointLight | undefined

    if (roomLight) {
      roomLight.intensity = room.data.lightsOn ? 1.2 : 0
    }

    return room.data.lightsOn
  }

  /** 切换窗户状态 */
  toggleWindow(roomId: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room || !room.data.hasWindow) return false

    room.data.windowOpen = !room.data.windowOpen
    const window = room.mesh.children.find(
      (child) => child.userData.interactive === 'window',
    ) as THREE.Mesh | undefined

    if (window && window.material instanceof THREE.MeshStandardMaterial) {
      // 窗户打开时透明度增加
      window.material.opacity = room.data.windowOpen ? 0.1 : 0.3
    }

    return room.data.windowOpen
  }

  /** 黑板交互：打开课程信息 */
  openBlackboard(roomId: string): CourseSchedule | null {
    const room = this.rooms.get(roomId)
    if (!room || room.data.type !== 'classroom' || !room.data.schedule) return null

    // 返回当前正在上的课程
    const currentWeekday = 1
    const currentTime = 8.5
    const activeCourse = room.data.schedule.find(
      (course) =>
        course.weekday === currentWeekday &&
        currentTime >= course.startTime &&
        currentTime < course.endTime,
    )

    return activeCourse || room.data.schedule[0] || null
  }

  /** 进入建筑（从外部） */
  enter() {
    this.playerInside = true
    this.group.visible = true
  }

  /** 离开建筑 */
  exit() {
    this.playerInside = false
  }

  /** 上楼 */
  goUpstairs() {
    if (this.currentFloor < this.config.floors) {
      this.currentFloor++
      return this.currentFloor
    }
    return this.currentFloor
  }

  /** 下楼 */
  goDownstairs() {
    if (this.currentFloor > 1) {
      this.currentFloor--
      return this.currentFloor
    }
    return this.currentFloor
  }

  /** 获取当前楼层 */
  getCurrentFloor() {
    return this.currentFloor
  }

  /** 获取房间信息 */
  getRoomInfo(roomId: string): RoomData | null {
    return this.rooms.get(roomId)?.data || null
  }

  /** 获取当前楼层所有房间 */
  getCurrentFloorRooms(): RoomData[] {
    return this.config.rooms.filter((room) => room.floor === this.currentFloor)
  }

  /** 更新动画（学生动作等） */
  update(deltaTime: number) {
    // 简单的学生晃动动画
    for (const student of this.students) {
      student.rotation.y += Math.sin(Date.now() * 0.001) * 0.001
    }
  }

  dispose() {
    for (const student of this.students) {
      this.group.remove(student)
    }
    this.students = []
    this.rooms.clear()
  }
}

