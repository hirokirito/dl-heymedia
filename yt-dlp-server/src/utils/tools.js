const { execSync } = require('child_process')

function commandExists(command) {
  for (const versionFlag of ['--version', '-version']) {
    try {
      execSync(`${command} ${versionFlag}`, {
        stdio: 'ignore'
      })
      return true
    } catch {
      // Try the next common version flag.
    }
  }

  return false
}

function resolveCommand(candidates) {
  return candidates.find(commandExists) || candidates[0]
}

module.exports = {
  commandExists,
  resolveCommand
}
