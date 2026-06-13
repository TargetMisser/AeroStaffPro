#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadTsModule(relativePath, mocks = {}) {
  const absolutePath = path.join(root, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const dirname = path.dirname(absolutePath);
  const sandbox = {
    module,
    exports: module.exports,
    require: request => {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) {
        return mocks[request];
      }
      if (request.startsWith('.')) {
        const resolved = path.resolve(dirname, request);
        const relative = path.relative(root, resolved).replace(/\\/g, '/');
        const tsPath = fs.existsSync(`${resolved}.ts`) ? `${relative}.ts` : relative;
        return loadTsModule(tsPath, mocks);
      }
      return require(request);
    },
    console,
    Date,
    Map,
    Set,
    Number,
    String,
    Array,
    Math,
    JSON,
    RegExp,
    setTimeout,
    clearTimeout,
    ...(mocks.__globals ?? {}),
  };
  vm.runInNewContext(output, sandbox, { filename: absolutePath });
  return module.exports;
}

function makeAsyncStorageMock(initialStore = {}) {
  const store = { ...initialStore };
  return {
    _store: store,
    getItem: async key => (key in store ? store[key] : null),
    setItem: async (key, value) => { store[key] = value; },
    removeItem: async key => { delete store[key]; },
  };
}

function makeNotificationsMock(initialPending = []) {
  let idCounter = 0;
  const pending = [...initialPending];
  const scheduled = [];
  const cancelledIds = [];
  return {
    SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
    scheduleNotificationAsync: async req => {
      idCounter += 1;
      const id = `notif-${idCounter}`;
      const request = { identifier: id, content: req.content, trigger: req.trigger };
      pending.push(request);
      scheduled.push(request);
      return id;
    },
    cancelScheduledNotificationAsync: async id => {
      cancelledIds.push(id);
      const idx = pending.findIndex(p => p.identifier === id);
      if (idx >= 0) pending.splice(idx, 1);
    },
    getAllScheduledNotificationsAsync: async () => [...pending],
    _pending: pending,
    _scheduled: scheduled,
    _cancelledIds: cancelledIds,
  };
}

function handleFailure(err) {
  console.error(err);
  process.exit(1);
}

async function main() {
  // ─── buildNotificationData: dedupeKey construction ─────────────────────────
  {
    const asyncStorage = makeAsyncStorageMock();
    const notifMock = makeNotificationsMock();
    const notifDiag = loadTsModule('src/utils/notificationDiagnostics.ts', {
      '@react-native-async-storage/async-storage': asyncStorage,
      'expo-notifications': notifMock,
    });

    const shift = notifDiag.buildNotificationData({ scheduler: 'flights', type: 'arrival_shift', flightNumber: 'FR1234', ts: 12345 });
    assert(shift.dedupeKey === 'shift:arrival_shift:FR1234:12345', 'shift dedupeKey should combine kind, type, flightNumber and ts');
    assert(shift.source === 'aerostaff' && shift.pinned === false, 'non-pinned notification data should have source=aerostaff and pinned=false');

    const pinned = notifDiag.buildNotificationData({ scheduler: 'flights_pinned', type: 'pinned_arrival', flightNumber: 'FR1234', ts: 12345, pinned: true });
    assert(pinned.dedupeKey === 'pinned:pinned_arrival:FR1234:12345', 'pinned dedupeKey should use the "pinned" prefix');
    assert(pinned.pinned === true, 'pinned flag should be preserved');

    const noFlight = notifDiag.buildNotificationData({ scheduler: 'flights', type: 'shift_end' });
    assert(noFlight.dedupeKey === 'shift:shift_end:shift:na', 'missing flightNumber/ts should default to "shift" and "na"');
    assert(noFlight.flightNumber === 'shift', 'missing flightNumber should default to "shift"');

    const withExtra = notifDiag.buildNotificationData({ scheduler: 'x', type: 'y', extra: { foo: 'bar' } });
    assert(withExtra.foo === 'bar', 'extra fields should be merged into the notification data');
  }

  // ─── cancelAeroStaffScheduledNotifications: scope filtering ─────────────────
  await (async () => {
    const NOTIF_IDS_KEY = 'aerostaff_notif_ids_v1';
    const PINNED_NOTIF_IDS_KEY = 'pinned_notif_ids_v1';

    const asyncStorage = makeAsyncStorageMock({
      [NOTIF_IDS_KEY]: JSON.stringify(['shift-1', 'shift-2']),
      [PINNED_NOTIF_IDS_KEY]: JSON.stringify(['pinned-1']),
    });
    const notifMock = makeNotificationsMock([
      { identifier: 'shift-3', content: { title: 'Arrivo', body: 'b', data: { source: 'aerostaff', pinned: false, type: 'arrival_shift', flightNumber: 'FR1', ts: 100, dedupeKey: 'shift:arrival_shift:FR1:100' } }, trigger: { type: 'timeInterval', seconds: 100 } },
      { identifier: 'pinned-2', content: { title: 'Pinned', body: 'b', data: { source: 'aerostaff', pinned: true, type: 'pinned_arrival', flightNumber: 'FR2', ts: 200, dedupeKey: 'pinned:pinned_arrival:FR2:200' } }, trigger: { type: 'timeInterval', seconds: 200 } },
      { identifier: 'other-1', content: { title: 'Ongoing', body: 'b', data: { type: 'shift_ongoing' } }, trigger: { type: 'timeInterval', seconds: 300 } },
    ]);

    const notifDiag = loadTsModule('src/utils/notificationDiagnostics.ts', {
      '@react-native-async-storage/async-storage': asyncStorage,
      'expo-notifications': notifMock,
    });

    const cancelled = await notifDiag.cancelAeroStaffScheduledNotifications({
      includeShift: true,
      includePinned: false,
      reason: 'test cancel',
      source: 'flights',
    });

    assert(cancelled === 3, 'cancelling shift scope should cancel both stored shift IDs plus the pending aerostaff shift request');
    assert(notifMock._cancelledIds.includes('shift-1') && notifMock._cancelledIds.includes('shift-2') && notifMock._cancelledIds.includes('shift-3'), 'all shift IDs (stored + pending) should be cancelled');
    assert(!notifMock._cancelledIds.includes('pinned-1') && !notifMock._cancelledIds.includes('pinned-2') && !notifMock._cancelledIds.includes('other-1'), 'pinned and non-aerostaff requests should be left alone when includePinned is false');

    assert(await asyncStorage.getItem(NOTIF_IDS_KEY) === null, 'NOTIF_IDS_KEY should be removed after cancelling the shift scope');
    assert(await asyncStorage.getItem(PINNED_NOTIF_IDS_KEY) !== null, 'PINNED_NOTIF_IDS_KEY should be untouched when includePinned is false');

    const snapshot = await notifDiag.getNotificationDebugSnapshot();
    assert(snapshot.savedShiftIds === 0, 'savedShiftIds should be 0 after the shift IDs key was removed');
    assert(snapshot.savedPinnedIds === 1, 'savedPinnedIds should reflect the untouched pinned IDs key');
    assert(snapshot.pendingTotal === 2 && snapshot.pendingPinned === 1 && snapshot.pendingShift === 0, 'remaining pending requests should be the pinned and non-aerostaff entries only');
    assert(snapshot.lastEvents[0].type === 'cancel' && snapshot.lastEvents[0].cancelled === 3 && snapshot.lastEvents[0].pending === 3, 'a cancel debug event recording the cancelled/pending counts should be appended');
  })();

  // ─── dedupeAeroStaffScheduledNotifications: collapse duplicate dedupeKeys ───
  await (async () => {
    const notifMock = makeNotificationsMock([
      { identifier: 'a1', content: { title: 'A1', body: 'b', data: { source: 'aerostaff', pinned: false, type: 'arrival_shift', flightNumber: 'FR1', ts: 100, dedupeKey: 'shift:arrival_shift:FR1:100' } }, trigger: { type: 'timeInterval', seconds: 100 } },
      { identifier: 'a2', content: { title: 'A2', body: 'b', data: { source: 'aerostaff', pinned: false, type: 'arrival_shift', flightNumber: 'FR1', ts: 100, dedupeKey: 'shift:arrival_shift:FR1:100' } }, trigger: { type: 'timeInterval', seconds: 105 } },
      { identifier: 'b1', content: { title: 'B1', body: 'b', data: { source: 'aerostaff', pinned: false, type: 'departure_shift', flightNumber: 'FR2', ts: 200, dedupeKey: 'shift:departure_shift:FR2:200' } }, trigger: { type: 'timeInterval', seconds: 200 } },
    ]);
    const notifDiag = loadTsModule('src/utils/notificationDiagnostics.ts', {
      '@react-native-async-storage/async-storage': makeAsyncStorageMock(),
      'expo-notifications': notifMock,
    });

    const cancelled = await notifDiag.dedupeAeroStaffScheduledNotifications({
      includeShift: true,
      includePinned: false,
      reason: 'test dedupe',
      source: 'flights',
    });

    assert(cancelled === 1, 'only the second of a pair of duplicate dedupeKey requests should be cancelled');
    assert(notifMock._cancelledIds.length === 1 && notifMock._cancelledIds[0] === 'a2', 'the later duplicate (a2) should be cancelled, leaving the first (a1)');

    const remaining = await notifMock.getAllScheduledNotificationsAsync();
    assert(remaining.find(r => r.identifier === 'a1') && remaining.find(r => r.identifier === 'b1') && !remaining.find(r => r.identifier === 'a2'), 'a1 and b1 should remain, a2 should be removed');
  })();

  // ─── runNotificationScheduleExclusive: serialization + error reporting ─────
  await (async () => {
    const asyncStorage = makeAsyncStorageMock();
    const notifMock = makeNotificationsMock();
    const notifDiag = loadTsModule('src/utils/notificationDiagnostics.ts', {
      '@react-native-async-storage/async-storage': asyncStorage,
      'expo-notifications': notifMock,
    });

    const order = [];
    const p1 = notifDiag.runNotificationScheduleExclusive('flights', 'first', async () => {
      order.push('start1');
      await new Promise(resolve => setTimeout(resolve, 20));
      order.push('end1');
      return 'r1';
    });
    const p2 = notifDiag.runNotificationScheduleExclusive('flights', 'second', async () => {
      order.push('start2');
      await new Promise(resolve => setTimeout(resolve, 5));
      order.push('end2');
      return 'r2';
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert(r1 === 'r1' && r2 === 'r2', 'both queued work functions should resolve with their own return values');
    assert(JSON.stringify(order) === JSON.stringify(['start1', 'end1', 'start2', 'end2']), 'the second work function should only start after the first fully completes');

    let threw = false;
    try {
      await notifDiag.runNotificationScheduleExclusive('flights', 'failing', async () => {
        throw new Error('boom');
      });
    } catch (e) {
      threw = true;
      assert(e.message === 'boom', 'the original error should be rethrown');
    }
    assert(threw, 'a failing work function should reject the returned promise');

    const snapshot = await notifDiag.getNotificationDebugSnapshot();
    assert(snapshot.lastEvents[0].type === 'scheduler_error', 'a scheduler_error debug event should be appended when work() throws');
    assert(snapshot.lastEvents[0].message.includes('failing'), 'the debug event message should include the failed operation label');
  })();

  // ─── scheduleShiftNotifications: lead-time math, filtering, EasyJet seconds ─
  await (async () => {
    const asyncStorage = makeAsyncStorageMock();
    const notifMock = makeNotificationsMock();
    const mocks = {
      '@react-native-async-storage/async-storage': asyncStorage,
      'expo-notifications': notifMock,
    };
    const scheduler = loadTsModule('src/utils/flightNotificationScheduler.ts', mocks);
    const notifDiag = loadTsModule('src/utils/notificationDiagnostics.ts', mocks);

    const nowSec = Math.floor(Date.now() / 1000);

    const easyJetArrival = {
      flight: {
        identification: { number: { default: 'U21234' } },
        airline: { name: 'easyJet', code: { iata: 'U2' } },
        airport: { origin: { code: { iata: 'BCN' }, name: 'Barcelona' } },
        time: { scheduled: { arrival: nowSec + 1805 }, estimated: {}, real: {} },
      },
    };
    const ryanairArrival = {
      flight: {
        identification: { number: { default: 'FR5678' } },
        airline: { name: 'Ryanair' },
        airport: { origin: { code: { iata: 'STN' }, name: 'London Stansted' } },
        time: { scheduled: { arrival: nowSec + 1200 }, estimated: {}, real: {} },
      },
    };
    const pastArrival = {
      flight: {
        identification: { number: { default: 'FR9999' } },
        airline: { name: 'Ryanair' },
        airport: { origin: { code: { iata: 'STN' }, name: 'London Stansted' } },
        time: { scheduled: { arrival: nowSec - 100 }, estimated: {}, real: {} },
      },
    };
    const wizzArrival = {
      flight: {
        identification: { number: { default: 'W61234' } },
        airline: { name: 'Wizz Air', code: { iata: 'W6' } },
        airport: { origin: { code: { iata: 'BUD' }, name: 'Budapest' } },
        time: { scheduled: { arrival: nowSec + 1200 }, estimated: {}, real: {} },
      },
    };
    const ryanairDeparture = {
      flight: {
        identification: { number: { default: 'FR1111' } },
        airline: { name: 'Ryanair' },
        airport: { destination: { code: { iata: 'BCN' }, name: 'Barcelona' } },
        time: { scheduled: { departure: nowSec + 1800 }, estimated: {}, real: {} },
      },
    };

    const settings = {
      onlyTrackedAirlines: true,
      includeArrivals: true,
      includeDepartures: true,
      includeShiftEnd: true,
      sticky: false,
      arrivalLeadMinutes: 15,
      departureLeadMinutes: 10,
    };
    const shiftEnd = nowSec + 3600;
    const selectedAirlines = ['ryanair', 'easyjet'];

    const scheduledCount = await scheduler.scheduleShiftNotifications(
      [easyJetArrival, ryanairArrival, pastArrival, wizzArrival],
      [ryanairDeparture],
      shiftEnd,
      'it-IT',
      settings,
      selectedAirlines,
    );

    assert(scheduledCount === 4, 'two arrivals, one departure and the shift-end notification should be scheduled (4 total)');

    const easyJetEntry = notifMock._scheduled.find(s => s.content.data.flightNumber === 'U21234');
    assert(easyJetEntry, 'easyJet arrival within the lead window and selected airlines should be scheduled');
    assert(easyJetEntry.content.title === 'Arrivo tra 15 min - U21234', 'arrival title should mention the lead time and flight number');
    const expectedEasyJetTime = new Date((nowSec + 1805) * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    assert(easyJetEntry.content.body.includes(expectedEasyJetTime), 'easyJet arrival body should include second-precision time');

    const ryanairEntry = notifMock._scheduled.find(s => s.content.data.flightNumber === 'FR5678');
    assert(ryanairEntry, 'Ryanair arrival within the lead window and selected airlines should be scheduled');
    const expectedRyanairTime = new Date((nowSec + 1200) * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    assert(ryanairEntry.content.body.includes(expectedRyanairTime), 'non-easyJet arrival body should include minute-precision time');
    assert((expectedRyanairTime.match(/:/g) || []).length === 1, 'non-easyJet arrival time should not include seconds');

    assert(!notifMock._scheduled.find(s => s.content.data.flightNumber === 'FR9999'), 'an arrival whose lead window has already passed should not be scheduled');
    assert(!notifMock._scheduled.find(s => s.content.data.flightNumber === 'W61234'), 'an airline not in selectedAirlines should be skipped when onlyTrackedAirlines is true');

    const depEntry = notifMock._scheduled.find(s => s.content.data.type === 'departure_shift');
    assert(depEntry, 'Ryanair departure within the lead window should be scheduled');
    assert(depEntry.content.title === 'Partenza tra 10 min - FR1111', 'departure title should mention the lead time and flight number');
    assert(depEntry.content.body.includes('BCN'), 'departure body should include the destination airport code');

    const endEntry = notifMock._scheduled.find(s => s.content.data.type === 'shift_end');
    assert(endEntry, 'a shift-end notification should be scheduled when includeShiftEnd is true and shiftEnd is in the future');
    assert(endEntry.content.title === 'Turno terminato', 'shift-end title should be "Turno terminato"');

    const savedIds = JSON.parse(await asyncStorage.getItem(notifDiag.NOTIF_IDS_KEY));
    assert(savedIds.length === 4, 'all scheduled notification IDs should be persisted under NOTIF_IDS_KEY');

    const snapshot = await notifDiag.getNotificationDebugSnapshot();
    assert(snapshot.lastEvents[0].type === 'schedule' && snapshot.lastEvents[0].scheduled === 4, 'a schedule debug event recording the scheduled count should be appended');
  })();

  // ─── schedulePinnedNotifications: multi-phase departures via airline ops ───
  await (async () => {
    const asyncStorage = makeAsyncStorageMock();
    const notifMock = makeNotificationsMock();
    const mocks = {
      '@react-native-async-storage/async-storage': asyncStorage,
      'expo-notifications': notifMock,
    };
    const scheduler = loadTsModule('src/utils/flightNotificationScheduler.ts', mocks);
    const notifDiag = loadTsModule('src/utils/notificationDiagnostics.ts', mocks);

    const nowSec = Math.floor(Date.now() / 1000);
    const settings = {
      onlyTrackedAirlines: true,
      includeArrivals: true,
      includeDepartures: true,
      includeShiftEnd: true,
      sticky: false,
      arrivalLeadMinutes: 15,
      departureLeadMinutes: 10,
    };

    const departure = {
      flight: {
        identification: { number: { default: 'FR2222' } },
        airline: { name: 'Ryanair' },
        airport: { destination: { code: { iata: 'STN' }, name: 'London Stansted' } },
        time: { scheduled: { departure: nowSec + 200 * 60 }, estimated: {}, real: {} },
      },
    };

    await scheduler.schedulePinnedNotifications(departure, 'departures', 'it-IT', settings);

    assert(notifMock._scheduled.length === 4, 'a far-future Ryanair departure should schedule all 4 phases (check-in, gate open, gate close, departure)');
    const types = notifMock._scheduled.map(s => s.content.data.type);
    for (const expected of ['pinned_checkin_open', 'pinned_gate_open', 'pinned_gate_close', 'pinned_departure']) {
      assert(types.includes(expected), `pinned departure phases should include ${expected}`);
    }
    assert(notifMock._scheduled.every(s => s.content.data.pinned === true), 'all pinned departure notifications should carry pinned:true');

    // Ryanair's checkInOpen offset is 150 minutes (vs default 120)
    const checkinEntry = notifMock._scheduled.find(s => s.content.data.type === 'pinned_checkin_open');
    const expectedSecs = (nowSec + 200 * 60) - 150 * 60 - nowSec;
    assert(Math.abs(checkinEntry.trigger.seconds - expectedSecs) <= 2, 'check-in-open phase should use Ryanair-specific 150-minute offset');

    const savedPinnedIds = JSON.parse(await asyncStorage.getItem(notifDiag.PINNED_NOTIF_IDS_KEY));
    assert(savedPinnedIds.length === 4, 'all 4 pinned notification IDs should be persisted under PINNED_NOTIF_IDS_KEY');
  })();

  // ─── schedulePinnedNotifications: single-phase arrivals ────────────────────
  await (async () => {
    const asyncStorage = makeAsyncStorageMock();
    const notifMock = makeNotificationsMock();
    const mocks = {
      '@react-native-async-storage/async-storage': asyncStorage,
      'expo-notifications': notifMock,
    };
    const scheduler = loadTsModule('src/utils/flightNotificationScheduler.ts', mocks);
    const notifDiag = loadTsModule('src/utils/notificationDiagnostics.ts', mocks);

    const nowSec = Math.floor(Date.now() / 1000);
    const settings = {
      onlyTrackedAirlines: true,
      includeArrivals: true,
      includeDepartures: true,
      includeShiftEnd: true,
      sticky: false,
      arrivalLeadMinutes: 15,
      departureLeadMinutes: 10,
    };

    const arrival = {
      flight: {
        identification: { number: { default: 'U23456' } },
        airline: { name: 'easyJet', code: { iata: 'U2' } },
        airport: { origin: { code: { iata: 'AMS' }, name: 'Amsterdam' } },
        time: { scheduled: { arrival: nowSec + 1805 }, estimated: {}, real: {} },
      },
    };

    await scheduler.schedulePinnedNotifications(arrival, 'arrivals', 'it-IT', settings);

    assert(notifMock._scheduled.length === 1, 'a pinned arrival should schedule exactly one notification');
    const entry = notifMock._scheduled[0];
    assert(entry.content.data.type === 'pinned_arrival' && entry.content.data.pinned === true, 'pinned arrival notification should be of type pinned_arrival');
    const expectedTime = new Date((nowSec + 1805) * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    assert(entry.content.body.includes(expectedTime), 'pinned easyJet arrival body should include second-precision time');

    const savedPinnedIds = JSON.parse(await asyncStorage.getItem(notifDiag.PINNED_NOTIF_IDS_KEY));
    assert(savedPinnedIds.length === 1, 'a single pinned notification ID should be persisted under PINNED_NOTIF_IDS_KEY');

    // A past arrival should schedule nothing and leave PINNED_NOTIF_IDS_KEY unset.
    const pastArrival = {
      flight: {
        identification: { number: { default: 'U29999' } },
        airline: { name: 'easyJet', code: { iata: 'U2' } },
        airport: { origin: { code: { iata: 'AMS' }, name: 'Amsterdam' } },
        time: { scheduled: { arrival: nowSec - 100 }, estimated: {}, real: {} },
      },
    };

    const asyncStorage2 = makeAsyncStorageMock();
    const notifMock2 = makeNotificationsMock();
    const mocks2 = {
      '@react-native-async-storage/async-storage': asyncStorage2,
      'expo-notifications': notifMock2,
    };
    const scheduler2 = loadTsModule('src/utils/flightNotificationScheduler.ts', mocks2);
    const notifDiag2 = loadTsModule('src/utils/notificationDiagnostics.ts', mocks2);

    await scheduler2.schedulePinnedNotifications(pastArrival, 'arrivals', 'it-IT', settings);
    assert(notifMock2._scheduled.length === 0, 'an arrival whose lead window has already passed should schedule nothing');
    assert(await asyncStorage2.getItem(notifDiag2.PINNED_NOTIF_IDS_KEY) === null, 'PINNED_NOTIF_IDS_KEY should not be written when nothing is scheduled');
  })();

  console.log('Notification scheduler test passed.');
}

main().catch(handleFailure);
