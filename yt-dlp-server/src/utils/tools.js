const { execSync } = require('child_process')

function commandExists(command) {
  try {
    execSync(`${command} --version`, {
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
}

module.exports = {
  commandExists
}
