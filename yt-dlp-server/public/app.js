const PASS = 'heymedia2026'
const API = ''

let selectedFormat = 'video'
let selectedQuality = 'best'
let pollInterval = null

function checkPin() {
  const input = document.getElementById('pinInput')

  if (input.value === PASS) {
    localStorage.setItem('dl_auth', '1')
    document.getElementById('pinScreen').style.display = 'none'
    return
  }

  document.getElementById('pinError').textContent = 'Sai mật khẩu, thử lại'
  input.value = ''
}

function selectOpt(el, format, quality, label) {
  document.querySelectorAll('.opt').forEach(option => option.classList.remove('active'))
  el.classList.add('active')
  selectedFormat = format
  selectedQuality = quality
  document.getElementById('selectedLabel').textContent = label
}

async function startDownload() {
  const url = document.getElementById('urlInput').value.trim()
  if (!url) return showError('Vui lòng nhập URL video')

  clearInterval(pollInterval)
  setBusy(true)
  document.getElementById('progressWrap').style.display = 'block'
  document.getElementById('result').style.display = 'none'
  setProgress(0, 'Đang tạo phiên tải...')

  try {
    const res = await fetch(`${API}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: selectedFormat, quality: selectedQuality })
    })
    const data = await res.json()

    if (!res.ok) throw new Error(data.error || 'Lỗi server')
    pollStatus(data.jobId)
  } catch (err) {
    showError(err.message)
    setBusy(false)
  }
}

function pollStatus(jobId) {
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${API}/api/download/${jobId}/status`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Không tìm thấy job')

      if (data.status === 'downloading') {
        const pct = Number(data.progress || 0)
        setProgress(pct, pct > 0 ? `Đang tải... ${pct.toFixed(1)}%` : 'Đang kết nối nguồn...')
      } else if (data.status === 'done') {
        clearInterval(pollInterval)
        setProgress(100, 'Hoàn thành')
        showSuccess(jobId, data.filename)
        setBusy(false)
      } else if (data.status === 'error') {
        clearInterval(pollInterval)
        showError(data.error || 'Có lỗi xảy ra')
        setBusy(false)
      }
    } catch (err) {
      clearInterval(pollInterval)
      showError(err.message || 'Mất kết nối server')
      setBusy(false)
    }
  }, 1000)
}

function setProgress(pct, text) {
  const safePct = Math.max(0, Math.min(100, Number(pct) || 0))
  document.getElementById('progressFill').style.width = `${safePct}%`
  document.getElementById('progressPct').textContent = `${safePct.toFixed(0)}%`
  document.getElementById('statusText').textContent = text
}

function showSuccess(jobId, filename) {
  const el = document.getElementById('result')
  el.className = 'result success'
  el.style.display = 'block'
  el.innerHTML = `
    <p class="result-title">File đã sẵn sàng</p>
    <p class="result-text">${escapeHtml(filename || 'Video đã tải xong')}</p>
    <a class="save-link" href="${API}/api/download/${jobId}/file">Lưu file về máy</a>
  `
}

function showError(msg) {
  const el = document.getElementById('result')
  el.className = 'result error'
  el.style.display = 'block'
  el.innerHTML = `
    <p class="result-title">Không thể tải xuống</p>
    <p class="result-text">${escapeHtml(msg)}</p>
  `
}

function setBusy(isBusy) {
  const btn = document.getElementById('dlBtn')
  btn.disabled = isBusy
  btn.textContent = isBusy ? 'Đang tải...' : 'Tải xuống'
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

document.getElementById('pinInput').addEventListener('keydown', event => {
  if (event.key === 'Enter') checkPin()
})

document.getElementById('urlInput').addEventListener('keydown', event => {
  if (event.key === 'Enter') startDownload()
})

if (localStorage.getItem('dl_auth') === '1') {
  document.getElementById('pinScreen').style.display = 'none'
}
