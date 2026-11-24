import { useOps } from '../../hooks/useOps'
import { PageHeader } from '../../components/layout/Layouts'
import { BookingsTable, useDrawers } from '../../components/dashboard/Tables'

export default function ProviderBookingsPage() {
  const ops = useOps()
  const { openBooking, drawers } = useDrawers(ops)
  return (
    <>
      <PageHeader title="Bookings" subtitle="Accept or decline requests from partner hotels, assign approved drivers and update pickup progress." />
      <BookingsTable ops={ops} rows={ops.bookings} onOpen={openBooking} initial="action" showHotel />
      {drawers}
    </>
  )
}
