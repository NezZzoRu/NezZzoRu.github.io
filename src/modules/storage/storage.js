import { isPeriodKey, SERVERS } from '../time/gameClock.js';
import { validateTemplateFields } from '../routine/routine.js';
import { isResinSnapshot, RESIN_CAP } from '../../core/resin.js';
import { validPlannerRelations } from '../../core/charactersFarm.js';
import { validPersonalTask, validCategory, validGoalFilters, isUtc } from '../../core/personalTasks.js';
import { isSafeJson, validId } from '../../core/jsonSafety.js';

export const STORAGE_KEY = 'teyvat-tasks:v1';
export const BACKUP_KEY = 'teyvat-tasks:backup:v1';
export const PAGES = Object.freeze(['overview', 'routine', 'characters', 'farm', 'goals', 'statistics', 'settings']);
export const COLLECTIONS = Object.freeze([
  'profiles', 'taskTemplates', 'completions', 'personalTasks',
  'characters', 'materialGoals', 'farmPlans', 'resinSnapshots',
]);

export function createInitialState() {
  return {
    schemaVersion: 1,
    settings: { theme: 'light', lastPage: 'overview' },
    ...Object.fromEntries(COLLECTIONS.map(name => [name, []])),
  };
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Поля и связи версии 1 проверяются также при чтении и импорте.
export function validateState(value) {
  if (!isObject(value) || !isSafeJson(value)) return { ok: false, code: 'invalid-data' };
  if (value.schemaVersion !== 1) return { ok: false, code: 'unsupported-version' };
  if (!isObject(value.settings)
    || !['light', 'dark'].includes(value.settings.theme)
    || !PAGES.includes(value.settings.lastPage)) return { ok: false, code: 'invalid-data' };
  for (const name of COLLECTIONS) {
    if (!Array.isArray(value[name])) return { ok: false, code: 'invalid-data' };
    const ids = new Set();
    for (const record of value[name]) {
      if (!isObject(record) || !validId(record.id) || ids.has(record.id)) {
        return { ok: false, code: 'invalid-data' };
      }
      ids.add(record.id);
    }
  }
  const profiles = new Set(value.profiles.map(profile => profile.id));
  for (const name of COLLECTIONS.filter(name => name !== 'profiles')) {
    if (value[name].some(record => !profiles.has(record.profileId))) return { ok: false, code: 'invalid-data' };
  }
  if (value.profiles.some(profile => (profile.server !== undefined && !Object.hasOwn(SERVERS, profile.server))
    || (profile.name !== undefined && (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 100))
    || (profile.routineSeeded !== undefined && typeof profile.routineSeeded !== 'boolean'))) return { ok: false, code: 'invalid-data' };
  if (value.settings.activeProfileId !== undefined && !profiles.has(value.settings.activeProfileId)) return { ok: false, code: 'invalid-data' };
  if (value.settings.farmFilter !== undefined && !['today', 'tomorrow', 'week'].includes(value.settings.farmFilter)) return { ok: false, code: 'invalid-data' };
  if (value.settings.goalFilters !== undefined && !validGoalFilters(value.settings.goalFilters)) return { ok: false, code: 'invalid-data' };
  if (value.profiles.some(profile => profile.personalCategories !== undefined && (!Array.isArray(profile.personalCategories)
    || profile.personalCategories.some(category => !validCategory(category)) || new Set(profile.personalCategories).size !== profile.personalCategories.length))) return { ok: false, code: 'invalid-data' };
  if (value.personalTasks.some(task => !validPersonalTask(task))) return { ok: false, code: 'invalid-data' };
  if (value.taskTemplates.some(template => !validateTemplateFields(template))) return { ok: false, code: 'invalid-data' };
  const completionKeys = new Set();
  for (const record of value.completions) {
    const key = JSON.stringify([record.profileId, record.templateId, record.periodKey]);
    if (!validId(record.templateId) || !isPeriodKey(record.periodKey)
      || typeof record.title !== 'string' || !record.title.trim() || record.title.length > 100
      || !Number.isInteger(record.target) || record.target < 1 || record.target > 999
      || !Number.isInteger(record.count) || record.count < 0 || record.count > record.target
      || !isUtc(record.createdAt) || !isUtc(record.updatedAt)
      || completionKeys.has(key)) return { ok: false, code: 'invalid-data' };
    const template = value.taskTemplates.find(template => template.id === record.templateId);
    if (template && template.profileId !== record.profileId) return { ok: false, code: 'invalid-data' };
    if (record.actionTimes !== undefined && (!Array.isArray(record.actionTimes) || record.actionTimes.length > record.count || record.actionTimes.some(time => !isUtc(time)))) return { ok: false, code: 'invalid-data' };
    completionKeys.add(key);
  }
  if (value.resinSnapshots.some(snapshot => !isResinSnapshot(snapshot)
    || !['manual', 'spend'].includes(snapshot.source)
    || (snapshot.source === 'manual' && snapshot.progressMs !== 0)
    || (snapshot.source === 'spend' && (!Number.isInteger(snapshot.spent) || snapshot.spent < 1 || snapshot.spent > RESIN_CAP)))) {
    return { ok: false, code: 'invalid-data' };
  }
  if (!validPlannerRelations(value)) return { ok: false, code: 'invalid-data' };
  return { ok: true };
}

function parse(raw) {
  try {
    const data = JSON.parse(raw);
    const result = validateState(data);
    return result.ok ? { ok: true, data } : { ok: false, error: result.code };
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
}

// Адаптер можно заменить при добавлении синхронизации. Доступ к localStorage
// происходит внутри try: даже его получение может выбросить SecurityError.
export function createStorage(getStorage = () => globalThis.localStorage) {
  function load() {
    try {
      const raw = getStorage().getItem(STORAGE_KEY);
      if (raw === null) return { ok: true, data: createInitialState(), isNew: true };
      return parse(raw);
    } catch {
      return { ok: false, error: 'read-unavailable' };
    }
  }

  function save(data, options = {}) {
    const validation = validateState(data);
    if (!validation.ok) return { ok: false, error: validation.code };
    if (Object.hasOwn(options, 'expectedRaw')) {
      const actual = readRaw();
      if (!actual.ok) return actual;
      if (actual.raw !== options.expectedRaw) return { ok: false, error: 'external-change' };
    }
    // Никогда не заменяем повреждённый или более новый документ начальными данными.
    const previous = load();
    if (!previous.ok) return previous;
    try {
      getStorage().setItem(STORAGE_KEY, JSON.stringify(data));
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'write-unavailable' };
    }
  }

  function updateSettings(patch) {
    const current = load();
    if (!current.ok) return current;
    return save({ ...current.data, settings: { ...current.data.settings, ...patch } });
  }

  function readRaw() {
    try { return { ok: true, raw: getStorage().getItem(STORAGE_KEY) }; }
    catch { return { ok: false, error: 'read-unavailable' }; }
  }
  function loadBackup() {
    try {
      const raw = getStorage().getItem(BACKUP_KEY);
      if (raw === null) return { ok: true, backup: null };
      const backup = JSON.parse(raw);
      if (!isSafeJson(backup) || !isUtc(backup.createdAt) || !['before-import', 'before-delete'].includes(backup.reason)
        || !validateState(backup.data).ok || (backup.previousStoredRaw !== null && typeof backup.previousStoredRaw !== 'string')) {
        return { ok: false, error: 'invalid-backup' };
      }
      return { ok: true, backup };
    } catch { return { ok: false, error: 'backup-unavailable' }; }
  }
  // Вызывается только после предпросмотра и явного подтверждения в интерфейсе.
  // setItem атомарен для одного ключа: ошибка записи оставляет старый документ.
  function replaceWithBackup(candidate, currentState, expectedRaw, now, reason = 'before-import') {
    if (!validateState(candidate).ok || !validateState(currentState).ok) return { ok: false, error: 'invalid-data' };
    const milliseconds = now instanceof Date ? now.getTime() : now;
    if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(new Date(milliseconds).getTime())
      || !['before-import', 'before-delete'].includes(reason)) return { ok: false, error: 'invalid-data' };
    const actual = readRaw();
    if (!actual.ok) return actual;
    if (actual.raw !== expectedRaw) return { ok: false, error: 'stale-preview' };
    const backup = { createdAt: new Date(milliseconds).toISOString(), reason, data: currentState,
      previousStoredRaw: actual.raw === JSON.stringify(currentState) ? null : actual.raw };
    try { getStorage().setItem(BACKUP_KEY, JSON.stringify(backup)); }
    catch { return { ok: false, error: 'backup-failed' }; }
    const recheck = readRaw();
    if (!recheck.ok || recheck.raw !== expectedRaw) return { ok: false, error: 'stale-preview', backupCreated: true };
    try {
      getStorage().setItem(STORAGE_KEY, JSON.stringify(candidate));
      return { ok: true, data: structuredClone(candidate), backupCreated: true };
    } catch { return { ok: false, error: 'replacement-failed', backupCreated: true }; }
  }
  return { load, save, updateSettings, readRaw, loadBackup, replaceWithBackup };
}

export function storageErrorMessage(error) {
  const messages = {
    'invalid-json': 'Сохранённые данные повреждены: не удалось прочитать JSON.',
    'invalid-data': 'Структура сохранённых данных не соответствует схеме приложения.',
    'unsupported-version': 'Эта версия данных пока не поддерживается приложением.',
    'read-unavailable': 'Браузер запретил доступ к локальному хранилищу.',
    'write-unavailable': 'Браузер не позволил сохранить изменения.',
    'quota-exceeded': 'В локальном хранилище браузера закончилось место.',
    'external-change': 'Данные изменились в другой вкладке. Запись заблокирована: экспортируйте изменения этой вкладки, затем обновите страницу.',
  };
  return `${messages[error] ?? 'Не удалось сохранить данные.'} Изменения действуют только до обновления страницы. Существующие данные не перезаписаны.`;
}
