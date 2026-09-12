'use strict';

// Read only rendered table cells and their associated time attributes.
// No page application state, session tokens, or private network endpoints.
function readVisibleFlightRows() {
  const visible = element => element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden';
  const clean = value => value.replace(/\s+/g, ' ').trim();
  const rows = [];
  for (const row of document.querySelectorAll('tr.data-row')) {
    if (!visible(row)) continue;
    const table = row.closest('table');
    const headers = Array.from(table.querySelectorAll('thead th')).filter(visible)
      .map(cell => clean(cell.innerText).toUpperCase());
    const cells = Array.from(row.children).filter(visible);
    if (headers.length !== cells.length) continue;
    const fields = {};
    for (let i = 0; i < headers.length; i++) {
      if (!headers[i]) continue;
      fields[headers[i]] = {
        text: clean(cells[i].innerText),
        timestamp: cells[i].getAttribute('data-timestamp'),
        offset: cells[i].getAttribute('data-offset'),
        links: Array.from(cells[i].querySelectorAll('a[href]')).map(a => a.href),
      };
    }
    const legIds = Array.from(row.querySelectorAll('a[data-flight-hex]'))
      .map(a => a.getAttribute('data-flight-hex'));
    rows.push({ fields, legIds });
  }
  return { url: location.href, title: document.title, rows };
}

function timeValue(cell) {
  if (!cell || !/^\d{9,11}$/.test(cell.timestamp ?? '')
    || !/^-?\d{1,5}$/.test(cell.offset ?? '')) return null;
  const timestamp = Number(cell.timestamp);
  const offset = Number(cell.offset);
  if (Math.abs(offset) > 14 * 3600) return null;
  const display = new Date((timestamp + offset) * 1000);
  const match = cell.text.match(/\b(\d{1,2}):(\d{2})(?:\s*(AM|PM))?\b/i);
  if (match) {
    let hour = Number(match[1]);
    if (match[3]) hour = (hour % 12) + (/PM/i.test(match[3]) ? 12 : 0);
    if (display.getUTCHours() !== hour || display.getUTCMinutes() !== Number(match[2])) return null;
  }
  return { timestamp, iso: new Date(timestamp * 1000).toISOString(),
    localDate: display.toISOString().slice(0, 10),
    clock: display.toISOString().slice(11, 16), offsetSeconds: offset };
}

function selectObservation(capture, target, readAt = new Date().toISOString()) {
  const url = new URL(capture.url);
  if (url.hostname !== 'www.flightradar24.com'
    || url.pathname.toLowerCase() !== `/data/flights/${target.flight.toLowerCase()}`) {
    throw new Error('La pagina aperta non corrisponde al volo selezionato.');
  }
  const matches = capture.rows.filter(row => {
    const date = timeValue(row.fields.DATE);
    const destinations = row.fields.TO?.links ?? [];
    return date?.localDate === target.date
      && destinations.some(link => new URL(link).pathname.toLowerCase() === `/data/airports/${target.airport.toLowerCase()}`)
      && (!target.legId || row.legIds.includes(target.legId));
  });
  if (matches.length !== 1) throw new Error(matches.length
    ? 'Più tratte corrispondenti: impossibile scegliere un arrivo senza ambiguità.'
    : 'Tratta selezionata assente dalla pagina.');
  const row = matches[0];
  const status = row.fields.STATUS?.text ?? '';
  const scheduled = timeValue(row.fields.STA);
  if (!scheduled) throw new Error('Ora programmata assente o incoerente con il testo visibile.');
  // The airport board says "Estimated", while the same delayed arrival's
  // flight history can say "Delayed 14:33". A bare "Delayed" has no ETA.
  const isEstimated = /^(?:Estimated|Delayed)\s+\d{1,2}:\d{2}\b/i.test(status);
  const isLanded = /^Landed\s+\d/i.test(status);
  const statusTime = (isEstimated || isLanded) ? timeValue(row.fields.STATUS) : null;
  if ((isEstimated || isLanded) && !statusTime) throw new Error('Orario di stato non leggibile con certezza.');
  return {
    flight: target.flight, serviceDate: target.date, destination: target.airport,
    origin: row.fields.FROM?.text ?? null, aircraft: row.fields.AIRCRAFT?.text ?? null,
    legId: target.legId ?? row.legIds[0] ?? null, status,
    scheduledArrival: scheduled,
    estimatedArrival: isEstimated ? statusTime : null,
    actualArrival: isLanded ? statusTime : null,
    source: 'fr24_web_experiment', sourceUrl: url.href,
    readAt, sourceUpdatedAt: null,
  };
}

function observationKey(observation) {
  if (!observation) return null;
  const { readAt, sourceUrl, ...data } = observation;
  return JSON.stringify(data);
}

function publicSnapshot(state, nowMs = Date.now(), maxReadAgeMs = 150_000) {
  const readAgeMs = state.observation ? nowMs - Date.parse(state.observation.readAt) : null;
  const readable = !state.error && readAgeMs !== null && readAgeMs >= 0 && readAgeMs <= maxReadAgeMs;
  return { ...state, readAgeMs, readable, sourceFreshness: 'unknown',
    state: state.error ? 'error' : !state.observation ? 'starting'
      : !readable ? 'stale' : state.finished ? 'finished' : 'ok' };
}

module.exports = { readVisibleFlightRows, timeValue, selectObservation, observationKey, publicSnapshot };
