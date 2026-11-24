import { useOps } from '../../hooks/useOps'
import { PageHeader } from '../../components/layout/Layouts'
import { IncidentsTable, useDrawers } from '../../components/dashboard/Tables'

export default function HotelIncidentsPage() {
  const ops = useOps()
  const { openIncident, drawers } = useDrawers(ops)
  return (
    <>
      <PageHeader title="Incidents" subtitle="Reports from your guests. Acknowledge quickly. Every public update is sent to the guest on WhatsApp." />
      <IncidentsTable ops={ops} rows={ops.incidents} onOpen={openIncident} showHotel={false} />
      {drawers}
    </>
  )
}
