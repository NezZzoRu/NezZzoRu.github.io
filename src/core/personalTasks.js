import { activeProfile } from './charactersFarm.js';

export const DEFAULT_CATEGORIES = Object.freeze(['квесты', 'исследование', 'достижения', 'прокачка', 'другое']);
export const TASK_STATUSES = Object.freeze({ planned: 'Запланировано', 'in-progress': 'В работе', completed: 'Выполнено' });
export const TASK_PRIORITIES = Object.freeze({ low: 'Низкий', normal: 'Обычный', high: 'Высокий' });
export const isUtc = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function utcTime(now) {
  const value = now instanceof Date ? now.getTime() : now;
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) throw new Error('Некорректное время.');
  return new Date(value).toISOString();
}
export const validCategory = value => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 50;
export const validDueDate = value => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
export function validTaskFields(task) {
  return task && typeof task === 'object' && typeof task.title === 'string' && task.title.trim().length > 0 && task.title.length <= 100
    && validCategory(task.category) && Object.hasOwn(TASK_STATUSES, task.status) && Object.hasOwn(TASK_PRIORITIES, task.priority)
    && validDueDate(task.dueDate) && typeof task.notes === 'string' && task.notes.length <= 2000;
}
export const validPersonalTask = task => validTaskFields(task) && isUtc(task.createdAt) && isUtc(task.updatedAt)
  && (task.status === 'completed' ? isUtc(task.completedAt) : task.completedAt === null);
export const validGoalFilters = filters => filters && typeof filters === 'object'
  && (filters.status === 'all' || Object.hasOwn(TASK_STATUSES, filters.status))
  && (filters.priority === 'all' || Object.hasOwn(TASK_PRIORITIES, filters.priority))
  && (filters.category === null || validCategory(filters.category));
export function personalTasks(state) {
  return state.personalTasks.filter(task => task.profileId === activeProfile(state)?.id);
}
export function taskCategories(state) {
  const profile = activeProfile(state);
  return [...new Set([...DEFAULT_CATEGORIES, ...(profile?.personalCategories ?? []), ...personalTasks(state).map(task => task.category)])];
}
function findTask(state, taskId) {
  const task = personalTasks(state).find(task => task.id === taskId);
  if (!task) throw new Error('Задача не найдена в текущем профиле.');
  return task;
}
export function savePersonalTask(state, fields, now, taskId = null, id = () => crypto.randomUUID()) {
  const values = { title: typeof fields?.title === 'string' ? fields.title.trim() : null,
    category: typeof fields?.category === 'string' ? fields.category.trim().toLocaleLowerCase('ru-RU') : null, priority: fields?.priority,
    status: fields?.status, dueDate: fields?.dueDate, notes: typeof fields?.notes === 'string' ? fields.notes.trim() : null };
  if (!validTaskFields(values)) throw new Error('Проверьте название (до 100 символов), категорию (до 50), срок, статус, приоритет и заметки (до 2000).');
  const timestamp = utcTime(now);
  const original = taskId ? findTask(state, taskId) : null;
  const next = structuredClone(state);
  let profile = activeProfile(next);
  if (!profile) { profile = { id: id(), name: 'Путешественник', server: 'europe' }; next.profiles.push(profile); }
  next.settings.activeProfileId = profile.id;
  if (!DEFAULT_CATEGORIES.includes(values.category)) profile.personalCategories = [...new Set([...(profile.personalCategories ?? []), values.category])];
  const completedAt = values.status === 'completed' ? (original?.status === 'completed' ? original.completedAt : timestamp) : null;
  if (taskId) Object.assign(findTask(next, taskId), values, { completedAt, updatedAt: timestamp });
  else {
    const newId = id();
    if (next.personalTasks.some(task => task.id === newId)) throw new Error('Идентификатор задачи уже занят.');
    next.personalTasks.push({ id: newId, profileId: profile.id, ...values, createdAt: timestamp, updatedAt: timestamp, completedAt });
  }
  return next;
}
export function setPersonalTaskStatus(state, taskId, status, now) {
  return savePersonalTask(state, { ...findTask(state, taskId), status }, now, taskId);
}
export function deletePersonalTask(state, taskId) {
  findTask(state, taskId);
  return { ...state, personalTasks: state.personalTasks.filter(task => task.id !== taskId) };
}
export function filterPersonalTasks(state, filters) {
  if (!validGoalFilters(filters)) throw new Error('Некорректный фильтр.');
  return personalTasks(state).filter(task => (filters.status === 'all' || task.status === filters.status)
    && (filters.category === null || task.category === filters.category) && (filters.priority === 'all' || task.priority === filters.priority));
}
export function nearestGoals(state) {
  return personalTasks(state).filter(task => task.status !== 'completed').sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.createdAt.localeCompare(b.createdAt));
}
