# Flight Reliability Design

**Date:** 2026-07-04

## Problem

AeroStaff Pro 2.7.31 has three related reliability problems:

1. Opening the Flights screen can block for too long before showing useful data.
2. The Android widget can remain blank or lose useful content during a failed background refresh.
3. Arrival estimates can be less accurate than Flightradar24 even when an official FR24 API key is configured.

The current provider pipeline runs providers sequentially until it has both current-day and next-day coverage. Its individual timeouts can accumulate, and non-essential ADS-B route enrichment is awaited inside the initial screen refresh. The Flights screen only uses its short-lived screen cache as an initial snapshot, so an empty or expired cache exposes the full network delay.

The accuracy regression has a separate cause. The official FR24 live endpoint already supplies an ETA, but the later open ADS-B overlay can replace that value with a geometric estimate based on current distance, current groundspeed, and a fixed approach allowance.

The widget background task also performs network work before rendering on update and refresh actions. If the headless task is delayed, terminated, or encounters a rendering error, the launcher may not receive a usable replacement view.

## Goals

- Show a useful Flights screen snapshot immediately when same-day cached data exists.
- Keep the visible snapshot on screen while fresh data loads.
- Bound the initial network refresh so a slow secondary provider cannot hold the screen open.
- Use the official FR24 ETA unchanged whenever it is available.
- Preserve StaffMonitor operational data such as stand, check-in, gate, belt, and airport status.
- Use public ADS-B estimates only to fill missing live data.
- Make the widget render the last valid state before attempting network work.
- Keep the last valid widget state when a refresh fails.
- Preserve provider diagnostics so failures and data provenance remain inspectable.

## Non-goals

- Reproducing Flightradar24's proprietary prediction model without its API.
- Adding a hosted backend or shared API credentials.
- Hardcoding provider keys.
- Removing AeroDataBox, AirLabs, StaffMonitor, or public fallbacks.
- Changing flight-card visual design.
- Publishing an APK as part of the implementation. Release remains a separate explicit action.

## Approach

Keep the existing client-side provider architecture, but separate it into three responsibilities:

1. **Schedule snapshot:** StaffMonitor and schedule providers supply the airport board and operational fields.
2. **Authoritative live overlay:** the official FR24 API supplies live aircraft state and ETA when a configured key is available.
3. **Best-effort enrichment:** public ADS-B fills only values still missing after the authoritative merge.

The screen and widget both adopt stale-while-revalidate behavior: render known-good data first, then refresh without removing that data.

This approach is preferred over an FR24-only mode because the official live-position endpoint is not a complete future airport schedule. It is preferred over a new backend because the requested reliability gains can be achieved without adding infrastructure, credential custody, or operating cost.

## Time Authority Rules

Arrival and departure timestamps must be merged according to explicit provenance rather than provider execution order.

Priority from highest to lowest:

1. Confirmed real arrival or departure.
2. Official FR24 live ETA or detected event.
3. Estimated time supplied by StaffMonitor, AeroDataBox, or another operational schedule provider.
4. Public ADS-B geometric estimate.
5. Scheduled time.

Rules:

- `applyLiveArrivalEtas` must not overwrite an existing official or operational estimated arrival.
- An FR24 live item merged into a schedule item must retain an explicit source marker for its ETA.
- Public ADS-B may add an estimate only when no higher-priority estimate exists.
- The displayed time, sorting time, notification time, and widget time must all use the same authority helper.
- A real timestamp always replaces estimates regardless of source.

## Flights Screen Data Flow

### Initial render

1. Read the same-airport screen cache.
2. Accept a cache entry when it contains flights for the selected local calendar day, even if its normal freshness window has elapsed.
3. Render the cached rows immediately with a visible "updating" indicator and source timestamp.
4. Never clear visible rows merely because a refresh starts.

An old same-day snapshot is preferable to a blocking loader, but it must be clearly marked as stale. Data from another airport or another local day must not be shown.

### Refresh

The refresh is split into a critical path and enrichment path.

Critical path:

- Load credentials and provider preference once.
- Start the schedule provider and official FR24 live request concurrently where supported.
- Merge each successful result using the time-authority rules.
- Publish a usable snapshot as soon as the required current-day board is available.
- Apply a hard deadline to the critical refresh. A timeout records diagnostics and leaves the previous snapshot visible.

Enrichment path:

- Fetch tomorrow coverage and secondary provider details without blocking the current-day board.
- Fetch public ADS-B only for flights that still lack authoritative live data.
- Run origin-route lookup outside the initial loading state.
- Save successful merged snapshots back to the screen and daily caches.

Manual pull-to-refresh follows the same flow but keeps its refresh indicator until the critical path settles.

### Errors

- A partial provider failure does not erase successful provider data.
- `NO_FLIGHT_PROVIDER_AVAILABLE` does not clear a valid same-day cache.
- The screen shows an empty state only when neither current data nor a valid snapshot exists.
- Diagnostics record provider duration, timeout, contribution, and whether stale data was retained.

## Widget Data Flow

For `WIDGET_ADDED`, `WIDGET_RESIZED`, `WIDGET_UPDATE`, and manual refresh:

1. Resolve the current shift from the stored snapshot or system calendar.
2. Read and validate the last widget cache.
3. Render a deterministic cached state immediately.
4. Start the network refresh with a hard timeout.
5. Validate the fresh result.
6. Persist and render the fresh result only when it is valid for the resolved shift.

Failure behavior:

- Network failure keeps the last rendered view.
- A transient fetch error never overwrites a valid `work` or `work_empty` cache with `error`.
- Missing data renders an explicit themed state rather than an unpainted widget.
- All rendering branches use the stored theme with a safe palette fallback.
- The handler records a compact diagnostic status in storage for later inspection from the app.

The task handler may render more than once during one action because `renderWidget` directly redraws the widget by ID on every call.

## Performance Targets

- Cached Flights content: first useful rows within 300 ms under normal device storage conditions.
- Critical refresh: target completion within 5 seconds; hard deadline no greater than 8 seconds.
- Secondary enrichment must never extend the blocking loader.
- Widget cached paint: target within 1 second of task start.
- No provider may have an unbounded request on the screen or widget critical path.

These are product targets and will be enforced through deterministic unit tests for orchestration and timeout behavior, plus emulator timing evidence where the runtime permits it.

## Testing

Focused regression tests must cover:

- Official FR24 ETA survives the public ADS-B overlay.
- Public ADS-B fills a missing ETA.
- Real timestamps beat every estimate.
- Provider results merge correctly regardless of completion order.
- A slow secondary provider does not delay the critical result beyond its deadline.
- A same-day stale cache remains displayable while a refresh runs.
- A failed refresh does not clear a valid screen snapshot.
- Widget update renders cached content before awaiting the network.
- Widget refresh failure preserves the last valid cache and never persists `error` over it.
- Widget theme fallback always produces a painted root.

Verification commands:

```bash
npm run test:flight-helpers
npm test
npm run typecheck
```

Emulator QA should capture the Flights screen immediately after navigation and again after refresh. Widget verification should exercise a valid cache, offline refresh, and restored network.

## Delivery

Implementation starts from the current `main`/v2.7.31 code rather than the older v2.7.16 base currently present on `codex/design-lab-storybook`. Existing local documentation commits and untracked `output/` and `tmp/` directories must be preserved.

The implementation will be committed and pushed after tests pass. No release or APK publication occurs without a separate user request.
