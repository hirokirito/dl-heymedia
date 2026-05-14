const { spawnSync } = require('child_process')

function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true
  })

  return !result.error && result.status === 0
}

module.exports = { commandExists }
