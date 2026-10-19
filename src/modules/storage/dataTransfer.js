import { validateState, COLLECTIONS } from './storage.js';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const COLLECTION_LABELS = Object.freeze({ profiles: 'Профили', taskTemplates: 'Шаблоны рутины', completions: 'Снимки выполнения', personalTasks: 'Личные задачи', characters: 'Персонажи', materialGoals: 'Материалы', farmPlans: 'Планы фарма', resinSnapshots: 'Замеры смолы' });
export function parseImport(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return { ok: false, error: 'file-too-large' };
  let data;
  try { data = JSON.parse(text); }
  catch { return { ok: false, error: 'invalid-json' }; }
  const validation = validateState(data);
  return validation.ok ? { ok: true, data } : { ok: false, error: validation.code };
}
export function serializeExport(state) {
  if (!validateState(state).ok) throw new Error('Текущие данные не прошли проверку. Экспорт остановлен.');
  return JSON.stringify(state, null, 2);
}
export function summarizeData(state) {
  return Object.fromEntries(COLLECTIONS.map(name => [name, state[name].length]));
}
export function transferMessage(code) {
  return {
    'invalid-json': 'Файл не является корректным JSON. Текущие данные не изменены.',
    'unsupported-version': 'Неподдерживаемая schemaVersion. MVP 1.0 читает только схему 1. Текущие данные не изменены.',
    'invalid-data': 'Проверка типов, идентификаторов или связей не пройдена. Текущие данные не изменены.',
    'file-too-large': 'Файл слишком большой. Максимум — 5 МиБ. Текущие данные не изменены.',
    'stale-preview': 'После предпросмотра данные изменились, возможно, в другой вкладке. Операция остановлена. Экспортируйте несохранённые изменения этой вкладки, обновите страницу и повторите предпросмотр.',
    'backup-failed': 'Не удалось создать резервную копию: хранилище недоступно или заполнено. Замена не выполнялась. Сначала экспортируйте данные и освободите место.',
    'replacement-failed': 'Не удалось записать новые данные. Старая рабочая запись сохранена, резервная копия доступна в настройках.',
    'read-unavailable': 'Доступ к хранилищу запрещён браузером. Операция остановлена.',
    'invalid-backup': 'Резервная копия не прошла проверку.',
    'backup-unavailable': 'Не удалось прочитать резервную копию.',
  }[code] ?? 'Операция не выполнена. Текущие данные не заменены.';
}
