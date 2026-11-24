import { useOps } from '../../hooks/useOps'
import { OpsOverview } from '../hotel/HotelOverviewPage'

export default function ProviderOverviewPage() {
  const ops = useOps()
  return <OpsOverview ops={ops} title="Provider overview" subtitle="Bookings from partner hotels and incident alerts for your trips. Updates live." bookingsLink="/provider/bookings" incidentsLink="/provider/incidents" />
}
