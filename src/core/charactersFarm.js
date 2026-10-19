import { getPeriod } from '../modules/time/gameClock.js';

export const WEEKDAYS = Object.freeze(['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']);
export const MAX_MATERIAL_AMOUNT = 1_000_000_000;
const makeId = () => crypto.randomUUID();
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
const recordObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const quantity = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_MATERIAL_AMOUNT;
export const validDays = days => Array.isArray(days) && days.every(day => Number.isInteger(day) && day >= 1 && day <= 7) && new Set(days).size === days.length;
export const validCharacter = record => recordObject(record) && text(record.name, 100, true) && text(record.notes, 2000)
  && Number.isSafeInteger(record.targetLevel) && record.targetLevel >= 1;
export const validMaterial = record => recordObject(record) && text(record.name, 100, true) && quantity(record.owned) && quantity(record.needed) && validDays(record.days);
export const validPlan = record => recordObject(record) && text(record.title, 100, true) && text(record.notes, 2000) && validDays(record.days) && record.days.length > 0
  && (record.completedAt === null || (typeof record.completedAt === 'string' && Number.isFinite(Date.parse(record.completedAt)) && new Date(record.completedAt).toISOString() === record.completedAt));

export function activeProfile(state) {
  return state.profiles.find(profile => profile.id === state.settings.activeProfileId) ?? state.profiles[0] ?? null;
}
function prepare(state, id) {
  const next = structuredClone(state);
  let profile = activeProfile(next);
  if (!profile) { profile = { id: id(), name: 'Путешественник', server: 'europe' }; next.profiles.push(profile); }
  next.settings.activeProfileId = profile.id;
  return { next, profileId: profile.id };
}
function find(state, collection, recordId) {
  const record = state[collection].find(record => record.id === recordId && record.profileId === activeProfile(state)?.id);
  if (!record) throw new Error('Запись не найдена в текущем профиле.');
  return record;
}
function uniqueId(state, collection, id) {
  const value = id();
  if (state[collection].some(record => record.id === value)) throw new Error('Идентификатор записи уже занят.');
  return value;
}

export function saveCharacter(state, fields, characterId = null, id = makeId) {
  if (!validCharacter(fields)) throw new Error('Введите имя до 100 символов, заметки до 2000 символов и положительный целевой уровень целым числом.');
  if (characterId) find(state, 'characters', characterId);
  const { next, profileId } = prepare(state, id);
  const values = { name: fields.name.trim(), notes: fields.notes.trim(), targetLevel: fields.targetLevel };
  if (characterId) Object.assign(find(next, 'characters', characterId), values);
  else next.characters.push({ id: uniqueId(next, 'characters', id), profileId, ...values });
  return next;
}
export function deleteCharacter(state, characterId) {
  find(state, 'characters', characterId);
  const removed = new Set(state.materialGoals.filter(goal => goal.characterId === characterId).map(goal => goal.id));
  return { ...state, characters: state.characters.filter(character => character.id !== characterId),
    materialGoals: state.materialGoals.filter(goal => !removed.has(goal.id)),
    farmPlans: state.farmPlans.filter(plan => !removed.has(plan.materialGoalId)) };
}
export function saveMaterial(state, characterId, fields, materialId = null, id = makeId) {
  const character = find(state, 'characters', characterId);
  if (!validMaterial(fields)) throw new Error('Введите название до 100 символов, целые owned/needed от 0 до 1 000 000 000 и дни от 1 до 7 без повторов.');
  if (materialId && find(state, 'materialGoals', materialId).characterId !== characterId) throw new Error('Материал принадлежит другому персонажу.');
  const next = structuredClone(state);
  const values = { name: fields.name.trim(), owned: fields.owned, needed: fields.needed, days: [...fields.days].sort((a, b) => a - b) };
  if (materialId) Object.assign(find(next, 'materialGoals', materialId), values);
  else next.materialGoals.push({ id: uniqueId(next, 'materialGoals', id), profileId: character.profileId, characterId, ...values });
  return next;
}
export function deleteMaterial(state, materialId) {
  find(state, 'materialGoals', materialId);
  return { ...state, materialGoals: state.materialGoals.filter(goal => goal.id !== materialId), farmPlans: state.farmPlans.filter(plan => plan.materialGoalId !== materialId) };
}

export function materialProgress(materials) {
  const needed = materials.reduce((sum, material) => sum + material.needed, 0);
  const owned = materials.reduce((sum, material) => sum + Math.min(material.owned, material.needed), 0);
  return { needed, owned, missing: Math.max(0, needed - owned), percent: needed === 0 ? (materials.length ? 100 : 0) : Math.min(100, Math.floor(owned / needed * 100)) };
}
export function characterMaterials(state, characterId) {
  return state.materialGoals.filter(goal => goal.characterId === characterId && goal.profileId === activeProfile(state)?.id);
}
export function profileCharacters(state) {
  return state.characters.filter(character => character.profileId === activeProfile(state)?.id);
}
export function gameWeekday(server, now) {
  const { startDate } = getPeriod(server, 'daily', now);
  return (new Date(`${startDate}T00:00:00Z`).getUTCDay() + 6) % 7 + 1;
}
export function matchesDay(days, filter, server, now) {
  if (!['today', 'tomorrow', 'week'].includes(filter)) throw new Error('Неизвестный фильтр дней.');
  if (filter === 'week') return true;
  const today = gameWeekday(server, now);
  const day = filter === 'tomorrow' ? today % 7 + 1 : today;
  return days.includes(day);
}
export function missingMaterials(state, filter, now) {
  const profile = activeProfile(state);
  if (!profile) return [];
  return state.materialGoals.filter(goal => goal.profileId === profile.id && goal.needed > goal.owned
    && matchesDay(goal.days, filter, profile.server ?? 'europe', now)).map(goal => ({ ...goal,
      missing: goal.needed - goal.owned, characterName: state.characters.find(character => character.id === goal.characterId)?.name ?? 'Персонаж удалён' }));
}
export function groupedMissingMaterials(state, filter, now) {
  const groups = new Map();
  for (const material of missingMaterials(state, filter, now)) {
    const key = material.name.trim().toLocaleLowerCase('ru-RU');
    if (!groups.has(key)) groups.set(key, { name: material.name, missing: 0, materials: [] });
    const group = groups.get(key);
    group.missing += material.missing;
    group.materials.push(material);
  }
  return [...groups.values()];
}

export function saveFarmPlan(state, fields, planId = null, id = makeId) {
  const goal = find(state, 'materialGoals', fields.materialGoalId);
  const original = planId ? find(state, 'farmPlans', planId) : null;
  const completedAt = original?.completedAt ?? null;
  if (!validPlan({ ...fields, completedAt })) throw new Error('Введите название до 100 символов, заметки до 2000 символов и выберите хотя бы один день.');
  const values = { title: fields.title.trim(), notes: fields.notes.trim(), days: [...fields.days].sort((a, b) => a - b), completedAt };
  const next = structuredClone(state);
  if (planId) Object.assign(find(next, 'farmPlans', planId), values, { materialGoalId: goal.id });
  else next.farmPlans.push({ id: uniqueId(next, 'farmPlans', id), profileId: goal.profileId, materialGoalId: goal.id, ...values });
  return next;
}
export function deleteFarmPlan(state, planId) {
  find(state, 'farmPlans', planId);
  return { ...state, farmPlans: state.farmPlans.filter(plan => plan.id !== planId) };
}
export function toggleFarmPlan(state, planId, now) {
  find(state, 'farmPlans', planId);
  const timestamp = now instanceof Date ? now.getTime() : now;
  if (!Number.isSafeInteger(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) throw new Error('Некорректное время отметки.');
  const next = structuredClone(state);
  const plan = find(next, 'farmPlans', planId);
  plan.completedAt = plan.completedAt ? null : new Date(timestamp).toISOString();
  return next;
}
export function filteredFarmPlans(state, filter, now) {
  const profile = activeProfile(state);
  return profile ? state.farmPlans.filter(plan => plan.profileId === profile.id && matchesDay(plan.days, filter, profile.server ?? 'europe', now)) : [];
}

export function validPlannerRelations(state) {
  if (state.characters.some(character => !validCharacter(character))) return false;
  for (const goal of state.materialGoals) {
    if (!validMaterial(goal) || !state.characters.some(character => character.id === goal.characterId && character.profileId === goal.profileId)) return false;
  }
  for (const plan of state.farmPlans) {
    if (!validPlan(plan) || !state.materialGoals.some(goal => goal.id === plan.materialGoalId && goal.profileId === plan.profileId)) return false;
  }
  return true;
}
