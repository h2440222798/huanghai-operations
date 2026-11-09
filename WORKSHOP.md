# 黄海行动 · 创意工坊开发约定

面向 Mod 作者的公开约定。游戏本体只暴露下面这份 API，**其他任何内部写法都不保证兼容**。

- 作品：黄海行动 · HUANGHAI OPERATIONS
- 项目 slug：`huanghai-operations`
- Mod API 版本：`1`（`window.HuangHai.apiVersion`）
- 游戏版本：`1.1.0`
- 联机策略：`mods-disabled`

> 平台不会扫描或限制 Mod 代码，这份文档是作者与 Mod 创作者之间的开发约定，**不是安全沙箱**。
> 游戏只保证：文档里写明的注册函数会做参数校验，非法数据会被拒绝并记录，而不是让对局崩溃。

---

## 1. 可以做哪些 Mod

| 方向 | 能力 | 说明 |
| --- | --- | --- |
| 武器 | 新增枪械 / 近战 | 自定义伤害、射速、弹匣、散布、后坐、开镜、枪身配色与音色；会出现在大厅配枪列表里 |
| 武器 | 微调现有枪械 | 改内置或其它 Mod 武器的数值与名称，做「平衡补丁」 |
| 数值 | 对局难度 | 敌人血量 / 伤害 / 速度、玩家回血、补给掉落、AI 队友伤害、挑战模式每波数量 |
| 界面 | HUD 主题 | 只改主色与危险色两个 CSS 变量，不动布局 |
| 界面 | 运行时提示 | 在屏幕底部弹一条纯文本提示 |
| 逻辑 | 事件订阅 | 订阅开局、击杀、波次、受伤、结算、HUD 快照，驱动自己的叠层或音效 |

**不开放**（现有架构不支持，强行做会破坏对局）：

- 新增游戏模式、改胜利条件或回合规则（引擎里是硬编码状态机）
- 改校园地形、建筑、刷怪点、爆破点/据点位置（场景是程序化生成且与碰撞体绑定）
- 替换敌人模型或新增敌人种类（敌人规格、动画、AI 状态绑定在 `EnemyManager`）
- 新增音效文件播放通道（枪声是 WebAudio 程序化合成，没有资源加载管线）
- 读取或改写存档、账号、联机状态

---

## 2. 公共对象

```js
window.HuangHai            // 唯一公共入口
window.HuangHai.apiVersion // 1
window.HuangHai.version    // '1.1.0'
window.HuangHai.events     // 可订阅事件名数组
```

每个 Mod 都应该用 `forMod` 绑定自己的身份，这样报错、提示、事件归属都能对上：

```js
const mod = window.HuangHai.forMod('your.mod.id')
```

`forMod` 返回的对象与根对象方法一致，额外带一个只读的 `modId`。

> 不调用 `forMod` 直接 `window.HuangHai.registerWeapon(...)` 也能用，此时归属记为
> `anonymous`，排查冲突时不容易定位，正式发布请务必绑定。

---

## 3. 注册函数

所有注册函数都不抛异常，统一返回结果对象：

```ts
{ ok: true, id?: string } | { ok: false, error: string }
```

### 3.1 `registerWeapon(spec)`

新增一把武器。必填只有 `id`、`name`、`slot`，其余字段从**同槽位内置武器**深拷贝
（主武器 → AK-47，副武器 → 沙鹰，近战 → 库尔喀弯刀），再叠加你写的字段。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 全局唯一，`^[a-z0-9][a-z0-9._-]{1,47}$`，不能与内置武器重名 |
| `name` | string | 英文型号，1~24 字符 |
| `cn` | string | 中文名，1~40 字符，默认同 `name` |
| `desc` | string | 大厅描述，≤240 字符 |
| `slot` | `primary` / `secondary` / `melee` | 决定默认模板 |
| `tag` | `rifle` `smg` `sniper` `machinegun` `pistol` `melee` | 近战槽必须 `melee`，其它槽不能是 `melee` |
| `rarity` | `standard` / `rare` / `hero` | 默认 `rare`，`hero` 在大厅有高亮边框 |
| `damage` | 1~500 | 单发躯干伤害 |
| `rpm` | 30~3000 | 每分钟射速 |
| `magazine` / `reserve` | 1~500 / 0~2000 | 弹匣 / 备弹（整数） |
| `reloadTime` / `drawTime` | 0.2~10 / 0~3 | 换弹、切枪时间（秒） |
| `spread` / `moveSpread` / `airSpread` | 0~20 / 0~30 / 0~40 | 站定 / 移动 / 腾空散布（度） |
| `bloom` / `bloomMax` / `bloomRecovery` | 0~10 / 0~20 / 0~50 | 连射散布增长、上限、恢复 |
| `kick` | 0~2 | 枪身后坐动画强度 |
| `armorPenetration` | 0~1 | 护甲穿透 |
| `headshotMultiplier` / `legMultiplier` | 1~10 / 0.1~1 | 爆头 / 四肢倍率 |
| `falloffStart` / `falloffEnd` / `minDamageRatio` | 1~200 / 2~400 / 0.05~1 | 距离衰减 |
| `pellets` | 1~24 | 霰弹丸数 |
| `zoomFov` `zoomSpread` `zoomRecoil` `zoomMove` | 0.1~1 / 0~30 / 0.2~3 / 0.2~1 | 有 `zoomFov` 才能开镜 |
| `spinUp` | 0~5 | 加特林预转时间 |
| `recoil` | `{ pitch: number[], yaw: number[] }` | 等长数组，长度 1~24，单值 ≤5，循环使用 |
| `sound` | `{ body, crack, noise, tail, gain, flavor }` | 程序化枪声；`flavor` 见下方枚举 |
| `model` | 见下 | 枪身外观 |

`sound.flavor` 只能是：`ak` `m4` `deagle` `barrett` `gatling` `smg` `suppressed` `knife` `shovel`。

`model` 字段：

| 字段 | 取值 |
| --- | --- |
| `body` `metal` `furniture` `accent` | `#RGB` / `#RRGGBB` |
| `barrel` | 0.4~2.5，枪管长度系数 |
| `mag` | `curved` `straight` `drum` `box` `none` |
| `stock` | `wood` `buffer` `folding` `none` |
| `scope` | boolean |
| `skin` | `flame` / `thunder`（英雄级动态皮肤） |
| `blade` | `kukri` / `shovel`（仅近战） |

### 3.2 `patchWeapon(id, patch)`

微调已有武器（内置或 Mod 武器）。可改字段：

- 文本：`name`、`cn`、`desc`
- 数值：`damage` `rpm` `magazine` `reserve` `reloadTime` `drawTime` `spread` `moveSpread`
  `airSpread` `bloom` `bloomMax` `bloomRecovery` `kick` `armorPenetration` `headshotMultiplier`
  `legMultiplier` `falloffStart` `falloffEnd` `minDamageRatio` `pellets` `zoomFov` `zoomSpread`
  `zoomRecoil` `zoomMove` `spinUp`

`id` 与 `slot` 是结构字段，**不能**通过 patch 修改；不存在的武器会被拒绝。

### 3.3 `patchBalance(patch)`

按 **Mod** 记录一份系数，最终生效值是所有 Mod 系数的乘积。

| 字段 | 默认 | 区间 | 作用 |
| --- | --- | --- | --- |
| `enemyHealth` | 1 | 0.2~5 | 敌人血量倍率 |
| `enemyDamage` | 1 | 0.1~5 | 敌人伤害倍率 |
| `enemySpeed` | 1 | 0.5~2.5 | 敌人移速倍率 |
| `playerRegen` | 1 | 0~5 | 脱战回血速度（0 = 关闭） |
| `pickupChance` | 1 | 0~5 | 击杀补给掉落概率 |
| `allyDamage` | 1 | 0~5 | AI 队友伤害 |
| `waveCount` | 1 | 0.5~3 | 挑战模式每波敌人数量 |

同一 Mod 重复调用会**替换自己上一次的设置**（不是叠加）。系数在对局创建时读取，
所以改动从**下一局**开始生效。

### 3.4 `registerTheme(theme)` / `useTheme(id)`

```js
mod.registerTheme({ id: 'your.mod.theme', name: '烈焰', accent: '#ff7a4d', danger: '#ff3b30' })
mod.useTheme('your.mod.theme')  // 传 null 恢复默认配色
```

只接受 `#RGB` / `#RRGGBB`。`accent` 影响 HUD 主色（目标面板、比分条、击杀播报边线、
准星旁的状态色），`danger` 影响低血量告警。**不能**写任意 CSS，也就无法改布局或遮挡按钮。

第一个注册的主题会自动生效；之后注册的主题需要显式 `useTheme`。

### 3.5 `on(event, handler)` / `off(event, handler)`

`on` 返回取消订阅函数。回调抛错会被捕获并记录，不影响对局和其它 Mod。

| 事件 | payload |
| --- | --- |
| `lobby:ready` | `{ modes: {id,name}[], modCount }` |
| `match:start` | `{ mode, modeName, loadout: {primary,secondary,melee} }` |
| `match:end` | `{ mode, victory, score, kills, headshots, deaths, accuracy, time, detail, lines }` |
| `enemy:killed` | `{ mode, kind, name, headshot, byAlly, streak }` |
| `wave:start` | `{ wave, total, isBossWave, label, count }` |
| `player:damaged` | `{ amount, source, health, armor }` |
| `hud` | `MatchHud` 快照，约 5Hz |

payload 都是**冻结的浅拷贝**，改它不会影响对局。

### 3.6 `notice(text, options)`

```js
mod.notice('补给已刷新', { tone: 'good', duration: 2200 })
```

`tone`：`info`（默认）/ `warn` / `good`；`duration` 800~8000ms。纯文本，最多 140 字，
同屏最多 4 条，旧的自动顶掉。**不支持 HTML**。

提示只在**对局界面**显示（大厅四角都被面板占满，弹在这里会挡住配枪）。在大厅发出的提示
最多排队 3 条，在玩家开局时补显；超出的会被丢弃。

### 3.7 只读查询

| 方法 | 返回 |
| --- | --- |
| `getBalance()` | 当前生效的数值系数 |
| `getWeapons()` | 全部可选武器（含 Mod 武器，已叠加 patch） |
| `getThemes()` / `getActiveThemeId()` | 主题列表 / 当前主题 |
| `getMods()` / `getWorkshop()` | 已启用 Mod、能力目录、联机策略 |
| `getErrors()` | 注册失败、事件回调报错的诊断列表 |

---

## 4. 最小可运行 Mod

目录：

```text
my-mod/
├── vibehub.mod.json
└── main.js
```

`vibehub.mod.json`：

```json
{
  "title": "侦察步枪 SR-1",
  "summary": "给主武器加一把高精度半自动步枪",
  "description": "新增 SR-1 侦察步枪：低射速、高单发、开镜稳定。",
  "version": "1.0.0",
  "releaseNotes": "首个版本",
  "entry": "main.js",
  "entryType": "classic",
  "styles": [],
  "loadPhase": "before-start",
  "dependencyIds": [],
  "capabilities": ["weapon.register"]
}
```

`main.js`：

```js
const mod = window.HuangHai.forMod('sr1.scout')

mod.registerWeapon({
  id: 'sr1.scout',
  name: 'SR-1',
  cn: 'SR-1 侦察步枪',
  slot: 'primary',
  tag: 'rifle',
  rarity: 'rare',
  damage: 58,
  rpm: 260,
  magazine: 12,
  reserve: 60,
  reloadTime: 2.1,
  spread: 0.05,
  moveSpread: 2.2,
  zoomFov: 0.42,
  model: { body: '#23303a', accent: '#5ad2c8', scope: true },
  sound: { flavor: 'm4' },
})

mod.on('enemy:killed', (kill) => {
  if (kill.headshot) mod.notice('爆头 · ' + kill.name, { tone: 'good' })
})
```

这段代码在启动前执行：注册的武器会直接出现在大厅配枪列表，事件订阅在对局中生效。

---

## 5. 启动前 / 启动后

| 阶段 | `loadPhase` | 适合做什么 | 不能假设什么 |
| --- | --- | --- | --- |
| 启动前 | `before-start` | 注册武器、改数值、注册主题、订阅事件 | 不能假设大厅或对局已存在；不能读其它启动后 Mod 的状态 |
| 启动后 | `after-start` | 换主题、订阅事件、弹提示、运行期补注册武器 | 不能假设玩家还没开局；不能假设启动前 Mod 一定成功加载 |

平台按清单里的 `loadPhase` 分两批执行，游戏按以下顺序推进：

1. 建立 `window.HuangHai`（此时还没有任何 UI）
2. 等待 `VibeHubWorkshop.beforeStart` → 所有启动前 Mod 执行完
3. 应用注册结果，挂载大厅
4. 调用 `markGameReady()` → 平台开始加载启动后 Mod
5. 等待 `VibeHubWorkshop.afterStart`

启动前 Mod 里 `document.querySelector('.mode-card')` 一定是 `null`；启动后 Mod 里大厅已经存在。

---

## 6. 公共前置依赖

可以把以下 API 当作**稳定基底**，供其它 Mod 依赖（`dependencyIds` 指向它）：

- `window.HuangHai.apiVersion` 与 `getWorkshop()`
- `registerWeapon` / `patchWeapon` / `patchBalance` / `registerTheme` / `useTheme`
- `on` / `off` 的全部事件与 payload 字段
- `getWeapons` / `getBalance` / `getMods` / `getErrors`

**禁止的跨阶段依赖**：

- 启动前 Mod 不得依赖启动后 Mod 注册的武器、主题或事件监听
- 启动后 Mod 不得假设启动前 Mod 一定存在；用 `getWeapons()` / `getMods()` 探测后再用
- 任何 Mod 都不得依赖 `window.__match`、`MatchEngine`、`CampusApp` 等调试/内部对象
- 不得依赖其它 Mod 的 DOM 结构或全局变量名

需要 Mod 之间协作时，用 `dependencyIds` 声明依赖，通过 `getWeapons()` 检查目标武器是否存在，
不要直接读写对方的内部变量。

---

## 7. 多 Mod 的命名、去重与冲突

- **Mod ID**：小写字母、数字、点、横线、下划线；发布后不要改含义。
- **武器 ID 全局唯一**，建议 `<modId>.<武器名>`。与内置武器重名、或与已注册武器重名都会被
  **拒绝**并记录诊断；先注册者生效，后注册者失败，顺序由平台下发顺序决定。
- **同一把武器被多个 Mod patch**：按加载顺序叠加，同一字段**后写覆盖**。不要 patch 别人
  注册的武器，除非这是你 Mod 的明确目的（例如「全局平衡补丁」）。
- **数值**：每个 Mod 只保存自己的一份系数，多 Mod 相乘；不要用重复调用去「叠加」难度。
- **主题**：按 ID 共存，第一个自动生效，之后由 `useTheme` 决定，最后一次调用获胜。
- **提示**：同屏最多 4 条，不区分来源，先到先出。
- **事件**：全部监听都会被调用，单个回调抛错只影响自己。

推荐的冲突自检：

```js
const existing = mod.getWeapons().some((w) => w.id === 'sr1.scout')
if (existing) mod.notice('SR-1 已被其它 Mod 占用', { tone: 'warn' })
```

---

## 8. 存档、联机与版本兼容

**存档**：游戏只在 `localStorage` 的 `huanghai-battlefield/v1` 保存配枪、上次模式、鼠标灵敏度。
Mod 不要读写这个 key；需要持久化时请用 `huanghai-mod.<modId>` 前缀，并自行处理解析失败。
玩家选的 Mod 武器如果之后被卸载，游戏会自动回退到同槽位的第一把内置武器，不会卡死。

**联机**：本作目前是纯单人（玩家 vs AI），没有联机入口。策略声明为 `mods-disabled`：
若未来加入联机，进入联机前必须拒绝所有已启用 Mod，不接受「只影响外观」的例外。
能力目录里的 `multiplayer: "local"` 表示该能力**只影响本地表现**，不代表联机可用。

**加载顺序**：平台按清单顺序加载同阶段 Mod；启动前一定早于启动后。不要用 `setTimeout`
猜测顺序，用 `dependencyIds` 和 `getMods()` 判断。

**版本兼容**：

- `apiVersion` 不变时，字段只增不改；新增字段会有默认值。
- `apiVersion` 变化表示有破坏性改动，Mod 应在启动时检查：

```js
if (window.HuangHai.apiVersion !== 1) {
  window.HuangHai.forMod('your.mod').notice('本 Mod 需要 API v1', { tone: 'warn' })
}
```

- 敌人的种类名、内部类名、DOM 结构、CSS 类名都可能随版本变化，**不属于**公共 API。

---

## 9. 明确禁止

以下行为会被视为破坏游戏，作者可以直接下架相关 Mod：

1. 读取、上传或伪造账号凭证、Token、支付信息、管理接口数据
2. 覆盖或改写游戏内部函数、内部对象（`__match`、`MatchEngine`、`CampusApp`）、Vue 组件状态
3. 直接操作 `.hud`、`#app`、`.lobby` 等私有 DOM 来伪造界面、遮挡按钮、伪装平台提示
4. 通过远程 URL 加载脚本、样式、图片或音频；所有资源必须打包在 Mod 包内
5. 拦截、改写游戏的网络请求或 `fetch` / `XMLHttpRequest`
6. 读写游戏自己的 `localStorage` key（`huanghai-battlefield/v1`）
7. 自动点击、自动瞄准、自动开局等代替玩家操作的行为
8. 诱导充值、冒充官方公告、收集玩家个人信息
9. 修改或隐藏联机策略提示，让玩家误以为 Mod 可用于联机

再次说明：这些是**约定**，不是平台沙箱。游戏只保证公开 API 的参数校验与错误隔离；
Mod 代码本身仍以你的页面权限运行，请只安装你信任的 Mod。
