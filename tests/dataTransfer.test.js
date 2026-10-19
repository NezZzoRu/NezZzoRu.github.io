import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, createInitialState, validateState, STORAGE_KEY, BACKUP_KEY } from '../src/modules/storage/storage.js';
import { parseImport, serializeExport, MAX_IMPORT_BYTES } from '../src/modules/storage/dataTransfer.js';
import { changeServer } from '../src/core/settings.js';
import { savePersonalTask } from '../src/core/personalTasks.js';
import { saveCharacter, saveMaterial, saveFarmPlan, toggleFarmPlan } from '../src/core/charactersFarm.js';
import { initializeRoutine, adjustCompletion } from '../src/modules/routine/routine.js';
import { recordResinMeasurement } from '../src/modules/resin/resinTracker.js';
import { getPeriod } from '../src/modules/time/gameClock.js';

const now = Date.parse('2026-10-19T12:00:00Z');
let sequence = 0;
const id = () => `transfer-${++sequence}`;
function fixture() {
  let { state, profileId } = initializeRoutine(createInitialState(), id);
  state = adjustCompletion(state, profileId, state.taskTemplates[0].id, 1, now, getPeriod('europe', 'daily', now).periodKey, id);
  state = savePersonalTask(state, { title: 'Квест', category: 'моё', status: 'completed', priority: 'high', dueDate: '2026-11-01', notes: 'Заметки' }, now, null, id);
  state = saveCharacter(state, { name: 'Герой', targetLevel: 90, notes: '' }, null, id);
  state = saveMaterial(state, state.characters[0].id, { name: 'Кристалл', owned: 2, needed: 10, days: [1, 3, 7] }, null, id);
  state = saveFarmPlan(state, { title: 'Собрать', notes: '', materialGoalId: state.materialGoals[0].id, days: [1] }, null, id);
  state = toggleFarmPlan(state, state.farmPlans[0].id, now);
  return recordResinMeasurement(state, 100, now, id);
}
function adapter(initial) {
  const values = new Map(initial === null ? [] : [[STORAGE_KEY, JSON.stringify(initial)]]);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('экспорт/импорт сохраняют все коллекции, профили, настройки и дополнительные безопасные поля', () => {
  const data = fixture(); data.settings.futureSetting = { safe: [true, 'данные'] };
  const parsed = parseImport(serializeExport(data));
  assert.equal(parsed.ok, true); assert.deepEqual(parsed.data, data);
});

test('повреждённый JSON, чужая версия и слишком большой файл отклоняются', () => {
  assert.equal(parseImport('{bad').error, 'invalid-json');
  assert.equal(parseImport(JSON.stringify({ ...createInitialState(), schemaVersion: 2 })).error, 'unsupported-version');
  assert.equal(parseImport(' '.repeat(MAX_IMPORT_BYTES + 1)).error, 'file-too-large');
  for (const text of ['null', '[]', '123', '"string"']) assert.equal(parseImport(text).ok, false);
});

test('проверка типов, идентификаторов и всех ссылок не пропускает повреждённые коллекции', () => {
  const original = fixture();
  for (const change of [
    s => { s.profiles[0].id = '<img src=x>'; },
    s => { s.profiles[0].name = {}; },
    s => { s.profiles[0].server = 'invalid'; },
    s => { s.profiles.push({ ...s.profiles[0] }); },
    s => { s.characters[0].profileId = 'missing'; },
    s => { s.personalTasks[0].priority = 3; },
    s => { s.completions[0].count = '1'; },
    s => { s.completions[0].templateId = 'bad id'; },
    s => { s.materialGoals[0].characterId = 'missing'; },
    s => { s.farmPlans[0].materialGoalId = 'missing'; },
    s => { s.resinSnapshots[0].amount = -1; },
    s => { s.settings.activeProfileId = 'missing'; },
  ]) {
    const data = structuredClone(original); change(data);
    assert.equal(parseImport(JSON.stringify(data)).ok, false);
  }
});

test('история удалённого шаблона разрешена, ссылка на шаблон другого профиля запрещена', () => {
  const state = fixture(); const templateId = state.completions[0].templateId;
  const deleted = { ...state, taskTemplates: state.taskTemplates.filter(template => template.id !== templateId) };
  assert.equal(parseImport(serializeExport(deleted)).ok, true);
  state.profiles.push({ id: 'other', name: 'Другой', server: 'asia' });
  state.taskTemplates.find(template => template.id === templateId).profileId = 'other';
  assert.equal(validateState(state).ok, false);
});

test('опасные ключи, глубокие структуры, циклы и не-JSON значения не допускаются', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const state = fixture(); state.settings.extra = JSON.parse(`{"${key}": {"polluted": true}}`);
    assert.equal(parseImport(JSON.stringify(state)).ok, false);
    assert.equal({}.polluted, undefined);
  }
  const deep = fixture(); let node = deep.settings;
  for (let i = 0; i < 40; i++) { node.extra = {}; node = node.extra; }
  assert.equal(validateState(deep).ok, false);
  const cycle = fixture(); cycle.settings.extra = cycle;
  assert.equal(validateState(cycle).ok, false);
  const invalid = fixture(); invalid.settings.extra = Infinity;
  assert.equal(validateState(invalid).ok, false);
  invalid.settings.extra = () => 1;
  assert.equal(validateState(invalid).ok, false);
});

test('предпросмотр не пишет данные, а подтверждённый импорт сначала создаёт копию', () => {
  const original = fixture(), incoming = createInitialState(), memory = adapter(original);
  const storage = createStorage(() => memory), raw = memory.getItem(STORAGE_KEY), writes = [];
  const parsed = parseImport(serializeExport(incoming));
  assert.equal(memory.getItem(STORAGE_KEY), raw); assert.equal(memory.getItem(BACKUP_KEY), null);
  const write = memory.setItem; memory.setItem = (key, value) => { writes.push(key); write(key, value); };
  const result = storage.replaceWithBackup(parsed.data, original, raw, now);
  assert.equal(result.ok, true); assert.deepEqual(writes, [BACKUP_KEY, STORAGE_KEY]);
  assert.deepEqual(storage.load().data, incoming);
  assert.deepEqual(storage.loadBackup().backup.data, original);
  assert.equal(storage.loadBackup().backup.createdAt, '2026-10-19T12:00:00.000Z');
  assert.equal(storage.loadBackup().backup.previousStoredRaw, null);
});

test('ошибка создания копии останавливает импорт без изменений основного JSON и старой копии', () => {
  const original = fixture(), memory = adapter(original), storage = createStorage(() => memory);
  memory.values.set(BACKUP_KEY, 'old-backup');
  const raw = memory.getItem(STORAGE_KEY), write = memory.setItem;
  memory.setItem = (key, value) => { if (key === BACKUP_KEY) throw new Error('QuotaExceeded'); write(key, value); };
  assert.equal(storage.replaceWithBackup(createInitialState(), original, raw, now).error, 'backup-failed');
  assert.equal(memory.getItem(STORAGE_KEY), raw); assert.equal(memory.getItem(BACKUP_KEY), 'old-backup');
});

test('ошибка записи после копирования сохраняет рабочие данные и доступную копию', () => {
  const original = fixture(), memory = adapter(original), storage = createStorage(() => memory), raw = memory.getItem(STORAGE_KEY);
  const write = memory.setItem;
  memory.setItem = (key, value) => { if (key === STORAGE_KEY) throw new Error('write blocked'); write(key, value); };
  const result = storage.replaceWithBackup(createInitialState(), original, raw, now);
  assert.equal(result.error, 'replacement-failed'); assert.equal(result.backupCreated, true);
  assert.equal(memory.getItem(STORAGE_KEY), raw); assert.deepEqual(storage.loadBackup().backup.data, original);
});

test('изменение данных после предпросмотра или во время копирования прерывает замену', () => {
  const original = fixture(), memory = adapter(original), storage = createStorage(() => memory), raw = memory.getItem(STORAGE_KEY);
  memory.values.set(STORAGE_KEY, JSON.stringify(createInitialState()));
  assert.equal(storage.replaceWithBackup(createInitialState(), original, raw, now).error, 'stale-preview');
  assert.equal(memory.getItem(BACKUP_KEY), null);
  memory.values.set(STORAGE_KEY, raw);
  const write = memory.setItem;
  memory.setItem = (key, value) => { write(key, value); if (key === BACKUP_KEY) memory.values.set(STORAGE_KEY, 'other-tab'); };
  assert.equal(storage.replaceWithBackup(createInitialState(), original, raw, now).error, 'stale-preview');
  assert.equal(memory.getItem(STORAGE_KEY), 'other-tab');
});

test('обычная запись с устаревшим состоянием не затирает другую вкладку', () => {
  const original = fixture(), memory = adapter(original), storage = createStorage(() => memory), raw = memory.getItem(STORAGE_KEY);
  const other = JSON.stringify(createInitialState()); memory.values.set(STORAGE_KEY, other);
  assert.equal(storage.save(original, { expectedRaw: raw }).error, 'external-change');
  assert.equal(memory.getItem(STORAGE_KEY), other);
});

test('неверный импорт не создаёт копии и не меняет рабочие данные', () => {
  const original = fixture(), memory = adapter(original), storage = createStorage(() => memory), raw = memory.getItem(STORAGE_KEY);
  assert.equal(storage.replaceWithBackup({ schemaVersion: 2 }, original, raw, now).ok, false);
  assert.equal(memory.getItem(STORAGE_KEY), raw); assert.equal(memory.getItem(BACKUP_KEY), null);
});

test('явное восстановление повреждённой записи сохраняет её исходный текст в резервной копии', () => {
  const memory = adapter(null), storage = createStorage(() => memory);
  memory.values.set(STORAGE_KEY, '{broken');
  const result = storage.replaceWithBackup(fixture(), createInitialState(), '{broken', now);
  assert.equal(result.ok, true); assert.equal(storage.loadBackup().backup.previousStoredRaw, '{broken');
});

test('резервная копия сохраняет несохранённые данные памяти и отличающуюся запись диска', () => {
  const original = fixture(), memory = adapter(original), storage = createStorage(() => memory), raw = memory.getItem(STORAGE_KEY);
  const pending = structuredClone(original); pending.settings.theme = 'dark';
  assert.equal(storage.replaceWithBackup(createInitialState(), pending, raw, now).ok, true);
  assert.deepEqual(storage.loadBackup().backup.data, pending);
  assert.equal(storage.loadBackup().backup.previousStoredRaw, raw);
});

test('очистка рабочих данных подтверждённой операцией сохраняет копию для восстановления', () => {
  const original = fixture(), memory = adapter(original), storage = createStorage(() => memory), raw = memory.getItem(STORAGE_KEY);
  assert.equal(storage.replaceWithBackup(createInitialState(), original, raw, now, 'before-delete').ok, true);
  assert.equal(storage.load().data.profiles.length, 0);
  assert.equal(storage.loadBackup().backup.reason, 'before-delete');
  assert.deepEqual(storage.loadBackup().backup.data, original);
});

test('недоступное хранилище и повреждённая копия возвращают ошибки, не выполняя замену', () => {
  const storage = createStorage(() => { throw new Error('SecurityError'); });
  assert.equal(storage.readRaw().ok, false); assert.equal(storage.loadBackup().ok, false);
  assert.equal(storage.replaceWithBackup(createInitialState(), createInitialState(), null, now).ok, false);
  const memory = adapter(null); memory.values.set(BACKUP_KEY, '{}');
  assert.equal(createStorage(() => memory).loadBackup().ok, false);
});

test('выбор сервера создаёт только профиль и не меняет коллекции истории и смолы', () => {
  const blank = changeServer(createInitialState(), 'asia', id);
  assert.equal(blank.profiles[0].server, 'asia'); assert.equal(blank.taskTemplates.length, 0);
  const original = fixture(), changed = changeServer(original, 'america', id);
  assert.deepEqual(changed.completions, original.completions); assert.deepEqual(changed.resinSnapshots, original.resinSnapshots);
  assert.equal(original.profiles[0].server, 'europe'); assert.equal(changed.profiles[0].server, 'america');
  assert.throws(() => changeServer(original, '__proto__', id));
});
