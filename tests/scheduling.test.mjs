import test from 'node:test';
import assert from 'node:assert/strict';
import { availabilityShade, expiration, dateEnd, validateDays, validateAvailability, recommendations, canonicalNickname, DAY_MS } from '../lib/scheduling.ts';
const created=Date.parse('2026-10-28T12:00:00+09:00');
test('expiry follows the last candidate day, including dates beyond 30 days',()=>{assert.equal(expiration([{date:'2026-10-30',slots:[18]}],created),dateEnd('2026-10-30'));assert.equal(expiration([{date:'2026-12-01',slots:[18]}],created),dateEnd('2026-12-01'));});
test('rejects dates outside retention and impossible dates',()=>{assert.throws(()=>validateDays([{date:'2027-01-29',slots:[18]}],created,created));assert.throws(()=>validateDays([{date:'2026-11-31',slots:[18]}],created,created));assert.throws(()=>validateDays([{date:'2026-10-27',slots:[18]}],created,created));assert.deepEqual(validateDays([{date:'2026-11-26',slots:[19,18,19]}],created,created),[{date:'2026-11-26',slots:[18,19]}]);});
test('cannot answer outside owner candidates; explicit unavailability stays distinct',()=>{const days=[{date:'2026-10-29',slots:[18,19]}];assert.throws(()=>validateAvailability({'2026-10-29':[20]},days));assert.deepEqual(validateAvailability({'2026-10-29':[]},days),{'2026-10-29':[]});assert.deepEqual(validateAvailability({},days),{});});
test('a 60-minute recommendation intersects participants across both half-hours',()=>{const event={dates:[{date:'2026-10-29',slots:[18,19,21]}],duration:60};const members=[{role:'participant',availability:{'2026-10-29':[18]}},{role:'participant',availability:{'2026-10-29':[19]}},{role:'participant',availability:{'2026-10-29':[18,19]}}];assert.deepEqual(recommendations(event,members),[{date:'2026-10-29',start:18,end:20,count:1}]);});
test('nickname normalization and forbidden invisible characters',()=>{assert.equal(canonicalNickname(' ｈａｒｕ '),'haru');assert.throws(()=>canonicalNickname('a\u200bb'));});

test('timeline shading reserves its strongest color for all participants', () => {
  assert.equal(availabilityShade(0, 0), '');
  assert.equal(availabilityShade(0, 1), '');
  assert.equal(availabilityShade(1, 1), 'overlap-all');
  assert.equal(availabilityShade(3, 6), 'overlap-some');
  assert.equal(availabilityShade(4, 6), 'overlap-majority');
  assert.equal(availabilityShade(5, 6), 'overlap-majority');
  assert.equal(availabilityShade(6, 6), 'overlap-all');
});

test('late and early answers retain their event dates and are not joined into a recommendation', () => {
  const date = '2026-10-29';
  const next = '2026-10-30';
  const dates = [{ date, slots: [46, 47] }, { date: next, slots: [0, 1] }];
  const availability = { [date]: [46, 47], [next]: [0, 1] };
  assert.deepEqual(validateAvailability(availability, dates), availability);
  const members = [{ role: 'participant', availability }];
  assert.deepEqual(recommendations({ dates, duration: 120 }, members), []);
  assert.deepEqual(recommendations({ dates, duration: 60 }, members), [
    { date, start: 46, end: 48, count: 1 },
    { date: next, start: 0, end: 2, count: 1 },
  ]);
});
