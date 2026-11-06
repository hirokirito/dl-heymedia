// Bài kiểm tra theo EBU Tech 3341 (case 1–3) và các trường hợp biên. Chạy: npm test (Node ≥ 22.6).
import test from 'node:test'
import assert from 'node:assert/strict'
import { LoudnessMeter } from '../src/tools/video-checker/loudness.ts'

type Segment = { dbfs: number | null; seconds: number; freq?: number }

function measure(segments: Segment[], sampleRate = 48000, channels = 2) {
  const meter = new LoudnessMeter(sampleRate, channels)
  let t = 0
  for (const seg of segments) {
    const frames = Math.round(seg.seconds * sampleRate)
    const amp = seg.dbfs === null ? 0 : Math.pow(10, seg.dbfs / 20)
    const freq = seg.freq ?? 1000
    for (let start = 0; start < frames; start += 4800) {
      const n = Math.min(4800, frames - start)
      const plane = new Float32Array(n)
      for (let i = 0; i < n; i++) plane[i] = amp * Math.sin((2 * Math.PI * freq * (t + i)) / sampleRate)
      t += n
      meter.push(Array.from({ length: channels }, () => plane))
    }
  }
  return meter.result()
}

const near = (actual: number | null, expected: number, tol: number, label: string) => {
  assert.ok(actual !== null, `${label}: không có kết quả`)
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual.toFixed(3)} lệch quá ${tol} so với ${expected}`)
}

test('EBU 3341 case 1: sine 1 kHz −23 dBFS stereo → −23 LUFS', () => {
  near(measure([{ dbfs: -23, seconds: 20 }]).integratedLufs, -23, 0.1, 'case 1')
})

test('EBU 3341 case 2: sine 1 kHz −33 dBFS stereo → −33 LUFS', () => {
  near(measure([{ dbfs: -33, seconds: 20 }]).integratedLufs, -33, 0.1, 'case 2')
})

test('EBU 3341 case 3: −36 / −23 / −36 dBFS (gate tương đối) → −23 LUFS', () => {
  near(measure([{ dbfs: -36, seconds: 10 }, { dbfs: -23, seconds: 60 }, { dbfs: -36, seconds: 10 }]).integratedLufs, -23, 0.1, 'case 3')
})

test('đoạn im lặng giữa file không kéo LUFS xuống (gate tuyệt đối)', () => {
  near(measure([{ dbfs: -23, seconds: 10 }, { dbfs: null, seconds: 10 }, { dbfs: -23, seconds: 10 }]).integratedLufs, -23, 0.1, 'có im lặng')
})

test('sample rate khác 48 kHz vẫn đúng', () => {
  for (const sr of [32000, 44100, 96000]) near(measure([{ dbfs: -23, seconds: 20 }], sr).integratedLufs, -23, 0.1, `${sr} Hz`)
})

test('toàn im lặng → null, không trả số giả', () => {
  const r = measure([{ dbfs: null, seconds: 5 }])
  assert.equal(r.integratedLufs, null)
  assert.equal(r.samplePeakDbfs, null)
})

test('true peak bắt được đỉnh giữa hai mẫu', () => {
  // Sine fs/4 lệch pha 45°: mẫu chỉ chạm 0,707 biên độ, đỉnh thật là 1,0 → chênh ~3 dB.
  const sr = 48000
  const meter = new LoudnessMeter(sr, 1)
  const plane = new Float32Array(sr)
  for (let i = 0; i < plane.length; i++) plane[i] = 0.5 * Math.sin((2 * Math.PI * (sr / 4) * i) / sr + Math.PI / 4)
  meter.push([plane])
  const r = meter.result()
  near(r.samplePeakDbfs, 20 * Math.log10(0.5 * Math.SQRT1_2), 0.05, 'sample peak')
  near(r.truePeakDbtp, 20 * Math.log10(0.5), 0.5, 'true peak')
})
