const STYLES: Record<string, { initial: string; bgVar: string; fgVar: string }> = {
  claude: { initial: 'C', bgVar: '--agent-claude-bg', fgVar: '--agent-claude-fg' },
  codex:  { initial: 'X', bgVar: '--agent-codex-bg',  fgVar: '--agent-codex-fg'  },
  human:  { initial: 'H', bgVar: '--agent-human-bg',  fgVar: '--agent-human-fg'  },
  system: { initial: 'S', bgVar: '--agent-system-bg', fgVar: '--agent-system-fg' },
}

export function AgentAvatar({ author, size = 28 }: { author: string; size?: number }) {
  const s = STYLES[author] ?? STYLES.human
  return (
    <span
      className="agent-avatar"
      style={{
        width: size,
        height: size,
        background: `var(${s.bgVar})`,
        color: `var(${s.fgVar})`,
        fontSize: Math.round(size * 0.42),
      }}
      aria-hidden="true"
    >
      {s.initial}
    </span>
  )
}
