import { Suspense, lazy, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppProvider, ROLE_HOME, useApp } from './context/AppContext'
import { DashboardLayout } from './components/layout/Layouts'
import PresenterBar from './components/layout/PresenterBar'
import { Spinner } from './components/common/ui'
import LandingPage from './pages/public/LandingPage'
const HowItWorksPage = lazy(() => import('./pages/public/HowItWorksPage'))
const StartPage = lazy(() => import('./pages/public/StartPage'))
const ShortLink = lazy(() => import('./pages/public/StartPage').then((m) => ({ default: m.ShortLink })))
const AssistantPage = lazy(() => import('./pages/tourist/AssistantPage'))
const BookPage = lazy(() => import('./pages/tourist/BookPage'))
const TripPage = lazy(() => import('./pages/tourist/TripPage'))
const ReportPage = lazy(() => import('./pages/tourist/ReportPage'))
const IncidentTrackingPage = lazy(() => import('./pages/tourist/IncidentTrackingPage'))
const AlertsPage = lazy(() => import('./pages/tourist/AlertsPage'))
const SafetyPage = lazy(() => import('./pages/public/SafetyPage'))
const MyBookingsPage = lazy(() => import('./pages/tourist/MyBookingsPage'))
const LoginPage = lazy(() => import('./pages/public/LoginPage'))
import NotFoundPage from './pages/public/NotFoundPage'
const HotelOverviewPage = lazy(() => import('./pages/hotel/HotelOverviewPage'))
const HotelBookingsPage = lazy(() => import('./pages/hotel/HotelBookingsPage'))
const HotelDriversPage = lazy(() => import('./pages/hotel/HotelDriversPage'))
const HotelIncidentsPage = lazy(() => import('./pages/hotel/HotelIncidentsPage'))
const HotelSetupPage = lazy(() => import('./pages/hotel/HotelSetupPage'))
const ProviderOverviewPage = lazy(() => import('./pages/transport/ProviderOverviewPage'))
const ProviderBookingsPage = lazy(() => import('./pages/transport/ProviderBookingsPage'))
const ProviderFleetPage = lazy(() => import('./pages/transport/ProviderFleetPage'))
const ProviderIncidentsPage = lazy(() => import('./pages/transport/ProviderIncidentsPage'))
const DriverTripsPage = lazy(() => import('./pages/transport/DriverTripsPage'))
const AdminOverviewPage = lazy(() => import('./pages/admin/AdminOverviewPage'))
const AdminIncidentsPage = lazy(() => import('./pages/admin/AdminIncidentsPage'))
const AdminPartnersPage = lazy(() => import('./pages/admin/AdminPartnersPage'))
const AdminAnalyticsPage = lazy(() => import('./pages/admin/AdminAnalyticsPage'))
const AdminAuditPage = lazy(() => import('./pages/admin/AdminAuditPage'))
const AdminAiPage = lazy(() => import('./pages/admin/AdminAiPage'))
const AdminFeedbackPage = lazy(() => import('./pages/admin/AdminFeedbackPage'))
const AdminGoalsPage = lazy(() => import('./pages/admin/AdminGoalsPage'))
const DevelopersPage = lazy(() => import('./pages/developers/DevelopersPage'))

/** Role-based route guard. RLS enforces the same rules on the server. */
function RequireRole({ roles, children }) {
  const { uid, role, loadingSession } = useApp()
  const location = useLocation()
  if (loadingSession) return <Spinner label="Checking your sign-in…" />
  if (!uid) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  if (!roles.includes(role)) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-xl font-semibold">Not available for your account</h1>
        <p className="mt-2 text-sm text-muted">This area is for {roles.map((r) => r.replace('_', ' ')).join(' or ')} accounts.</p>
        <a href={ROLE_HOME[role] ?? '/'} className="mt-4 inline-block font-medium text-teal-ink underline">Go to your dashboard</a>
      </div>
    )
  }
  return children
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

const guard = (roles, el) => <RequireRole roles={roles}>{el}</RequireRole>

export default function App() {
  return (
    <AppProvider>
      <ScrollToTop />
      <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/start" element={<StartPage />} />
        <Route path="/s/:code" element={<ShortLink />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/book" element={<BookPage />} />
        <Route path="/trip/:token" element={<TripPage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/incident/:token" element={<IncidentTrackingPage />} />
        <Route path="/alerts/:token" element={<AlertsPage />} />
        <Route path="/developers/:section?" element={<DevelopersPage />} />
        <Route path="/safety" element={<SafetyPage />} />
        <Route path="/my-bookings" element={<MyBookingsPage />} />
        <Route path="/login" element={<LoginPage />} />

        <Route element={guard(['hotel_staff', 'admin'], <DashboardLayout area="hotel" />)}>
          <Route path="/hotel" element={<HotelOverviewPage />} />
          <Route path="/hotel/bookings" element={<HotelBookingsPage />} />
          <Route path="/hotel/drivers" element={<HotelDriversPage />} />
          <Route path="/hotel/incidents" element={<HotelIncidentsPage />} />
          <Route path="/hotel/setup" element={<HotelSetupPage />} />
        </Route>
        <Route element={guard(['provider_staff', 'admin'], <DashboardLayout area="provider" />)}>
          <Route path="/provider" element={<ProviderOverviewPage />} />
          <Route path="/provider/bookings" element={<ProviderBookingsPage />} />
          <Route path="/provider/fleet" element={<ProviderFleetPage />} />
          <Route path="/provider/incidents" element={<ProviderIncidentsPage />} />
        </Route>
        <Route element={guard(['driver'], <DashboardLayout area="driver" />)}>
          <Route path="/driver" element={<DriverTripsPage />} />
        </Route>
        <Route element={guard(['admin'], <DashboardLayout area="admin" />)}>
          <Route path="/admin" element={<AdminOverviewPage />} />
          <Route path="/admin/incidents" element={<AdminIncidentsPage />} />
          <Route path="/admin/partners" element={<AdminPartnersPage />} />
          <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
          <Route path="/admin/feedback" element={<AdminFeedbackPage />} />
          <Route path="/admin/goals" element={<AdminGoalsPage />} />
          <Route path="/admin/ai" element={<AdminAiPage />} />
          <Route path="/admin/audit" element={<AdminAuditPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
      <PresenterBar />
      <Toaster position="top-right" richColors closeButton />
    </AppProvider>
  )
}
