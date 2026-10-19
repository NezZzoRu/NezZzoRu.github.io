import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, createStorage, validateState, STORAGE_KEY } from '../src/modules/storage/storage.js';
import { saveCharacter, deleteCharacter, saveMaterial, deleteMaterial, materialProgress, characterMaterials,
  profileCharacters, groupedMissingMaterials, missingMaterials, gameWeekday, saveFarmPlan, toggleFarmPlan,
  deleteFarmPlan, filteredFarmPlans, matchesDay } from '../src/core/charactersFarm.js';
import { characterOverview } from '../src/modules/rendering/plannerViews.js';

let sequence = 0;
const id = () => `planner-${++sequence}`;
const monday = Date.parse('2026-10-19T08:00:00Z');
const character = name => ({ name, notes: 'Ручные заметки', targetLevel: 80 });
const material = (name, owned, needed, days = []) => ({ name, owned, needed, days });
const plan = (materialGoalId, days = [1]) => ({ materialGoalId, title: 'Собрать материалы', notes: 'Ручной план', days });
function fixture() {
  let state = saveCharacter(createInitialState(), character('Герой А'), null, id);
  const a = state.characters[0].id;
  state = saveCharacter(state, character('Герой Б'), null, id);
  const b = state.characters[1].id;
  state = saveMaterial(state, a, material('Кристалл', 2, 10, [1, 3]), null, id);
  const aCrystal = state.materialGoals.at(-1).id;
  state = saveMaterial(state, a, material('Нулевая цель', 0, 0), null, id);
  state = saveMaterial(state, b, material('Кристалл', 3, 8, [2, 7]), null, id);
  const bCrystal = state.materialGoals.at(-1).id;
  state = saveMaterial(state, b, material('Книга', 10, 5, [1, 2, 3, 4, 5, 6, 7]), null, id);
  return { state, a, b, aCrystal, bCrystal };
}

test('два персонажа с материалами: редактирование, owned/needed и расчёт прогресса', () => {
  let { state, a, b, aCrystal } = fixture();
  assert.equal(state.characters.length, 2);
  assert.equal(state.materialGoals.length, 4);
  assert.equal(validateState(state).ok, true);
  assert.equal(materialProgress(characterMaterials(state, a)).percent, 20);
  assert.equal(materialProgress(characterMaterials(state, b)).percent, 61);
  state = saveCharacter(state, { ...character('Новое имя'), notes: 'Изменены заметки', targetLevel: 90 }, a, id);
  assert.equal(state.characters[0].name, 'Новое имя');
  assert.equal(saveCharacter(state, { ...character('Произвольная цель'), targetLevel: 100 }, a, id).characters[0].targetLevel, 100);
  state = saveMaterial(state, a, material('Кристалл', 10, 10, [7]), aCrystal, id);
  assert.equal(materialProgress(characterMaterials(state, a)).percent, 100);
  assert.equal(state.materialGoals.find(goal => goal.id === aCrystal).characterId, a);
  assert.match(characterOverview(state), /Новое имя/);
  assert.match(characterOverview(state), /100%/);
});

test('ноль требуемых материалов и избыток owned не дают NaN, Infinity или больше 100%', () => {
  assert.deepEqual(materialProgress([]), { owned: 0, needed: 0, missing: 0, percent: 0 });
  assert.deepEqual(materialProgress([material('Ничего', 50, 0)]), { owned: 0, needed: 0, missing: 0, percent: 100 });
  assert.equal(materialProgress([material('Избыток', 100, 10), material('Дефицит', 0, 10)]).percent, 50);
});

test('сводный дефицит группируется по названию, но owned не смешивается между персонажами', () => {
  const { state, a, b } = fixture();
  const groups = groupedMissingMaterials(state, 'week', monday);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'Кристалл');
  assert.equal(groups[0].missing, 13);
  assert.deepEqual(groups[0].materials.map(goal => [goal.characterId, goal.missing]), [[a, 8], [b, 5]]);
  assert.equal(materialProgress(state.materialGoals).percent, 43);
});

test('Сегодня, Завтра и Вся неделя учитывают введённые дни; неизвестное расписание не выдумывается', () => {
  let { state, a, aCrystal, bCrystal } = fixture();
  state = saveMaterial(state, a, material('Руда', 0, 3), null, id);
  assert.deepEqual(missingMaterials(state, 'today', monday).map(goal => goal.id), [aCrystal]);
  assert.deepEqual(missingMaterials(state, 'tomorrow', monday).map(goal => goal.id), [bCrystal]);
  assert.equal(missingMaterials(state, 'week', monday).length, 3);
  assert.equal(groupedMissingMaterials(state, 'week', monday).find(group => group.name === 'Руда').missing, 3);
});

test('нумерация всех дней 1–7 и переход воскресенье → понедельник', () => {
  for (let offset = 0; offset < 7; offset++) {
    const now = monday + offset * 86400000;
    assert.equal(gameWeekday('europe', now), offset + 1);
    assert.equal(matchesDay([offset + 1], 'today', 'europe', now), true);
    assert.equal(matchesDay([(offset + 1) % 7 + 1], 'tomorrow', 'europe', now), true);
  }
  const { state, aCrystal, bCrystal } = fixture();
  assert.deepEqual(missingMaterials(state, 'today', monday + 6 * 86400000).map(goal => goal.id), [bCrystal]);
  assert.deepEqual(missingMaterials(state, 'tomorrow', monday + 6 * 86400000).map(goal => goal.id), [aCrystal]);
});

test('день фильтра меняется в 04:00 выбранного сервера, а не в полночь компьютера', () => {
  const before = Date.parse('2026-10-19T02:59:00Z');
  const after = Date.parse('2026-10-19T03:00:00Z');
  assert.equal(gameWeekday('europe', before), 7);
  assert.equal(gameWeekday('europe', after), 1);
  assert.equal(gameWeekday('america', after), 7);
  assert.equal(gameWeekday('asia', after), 1);
  const { state, aCrystal, bCrystal } = fixture();
  assert.deepEqual(missingMaterials(state, 'today', before).map(goal => goal.id), [bCrystal]);
  assert.deepEqual(missingMaterials(state, 'today', after).map(goal => goal.id), [aCrystal]);
});

test('планы создаются, редактируются и фильтруются по собственным ручным дням', () => {
  let { state, aCrystal, bCrystal } = fixture();
  state = saveFarmPlan(state, plan(aCrystal, [1, 7]), null, id);
  const firstId = state.farmPlans[0].id;
  state = saveFarmPlan(state, plan(bCrystal, [2]), null, id);
  assert.equal(filteredFarmPlans(state, 'today', monday).length, 1);
  assert.equal(filteredFarmPlans(state, 'tomorrow', monday).length, 1);
  assert.equal(filteredFarmPlans(state, 'week', monday).length, 2);
  state = saveFarmPlan(state, { ...plan(aCrystal, [3]), title: 'Новый план' }, firstId, id);
  assert.equal(filteredFarmPlans(state, 'today', monday).length, 0);
  assert.equal(state.farmPlans[0].title, 'Новый план');
  assert.equal(validateState(state).ok, true);
  assert.equal(deleteFarmPlan(state, firstId).farmPlans.length, 1);
});

test('выполнение и отмена плана не меняют инвентарь, прогресс или другие записи', () => {
  let { state, aCrystal } = fixture();
  state = saveFarmPlan(state, plan(aCrystal), null, id);
  const originalGoals = structuredClone(state.materialGoals);
  const originalCharacters = structuredClone(state.characters);
  const planId = state.farmPlans[0].id;
  state = toggleFarmPlan(state, planId, monday);
  assert.equal(state.farmPlans[0].completedAt, '2026-10-19T08:00:00.000Z');
  assert.deepEqual(state.materialGoals, originalGoals);
  assert.deepEqual(state.characters, originalCharacters);
  state = saveFarmPlan(state, { ...plan(aCrystal), title: 'Обновлён' }, planId, id);
  assert.equal(state.farmPlans[0].completedAt, '2026-10-19T08:00:00.000Z');
  state = toggleFarmPlan(state, planId, monday + 86400000);
  assert.equal(state.farmPlans[0].completedAt, null);
  assert.deepEqual(state.materialGoals, originalGoals);
  assert.throws(() => toggleFarmPlan(state, planId, NaN));
});

test('удаление персонажа или материала удаляет только связанные цели и планы', () => {
  let { state, a, b, aCrystal, bCrystal } = fixture();
  state = saveFarmPlan(state, plan(aCrystal), null, id);
  state = saveFarmPlan(state, plan(bCrystal), null, id);
  const otherPlan = structuredClone(state.farmPlans[1]);
  const deleted = deleteCharacter(state, a);
  assert.equal(deleted.characters.length, 1);
  assert.equal(deleted.characters[0].id, b);
  assert.deepEqual(deleted.farmPlans, [otherPlan]);
  assert.equal(deleted.materialGoals.some(goal => goal.characterId === a), false);
  assert.equal(validateState(deleted).ok, true);
  const removedMaterial = deleteMaterial(state, aCrystal);
  assert.deepEqual(removedMaterial.farmPlans, [otherPlan]);
  assert.equal(removedMaterial.characters.length, 2);
  assert.equal(validateState(removedMaterial).ok, true);
  assert.equal(state.characters.length, 2);
});

test('два персонажа, материалы, расписания, фильтр и выполнение сохраняются после перезагрузки', () => {
  let { state, aCrystal } = fixture();
  state = saveFarmPlan(state, plan(aCrystal), null, id);
  state = toggleFarmPlan(state, state.farmPlans[0].id, monday);
  state.settings.farmFilter = 'tomorrow';
  let raw = null;
  const adapter = { getItem: key => key === STORAGE_KEY ? raw : null, setItem: (_, value) => { raw = value; } };
  assert.equal(createStorage(() => adapter).save(state).ok, true);
  const loaded = createStorage(() => adapter).load();
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.data, state);
  assert.equal(groupedMissingMaterials(loaded.data, 'week', monday)[0].missing, 13);
  assert.match(characterOverview(loaded.data), /43%/);
});

test('некорректные количества, дни, пустые имена и цели уровня не принимаются', () => {
  const { state, a, aCrystal } = fixture();
  for (const change of [{ name: ' ' }, { name: 'x'.repeat(101) }, { targetLevel: 0 }, { targetLevel: Number.MAX_SAFE_INTEGER + 1 }, { targetLevel: 1.5 }]) {
    assert.throws(() => saveCharacter(state, { ...character('Имя'), ...change }, a, id));
  }
  for (const change of [{ owned: -1 }, { needed: 1.5 }, { owned: Infinity }, { needed: NaN }, { days: [0] }, { days: [8] }, { days: [1, 1] }, { days: ['1'] }]) {
    assert.throws(() => saveMaterial(state, a, { ...material('Тест', 0, 0), ...change }, null, id));
  }
  assert.throws(() => saveFarmPlan(state, plan(aCrystal, []), null, id));
  assert.throws(() => saveFarmPlan(state, plan(aCrystal, [1, 1]), null, id));
});

test('другой профиль изолирован; связи между чужими материалами и планами запрещены', () => {
  const { state, a, aCrystal } = fixture();
  const changed = structuredClone(state);
  changed.profiles.push({ id: 'other-profile', name: 'Другой', server: 'asia' });
  changed.settings.activeProfileId = 'other-profile';
  assert.equal(profileCharacters(changed).length, 0);
  assert.equal(missingMaterials(changed, 'week', monday).length, 0);
  assert.throws(() => deleteCharacter(changed, a));
  assert.throws(() => saveFarmPlan(changed, plan(aCrystal), null, id));
  const invalid = structuredClone(changed);
  invalid.materialGoals[0].profileId = 'other-profile';
  assert.equal(validateState(invalid).ok, false);
});

test('валидация хранения отклоняет повреждённые поля и оборванные связи без перезаписи', () => {
  let { state, aCrystal } = fixture();
  state = saveFarmPlan(state, plan(aCrystal), null, id);
  for (const mutate of [
    s => { s.characters[0].targetLevel = 0; },
    s => { s.materialGoals[0].needed = -1; },
    s => { s.materialGoals[0].characterId = 'missing'; },
    s => { s.materialGoals[0].days = [8]; },
    s => { s.farmPlans[0].materialGoalId = 'missing'; },
    s => { s.farmPlans[0].completedAt = 'invalid'; },
    s => { s.settings.farmFilter = 'unknown'; },
  ]) {
    const invalid = structuredClone(state);
    mutate(invalid);
    assert.equal(validateState(invalid).ok, false);
    let raw = JSON.stringify(invalid);
    const original = raw;
    const storage = createStorage(() => ({ getItem: () => raw, setItem: (_, value) => { raw = value; } }));
    assert.equal(storage.save(state).ok, false);
    assert.equal(raw, original);
  }
});

test('сводка главной страницы безопасно выводит ручные имена как текст', () => {
  const state = saveCharacter(createInitialState(), character('<img src=x onerror=alert(1)>'), null, id);
  const html = characterOverview(state);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('&lt;img'), true);
});
