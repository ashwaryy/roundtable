import { Link } from 'react-router-dom'
import appIconUrl from '../../assets/web/icon-192.png'

export function RoundtableBrand({
  className,
  backendStatus,
}: {
  className: 'brand' | 'workspace-brand'
  backendStatus?: 'connected' | 'connecting' | 'disconnected'
}) {
  const statusClassName = className === 'brand' ? 'dot' : 'workspace-brand__dot'
  const statusLabel = backendStatus ? `Backend ${backendStatus}` : undefined

  return (
    <Link to="/" className={className} aria-label="Roundtable home">
      <span className={`${className}__badge`}>
        <img className={`${className}__logo`} src={appIconUrl} alt="" aria-hidden="true" />
        <span
          className={statusClassName}
          data-backend-status={backendStatus}
          aria-label={statusLabel}
          title={statusLabel}
        />
      </span>
      <span>Roundtable</span>
    </Link>
  )
}
