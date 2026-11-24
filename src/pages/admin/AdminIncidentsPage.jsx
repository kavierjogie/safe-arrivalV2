import { useOps } from '../../hooks/useOps'
import { PageHeader } from '../../components/layout/Layouts'
import { IncidentsTable, useDrawers } from '../../components/dashboard/Tables'

export default function AdminIncidentsPage() {
  const ops = useOps()
  const { openIncident, drawers } = useDrawers(ops)
  return (
    <>
      <PageHeader title="Incident management" subtitle="Investigate, assign handlers, escalate and record external police references." />
      <IncidentsTable ops={ops} rows={ops.incidents} onOpen={openIncident} />
      {drawers}
    </>
  )
}
