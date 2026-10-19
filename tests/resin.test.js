import test from 'node:test';
import assert from 'node:assert/strict';
import { RESIN_INTERVAL_MS as STEP, createResinSnapshot, calculateResin, spendResin, isResinSnapshot } from '../src/core/resin.js';
import { latestResinSnapshot, recordResinMeasurement, recordResinSpend } from '../src/modules/resin/resinTracker.js';
import { createInitialState, createStorage, validateState, STORAGE_KEY } from '../src/modules/storage/storage.js';

const start = Date.parse('2026-10-19T00:00:00Z');
let sequence = 0;
const id = () => `resin-${++sequence}`;

test('одна единица восстанавливается ровно через восемь минут', () => {
  const snapshot = createResinSnapshot(50, start);
  assert.equal(calculateResin(snapshot, start + STEP - 1).amount, 50);
  const result = calculateResin(snapshot, start + STEP);
  assert.equal(result.amount, 51);
  assert.equal(result.progressMs, 0);
  assert.equal(result.nextPointMs, STEP);
  assert.equal(calculateResin(snapshot, start + 2 * STEP).amount, 52);
});

test('количество ограничено 200, время до заполнения и шкала согласованы', () => {
  const snapshot = createResinSnapshot(199, start);
  assert.equal(calculateResin(snapshot, start + STEP - 1).remainingMs, 1);
  assert.equal(calculateResin(snapshot, start + STEP - 1).fullAt, start + STEP);
  const full = calculateResin(snapshot, start + STEP);
  assert.equal(full.amount, 200);
  assert.equal(full.remainingMs, 0);
  assert.equal(full.nextPointMs, null);
  assert.equal(full.progressMs, 0);
  assert.equal(calculateResin(createResinSnapshot(200, start), start + STEP).amount, 200);
});

test('после длительного отсутствия восстанавливается максимум 200, замер не меняется', () => {
  const snapshot = createResinSnapshot(0, start);
  const original = structuredClone(snapshot);
  const result = calculateResin(snapshot, start + 365 * 86400000);
  assert.equal(result.amount, 200);
  assert.equal(result.progressMs, 0);
  assert.deepEqual(snapshot, original);
});

test('время до заполнения учитывает неполный интервал', () => {
  const snapshot = createResinSnapshot(100, start);
  const result = calculateResin(snapshot, start + 4 * 60000);
  assert.equal(result.amount, 100);
  assert.equal(result.remainingMs, 100 * STEP - 4 * 60000);
  assert.equal(result.fullAt, start + 100 * STEP);
  assert.equal(result.nextPointMs, 4 * 60000);
});

test('расход вычитается из восстановленного количества, а не из старого замера', () => {
  const snapshot = createResinSnapshot(40, start);
  const spent = spendResin(snapshot, 41, start + STEP);
  assert.equal(spent.amount, 0);
  assert.equal(spent.measuredAt, '2026-10-19T00:08:00.000Z');
  assert.equal(calculateResin(spent, start + 2 * STEP).amount, 1);
  assert.equal(snapshot.amount, 40);
});

test('расход сохраняет остаток интервала, повторный расход не начисляет смолу', () => {
  const snapshot = createResinSnapshot(100, start);
  const firstSpend = spendResin(snapshot, 20, start + 12 * 60000);
  assert.equal(firstSpend.amount, 81);
  assert.equal(firstSpend.progressMs, 4 * 60000);
  const secondSpend = spendResin(firstSpend, 1, start + 12 * 60000);
  assert.equal(secondSpend.amount, 80);
  assert.equal(calculateResin(secondSpend, start + 16 * 60000 - 1).amount, 80);
  assert.equal(calculateResin(secondSpend, start + 16 * 60000).amount, 81);
});

test('время на лимите не накапливается для восстановления после расхода', () => {
  const snapshot = createResinSnapshot(199, start);
  const spendTime = start + 2 * 86400000 + 1234;
  const spent = spendResin(snapshot, 40, spendTime);
  assert.equal(spent.amount, 160);
  assert.equal(spent.progressMs, 0);
  assert.equal(calculateResin(spent, spendTime + STEP - 1).amount, 160);
  assert.equal(calculateResin(spent, spendTime + STEP).amount, 161);
});

test('ручная коррекция начинает новый замер без накопленного остатка', () => {
  let state = recordResinMeasurement(createInitialState(), 100, start, id);
  state = recordResinSpend(state, 20, start + 4 * 60000, id);
  const originalRecords = structuredClone(state.resinSnapshots);
  state = recordResinMeasurement(state, 70, start + 5 * 60000, id);
  const corrected = latestResinSnapshot(state);
  assert.equal(corrected.progressMs, 0);
  assert.equal(calculateResin(corrected, start + 12 * 60000).amount, 70);
  assert.equal(calculateResin(corrected, start + 13 * 60000).amount, 71);
  assert.deepEqual(state.resinSnapshots.slice(0, 2), originalRecords);
});

test('неверное количество, расход и нехватка смолы отклоняются', () => {
  for (const amount of [-1, 201, 1.5, NaN, Infinity, '50', null, undefined]) {
    assert.throws(() => createResinSnapshot(amount, start), RangeError);
  }
  const snapshot = createResinSnapshot(20, start);
  for (const cost of [0, -1, 201, 0.5, NaN, Infinity, '20', null, 21]) {
    assert.throws(() => spendResin(snapshot, cost, start), RangeError);
  }
  assert.equal(createResinSnapshot(0, start).amount, 0);
  assert.equal(spendResin(snapshot, 20, start).amount, 0);
});

test('некорректные часы, UTC-строки и замеры отклоняются', () => {
  for (const time of [NaN, Infinity, '2026-10-19', null, 0.5, new Date('invalid'), 1e20]) {
    assert.throws(() => createResinSnapshot(10, time), RangeError);
    assert.throws(() => calculateResin(createResinSnapshot(10, start), time), RangeError);
  }
  for (const snapshot of [null, {}, [], { amount: 10, measuredAt: 'invalid', progressMs: 0 },
    { amount: 10, measuredAt: '2026-10-19T00:00:00+00:00', progressMs: 0 },
    { amount: 10, measuredAt: new Date(start).toISOString(), progressMs: STEP },
    { amount: 200, measuredAt: new Date(start).toISOString(), progressMs: 1 }]) {
    assert.equal(isResinSnapshot(snapshot), false);
    assert.throws(() => calculateResin(snapshot, start), RangeError);
  }
});

test('откат часов не уменьшает смолу и блокирует расход до коррекции', () => {
  const snapshot = createResinSnapshot(50, start);
  const result = calculateResin(snapshot, start - 1);
  assert.equal(result.amount, 50);
  assert.equal(result.clockSkew, true);
  assert.equal(result.remainingMs, null);
  assert.throws(() => spendResin(snapshot, 20, start - 1), /будущем/);
  assert.equal(calculateResin(createResinSnapshot(30, start - 1), start - 1).clockSkew, false);
});

test('перезагрузка и повторное чтение не вызывают двойного начисления', () => {
  let raw = null;
  const adapter = { getItem: key => key === STORAGE_KEY ? raw : null, setItem: (_, value) => { raw = value; } };
  const state = recordResinMeasurement(createInitialState(), 10, start, id);
  assert.equal(createStorage(() => adapter).save(state).ok, true);
  const original = raw;
  for (let reload = 0; reload < 3; reload++) {
    const restored = createStorage(() => adapter).load().data;
    assert.equal(calculateResin(latestResinSnapshot(restored), start + STEP).amount, 11);
    assert.equal(raw, original);
    assert.equal(restored.resinSnapshots.length, 1);
  }
  const loaded = createStorage(() => adapter).load().data;
  const spent = recordResinSpend(loaded, 1, start + STEP + STEP / 2, id);
  assert.equal(createStorage(() => adapter).save(spent).ok, true);
  const restored = createStorage(() => adapter).load().data;
  assert.equal(calculateResin(latestResinSnapshot(restored), start + STEP + STEP / 2).amount, 10);
  assert.equal(calculateResin(latestResinSnapshot(restored), start + 2 * STEP).amount, 11);
});

test('замер сохраняется в UTC и создаёт профиль без демонстрационной рутины', () => {
  const initial = createInitialState();
  const state = recordResinMeasurement(initial, 70, new Date('2026-10-19T08:00:00+08:00'), id);
  const record = latestResinSnapshot(state);
  assert.equal(record.measuredAt, '2026-10-19T00:00:00.000Z');
  assert.equal(state.taskTemplates.length, 0);
  assert.equal(state.profiles.length, 1);
  assert.equal(initial.profiles.length, 0);
  assert.equal(validateState(state).ok, true);
  assert.throws(() => recordResinSpend(initial, 20, start, id), /Сначала/);
});

test('замеры изолированы по профилям; последняя коррекция важнее порядка UTC-дат', () => {
  let state = recordResinMeasurement(createInitialState(), 90, start, id);
  const firstProfile = state.settings.activeProfileId;
  state.profiles.push({ id: 'other', name: 'Другой', server: 'asia' });
  state.settings.activeProfileId = 'other';
  assert.equal(latestResinSnapshot(state), null);
  state = recordResinMeasurement(state, 30, start, id);
  assert.equal(latestResinSnapshot(state).amount, 30);
  state.settings.activeProfileId = firstProfile;
  assert.equal(latestResinSnapshot(state).amount, 90);
  state = recordResinMeasurement(state, 60, start - STEP, id);
  assert.equal(latestResinSnapshot(state).amount, 60);
  assert.equal(validateState(state).ok, true);
});

test('хранилище отклоняет испорченные записи смолы без перезаписи оригинала', () => {
  const original = recordResinMeasurement(createInitialState(), 100, start, id);
  for (const mutate of [
    record => { record.amount = 201; },
    record => { record.amount = -1; },
    record => { record.progressMs = STEP; },
    record => { record.progressMs = 1; },
    record => { record.measuredAt = 'invalid'; },
    record => { record.source = 'unknown'; },
    record => { record.source = 'spend'; record.spent = 0; },
  ]) {
    const invalid = structuredClone(original);
    mutate(invalid.resinSnapshots[0]);
    assert.equal(validateState(invalid).ok, false);
    const raw = JSON.stringify(invalid);
    let changed = false;
    const storage = createStorage(() => ({ getItem: () => raw, setItem: () => { changed = true; } }));
    assert.equal(storage.load().ok, false);
    assert.equal(storage.save(original).ok, false);
    assert.equal(changed, false);
  }
});
