import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'

function launchDetached(file: string, args: string[]): void {
  const child = spawn(file, args, {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function executableExists(file: string): boolean {
  const result = spawnSync('which', [file], { encoding: 'utf8' })
  return result.status === 0
}

function appleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

interface LinuxTerminal {
  name: string
  args: (sessionName: string) => string[]
}

const LINUX_TERMINALS: LinuxTerminal[] = [
  { name: 'x-terminal-emulator', args: (session) => ['-e', 'tmux', 'attach', '-t', session] },
  { name: 'gnome-terminal', args: (session) => ['--', 'tmux', 'attach', '-t', session] },
  { name: 'konsole', args: (session) => ['-e', 'tmux', 'attach', '-t', session] },
  { name: 'xfce4-terminal', args: (session) => ['-e', 'tmux', 'attach', '-t', session] },
  { name: 'xterm', args: (session) => ['-e', 'tmux', 'attach', '-t', session] },
  { name: 'alacritty', args: (session) => ['-e', 'tmux', 'attach', '-t', session] },
  { name: 'kitty', args: (session) => ['tmux', 'attach', '-t', session] },
]

function linuxTerminalCandidates(): LinuxTerminal[] {
  const configured = process.env.TERMINAL
  if (!configured) return LINUX_TERMINALS

  const configuredName = path.basename(configured)
  const match = LINUX_TERMINALS.find((terminal) => terminal.name === configuredName)
  if (!match) return LINUX_TERMINALS

  return [match, ...LINUX_TERMINALS.filter((terminal) => terminal.name !== match.name)]
}

export function openTerminalForTmux(sessionName: string): void {
  if (process.platform === 'darwin') {
    const command = `tmux attach -t ${appleScriptString(sessionName)}`
    launchDetached('osascript', [
      '-e',
      `tell application "Terminal" to do script "${command}"`,
      '-e',
      'tell application "Terminal" to activate',
    ])
    return
  }

  if (process.platform === 'linux') {
    const terminal = linuxTerminalCandidates().find((candidate) =>
      executableExists(candidate.name),
    )
    if (!terminal) {
      throw new Error('no supported terminal emulator found')
    }
    launchDetached(terminal.name, terminal.args(sessionName))
    return
  }

  throw new Error(`unsupported platform: ${process.platform}`)
}
