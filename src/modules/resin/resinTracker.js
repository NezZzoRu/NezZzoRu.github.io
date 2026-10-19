import { createResinSnapshot, spendResin } from '../../core/resin.js';

function activeProfile(state) {
  return state.profiles.find(profile => profile.id === state.settings.activeProfileId) ?? state.profiles[0];
}
export function latestResinSnapshot(state) {
  const profile = activeProfile(state);
  // Порядок явных операций важнее часов: после ручной коррекции времени
  // последняя добавленная запись остаётся актуальной.
  return profile ? state.resinSnapshots.findLast(snapshot => snapshot.profileId === profile.id) ?? null : null;
}

export function recordResinMeasurement(state, amount, now, id = () => crypto.randomUUID()) {
  const snapshot = createResinSnapshot(amount, now);
  const next = structuredClone(state);
  let profile = activeProfile(next);
  if (!profile) {
    profile = { id: id(), name: 'Путешественник', server: 'europe' };
    next.profiles.push(profile);
  }
  next.settings.activeProfileId = profile.id;
  const snapshotId = id();
  if (next.resinSnapshots.some(record => record.id === snapshotId)) throw new Error('Идентификатор замера уже занят.');
  next.resinSnapshots.push({ id: snapshotId, profileId: profile.id, source: 'manual', ...snapshot });
  return next;
}

export function recordResinSpend(state, cost, now, id = () => crypto.randomUUID()) {
  const previous = latestResinSnapshot(state);
  if (!previous) throw new Error('Сначала сохраните количество смолы из игры.');
  const snapshot = spendResin(previous, cost, now);
  const snapshotId = id();
  if (state.resinSnapshots.some(record => record.id === snapshotId)) throw new Error('Идентификатор замера уже занят.');
  return {
    ...state,
    resinSnapshots: [...state.resinSnapshots, { id: snapshotId, profileId: previous.profileId, source: 'spend', spent: cost, ...snapshot }],
  };
}
