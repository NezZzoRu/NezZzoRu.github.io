import { activeProfile, materialProgress, characterMaterials, profileCharacters } from './charactersFarm.js';
import { personalTasks, utcTime } from './personalTasks.js';
import { DAY, getPeriod } from '../modules/time/gameClock.js';

function currentRoutine(state, profile, type, now) {
  const period = getPeriod(profile?.server ?? 'europe', type, now);
  const records = state.completions.filter(record => record.profileId === profile?.id && record.periodKey === period.periodKey);
  const rows = records.map(record => ({ count: record.count, target: record.target }));
  for (const template of state.taskTemplates.filter(template => template.profileId === profile?.id && template.enabled && template.period === type)) {
    if (!records.some(record => record.templateId === template.id)) rows.push({ count: 0, target: template.target });
  }
  const count = rows.reduce((sum, row) => sum + row.count, 0), target = rows.reduce((sum, row) => sum + row.target, 0);
  return { count, target, percent: target ? Math.floor(count / target * 100) : 0, recorded: records.length, periodKey: period.periodKey };
}

// Каждый вызов строит сводку из первичных записей. Счётчики статистики не сохраняются.
export function calculateStatistics(state, now) {
  const timestamp = Date.parse(utcTime(now));
  const profile = activeProfile(state), server = profile?.server ?? 'europe';
  const current = getPeriod(server, 'daily', timestamp);
  const days = Array.from({ length: 30 }, (_, index) => ({ date: getPeriod(server, 'daily', current.startMs - (29 - index) * DAY).startDate, count: 0, hasRecords: false }));
  const byDate = new Map(days.map(day => [day.date, day]));
  function observe(time, action = false) {
    const value = Date.parse(time);
    if (!Number.isFinite(value) || value > timestamp || value < current.startMs - 29 * DAY) return;
    const day = byDate.get(getPeriod(server, 'daily', value).startDate);
    if (day) { day.hasRecords = true; if (action) day.count++; }
  }
  let undatedRoutineActions = 0;
  for (const record of state.completions.filter(record => record.profileId === profile?.id)) {
    const times = record.actionTimes ?? [];
    times.forEach(time => observe(time, true));
    undatedRoutineActions += record.count - times.length;
    observe(record.createdAt); observe(record.updatedAt);
  }
  const tasks = personalTasks(state);
  for (const task of tasks) { observe(task.createdAt); observe(task.updatedAt); if (task.status === 'completed') observe(task.completedAt, true); }
  for (const plan of state.farmPlans.filter(plan => plan.profileId === profile?.id)) { if (plan.completedAt) observe(plan.completedAt, true); }
  const materials = state.materialGoals.filter(goal => goal.profileId === profile?.id);
  return {
    server, days, actions7: days.slice(-7).reduce((sum, day) => sum + day.count, 0), actions30: days.reduce((sum, day) => sum + day.count, 0),
    undatedRoutineActions, completedPersonal: tasks.filter(task => task.status === 'completed').length,
    totalPersonal: tasks.length, statuses: { planned: tasks.filter(task => task.status === 'planned').length, 'in-progress': tasks.filter(task => task.status === 'in-progress').length, completed: tasks.filter(task => task.status === 'completed').length },
    daily: currentRoutine(state, profile, 'daily', timestamp), weekly: currentRoutine(state, profile, 'weekly', timestamp),
    materials: materialProgress(materials), characters: profileCharacters(state).map(character => ({ id: character.id, name: character.name, ...materialProgress(characterMaterials(state, character.id)) })),
  };
}
