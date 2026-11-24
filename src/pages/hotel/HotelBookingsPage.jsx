import { useOps } from '../../hooks/useOps'
import { PageHeader } from '../../components/layout/Layouts'
import { BookingsTable, useDrawers } from '../../components/dashboard/Tables'
import { useApp } from '../../context/AppContext'

export default function HotelBookingsPage() {
  const ops = useOps()
  const { role } = useApp()
  const { openBooking, drawers } = useDrawers(ops)
  return (
    <>
      <PageHeader title="Bookings" subtitle="Confirm requests, set prices, assign approved drivers and track each pickup." />
      <BookingsTable ops={ops} rows={ops.bookings} onOpen={openBooking} initial="action" showHotel={role === 'admin'} />
      {drawers}
    </>
  )
}
