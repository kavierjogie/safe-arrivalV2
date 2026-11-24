import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import { Navigation } from 'lucide-react'

export const directionsUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`

/** OpenStreetMap pin for a pickup point (no API key needed). */
export default function PickupMap({ point, height = 'h-56' }) {
  if (!point) return null
  return (
    <div className="space-y-2">
      <div className={`relative overflow-hidden rounded-xl border border-slate-200 ${height}`}>
        <MapContainer center={[point.lat, point.lng]} zoom={16} scrollWheelZoom={false} className="h-full w-full">
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
          <CircleMarker center={[point.lat, point.lng]} radius={11} pathOptions={{ color: '#fff', weight: 3, fillColor: '#13A89E', fillOpacity: 1 }}>
            <Tooltip permanent direction="top" offset={[0, -10]}>Meet your driver here</Tooltip>
          </CircleMarker>
        </MapContainer>
      </div>
      <a href={directionsUrl(point)} target="_blank" rel="noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-navy ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
        <Navigation className="size-4" aria-hidden />Open directions in Google Maps
      </a>
    </div>
  )
}
