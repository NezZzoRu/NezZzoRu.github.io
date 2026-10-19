import { getPeriod, SERVERS, PERIOD_TYPES } from '../time/gameClock.js';

const makeId = () => crypto.randomUUID();
export function validateTemplateFields({ title, period, target, enabled }) {
  return typeof title === 'string' && title.trim().length > 0 && title.trim().length <= 100
    && PERIOD_TYPES.includes(period) && Number.isInteger(target) && target >= 1 && target <= 999
    && typeof enabled === 'boolean';
}
const clone = state => structuredClone(state);
function profileFor(state, profileId) {
  const profile = state.profiles.find(profile => profile.id === profileId);
  if (!profile || !Object.hasOwn(SERVERS, profile.server)) throw new Error('Не выбран игровой сервер.');
  return profile;
}
function templateFor(state, profileId, templateId) {
  const template = state.taskTemplates.find(template => template.id === templateId && template.profileId === profileId);
  if (!template) throw new Error('Шаблон уже удалён.');
  return template;
}

// Демонстрационные шаблоны создаются ровно один раз для выбранного профиля.
export function initializeRoutine(state, id = makeId) {
  const next = clone(state);
  let profile = next.profiles.find(profile => profile.id === next.settings.activeProfileId) ?? next.profiles[0];
  if (!profile) {
    profile = { id: id(), name: 'Путешественник', server: 'europe' };
    next.profiles.push(profile);
  }
  if (!profile.server) profile.server = 'europe';
  next.settings.activeProfileId = profile.id;
  if (!profile.routineSeeded) {
    if (!next.taskTemplates.some(template => template.profileId === profile.id)) {
      const examples = [
        ['Награды за поручения', 'daily', 4],
        ['Экспедиции', 'daily', 1],
        ['Еженедельные боссы', 'weekly', 3],
        ['Задания Боевого пропуска', 'weekly', 1],
      ];
      next.taskTemplates.push(...examples.map(([title, period, target]) => ({ id: id(), profileId: profile.id, title, period, target, enabled: true })));
    }
    profile.routineSeeded = true;
  }
  return { state: next, profileId: profile.id, changed: JSON.stringify(next) !== JSON.stringify(state) };
}

export function createTemplate(state, profileId, fields, id = makeId) {
  profileFor(state, profileId);
  if (!validateTemplateFields(fields)) throw new Error('Введите название до 100 символов и целое количество от 1 до 999.');
  const next = clone(state);
  const templateId = id();
  if (next.taskTemplates.some(template => template.id === templateId)) throw new Error('Идентификатор шаблона уже занят.');
  next.taskTemplates.push({ id: templateId, profileId, title: fields.title.trim(), period: fields.period, target: fields.target, enabled: fields.enabled });
  return next;
}
export function editTemplate(state, profileId, templateId, fields) {
  const original = templateFor(state, profileId, templateId);
  const merged = { ...original, ...fields };
  if (!validateTemplateFields(merged)) throw new Error('Введите название до 100 символов и целое количество от 1 до 999.');
  const next = clone(state);
  Object.assign(templateFor(next, profileId, templateId), {
    title: merged.title.trim(), period: merged.period, target: merged.target, enabled: merged.enabled,
  });
  return next;
}
export function deleteTemplate(state, profileId, templateId) {
  templateFor(state, profileId, templateId);
  return { ...state, taskTemplates: state.taskTemplates.filter(template => template.id !== templateId) };
}
export function setServer(state, profileId, server) {
  if (!Object.hasOwn(SERVERS, server)) throw new Error('Неизвестный сервер.');
  const next = clone(state);
  profileFor(next, profileId).server = server;
  return next;
}
export function getCurrentTasks(state, profileId, type, now) {
  const profile = profileFor(state, profileId);
  const period = getPeriod(profile.server, type, now);
  return state.taskTemplates.filter(template => template.profileId === profileId && template.period === type).map(template => {
    const completion = state.completions.find(record => record.profileId === profileId && record.templateId === template.id && record.periodKey === period.periodKey);
    return { template, completion, period, count: completion?.count ?? 0, target: completion?.target ?? template.target, title: completion?.title ?? template.title };
  });
}

// Только явное действие пользователя меняет счётчик текущего периода.
// На сбросе новые записи не создаются, а предыдущие остаются неизменными.
export function adjustCompletion(state, profileId, templateId, delta, now, expectedPeriodKey, id = makeId) {
  if (delta !== 1 && delta !== -1) throw new Error('Допустима одна отметка или её отмена.');
  const profile = profileFor(state, profileId);
  const template = templateFor(state, profileId, templateId);
  const period = getPeriod(profile.server, template.period, now);
  if (period.periodKey !== expectedPeriodKey) throw new Error('Игровой период обновился. Проверьте новый счётчик и повторите действие.');
  if (!template.enabled && delta > 0) throw new Error('Сначала включите шаблон.');
  const next = clone(state);
  let record = next.completions.find(record => record.profileId === profileId && record.templateId === templateId && record.periodKey === period.periodKey);
  if (!record) {
    if (delta < 0) return next;
    record = {
      id: id(), profileId, templateId, periodKey: period.periodKey,
      title: template.title, target: template.target, count: 0, actionTimes: [],
      createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    };
    next.completions.push(record);
  }
  const count = Math.min(record.target, Math.max(0, record.count + delta));
  if (count !== record.count) {
    record.actionTimes ??= [];
    if (delta > 0) record.actionTimes.push(new Date(now).toISOString());
    else record.actionTimes.pop();
    record.count = count;
    record.updatedAt = new Date(now).toISOString();
  }
  return next;
}
