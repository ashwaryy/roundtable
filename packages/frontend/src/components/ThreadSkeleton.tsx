export function ThreadSkeleton() {
  return (
    <div className="workspace-root" aria-busy="true" aria-label="Loading thread">
      {/* Header strip */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          height: 'var(--header-h)', padding: '0 20px',
          background: 'var(--surface)', borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <span className="sk" style={{ width: 28, height: 28, borderRadius: 6 }} />
        <span className="sk" style={{ width: 220, height: 14 }} />
        <span className="sk" style={{ width: 72, height: 20, borderRadius: 999, marginLeft: 'auto' }} />
      </div>

      <div className="workspace-body">
        <div className="workspace-main">
          {/* Thread body */}
          <div style={{ padding: '24px clamp(20px, 5vw, 48px)', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
            <span className="sk" style={{ width: '55%', height: 20, marginBottom: 14 }} />
            {[100, 100, 78].map((w, i) => (
              <span key={i} className="sk" style={{ width: `${w}%`, height: 13, marginBottom: 8 }} />
            ))}
          </div>

          {/* Comment stream */}
          <div style={{ padding: '24px clamp(20px, 5vw, 48px)', display: 'flex', flexDirection: 'column', gap: 28 }}>
            {[
              { lines: 2, bodyH: 44 },
              { lines: 1, bodyH: 28 },
              { lines: 3, bodyH: 62 },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 10 }}>
                <span className="sk" style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span className="sk" style={{ width: 88, height: 12 }} />
                  <span className="sk" style={{ height: item.bodyH, borderRadius: 8 }} />
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          <div style={{ position: 'sticky', bottom: 0, padding: '10px clamp(20px, 5vw, 48px) 12px', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
            <span className="sk" style={{ height: 38, borderRadius: 8 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
