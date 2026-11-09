# 黄海行动 · HUANGHAI OPERATIONS

把 `04_cgweb` 里的黄海校园 3D 场景（`student/campus`）和 CF 枪械手感（`campus/defense/cf`）抽出来，做成一个可玩的五模式校园射击游戏。

- 场景：青岛黄海学院 1.2 km² 实景校园（程序化建筑 / 树木 / 水景 / 天空昼夜，`qdhh` 布局）
- 枪械：AK-47、M4A1、巴雷特、加特林、汤姆逊、火麒麟、雷神、沙鹰、USP、尼泊尔、铁锹（固定弹道 + 压枪 + 四段换弹 + 程序化枪声）
- 模式：经典 / 爆破 / 生化 / 挑战 / 三角洲大战场

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 类型检查 + 生产构建
```

需要支持 WebGL2 的桌面浏览器；进入对局后点击「开始战斗」会锁定鼠标。

## 五个模式

| 模式 | 目标 | 时长 | 关键规则 |
|---|---|---|---|
| 经典模式 | 团队竞技先到 40 击杀 | 6 分钟 | 阵亡 3 秒复活，3 名 AI 队友协同压点 |
| 爆破模式 | 5 回合 3 胜 | 每回合 2:10 | 包点内按住 E 安放 C4，引爆倒计时 45 秒；敌人贴近 3.2m 持续 10 秒会拆弹 |
| 生化模式 | 存活 4 分钟 | 4 分钟 | 单条命，血量归零即被感染；每 55 秒刷一只强化母体 |
| 挑战模式 | 清空 30 波 | — | 沿用原守卫战配比，每 10 波 BOSS，波间 6 秒补给 |
| 三角洲大战场 | 三点据点征服 | 8 分钟 | A/B/C 三点，双方各 300 票；占点持续扣票，击杀 -2 票，阵亡 -3 票 |

所有模式共享同一套战斗内核：CF 弹道表、护甲穿透、爆头倍率、连杀播报、医疗包 / 护甲 / 弹药掉落、脱战 8 秒回血。

## 操作

| 按键 | 功能 |
|---|---|
| WASD / Shift / Space | 移动 / 冲刺 / 跳跃（支持四段跳与滑翔） |
| 左键 / 右键 | 射击 / 开镜（狙击、部分步枪） |
| R / 1 / 2 / 3 / Q / 滚轮 | 换弹 / 主武器 / 副武器 / 近战 / 上一把 / 循环切枪 |
| E | 爆破模式安放 C4 |
| Esc | 暂停（释放指针） |

## 创意工坊

本作已接入 VibeHub 创意工坊（Mod API v1）。玩家可以用 Mod 新增武器、微调数值、换 HUD 配色、
订阅对局事件与弹提示，完整约定见 [WORKSHOP.md](./WORKSHOP.md)，能力目录见
[WORKSHOP_CAPABILITIES.json](./WORKSHOP_CAPABILITIES.json)。

- 公共入口：`window.HuangHai`，每个 Mod 用 `HuangHai.forMod(id)` 绑定身份
- 启动顺序：`index.html` 先加载官方 Loader → `main.ts` 建立 API → 等 `beforeStart`
  → 挂载游戏 → `markGameReady()` → 等 `afterStart`
- 联机策略：`mods-disabled`（本作目前是纯单人）

## 目录结构

```
src/
├─ game/
│  ├─ match.ts          对局引擎：玩家状态、武器、五模式状态机、HUD 数据、结算
│  ├─ arena.ts          校园可行走区域 → EnemyManager 需要的战场接口（刷怪 / 碰撞 / 选址）
│  ├─ markers.ts        爆破点 / 据点的地面光圈、光柱、中文悬浮牌、C4 实体、爆炸波
│  ├─ squad.ts          AI 队友小队（推进据点、点射敌人，击杀不计入玩家）
│  ├─ waves.ts          挑战模式 30 波配比 + 各模式敌人称呼 + 掉落概率
│  ├─ meta.ts           模式元数据（首页 / 简报面板共用）
│  ├─ types.ts          HUD / 结算 / 雷达的数据契约
│  ├─ mods/             创意工坊：API 组装、武器注册、数值系数、主题、事件总线、诊断
│  └─ world/
│     ├─ three/         原校园场景（campus / 建筑 / 天空 / 水面 / 知新楼 / 第一人称控制器）
│     ├─ cf/            CF 枪械表 / 弹道数学 / 第一人称枪模 / 程序化枪声
│     └─ arena/         敌军 AI、命中特效、敌兵规格（从 starbattle 裁剪）
├─ components/
│  ├─ GameHud.vue       准星 / 血甲 / 弹药 / 计分 / 雷达 / 爆破倒计时 / 据点面板 / 击杀播报
│  └─ ModeIcon.vue      五个模式的矢量图标
├─ views/
│  ├─ HomeView.vue      大厅：模式选择、配枪、灵敏度
│  └─ GameView.vue      战场：挂载 CampusApp、简报 / 暂停 / 结算遮罩
└─ stores/game.ts       配枪、上次模式、灵敏度（localStorage 持久化）
```

## 关键实现说明

**场景复用**：`CampusApp.startMatch(mode, callbacks, loadout)` 会切到第一人称、收起小地图、把漫游速度压到射击区间（`speedScale = 0.42`），并实例化 `MatchEngine`；渲染循环里先画校园再叠第一人称枪模。

**模式隔离**：所有模式共用一个 `MatchEngine`，按 `mode` 分派 `updateClassic / updateBomb / updateBio / updateChallenge / updateDelta`。回合过场用引擎时间驱动（`bombGate`），不依赖 `setTimeout`，所以暂停、快进、重开都不会串场。

**目标点选址**：`ArenaField.findOpenArea()` 从期望坐标向外螺旋搜索不被建筑碰撞体覆盖的空地，所以 A/B 包点、A/B/C 据点会自适应校园建筑布局，不会卡进楼里。

**雷达**：HUD 拿到的是一组世界坐标 + 玩家坐标 / 朝向，按 `dot(rel, right)`、`-dot(rel, forward)` 投影成朝向朝上的圆形雷达；超出 130m 的目标贴边显示。

**AI 队友**：只做「向目标点推进 + 45m 内点射」，靠圆形碰撞推离绕建筑。队友伤害单独记账，击杀不会算到玩家头上。

## 调参入口

| 想改什么 | 文件 |
|---|---|
| 模式数值（击杀目标、回合数、存活时长、票数） | `src/game/match.ts` 顶部常量 |
| 波次配比 / 敌人称呼 / 掉落概率 | `src/game/waves.ts` |
| 各模式刷怪节奏 | `match.ts` 的 `updateClassic / updateBomb / updateBio / updateDelta` |
| 枪械数值 / 弹道 / 皮肤 | `src/game/world/cf/weapons.ts` |
| 散布 / 伤害衰减 / 连杀 | `src/game/world/cf/math.ts` |
| 枪模动画 / 枪声音色 | `src/game/world/cf/viewmodel.ts` / `audio.ts` |
| 据点光圈与标签 | `src/game/markers.ts` |
| HUD 布局与配色 | `src/components/GameHud.vue` |

## 开发调试

开发模式下控制台可直接操作当前对局：

```js
window.__match.debugState          // 模式、阶段、计时、敌人数、比分
window.__match.objectivePoints     // 爆破点 / 据点坐标
window.__match.teleportTo(x, z)    // 把玩家送到坐标
window.__match.debugFinish(true)   // 直接结算，验收结算面板
window.__match.enemyManager.clear()// 清场，验证波次推进
```

工坊 API 在开发模式下同样可用，可手动模拟一次 Mod 注册：

```js
const mod = window.HuangHai.forMod('dev.test')
mod.registerWeapon({ id: 'dev.test', name: 'DEV', slot: 'primary', damage: 50 })
mod.patchBalance({ enemyHealth: 0.5 })
mod.notice('dev mod loaded')
window.HuangHai.getErrors()        // 注册失败 / 回调报错
```
