import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import './styles/base.css'
import router from './router'
import { installModApi } from './game/mods'

/**
 * 启动顺序（创意工坊契约）：
 * 1. 先建立并暴露 Mod API —— 启动前 Mod 加载后立刻就能注册武器 / 数值 / 主题；
 * 2. 等待 VibeHubWorkshop.beforeStart（平台把所有 before-start Mod 执行完才 resolve）；
 * 3. 提交注册结果并挂载游戏（大厅）；
 * 4. markGameReady() 通知平台游戏已就绪，之后才会加载 after-start Mod；
 * 5. 等待 afterStart，再补一次提交，让运行期注册的武器 / 主题出现在大厅里。
 */
const workshop = window.VibeHubWorkshop ?? null

// 第 1 步：建立 API。此时游戏还没启动，但 window.HuangHai 已经可用。
const modApi = installModApi()

const BEFORE_START_TIMEOUT = 20000

/**
 * 平台没有应答时不要永久黑屏：20 秒后按「无 Mod」启动，并在控制台留下原因。
 * 正常托管在 VibeHub 时，beforeStart 会在所有启动前 Mod 执行完后立即完成。
 */
async function waitBeforeStart(): Promise<void> {
  if (!workshop?.beforeStart) return
  let timer = 0
  const timeout = new Promise<void>((resolve) => {
    timer = window.setTimeout(() => {
      console.warn('[黄海行动 · 创意工坊] 平台握手超时，按未启用 Mod 启动')
      resolve()
    }, BEFORE_START_TIMEOUT)
  })
  try {
    await Promise.race([workshop.beforeStart.then(() => undefined), timeout])
  } finally {
    window.clearTimeout(timer)
  }
}

async function boot(): Promise<void> {
  // 第 2 步：启动前 Mod 已全部执行，注册表里是它们写入的内容
  await waitBeforeStart()
  modApi.__commit()

  // 第 3 步：正式启动游戏
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  await router.isReady()
  app.mount('#app')
  modApi.__lobbyReady()

  // 第 4 步：告诉平台游戏已就绪，after-start Mod 从此开始加载
  workshop?.markGameReady()

  // 第 5 步：启动后 Mod（订阅对局事件、换主题、运行期加武器）
  if (workshop?.afterStart) {
    await workshop.afterStart
    modApi.__commit()
  }
}

void boot()
