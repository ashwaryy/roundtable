import type { CSSProperties } from 'react'
import { Icon } from './primitives'
import { RAIL_COLLAPSED_STORAGE_KEY, readStoredBoolean } from '../lib/uiStorage'

export function ThreadSkeleton() {
  const railCollapsed = readStoredBoolean(RAIL_COLLAPSED_STORAGE_KEY, false)

  return (
    <div
      className="workspace-root thread-skeleton"
      aria-busy="true"
      aria-label="Loading thread"
      style={{ '--sidebar-w': railCollapsed ? '52px' : '340px' } as CSSProperties}
    >
      <header className="workspace-header" aria-label="Loading thread header">
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
          <span className="sk thread-skeleton__pill" />
          <span className="sk thread-skeleton__avatar" />
          <span className="sk thread-skeleton__avatar" />
          <span className="sk thread-skeleton__toggle" />
        </div>
      </header>
      <div className="workspace-body">
        <main className="workspace-main">
          <div className="thread-body-section">
            <div className="source">
              <div className="source-eyebrow">
                <span className="sk thread-skeleton__eyebrow" />
                <span style={{ color: 'var(--rule-strong)' }}>·</span>
                <span className="sk thread-skeleton__file-chip" />
                <span style={{ flex: 1 }} />
                <span className="sk thread-skeleton__date" />
              </div>
              <div className="source-title-row">
                <span className="sk thread-skeleton__title" />
                <span className="sk thread-skeleton__saved-button" />
              </div>
              <div className="source-body thread-skeleton__source-body">
                {[100, 94, 88, 72].map((width) => (
                  <span key={width} className="sk" style={{ width: `${width}%` }} />
                ))}
              </div>
              <div className="source-foot">
                <span className="sk thread-skeleton__foot-button" />
                <span className="spacer" />
                <span className="sk thread-skeleton__foot-button" />
              </div>
            </div>
          </div>

          <section className="comment-stream" aria-label="Loading discussion">
            <div className="discussion-head">
              <span className="sk thread-skeleton__discussion-title" />
              <div className="discuss-tools">
                <span className="sk thread-skeleton__discussion-meta" />
                <span style={{ color: 'var(--rule-strong)' }}>·</span>
                <span className="sk thread-skeleton__sort" />
              </div>
            </div>

            <div className="thread-skeleton__comments">
              {[44, 28, 62].map((height, index) => (
                <div key={height} className="thread-skeleton__comment">
                  <span className="sk thread-skeleton__comment-avatar" />
                  <div className="thread-skeleton__comment-main">
                    <div className="thread-skeleton__comment-meta">
                      <span className="sk" style={{ width: index === 1 ? 74 : 92 }} />
                      <span className="sk" style={{ width: 48 }} />
                    </div>
                    <span className="sk thread-skeleton__comment-body" style={{ height }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="composer-anchor" aria-label="Loading composer">
            <div className="composer-card thread-skeleton__composer">
              <div className="thread-skeleton__type-row">
                {[56, 68, 62, 70].map((width) => (
                  <span key={width} className="sk" style={{ width }} />
                ))}
              </div>
              <span className="sk thread-skeleton__composer-input" />
            </div>
          </div>
        </main>

        <aside
          className={`workspace-sidebar rail ${railCollapsed ? 'rail--collapsed' : ''}`}
          aria-label="Loading thread details"
        >
          {railCollapsed ? (
            <div className="rail-collapsed-strip">
              <span className="sk thread-skeleton__strip-icon" />
              <div className="strip-sep" />
              <div className="vlabel">Room</div>
              <span className="sk thread-skeleton__strip-avatar" />
              <span className="sk thread-skeleton__strip-avatar" />
              <span className="sk thread-skeleton__strip-state" />
              <div className="strip-sep" />
              <span className="sk thread-skeleton__strip-icon" />
              <span className="sk thread-skeleton__strip-icon" />
            </div>
          ) : (
            <>
              <div className="rail-head">
                <div className="title">
                  <Icon name="terminal" className="ic-sm" />
                  Agent Room
                </div>
                <span className="sk thread-skeleton__rail-collapse" />
              </div>
              <div className="rail-body">
                {[0, 1, 2].map((item) => (
                  <section key={item} className="rail-section" data-open="1">
                    <div className="rail-section-head">
                      <span className="sk thread-skeleton__rail-label" />
                      <span className="sk thread-skeleton__rail-count" />
                    </div>
                    <div className="rail-section-body thread-skeleton__rail-body">
                      <span className="sk" style={{ width: '100%', height: item === 0 ? 54 : 34 }} />
                      <span className="sk" style={{ width: item === 2 ? '72%' : '88%' }} />
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
