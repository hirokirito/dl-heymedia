// Đo loudness theo ITU-R BS.1770-4 / EBU R128, dạng LUỒNG: nạp từng khúc PCM float, không giữ cả file trong RAM.
// - Integrated loudness (LUFS): K-weighting, block 400 ms chồng 75 %, gate tuyệt đối −70 LUFS, gate tương đối −10 LU.
// - Sample peak (dBFS): giá trị tuyệt đối lớn nhất của mẫu gốc.
// - True peak (dBTP): nội suy 4× bằng bộ lọc FIR 48 hệ số của BS.1770-4 Annex 2 (2× nếu ≥ 96 kHz, 1× nếu ≥ 192 kHz).
// Hệ số K-weighting tính theo sample rate thực tế (công thức dùng trong libebur128), nên 44,1 kHz, 32 kHz… đều đúng.

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number }

function kWeightingFilters(sampleRate: number): [Biquad, Biquad] {
  // Tầng 1: high-shelf (+4 dB quanh 1,7 kHz) — mô phỏng ảnh hưởng của đầu người.
  let f0 = 1681.974450955533
  const G = 3.999843853973347
  let Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / sampleRate)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  }
  // Tầng 2: high-pass (RLB) ~38 Hz.
  f0 = 38.13547087602444
  Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / sampleRate)
  a0 = 1 + K / Q + K * K
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 }
  return [shelf, highpass]
}

// BS.1770-4 Annex 2: 4 pha × 12 hệ số.
const TRUE_PEAK_PHASES: number[][] = [
  [0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625, 0.9721679687500, -0.1022949218750, 0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500],
  [-0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250, -0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125, 0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375],
  [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625000000, -0.2003173828125, 0.7797851562500, 0.4650878906250, -0.1665039062500, 0.0891113281250, -0.0517578125000, 0.0292968750000, -0.0291748046875],
  [-0.0083007812500, 0.0148925781250, -0.0266113281250, 0.0476074218750, -0.1022949218750, 0.9721679687500, 0.1373291015625, -0.0594482421875, 0.0332031250000, -0.0196533203125, 0.0109863281250, 0.0017089843750]
]
const TAPS = 12

// Trọng số kênh BS.1770: L/R/C = 1, surround = 1,41, LFE = 0.
// Thứ tự kênh 5.1/7.1 theo thứ tự WebCodecs trả về (L, R, C, LFE, Ls, Rs, …).
export function channelWeights(channels: number): number[] {
  if (channels === 6) return [1, 1, 1, 0, 1.41, 1.41]
  if (channels === 8) return [1, 1, 1, 0, 1.41, 1.41, 1.41, 1.41]
  return Array.from({ length: channels }, () => 1)
}

export type LoudnessResult = {
  integratedLufs: number | null // null = toàn im lặng (dưới gate −70 LUFS) hoặc quá ngắn (< 400 ms)
  samplePeakDbfs: number | null
  truePeakDbtp: number | null
  measuredSeconds: number
  gatedBlocks: number
  oversampling: number
}

export class LoudnessMeter {
  private readonly channels: number
  private readonly sampleRate: number
  private readonly weights: number[]
  private readonly filters: [Biquad, Biquad]
  // Trạng thái 2 biquad cho mỗi kênh: x1, x2, y1, y2 của mỗi tầng.
  private readonly state: Float64Array
  private readonly subBlockFrames: number
  private subBlockPos = 0
  private readonly subBlockEnergy: Float64Array // tổng bình phương mỗi kênh trong sub-block 100 ms hiện tại
  private readonly lastSubBlocks: Float64Array[] = [] // 3 sub-block gần nhất (đã nhân trọng số, cộng các kênh)
  private readonly blockPower: number[] = [] // năng lượng trung bình mỗi block 400 ms
  private samplePeak = 0
  private truePeak = 0
  private readonly oversampling: number
  private readonly phases: number[][]
  private readonly history: Float64Array // 12 mẫu gần nhất mỗi kênh cho bộ nội suy true peak
  private historyPos = 0
  private frames = 0

  constructor(sampleRate: number, channels: number) {
    if (!(sampleRate > 0) || !(channels > 0)) throw new Error('Sample rate hoặc số kênh không hợp lệ')
    this.sampleRate = sampleRate
    this.channels = channels
    this.weights = channelWeights(channels)
    this.filters = kWeightingFilters(sampleRate)
    this.state = new Float64Array(channels * 8)
    this.subBlockFrames = Math.round(sampleRate * 0.1)
    this.subBlockEnergy = new Float64Array(channels)
    this.oversampling = sampleRate >= 192000 ? 1 : sampleRate >= 96000 ? 2 : 4
    this.phases = this.oversampling === 4 ? TRUE_PEAK_PHASES : this.oversampling === 2 ? [TRUE_PEAK_PHASES[0], TRUE_PEAK_PHASES[2]] : []
    this.history = new Float64Array(channels * TAPS)
  }

  // planes[c] là mẫu float (−1..1) của kênh c; mọi plane cùng độ dài.
  push(planes: Float32Array[]): void {
    const n = planes[0]?.length ?? 0
    const { channels, filters, state, weights } = this
    const [s, h] = filters
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < channels; c++) {
        const x = planes[c][i]
        const ax = x < 0 ? -x : x
        if (ax > this.samplePeak) this.samplePeak = ax

        // True peak: đẩy mẫu vào lịch sử vòng, tính các pha nội suy.
        if (this.phases.length) {
          const base = c * TAPS
          this.history[base + this.historyPos] = x
          for (let p = 0; p < this.phases.length; p++) {
            const coeffs = this.phases[p]
            let acc = 0
            for (let k = 0; k < TAPS; k++) {
              // hệ số k nhân với mẫu trễ k (mẫu mới nhất ở historyPos).
              let idx = this.historyPos - k
              if (idx < 0) idx += TAPS
              acc += coeffs[k] * this.history[base + idx]
            }
            const a = acc < 0 ? -acc : acc
            if (a > this.truePeak) this.truePeak = a
          }
        }

        // K-weighting (2 biquad nối tiếp, Direct Form I).
        const o = c * 8
        const y1 = s.b0 * x + s.b1 * state[o] + s.b2 * state[o + 1] - s.a1 * state[o + 2] - s.a2 * state[o + 3]
        state[o + 1] = state[o]; state[o] = x
        state[o + 3] = state[o + 2]; state[o + 2] = y1
        const y2 = h.b0 * y1 + h.b1 * state[o + 4] + h.b2 * state[o + 5] - h.a1 * state[o + 6] - h.a2 * state[o + 7]
        state[o + 5] = state[o + 4]; state[o + 4] = y1
        state[o + 7] = state[o + 6]; state[o + 6] = y2
        if (weights[c] !== 0) this.subBlockEnergy[c] += y2 * y2
      }
      if (this.phases.length) this.historyPos = (this.historyPos + 1) % TAPS

      this.frames++
      if (++this.subBlockPos === this.subBlockFrames) this.closeSubBlock()
    }
  }

  private closeSubBlock(): void {
    let weighted = 0
    for (let c = 0; c < this.channels; c++) {
      weighted += this.weights[c] * this.subBlockEnergy[c]
      this.subBlockEnergy[c] = 0
    }
    this.subBlockPos = 0
    const current = new Float64Array([weighted])
    if (this.lastSubBlocks.length === 3) {
      const sum = this.lastSubBlocks[0][0] + this.lastSubBlocks[1][0] + this.lastSubBlocks[2][0] + weighted
      this.blockPower.push(sum / (4 * this.subBlockFrames))
      this.lastSubBlocks.shift()
    }
    this.lastSubBlocks.push(current)
  }

  result(): LoudnessResult {
    const toLufs = (power: number) => -0.691 + 10 * Math.log10(power)
    const ABS_GATE = -70
    const absPassed = this.blockPower.filter(p => p > 0 && toLufs(p) > ABS_GATE)
    let integrated: number | null = null
    let gated = 0
    if (absPassed.length) {
      const absMean = absPassed.reduce((a, b) => a + b, 0) / absPassed.length
      const relGate = toLufs(absMean) - 10
      const relPassed = absPassed.filter(p => toLufs(p) > relGate)
      gated = relPassed.length
      if (relPassed.length) integrated = toLufs(relPassed.reduce((a, b) => a + b, 0) / relPassed.length)
    }
    const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : null)
    const truePeakLinear = this.phases.length ? Math.max(this.truePeak, this.samplePeak) : this.samplePeak
    return {
      integratedLufs: integrated,
      samplePeakDbfs: this.frames ? db(this.samplePeak) : null,
      truePeakDbtp: this.frames ? db(truePeakLinear) : null,
      measuredSeconds: this.frames / this.sampleRate,
      gatedBlocks: gated,
      oversampling: this.oversampling
    }
  }
}
