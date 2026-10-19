import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, createInitialState, validateState, STORAGE_KEY, COLLECTIONS } from '../src/modules/storage/storage.js';
import { savePersonalTask } from '../src/core/personalTasks.js';

function memoryStorage(raw = null) {
  const values = new Map(raw === null ? [] : [[STORAGE_KEY, raw]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('новое хранилище создаёт независимые коллекции версии 1', () => {
  const storage = createStorage(() => memoryStorage());
  const result = storage.load();
  assert.equal(result.isNew, true);
  assert.equal(result.data.schemaVersion, 1);
  assert.deepEqual(result.data.settings, { theme: 'light', lastPage: 'overview' });
  for (const name of COLLECTIONS) assert.deepEqual(result.data[name], []);
  const other = createInitialState();
  result.data.profiles.push({ id: 'p1' });
  assert.deepEqual(other.profiles, []);
});

test('настройки восстанавливаются новым экземпляром и сохраняют игровые данные', () => {
  const adapter = memoryStorage();
  const storage = createStorage(() => adapter);
  let state = createInitialState();
  state.profiles.push({ id: 'p1', name: 'Путешественник' });
  state = savePersonalTask(state, { title: 'Пример', category: 'другое', priority: 'normal', status: 'planned', dueDate: null, notes: '' }, Date.parse('2026-10-19T00:00:00Z'), null, () => 't1');
  state.settings.futureSetting = 'preserve';
  assert.equal(storage.save(state).ok, true);
  assert.equal(storage.updateSettings({ theme: 'dark', lastPage: 'goals' }).ok, true);
  const restored = createStorage(() => adapter).load();
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.data.personalTasks, state.personalTasks);
  assert.deepEqual(restored.data.settings, { ...state.settings, theme: 'dark', lastPage: 'goals' });
});

for (const [label, raw, expected] of [
  ['повреждённый JSON', '{broken', 'invalid-json'],
  ['новая версия', JSON.stringify({ ...createInitialState(), schemaVersion: 2 }), 'unsupported-version'],
  ['неверная структура', JSON.stringify({ ...createInitialState(), characters: {} }), 'invalid-data'],
]) {
  test(`${label}: ошибка чтения и запрет перезаписи оригинала`, () => {
    const adapter = memoryStorage(raw);
    const storage = createStorage(() => adapter);
    assert.equal(storage.load().error, expected);
    assert.equal(storage.save(createInitialState()).ok, false);
    assert.equal(storage.updateSettings({ theme: 'dark' }).ok, false);
    assert.equal(adapter.getItem(STORAGE_KEY), raw);
  });
}

test('ошибка получения localStorage не выходит наружу', () => {
  const storage = createStorage(() => { throw new Error('SecurityError'); });
  assert.equal(storage.load().error, 'read-unavailable');
  assert.equal(storage.updateSettings({ theme: 'dark' }).ok, false);
});

for (const name of ['QuotaExceededError', 'SecurityError']) {
  test(`ошибка записи ${name} возвращается безопасно, старые данные остаются`, () => {
    const raw = JSON.stringify(createInitialState());
    const adapter = memoryStorage(raw);
    adapter.setItem = () => { const error = new Error('blocked'); error.name = name; throw error; };
    const result = createStorage(() => adapter).updateSettings({ theme: 'dark' });
    assert.equal(result.error, name === 'QuotaExceededError' ? 'quota-exceeded' : 'write-unavailable');
    assert.equal(adapter.getItem(STORAGE_KEY), raw);
  });
}

test('валидация отклоняет неверные настройки, коллекции, ID и ссылки профилей', () => {
  for (const modify of [
    state => { state.settings.theme = 'unknown'; },
    state => { state.settings.lastPage = '<script>'; },
    state => { state.profiles = null; },
    state => { state.profiles = [{ id: '' }]; },
    state => { state.profiles = [{ id: 'x' }, { id: 'x' }]; },
    state => { state.personalTasks = [{ id: 'task', profileId: 'missing' }]; },
  ]) {
    const state = createInitialState();
    modify(state);
    assert.equal(validateState(state).ok, false);
  }
});

test('невалидная запись не изменяет сохранённый документ', () => {
  const raw = JSON.stringify(createInitialState());
  const adapter = memoryStorage(raw);
  const storage = createStorage(() => adapter);
  assert.equal(storage.updateSettings({ theme: 'invalid' }).ok, false);
  assert.equal(adapter.getItem(STORAGE_KEY), raw);
});
