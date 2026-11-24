import { useOps } from '../../hooks/useOps'
import { useApp } from '../../context/AppContext'
import { PageHeader } from '../../components/layout/Layouts'
import Fleet from '../../components/dashboard/Fleet'
import { Panel, Info } from '../../components/common/ui'
import { PartnerStatusBadge } from '../../components/common/StatusBadges'
import { PROVIDER_TYPE } from '../../lib/labels'

export default function ProviderFleetPage() {
  const ops = useOps()
  const { profile } = useApp()
  const mine = ops.transport_providers.filter((p) => profile?.role === 'admin' || p.id === profile?.provider_id)
  return (
    <>
      <PageHeader title="Drivers & vehicles" subtitle="Every driver must belong to an approved provider and be approved before they can be assigned." />
      {mine.length === 1 && (
        <Panel title="Company profile" className="mb-4" bodyClass="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Info label="Company">{mine[0].name}</Info>
          <Info label="Type">{PROVIDER_TYPE[mine[0].provider_type]}</Info>
          <Info label="Status"><PartnerStatusBadge status={mine[0].status} /></Info>
          <Info label="Safety contact">{mine[0].safety_contact}</Info>
          <Info label="Phone">{mine[0].contact_phone}</Info>
          <Info label="Email">{mine[0].contact_email}</Info>
          <Info label="Partner hotels">{new Set(ops.hotel_transport_partners.filter((o) => o.provider_id === mine[0].id).map((o) => o.hotel_id)).size}</Info>
        </Panel>
      )}
      <Fleet ops={ops} providerIds={mine.map((p) => p.id)} manageable={mine} />
    </>
  )
}
