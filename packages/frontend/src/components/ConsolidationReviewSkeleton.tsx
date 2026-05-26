import type { CSSProperties } from 'react'
import { readStoredBoolean } from '../lib/uiStorage'

const REVIEW_RAIL_COLLAPSED_STORAGE_KEY = 'roundtable.reviewRailCollapsed'

export function ConsolidationReviewSkeleton() {
  const railCollapsed = readStoredBoolean(REVIEW_RAIL_COLLAPSED_STORAGE_KEY, false)

  return (
    <div
      className="workspace-root thread-skeleton consolidation-review-skeleton"
      aria-busy="true"
      aria-label="Loading discussion outcome review"
      style={{ '--sidebar-w': railCollapsed ? '52px' : '340px' } as CSSProperties}
    >
      <header className="workspace-header" aria-label="Loading review header">
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
          <span className="sk thread-skeleton__toggle" />
        </div>
      </header>

      <div className="workspace-body">
        <main className="workspace-main consolidation-review-main" aria-label="Loading review content">
          <div className="thread-body-section">
            <section className="source review-source">
              <div className="consolidation-review-skeleton__steps">
                {Array.from({ length: 4 }).map((_, index) => (
                  <span
                    key={index}
                    className="sk consolidation-review-skeleton__step"
                    style={{ width: index === 1 ? 112 : index === 2 ? 134 : 96 }}
                  />
                ))}
              </div>

              <div className="source-body proposal-preview consolidation-review-skeleton__body">
                {[100, 92, 88, 95, 74, 82].map((width) => (
                  <span key={width} className="sk" style={{ width: `${width}%` }} />
                ))}
              </div>

              <div className="source-foot review-source-foot">
                <span className="sk thread-skeleton__foot-button" />
                <span className="spacer" />
                <span className="sk thread-skeleton__foot-button" />
                <span className="sk thread-skeleton__foot-button" />
                <span className="sk thread-skeleton__foot-button" />
              </div>
            </section>
          </div>
        </main>

        <aside
          className={`workspace-sidebar rail review-rail ${railCollapsed ? 'rail--collapsed' : ''}`}
          aria-label="Loading review context"
        >
          {railCollapsed ? (
            <div className="rail-collapsed-strip">
              <span className="sk thread-skeleton__strip-icon" />
              <div className="strip-sep" />
              <div className="vlabel">Review</div>
            </div>
          ) : (
            <>
              <div className="rail-head">
                <div className="title">
                  <span className="sk consolidation-review-skeleton__rail-title" />
                </div>
                <span className="sk thread-skeleton__rail-collapse" />
              </div>
              <div className="rail-body">
                {[0, 1, 2].map((section) => (
                  <section key={section} className="rail-section" data-open="1">
                    <div className="rail-section-head">
                      <span className="sk thread-skeleton__rail-label" />
                      <span className="sk thread-skeleton__rail-count" />
                    </div>
                    <div className="rail-section-body consolidation-review-skeleton__rail-body">
                      <span className="sk consolidation-review-skeleton__input" />
                      <span className="sk consolidation-review-skeleton__input" />
                      <span className="sk consolidation-review-skeleton__button" />
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
