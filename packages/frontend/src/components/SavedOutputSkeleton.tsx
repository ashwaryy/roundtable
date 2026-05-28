export function SavedOutputSkeleton() {
  return (
    <div className="workspace-root saved-output-page saved-output-workspace" aria-busy="true" aria-label="Loading saved output">
      <header className="workspace-header" aria-label="Loading saved output header">
        <span className="workspace-back thread-skeleton__icon-slot">
          <span className="sk" />
        </span>
        <div className="workspace-brand">
          <span className="workspace-brand__dot" />
          <span>Roundtable</span>
        </div>
        <div className="workspace-header__title">
          <div className="workspace-crumbs">
            <span className="sk thread-skeleton__crumb" />
            <span>/</span>
            <span className="sk thread-skeleton__crumb-file" />
            <span>/</span>
            <span className="sk thread-skeleton__crumb-title" />
          </div>
        </div>
        <div className="workspace-header__badges">
          <span className="sk thread-skeleton__toggle" />
        </div>
      </header>

      <div className="workspace-body">
        <main className="workspace-main saved-output-main saved-output-skeleton" aria-label="Loading saved output content">
          <article className="saved-output-shell">
            <section className="source saved-output-source">
              <div className="source-eyebrow">
                <span className="sk thread-skeleton__eyebrow" />
                <span style={{ color: 'var(--rule-strong)' }}>·</span>
                <span className="sk thread-skeleton__file-chip" />
                <span style={{ color: 'var(--rule-strong)' }}>·</span>
                <span className="sk thread-skeleton__date" />
              </div>

              <div className="source-title-row">
                <span className="sk thread-skeleton__title" />
                <span className="sk thread-skeleton__saved-button" />
              </div>

              <span className="sk saved-output-skeleton__subtitle" />

              <div className="source-body saved-output-body">
                {[100, 94, 87, 96, 78, 84, 92].map((width) => (
                  <span key={width} className="sk" style={{ width: `${width}%` }} />
                ))}
              </div>

              <div className="source-foot">
                <span className="sk thread-skeleton__foot-button" />
                <span className="spacer" />
                <span className="sk thread-skeleton__foot-button" />
              </div>
            </section>
          </article>
        </main>
      </div>
    </div>
  )
}
