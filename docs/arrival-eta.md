# Arrival ETA updates

The official FR24 live provider must not depend on the public FR24 airport
schedule. Previously, a failed public schedule caused successful official ETA
responses to be discarded. The regression is covered by
`npm run test:live-arrivals`.

`FlightScheduleProviderResult.liveUpdates` carries observations separately from
scheduled rows. The coordinator applies them to StaffMonitor, AeroDataBox or
another timetable, regardless of provider completion order. The shared facade
also applies them to the daily cached timetable when only live data succeeds.
An unmatched observation never creates a synthetic STA/STD. Confirmed real
times and operational fields remain intact; ambiguous rotations are skipped.

While Flights / Today is visible and the app is active, a separate updater
checks up to six selected arrivals within the next 90 minutes (including
overdue arrivals up to three hours). It runs every 30 seconds. Official FR24
requests are limited to once per minute and those flight numbers, use the
configured key in Auto/FR24 mode, and back off for 30 minutes after auth/quota
errors. Recent official observations avoid redundant calls. This is separate
from the existing two-minute full-board refresh and is not a background widget
or Home polling loop.

Official ETA wins over a fresh geometric fallback even if the latter position
is a few seconds newer. Source observation timestamps are retained; after
three minutes the UI marks the observation stale. Open ADS-B positions older
than 90 seconds cannot generate arrival estimates. Each open endpoint has its
own deadline so a stalled first endpoint leaves time for the second.

The compact departure card shows its linked inbound ETA and source age. Open
ADS-B remains an approximate distance/speed estimate within 250 nautical miles;
it does not reproduce FR24's prediction model. Provider observation age does
not measure when an ETA last changed or guarantee landing prediction accuracy.

Official reference: [FR24 endpoint documentation](https://fr24api.flightradar24.com/docs/endpoints/overview).
Live full positions expose `eta` and `timestamp`, support inbound airport and
flight-number filters, and charge per returned flight; see the
[credit overview](https://fr24api.flightradar24.com/docs/credit-overview).

Validation: `npm run qa:release`, plus a controlled browser check with blocked
public FR24, a StaffMonitor timetable, changing official ETA and stale data.
Real-world accuracy still requires comparison on the user's configured device.
