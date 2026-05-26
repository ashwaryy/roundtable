import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LiveRefreshStatus } from '../useLiveRefresh'
import { Icon } from './primitives'
import { RoundtableBrand } from './RoundtableBrand'

export function TopbarHeader({
  actions,
  backendStatus,
}: {
  actions: ReactNode
  backendStatus?: LiveRefreshStatus
}) {
  return (
    <header className="topbar">
      <RoundtableBrand className="brand" backendStatus={backendStatus} />
      <div className="spacer" />
      <div className="meta">{actions}</div>
    </header>
  )
}

export function WorkspaceHeader({
  ariaLabel,
  backTo,
  backLabel,
  backTitle,
  title,
  actions,
  backendStatus,
  extra,
}: {
  ariaLabel: string
  backTo: string
  backLabel: string
  backTitle: string
  title: ReactNode
  actions: ReactNode
  backendStatus?: LiveRefreshStatus
  extra?: ReactNode
}) {
  return (
    <header className="workspace-header" aria-label={ariaLabel}>
      <Link to={backTo} className="workspace-back" aria-label={backLabel} title={backTitle}>
        <Icon name="arrowLeft" className="ic" />
      </Link>

      <RoundtableBrand className="workspace-brand" backendStatus={backendStatus} />

      <div className="workspace-header__title">{title}</div>

      <div className="workspace-header__badges">{actions}</div>

      {extra}
    </header>
  )
}
