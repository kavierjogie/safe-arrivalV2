import { useOps } from '../../hooks/useOps'
import { useApp } from '../../context/AppContext'
import { PageHeader } from '../../components/layout/Layouts'
import Fleet from '../../components/dashboard/Fleet'

export default function HotelDriversPage() {
  const ops = useOps()
  const { profile } = useApp()
  // Drivers RLS shows a hotel: approved drivers of its partner providers + its own fleet.
  const providerIds = [...new Set(ops.drivers.map((d) => d.provider_id))]
  const own = ops.transport_providers.filter((p) => p.owner_hotel_id && (p.owner_hotel_id === profile?.hotel_id || profile?.role === 'admin'))
  return (
    <>
      <PageHeader title="Approved drivers" subtitle="Drivers you can assign: your own fleet plus approved drivers of your partner shuttle companies." />
      <Fleet ops={ops} providerIds={providerIds} manageable={own} />
    </>
  )
}
