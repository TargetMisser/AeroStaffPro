'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { chromium } = require('playwright');
const { readVisibleFlightRows, selectObservation, observationKey, publicSnapshot } = require('./reader.cjs');

const { values } = parseArgs({ options: {
  flight: { type: 'string' }, date: { type: 'string' },
  airport: { type: 'string', default: 'PSA' }, 'leg-id': { type: 'string' },
  samples: { type: 'string', default: '5' }, interval: { type: 'string', default: '60' },
  port: { type: 'string', default: '8794' }, profile: { type: 'string' },
  headless: { type: 'boolean', default: false },
} });
const target = { flight: (values.flight ?? '').toUpperCase(), date: values.date,
  airport: values.airport.toUpperCase(), legId: values['leg-id']?.toLowerCase() };
if (!/^[A-Z0-9]{2,3}\d{1,5}$/.test(target.flight)
  || !/^\d{4}-\d{2}-\d{2}$/.test(target.date ?? '')
  || !/^\w{3,4}$/.test(target.airport)
  || (target.legId && !/^[a-f0-9]{6,16}$/.test(target.legId))) {
  throw new Error('Specificare --flight W45029 --date 2026-09-12 --airport PSA [--leg-id 419febbe]');
}
const samples = Number(values.samples), intervalSeconds = Number(values.interval), port = Number(values.port);
if (!Number.isInteger(samples) || samples < 1 || samples > 30
  || !Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 600
  || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Limiti prova: 1–30 letture, intervallo 60–600 secondi, porta 1024–65535.');
}
const repo = path.resolve(__dirname, '../..');
const output = path.join(repo, 'output/playwright/fr24-eta');
const profile = values.profile ? path.resolve(values.profile) : path.join(repo, 'tmp/fr24-eta-browser-profile');
const sourceUrl = `https://www.flightradar24.com/data/flights/${target.flight.toLowerCase()}${target.legId ? `#${target.legId}` : ''}`;
const state = { target, observation: null, lastChangedAt: null, error: null,
  samplesCompleted: 0, samplesRequested: samples, intervalSeconds,
  finished: false, startedAt: new Date().toISOString(), endedAt: null };
let context, timer, stopping = false;
const history = [];

const server = http.createServer(async (req, res) => {
  // Loopback only, no cross-origin access, no route which triggers a remote fetch.
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) {
    res.writeHead(403); return res.end();
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  if (req.url === '/api/eta') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(publicSnapshot(state)));
  }
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(await fs.readFile(path.join(__dirname, 'dashboard.html')));
  }
  res.writeHead(404); res.end();
});

async function saveEvidence() {
  await fs.writeFile(path.join(output, 'latest.json'), JSON.stringify(publicSnapshot(state), null, 2));
  await fs.writeFile(path.join(output, 'history.json'), JSON.stringify(history, null, 2));
}

async function collect(page) {
  if (stopping) return;
  try {
    // Reload through the normal website UI; never call its private endpoints.
    const response = await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!response || response.status() >= 400) throw new Error(`Pagina FR24 non disponibile (HTTP ${response?.status() ?? 'assente'}).`);
    await page.locator('tr.data-row').first().waitFor({ state: 'attached', timeout: 15_000 });
    const capture = await page.evaluate(readVisibleFlightRows);
    const observation = selectObservation(capture, target);
    if (observationKey(observation) !== observationKey(state.observation)) state.lastChangedAt = observation.readAt;
    state.observation = observation;
    state.error = null;
    if (state.samplesCompleted === 0) await page.screenshot({ path: path.join(output, 'server-first-read.png') });
    console.log(JSON.stringify({ readAt: observation.readAt, flight: observation.flight,
      status: observation.status, scheduled: observation.scheduledArrival.clock,
      eta: observation.estimatedArrival?.clock ?? null }));
  } catch (error) {
    // Stop after a failed read. Never loop on login, access denial or a challenge.
    state.error = error.message;
    console.error(`Lettura interrotta: ${error.message}`);
  }
  state.samplesCompleted += 1;
  state.finished = Boolean(state.error) || state.samplesCompleted >= samples
    || Boolean(state.observation?.actualArrival);
  if (state.finished) state.endedAt = new Date().toISOString();
  history.push(publicSnapshot(state));
  await saveEvidence();
  if (state.finished) {
    await context.close();
    console.log('Prova conclusa: nessun altro accesso a FR24. Il riepilogo locale resta disponibile.');
  } else timer = setTimeout(() => collect(page).catch(fail), intervalSeconds * 1000);
}

async function fail(error) {
  state.error = error.message;
  state.finished = true;
  state.endedAt = new Date().toISOString();
  console.error(error.message);
  await saveEvidence().catch(() => {});
  await context?.close().catch(() => {});
}
async function stop() {
  stopping = true;
  clearTimeout(timer);
  await context?.close().catch(() => {});
  server.close();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

(async () => {
  await fs.mkdir(output, { recursive: true });
  const dashboardUrl = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`Prova locale: ${dashboardUrl} — ${target.flight}, ${target.date}`);
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome', headless: values.headless,
    viewport: { width: 1440, height: 1000 }, locale: 'en-GB', timezoneId: 'Europe/Rome',
    acceptDownloads: false,
  });
  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();
  for (const extra of pages.slice(1)) await extra.close();
  await collect(page);
})().catch(fail);
