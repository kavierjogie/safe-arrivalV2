import { Link } from 'react-router-dom'
import { PublicPage } from '../../components/layout/Layouts'

export default function NotFoundPage() {
  return (
    <PublicPage narrow>
      <div className="py-16 text-center">
        <p className="font-mono text-sm text-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted">If you followed a booking link, check it against your WhatsApp message.</p>
        <Link to="/" className="mt-4 inline-block font-medium text-teal-ink underline">Go to the home page</Link>
      </div>
    </PublicPage>
  )
}
