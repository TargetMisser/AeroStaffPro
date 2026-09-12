'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectObservation, observationKey, publicSnapshot, timeValue } = require('./reader.cjs');

const target = { flight: 'W45029', date: '2026-09-12', airport: 'PSA', legId: '419febbe' };
const cell = (text, timestamp, offset = '7200', links = []) => ({ text, timestamp, offset, links });
// Values observed in the visible W45029 flight row on 12 September 2026.
function capturedRow() {
  return { legIds: ['419febbe'], fields: {
    DATE: cell('12 Sep 2026', '1789201800'),
    FROM: cell('Tirana (TIA)', null, null, ['https://www.flightradar24.com/data/airports/tia']),
    TO: cell('Pisa (PSA)', null, null, ['https://www.flightradar24.com/data/airports/psa']),
    AIRCRAFT: cell('A321 (HA-LTD)', null),
    STA: cell('12:15', '1789208100'), STATUS: cell('Estimated 12:16', '1789208169'),
  } };
}
const capture = rows => ({ url: 'https://www.flightradar24.com/data/flights/w45029#419febbe', rows });
const readAt = '2026-09-12T09:53:00.000Z';

test('reads the observed 12:16 ETA separately from the 12:15 timetable', () => {
  const result = selectObservation(capture([capturedRow()]), target, readAt);
  assert.equal(result.scheduledArrival.clock, '12:15');
  assert.equal(result.estimatedArrival.clock, '12:16');
  assert.equal(result.estimatedArrival.iso, '2026-09-12T10:16:09.000Z');
  assert.equal(result.readAt, readAt);
  assert.equal(result.sourceUpdatedAt, null);
});

test('a neighbouring day and different leg cannot replace the selected service', () => {
  const yesterday = capturedRow();
  yesterday.fields.DATE = cell('11 Sep 2026', '1789115400');
  yesterday.legIds = ['419bc33e'];
  assert.equal(selectObservation(capture([yesterday, capturedRow()]), target).legId, '419febbe');
  assert.throws(() => selectObservation(capture([yesterday]), target), /assente/);
  const otherLeg = capturedRow(); otherLeg.legIds = ['419bc33e'];
  assert.throws(() => selectObservation(capture([otherLeg]), target), /assente/);
});

test('rejects ambiguous rotations, wrong destinations and wrong pages', () => {
  assert.throws(() => selectObservation(capture([capturedRow(), capturedRow()]), target), /ambiguità/);
  const otherAirport = capturedRow();
  otherAirport.fields.TO.links = ['https://www.flightradar24.com/data/airports/flr'];
  assert.throws(() => selectObservation(capture([otherAirport]), target), /assente/);
  assert.throws(() => selectObservation({ ...capture([]), url: 'https://www.flightradar24.com/login' }, target), /pagina/);
});

test('scheduled and delayed rows do not acquire a fabricated ETA', () => {
  for (const status of ['Scheduled', 'Delayed', 'Canceled']) {
    const row = capturedRow(); row.fields.STATUS = cell(status, null);
    const result = selectObservation(capture([row]), target);
    assert.equal(result.estimatedArrival, null);
    assert.equal(result.actualArrival, null);
  }
});

test('landing time is actual, never estimated', () => {
  const row = capturedRow(); row.fields.STATUS.text = 'Landed 12:16';
  const result = selectObservation(capture([row]), target);
  assert.equal(result.actualArrival.clock, '12:16');
  assert.equal(result.estimatedArrival, null);
});

test('reads the live FR6937 Delayed 14:33 status as an arrival estimate', () => {
  const row = capturedRow();
  row.legIds = ['41a057b6'];
  row.fields.DATE = cell('12 Sep 2026', '1789208400');
  row.fields.FROM.text = 'Lamezia Terme (SUF)';
  row.fields.STA = cell('13:45', '1789213500');
  row.fields.STATUS = cell('Delayed 14:33', '1789216411');
  const liveTarget = { ...target, flight: 'FR6937', legId: '41a057b6' };
  const liveCapture = { url: 'https://www.flightradar24.com/data/flights/fr6937#41a057b6', rows: [row] };
  const result = selectObservation(liveCapture, liveTarget);
  assert.equal(result.scheduledArrival.clock, '13:45');
  assert.equal(result.estimatedArrival.clock, '14:33');
  assert.equal(result.estimatedArrival.iso, '2026-09-12T12:33:31.000Z');
  assert.equal(result.actualArrival, null);
  row.fields.STATUS.timestamp = null;
  assert.throws(() => selectObservation(liveCapture, liveTarget), /certezza/);
  row.fields.STATUS = cell('Delayed 48 minutes', '1789216411');
  assert.equal(selectObservation(liveCapture, liveTarget).estimatedArrival, null);
});

test('rejects missing or inconsistent timestamp attributes', () => {
  const row = capturedRow(); row.fields.STATUS.timestamp = null;
  assert.throws(() => selectObservation(capture([row]), target), /certezza/);
  row.fields.STATUS = cell('Estimated 12:50', '1789208169');
  assert.throws(() => selectObservation(capture([row]), target), /certezza/);
});

test('preserves next-day arrival and timezone offsets, including a winter offset', () => {
  const nextDay = Date.parse('2026-09-12T22:20:00Z') / 1000;
  const time = timeValue(cell('Estimated 00:20', String(nextDay)));
  assert.equal(time.localDate, '2026-09-13');
  assert.equal(time.clock, '00:20');
  assert.equal(timeValue(cell('Estimated 12:20 AM', String(nextDay))).timestamp, nextDay);
  const winter = timeValue(cell('01:20', String(Date.parse('2026-12-12T00:20:00Z') / 1000), '3600'));
  assert.equal(winter.clock, '01:20');
});

test('reading the same ETA again does not count as a source change', () => {
  const first = selectObservation(capture([capturedRow()]), target, readAt);
  const second = { ...first, readAt: '2026-09-12T09:54:00.000Z' };
  assert.equal(observationKey(first), observationKey(second));
});

test('expired, failed and clock-skewed reads cannot be reported as current', () => {
  const observation = selectObservation(capture([capturedRow()]), target, readAt);
  const state = { observation, error: null, finished: false };
  assert.equal(publicSnapshot(state, Date.parse(readAt) + 60_000).readable, true);
  assert.equal(publicSnapshot(state, Date.parse(readAt) + 151_000).state, 'stale');
  assert.equal(publicSnapshot(state, Date.parse(readAt) - 1).readable, false);
  const failed = publicSnapshot({ ...state, error: 'Lettura interrotta' }, Date.parse(readAt) + 1);
  assert.equal(failed.readable, false);
  assert.equal(failed.observation.readAt, readAt);
  assert.equal(failed.sourceFreshness, 'unknown');
});
