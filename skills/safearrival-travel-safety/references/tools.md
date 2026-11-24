# SafeArrival MCP tools: when to call which

Coordinates are WGS84 decimal degrees. Convert place names first. Useful points:
Cape Town International Airport (International Arrivals) `-33.9697, 18.5968` · V&A Waterfront `-33.905, 18.419` ·
Cape Town Station `-33.9222, 18.4253` · Sea Point `-33.915, 18.385`.

| User intent | Tool | Key inputs | Read from the result |
|---|---|---|---|
| "Is it safe around X?", "incidents near my hotel/airport" | `check_area_safety` | `latitude`, `longitude`, `radius_km` (default 2), `location_name`, `period_days` (default 90) | `summary` counts by type, `by_category`, `reports[]`, `coverage`, `limitations` |
| "Any alerts in Cape Town this week?" | `get_safety_alerts` | optional location + `radius_km`, `category`, `days` (default 14), `include_unverified`, `include_expired` | `alerts[]` (advisories first), `counts` |
| "Is the route from the airport to Sea Point OK?" | `check_route_safety` | origin + destination coordinates, `travel_mode`, `corridor_km` | `reports_near_route[]`, `route_model.note` (straight-line corridor, not road route) |
| "Is <company> legit?" | `verify_transport_provider` | `provider_name` (≥3 chars) or `provider_id` | `matches[].safearrival_status`, `meaning`, `result` |
| "Is this my driver?" (has a booking) | `verify_driver` | `booking_token`, `spoken_code` (what the driver SAID), `vehicle_registration`, `driver_name` | `checks`, `next_steps`, `can_verify` |
| "Where do I meet my driver?", "how does verification work?" | `get_pickup_guidance` | `pickup_point`, `hotel`, or coordinates | `pickup_point.meeting_instructions`, `verification_instructions`, `impersonation_warnings` |
| Emergency, "who do I call?" | `find_emergency_services` | optional coordinates | `immediate_danger`, `emergency_numbers[]` |
| "What should I know before travelling to X?" | `get_travel_safety_advice` | `destination`, `travel_context` (`airport_arrival`, `ehailing`, `shuttle`, `night`, `outdoors`, `general`), `travel_time` | `precautions`, `common_reported_issues`, `active_alerts`, `coverage` |
| "I want to report something" | `report_safety_incident` | `category`, `description`, location (`pickup_point_id` or coordinates or `location_text`), `occurred_at`, `urgent`, `user_confirmed: true` **only after the user confirms** | `reference`, `next_steps` |
| "Tell me if anything happens near my hotel" | `subscribe_safety_alerts` | coordinates, `location_name`, `radius_km` (default 3), `categories`, `channel` (`web` default, or `whatsapp` + `whatsapp_number`), `duration_days` (default 14, max 30), `consent: true` **only after the user agrees** | `reference`, `manage_url` (give it to the user), `whatsapp_delivery`, `expires_at` |
| "Pause / change / stop my alerts", "any alerts for me?" | `manage_safety_alerts` | `manage_token` (end of the manage link), `action` (`view`, `pause`, `resume`, `update`, `unsubscribe`), `radius_km`, `categories`, `extend_days` | `subscription.status`, `alerts[]` |

Report categories: `extra_payment`, `driver_mismatch`, `vehicle_mismatch`, `code_incorrect`, `suspected_scam`,
`intimidation`, `cannot_locate_driver`, `other`.

## Fields present on every incident-like item

`type`, `verification_status`, `category_label`, `severity` (of the *category*, not a risk score), `summary`, `source`,
`reported_at`, `occurred_at`, `last_updated`, `verified_at`, `public_until`, `review_status`
(`active`, `expired`, `under_review`, `case_closed`), `is_historical`, `location` (`area_name`, `approx_lat/lng`,
`precision`, `distance_km`), `precaution`.

## Limits

60 read calls per minute and 3 submissions (reports + subscriptions) per hour per caller. `verify_driver` code checks: 5 per 10 minutes per booking.
