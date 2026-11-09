import type { CfWeaponSpec } from './weapons'

/**
 * CF 风格程序化枪声：不依赖任何音频文件。
 *
 * 和「太阳系战场」的 CS 合成器相比，这里刻意做得更「炸」：
 *  · AK / M4 是高频金属脆响 + 中频枪机声 + 短尾音；
 *  · 沙鹰是低频炮击 + 长尾；
 *  · 巴雷特是次低频轰鸣 + 两次回声，开一枪整个校园都听得见；
 *  · 加特林带持续电机啸叫，开枪时叠机械撞击。
 */
export class CfAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private spinOsc: OscillatorNode | null = null
  private spinGain: GainNode | null = null
  private paused = false
  private muted = false
  private disposed = false

  private ensure(): AudioContext | null {
    if (this.disposed) return null
    if (!this.ctx) {
      const Ctor = window.AudioContext
      if (!Ctor) return null
      const ctx = new Ctor()
      this.ctx = ctx
      const master = ctx.createGain()
      master.gain.value = this.muted ? 0.0001 : this.paused ? 0.12 : 0.62
      master.connect(ctx.destination)
      this.master = master
      const length = Math.floor(ctx.sampleRate * 2)
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
      this.noiseBuffer = buffer
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  unlock() {
    this.ensure()
  }

  private noiseBurst(options: {
    when?: number
    duration: number
    gain: number
    type?: BiquadFilterType
    frequency: number
    q?: number
    rate?: number
    destination?: AudioNode
  }) {
    const ctx = this.ensure()
    if (!ctx || !this.noiseBuffer) return
    const { when = 0, duration, gain, type = 'lowpass', frequency, q = 0.8, rate = 1 } = options
    const start = ctx.currentTime + when
    const source = ctx.createBufferSource()
    source.buffer = this.noiseBuffer
    source.playbackRate.value = rate
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = frequency
    filter.Q.value = q
    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.004)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(filter).connect(envelope).connect(options.destination ?? this.master!)
    source.start(start, Math.random() * 1.2, duration + 0.03)
    source.stop(start + duration + 0.04)
  }

  private tone(options: {
    when?: number
    duration: number
    gain: number
    from: number
    to?: number
    type?: OscillatorType
  }) {
    const ctx = this.ensure()
    if (!ctx) return
    const { when = 0, duration, gain, from, to = from, type = 'sine' } = options
    const start = ctx.currentTime + when
    const oscillator = ctx.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(Math.max(20, from), start)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration)
    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.005)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(envelope).connect(this.master!)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.02)
  }

  /* ============================== 枪声 ============================== */

  shot(weapon: CfWeaponSpec) {
    const sound = weapon.sound
    const gain = sound.gain
    const flavor = sound.flavor

    switch (flavor) {
      case 'ak':
        this.noiseBurst({ duration: sound.noise * 1.6, gain, frequency: sound.crack, q: 0.9 })
        this.noiseBurst({ duration: 0.03, gain: gain * 0.7, type: 'highpass', frequency: sound.crack * 1.7, q: 0.7 })
        this.tone({ duration: 0.14, gain: gain * 0.95, from: sound.body, to: sound.body * 0.38, type: 'triangle' })
        this.noiseBurst({ when: 0.014, duration: 0.16, gain: gain * 0.2, frequency: 320, q: 0.6 })
        break
      case 'm4':
        this.noiseBurst({ duration: sound.noise * 1.35, gain: gain * 0.95, frequency: sound.crack, q: 1 })
        this.noiseBurst({ duration: 0.026, gain: gain * 0.66, type: 'highpass', frequency: sound.crack * 1.85, q: 0.8 })
        this.tone({ duration: 0.1, gain: gain * 0.82, from: sound.body, to: sound.body * 0.44, type: 'triangle' })
        this.noiseBurst({ when: 0.012, duration: 0.12, gain: gain * 0.17, frequency: 420, q: 0.7 })
        break
      case 'deagle':
        this.noiseBurst({ duration: 0.16, gain, frequency: 1300, q: 0.7 })
        this.noiseBurst({ duration: 0.05, gain: gain * 0.8, type: 'highpass', frequency: 2600, q: 0.6 })
        this.tone({ duration: 0.24, gain: gain * 1.05, from: sound.body, to: sound.body * 0.28, type: 'sine' })
        this.tone({ when: 0.01, duration: 0.12, gain: gain * 0.4, from: sound.body * 2.1, to: sound.body * 0.7, type: 'triangle' })
        this.noiseBurst({ when: 0.03, duration: sound.tail, gain: gain * 0.26, frequency: 260, q: 0.5 })
        break
      case 'barrett':
        this.tone({ duration: 0.55, gain: gain * 1.15, from: sound.body, to: 20, type: 'sine' })
        this.noiseBurst({ duration: 0.42, gain, frequency: 260, q: 0.5 })
        this.noiseBurst({ duration: 0.06, gain: gain * 0.9, type: 'highpass', frequency: 2200, q: 0.5 })
        this.noiseBurst({ when: 0.12, duration: 0.3, gain: gain * 0.22, frequency: 320, q: 0.4 })
        this.noiseBurst({ when: 0.26, duration: 0.4, gain: gain * 0.12, frequency: 240, q: 0.4 })
        break
      case 'gatling':
        this.noiseBurst({ duration: 0.05, gain: gain * 0.9, frequency: 1900, q: 0.8 })
        this.tone({ duration: 0.06, gain: gain * 0.7, from: sound.body, to: sound.body * 0.5, type: 'square' })
        this.noiseBurst({ duration: 0.03, gain: gain * 0.4, type: 'highpass', frequency: 3200, q: 0.6 })
        break
      case 'smg':
        this.noiseBurst({ duration: sound.noise * 1.4, gain, frequency: sound.crack, q: 0.85 })
        this.tone({ duration: 0.1, gain: gain * 0.85, from: sound.body, to: sound.body * 0.4, type: 'triangle' })
        this.noiseBurst({ when: 0.01, duration: 0.1, gain: gain * 0.16, frequency: 380, q: 0.6 })
        break
      case 'suppressed':
        this.noiseBurst({ duration: 0.07, gain: gain * 0.75, type: 'lowpass', frequency: 900, q: 0.7 })
        this.tone({ duration: 0.05, gain: gain * 0.5, from: 520, to: 220, type: 'triangle' })
        this.noiseBurst({ when: 0.03, duration: 0.1, gain: gain * 0.16, type: 'bandpass', frequency: 1800, q: 2 })
        break
      case 'shovel':
        this.noiseBurst({ duration: 0.2, gain: gain * 0.8, type: 'highpass', frequency: 900, rate: 1.4 })
        this.tone({ duration: 0.16, gain: gain * 0.4, from: 340, to: 120, type: 'sawtooth' })
        break
      default:
        this.noiseBurst({ duration: 0.18, gain: gain, type: 'highpass', frequency: 1400, rate: 1.5 })
        this.tone({ duration: 0.12, gain: gain * 0.3, from: 700, to: 240, type: 'triangle' })
        break
    }
  }

  dryFire() {
    this.noiseBurst({ duration: 0.03, gain: 0.2, type: 'bandpass', frequency: 2800, q: 7 })
    this.tone({ duration: 0.03, gain: 0.06, from: 1600, to: 900, type: 'square' })
  }

  reload(weapon: CfWeaponSpec) {
    const duration = Math.max(0.6, weapon.reloadTime)
    const click = (when: number, pitch: number, gain = 0.2) => {
      this.noiseBurst({ when, duration: 0.035, gain, type: 'bandpass', frequency: pitch, q: 6 })
      this.tone({ when, duration: 0.03, gain: gain * 0.45, from: pitch * 0.55, to: pitch * 0.35, type: 'square' })
    }
    // 退弹匣 → 插弹匣 → 拉枪机
    click(0.04, 2100, 0.16)
    this.noiseBurst({ when: duration * 0.24, duration: 0.09, gain: 0.12, type: 'lowpass', frequency: 420 })
    click(duration * 0.2, 1500, 0.14)
    click(duration * 0.58, 2400, 0.2)
    this.noiseBurst({ when: duration * 0.6, duration: 0.08, gain: 0.14, type: 'lowpass', frequency: 500 })
    if (weapon.tag === 'sniper') {
      click(duration * 0.8, 1700, 0.18)
      click(duration * 0.88, 2300, 0.16)
    } else {
      click(duration * 0.88, 2900, 0.18)
    }
  }

  switchWeapon() {
    this.noiseBurst({ duration: 0.05, gain: 0.16, type: 'bandpass', frequency: 1900, q: 4 })
    this.noiseBurst({ when: 0.04, duration: 0.07, gain: 0.1, type: 'bandpass', frequency: 1100, q: 3 })
  }

  melee(weapon: CfWeaponSpec) {
    if (weapon.model.blade === 'shovel') {
      this.noiseBurst({ duration: 0.24, gain: 0.24, type: 'highpass', frequency: 700, rate: 1.2 })
      this.tone({ duration: 0.18, gain: 0.1, from: 260, to: 90, type: 'sawtooth' })
    } else {
      this.noiseBurst({ duration: 0.16, gain: 0.2, type: 'highpass', frequency: 1900, rate: 1.7 })
      this.tone({ duration: 0.1, gain: 0.05, from: 900, to: 380, type: 'triangle' })
    }
  }

  /* ============================== 命中反馈 ============================== */

  hit(headshot: boolean) {
    if (headshot) {
      this.tone({ duration: 0.05, gain: 0.2, from: 2100, to: 2100, type: 'square' })
      this.tone({ when: 0.05, duration: 0.12, gain: 0.16, from: 2900, to: 2400, type: 'square' })
      this.noiseBurst({ duration: 0.05, gain: 0.1, type: 'highpass', frequency: 3600 })
    } else {
      this.tone({ duration: 0.04, gain: 0.14, from: 1300, to: 1100, type: 'square' })
    }
  }

  kill() {
    this.tone({ duration: 0.14, gain: 0.18, from: 720, to: 420, type: 'triangle' })
    this.noiseBurst({ duration: 0.12, gain: 0.18, type: 'lowpass', frequency: 620 })
  }

  streak(level: number) {
    const notes = level >= 6 ? [523, 659, 784, 1046, 1318] : level >= 4 ? [523, 659, 784] : [523, 784]
    notes.forEach((frequency, index) => {
      this.tone({ when: index * 0.07, duration: 0.16, gain: 0.14, from: frequency, to: frequency * 1.01, type: 'triangle' })
    })
  }

  hurt() {
    this.tone({ duration: 0.22, gain: 0.26, from: 150, to: 55, type: 'square' })
    this.noiseBurst({ duration: 0.26, gain: 0.22, frequency: 380 })
  }

  pickup() {
    this.tone({ duration: 0.09, gain: 0.13, from: 820, to: 1180, type: 'sine' })
    this.tone({ when: 0.07, duration: 0.12, gain: 0.1, from: 1180, to: 1560, type: 'sine' })
  }

  enemyShot(close: boolean) {
    const gain = close ? 0.17 : 0.07
    this.tone({ duration: 0.13, gain, from: 1000, to: 240, type: 'sawtooth' })
    this.noiseBurst({ duration: 0.07, gain: gain * 0.6, type: 'bandpass', frequency: 1900, q: 2 })
  }

  footstep() {
    this.noiseBurst({ duration: 0.06, gain: 0.05, type: 'lowpass', frequency: 640 })
  }

  land() {
    this.noiseBurst({ duration: 0.12, gain: 0.12, type: 'lowpass', frequency: 300 })
  }

  waveStart(boss: boolean) {
    if (boss) {
      this.tone({ duration: 0.7, gain: 0.2, from: 70, to: 48, type: 'sawtooth' })
      this.tone({ when: 0.2, duration: 0.7, gain: 0.14, from: 96, to: 62, type: 'square' })
      this.noiseBurst({ when: 0.05, duration: 0.5, gain: 0.1, type: 'lowpass', frequency: 220 })
    } else {
      this.tone({ duration: 0.35, gain: 0.12, from: 260, to: 520, type: 'triangle' })
      this.tone({ when: 0.12, duration: 0.3, gain: 0.08, from: 390, to: 780, type: 'triangle' })
    }
  }

  victory() {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((frequency, index) => {
      this.tone({ when: index * 0.12, duration: 0.5, gain: 0.14, from: frequency, to: frequency, type: 'triangle' })
    })
  }

  defeat() {
    const notes = [392, 329.63, 261.63, 196]
    notes.forEach((frequency, index) => {
      this.tone({ when: index * 0.18, duration: 0.7, gain: 0.16, from: frequency, to: frequency * 0.97, type: 'sine' })
    })
  }

  /* ============================== 加特林电机 ============================== */

  setSpin(level: number) {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    if (!this.spinOsc) {
      const oscillator = ctx.createOscillator()
      oscillator.type = 'sawtooth'
      oscillator.frequency.value = 45
      const gain = ctx.createGain()
      gain.gain.value = 0.0001
      oscillator.connect(gain).connect(this.master)
      oscillator.start()
      this.spinOsc = oscillator
      this.spinGain = gain
    }
    const clamped = Math.max(0, Math.min(1, level))
    this.spinOsc.frequency.setTargetAtTime(42 + clamped * 58, ctx.currentTime, 0.05)
    this.spinGain?.gain.setTargetAtTime(clamped * 0.028, ctx.currentTime, 0.06)
  }

  /* ============================== 生命周期 ============================== */

  setPaused(paused: boolean) {
    this.paused = paused
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const target = this.muted ? 0.0001 : paused ? 0.1 : 0.62
    this.master.gain.cancelScheduledValues(ctx.currentTime)
    this.master.gain.setTargetAtTime(target, ctx.currentTime, 0.18)
    if (paused) this.setSpin(0)
  }

  setMuted(muted: boolean) {
    this.muted = muted
    const ctx = this.ctx
    if (!this.master || !ctx) return
    this.master.gain.setTargetAtTime(muted ? 0.0001 : this.paused ? 0.1 : 0.62, ctx.currentTime, 0.12)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    try {
      this.spinOsc?.stop()
    } catch {
      /* 已停止 */
    }
    this.spinOsc = null
    this.spinGain = null
    const ctx = this.ctx
    this.ctx = null
    this.master = null
    this.noiseBuffer = null
    if (ctx) void ctx.close().catch(() => undefined)
  }
}
