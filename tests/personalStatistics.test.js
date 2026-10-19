import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, createStorage, validateState, STORAGE_KEY } from '../src/modules/storage/storage.js';
import { savePersonalTask, setPersonalTaskStatus, deletePersonalTask, filterPersonalTasks, taskCategories, nearestGoals, validPersonalTask } from '../src/core/personalTasks.js';
import { calculateStatistics } from '../src/core/statistics.js';
import { initializeRoutine, adjustCompletion, deleteTemplate } from '../src/modules/routine/routine.js';
import { getPeriod, DAY } from '../src/modules/time/gameClock.js';
import { saveCharacter, saveMaterial, saveFarmPlan, toggleFarmPlan } from '../src/core/charactersFarm.js';

const now = Date.parse('2026-10-19T12:00:00Z');
let sequence = 0;
const id = () => `personal-${++sequence}`;
const fields = (changes = {}) => ({ title: 'Исследовать остров', category: 'исследование', priority: 'normal', status: 'planned', dueDate: null, notes: '', ...changes });
const add = (state, changes = {}, time = now) => savePersonalTask(state, fields(changes), time, null, id);
const filters = changes => ({ status: 'all', priority: 'all', category: null, ...changes });
function mark(state, template, time, delta = 1) {
  return adjustCompletion(state, state.settings.activeProfileId, template.id, delta, time, getPeriod('europe', template.period, time).periodKey, id);
}

test('личная задача: создание, редактирование, необязательный срок и сохранение UTC', () => {
  const initial = createInitialState();
  let state = add(initial, { title: '  Квест  ', dueDate: '2026-10-31', notes: 'Поговорить с NPC' });
  const task = state.personalTasks[0];
  assert.equal(task.title, 'Квест'); assert.equal(task.createdAt, '2026-10-19T12:00:00.000Z');
  assert.equal(task.completedAt, null); assert.equal(validPersonalTask(task), true);
  state = savePersonalTask(state, fields({ title: 'Новая цель', status: 'in-progress', priority: 'high' }), now + 1000, task.id);
  assert.equal(state.personalTasks[0].createdAt, task.createdAt);
  assert.equal(state.personalTasks[0].dueDate, null); assert.equal(state.personalTasks[0].status, 'in-progress');
  assert.equal(initial.profiles.length, 0); assert.equal(state.taskTemplates.length, 0);
});

test('завершение сохраняет время, редактирование не меняет его, возврат в работу очищает отметку', () => {
  let state = add(createInitialState()); const taskId = state.personalTasks[0].id;
  state = setPersonalTaskStatus(state, taskId, 'completed', now + 1000);
  const finished = state.personalTasks[0].completedAt;
  state = savePersonalTask(state, fields({ title: 'Уточнено', status: 'completed' }), now + 2000, taskId);
  assert.equal(state.personalTasks[0].completedAt, finished);
  state = setPersonalTaskStatus(state, taskId, 'in-progress', now + 3000);
  assert.equal(state.personalTasks[0].completedAt, null);
  state = setPersonalTaskStatus(state, taskId, 'completed', now + 4000);
  assert.equal(state.personalTasks[0].completedAt, '2026-10-19T12:00:04.000Z');
  assert.equal(calculateStatistics(state, now + 5000).actions7, 1);
});

test('категории по умолчанию и пользовательские категории сохраняются после удаления задач', () => {
  let state = add(createInitialState(), { category: '  Мои открытия  ' });
  assert.deepEqual(taskCategories(state), ['квесты', 'исследование', 'достижения', 'прокачка', 'другое', 'мои открытия']);
  const taskId = state.personalTasks[0].id;
  state = deletePersonalTask(state, taskId);
  assert.equal(taskCategories(state).includes('мои открытия'), true);
});

test('фильтры комбинируют статус, категорию и приоритет; ближайшие цели сортируются по сроку', () => {
  let state = add(createInitialState(), { title: 'Без срока' });
  state = add(state, { title: 'Ближе', dueDate: '2026-10-20', status: 'in-progress', priority: 'high', category: 'квесты' });
  state = add(state, { title: 'Позже', dueDate: '2026-11-01', priority: 'high', category: 'квесты' });
  state = add(state, { title: 'Готово', status: 'completed', dueDate: '2026-10-19' });
  assert.equal(filterPersonalTasks(state, filters({ category: 'квесты', priority: 'high' })).length, 2);
  assert.equal(filterPersonalTasks(state, filters({ status: 'in-progress', category: 'квесты', priority: 'high' }))[0].title, 'Ближе');
  assert.deepEqual(nearestGoals(state).map(task => task.title), ['Ближе', 'Позже', 'Без срока']);
});

test('неверные статусы, даты, категории и несогласованное completedAt отклоняются', () => {
  const state = createInitialState();
  for (const changes of [{ title: ' ' }, { category: '' }, { priority: 'urgent' }, { status: 'unknown' }, { dueDate: '2026-02-30' }, { dueDate: '2026-2-1' }, { notes: 'x'.repeat(2001) }]) {
    assert.throws(() => add(state, changes));
  }
  assert.throws(() => savePersonalTask(state, fields(), NaN));
  const saved = add(state); saved.personalTasks[0].completedAt = new Date(now).toISOString();
  assert.equal(validateState(saved).ok, false);
});

test('личные задачи, категории, фильтры и время выполнения переживают сериализацию', () => {
  const state = add(createInitialState(), { status: 'completed', category: 'моя категория' });
  state.settings.goalFilters = filters({ priority: 'normal' });
  let raw = null;
  const adapter = { getItem: key => key === STORAGE_KEY ? raw : null, setItem: (_, value) => { raw = value; } };
  assert.equal(createStorage(() => adapter).save(state).ok, true);
  assert.deepEqual(createStorage(() => adapter).load().data, state);
});

test('пустая статистика не выдаёт дни без записей за пропуски и не меняет состояние', () => {
  const state = createInitialState(), original = structuredClone(state);
  const stats = calculateStatistics(state, now);
  assert.equal(stats.actions7, 0); assert.equal(stats.actions30, 0);
  assert.equal(stats.days.length, 30); assert.equal(stats.days.every(day => !day.hasRecords), true);
  assert.equal(stats.daily.target, 0); assert.equal(stats.materials.percent, 0);
  assert.deepEqual(state, original);
});

test('7/30 игровых дней: границы включаются точно, будущие выполнения не считаются', () => {
  const today = getPeriod('europe', 'daily', now).startMs;
  let state = add(createInitialState(), { status: 'completed', title: 'За 7 дней' }, today - 6 * DAY);
  state = add(state, { status: 'completed', title: 'За 30 дней' }, today - 6 * DAY - 1);
  state = add(state, { status: 'completed', title: 'Нижняя граница 30' }, today - 29 * DAY);
  state = add(state, { status: 'completed', title: 'Слишком давно' }, today - 29 * DAY - 1);
  state = add(state, { status: 'completed', title: 'Будущее' }, now + 1);
  const stats = calculateStatistics(state, now);
  assert.equal(stats.actions7, 1); assert.equal(stats.actions30, 3);
  assert.equal(stats.completedPersonal, 5);
});

test('статистика суммирует отдельные отметки рутины, личные задачи и планы фарма', () => {
  let { state } = initializeRoutine(createInitialState(), id);
  const daily = state.taskTemplates.find(template => template.period === 'daily');
  const weekly = state.taskTemplates.find(template => template.period === 'weekly');
  state = mark(state, daily, now - 2 * DAY); state = mark(state, daily, now);
  state = mark(state, weekly, now);
  state = add(state, { status: 'completed' });
  state = saveCharacter(state, { name: 'Герой', notes: '', targetLevel: 80 }, null, id);
  const characterId = state.characters[0].id;
  state = saveMaterial(state, characterId, { name: 'Кристалл', owned: 5, needed: 10, days: [1] }, null, id);
  state = saveFarmPlan(state, { materialGoalId: state.materialGoals[0].id, title: 'Фарм', notes: '', days: [1] }, null, id);
  state = toggleFarmPlan(state, state.farmPlans[0].id, now);
  const stats = calculateStatistics(state, now);
  assert.equal(stats.actions7, 5); assert.equal(stats.actions30, 5);
  assert.equal(stats.daily.count, 1); assert.equal(stats.daily.target, 5);
  assert.equal(stats.weekly.count, 1); assert.equal(stats.weekly.target, 4);
  assert.equal(stats.completedPersonal, 1); assert.equal(stats.materials.percent, 50);
  assert.equal(stats.characters[0].percent, 50);
  assert.equal(validateState(state).ok, true);
});

test('отмена рутины и возврат личной задачи в работу сразу меняют производные итоги', () => {
  let { state } = initializeRoutine(createInitialState(), id); const template = state.taskTemplates[0];
  state = mark(state, template, now); state = add(state, { status: 'completed' });
  assert.equal(calculateStatistics(state, now).actions7, 2);
  state = mark(state, template, now, -1);
  state = setPersonalTaskStatus(state, state.personalTasks[0].id, 'in-progress', now);
  const stats = calculateStatistics(state, now);
  assert.equal(stats.actions7, 0); assert.equal(stats.completedPersonal, 0);
  assert.equal(stats.days.at(-1).hasRecords, true); assert.equal(stats.days.at(-1).count, 0);
  state = deletePersonalTask(state, state.personalTasks[0].id);
  assert.equal(calculateStatistics(state, now).totalPersonal, 0);
});

test('исторические шаблоны не теряются в прогрессе после удаления', () => {
  let { state } = initializeRoutine(createInitialState(), id); const template = state.taskTemplates[0];
  state = mark(state, template, now); state = deleteTemplate(state, state.settings.activeProfileId, template.id);
  assert.equal(calculateStatistics(state, now).daily.count, 1);
  assert.equal(calculateStatistics(state, now).daily.target, 5);
});

test('старые счётчики без времени не получают выдуманные даты и не переписываются при просмотре', () => {
  let { state } = initializeRoutine(createInitialState(), id); const template = state.taskTemplates[0];
  state = mark(state, template, now); delete state.completions[0].actionTimes;
  state.completions[0].count = 2;
  const original = structuredClone(state.completions);
  let stats = calculateStatistics(state, now);
  assert.equal(stats.actions7, 0); assert.equal(stats.undatedRoutineActions, 2);
  assert.deepEqual(state.completions, original);
  state = mark(state, template, now);
  stats = calculateStatistics(state, now);
  assert.equal(stats.actions7, 1); assert.equal(stats.undatedRoutineActions, 2);
  state = mark(state, template, now, -1);
  assert.equal(calculateStatistics(state, now).actions7, 0);
  assert.equal(validateState(state).ok, true);
});

test('профили изолированы; серверный сброс меняет окно, но не сохранённые записи', () => {
  const before = Date.parse('2026-10-19T02:59:00Z'), after = Date.parse('2026-10-19T03:00:00Z');
  let state = add(createInitialState(), { status: 'completed' }, before);
  const original = structuredClone(state);
  assert.equal(calculateStatistics(state, before).days.at(-1).date, '2026-10-18');
  assert.equal(calculateStatistics(state, after).days.at(-1).date, '2026-10-19');
  assert.equal(calculateStatistics(state, after).days.at(-2).count, 1);
  assert.deepEqual(state, original);
  state.profiles.push({ id: 'other', name: 'Другой', server: 'asia' }); state.settings.activeProfileId = 'other';
  assert.equal(calculateStatistics(state, now).actions30, 0);
  assert.throws(() => deletePersonalTask(state, state.personalTasks[0].id));
});

test('валидация защищает время отдельных действий и фильтры от повреждения', () => {
  let { state } = initializeRoutine(createInitialState(), id); state = mark(state, state.taskTemplates[0], now);
  const invalid = structuredClone(state); invalid.completions[0].actionTimes.push(new Date(now).toISOString());
  assert.equal(validateState(invalid).ok, false);
  const invalidTime = structuredClone(state); invalidTime.completions[0].actionTimes = ['invalid'];
  assert.equal(validateState(invalidTime).ok, false);
  state.settings.goalFilters = filters({ category: 'all' }); // пользовательская категория не конфликтует с «все»
  assert.equal(validateState(state).ok, true);
  state.settings.goalFilters.status = 'unknown'; assert.equal(validateState(state).ok, false);
});
