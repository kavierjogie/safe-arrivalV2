import { useOps } from '../../hooks/useOps'
import { PageHeader } from '../../components/layout/Layouts'
import { IncidentsTable, useDrawers } from '../../components/dashboard/Tables'

export default function ProviderIncidentsPage() {
  const ops = useOps()
  const { openIncident, drawers } = useDrawers(ops)
  return (
    <>
      <PageHeader title="Incident notifications" subtitle="Reports about your trips. They are unverified until investigated." />
      <IncidentsTable ops={ops} rows={ops.incidents} onOpen={openIncident} />
      {drawers}
    </>
  )
}
