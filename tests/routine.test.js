import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, createStorage, validateState, STORAGE_KEY } from '../src/modules/storage/storage.js';
import { initializeRoutine, createTemplate, editTemplate, deleteTemplate, setServer, getCurrentTasks, adjustCompletion } from '../src/modules/routine/routine.js';
import { getPeriod } from '../src/modules/time/gameClock.js';

let sequence = 0;
const id = () => `test-${++sequence}`;
const now = Date.parse('2026-10-19T08:00:00Z');
const setup = () => initializeRoutine(createInitialState(), id);
function mark(state, profileId, templateId, delta = 1, timestamp = now) {
  const template = state.taskTemplates.find(template => template.id === templateId);
  const server = state.profiles.find(profile => profile.id === profileId).server;
  return adjustCompletion(state, profileId, templateId, delta, timestamp, getPeriod(server, template.period, timestamp).periodKey, id);
}

test('примеры создаются один раз, удаление всех шаблонов не возвращает их', () => {
  const initialized = setup();
  assert.equal(initialized.state.taskTemplates.length, 4);
  assert.equal(validateState(initialized.state).ok, true);
  assert.equal(initializeRoutine(initialized.state, id).changed, false);
  let state = initialized.state;
  for (const template of state.taskTemplates) state = deleteTemplate(state, initialized.profileId, template.id);
  assert.equal(initializeRoutine(state, id).state.taskTemplates.length, 0);
  assert.equal(createInitialState().profiles.length, 0);
});

test('создание, редактирование и переключение шаблона, проверка полей', () => {
  const { state, profileId } = setup();
  const added = createTemplate(state, profileId, { title: '  Новый  ', period: 'daily', target: 4, enabled: true }, id);
  const template = added.taskTemplates.at(-1);
  assert.equal(template.title, 'Новый');
  const edited = editTemplate(added, profileId, template.id, { title: 'Другое', period: 'weekly', target: 2, enabled: false });
  assert.deepEqual(edited.taskTemplates.at(-1), { ...template, title: 'Другое', period: 'weekly', target: 2, enabled: false });
  assert.equal(added.taskTemplates.at(-1).enabled, true);
  for (const fields of [{ title: ' ' }, { title: 'x'.repeat(101) }, { target: 0 }, { target: 1.5 }, { target: 1000 }, { period: 'monthly' }]) {
    assert.throws(() => editTemplate(added, profileId, template.id, fields));
  }
});

test('счётчик 0/4 → 4/4, границы и отмена без отрицательных значений', () => {
  let { state, profileId } = setup();
  const template = state.taskTemplates.find(template => template.target === 4);
  assert.equal(getCurrentTasks(state, profileId, 'daily', now)[0].count, 0);
  state = mark(state, profileId, template.id, -1);
  assert.equal(state.completions.length, 0);
  for (let i = 0; i < 5; i++) state = mark(state, profileId, template.id);
  assert.equal(state.completions.length, 1);
  assert.equal(state.completions[0].count, 4);
  for (let i = 0; i < 5; i++) state = mark(state, profileId, template.id, -1);
  assert.equal(state.completions[0].count, 0);
  assert.equal(state.completions.length, 1);
});

test('отключение запрещает новые отметки, но позволяет отмену и повторное включение', () => {
  let { state, profileId } = setup();
  const templateId = state.taskTemplates[0].id;
  state = mark(state, profileId, templateId);
  state = editTemplate(state, profileId, templateId, { enabled: false });
  assert.throws(() => mark(state, profileId, templateId));
  state = mark(state, profileId, templateId, -1);
  assert.equal(state.completions[0].count, 0);
  state = editTemplate(state, profileId, templateId, { enabled: true });
  assert.equal(mark(state, profileId, templateId).completions[0].count, 1);
});

for (const type of ['daily', 'weekly']) {
  test(`${type}: сброс не меняет историю, новый период имеет отдельный счётчик`, () => {
    let { state, profileId } = setup();
    const templateId = state.taskTemplates.find(template => template.period === type).id;
    const before = Date.parse('2026-10-19T02:59:00Z');
    const after = Date.parse('2026-10-19T03:00:00Z');
    state = mark(state, profileId, templateId, 1, before);
    const previous = structuredClone(state.completions[0]);
    const staleKey = previous.periodKey;
    assert.equal(getCurrentTasks(state, profileId, type, after).find(row => row.template.id === templateId).count, 0);
    assert.deepEqual(state.completions, [previous]);
    assert.throws(() => adjustCompletion(state, profileId, templateId, 1, after, staleKey, id), /период обновился/);
    state = mark(state, profileId, templateId, 1, after);
    assert.equal(state.completions.length, 2);
    assert.deepEqual(state.completions[0], previous);
    assert.notEqual(state.completions[1].periodKey, previous.periodKey);
    assert.equal(state.completions[1].count, 1);
  });
}

test('редактирование и удаление не переписывают снимки истории', () => {
  let { state, profileId } = setup();
  const templateId = state.taskTemplates[0].id;
  state = mark(state, profileId, templateId);
  const original = structuredClone(state.completions);
  state = editTemplate(state, profileId, templateId, { title: 'Новое имя', target: 1 });
  assert.deepEqual(state.completions, original);
  const row = getCurrentTasks(state, profileId, 'daily', now)[0];
  assert.equal(row.target, 4);
  state = deleteTemplate(state, profileId, templateId);
  assert.deepEqual(state.completions, original);
  assert.equal(validateState(state).ok, true);
});

test('смена сервера отделяет прогресс и возвращает прежние отметки при возврате', () => {
  let { state, profileId } = setup();
  const templateId = state.taskTemplates[0].id;
  state = mark(state, profileId, templateId);
  const original = structuredClone(state.completions[0]);
  state = setServer(state, profileId, 'asia');
  assert.equal(getCurrentTasks(state, profileId, 'daily', now)[0].count, 0);
  state = mark(state, profileId, templateId);
  assert.deepEqual(state.completions[0], original);
  assert.equal(state.completions.length, 2);
  state = setServer(state, profileId, 'europe');
  assert.equal(getCurrentTasks(state, profileId, 'daily', now)[0].count, 1);
});

test('данные рутины проходят сохранение и восстановление', () => {
  let { state, profileId } = setup();
  state = mark(state, profileId, state.taskTemplates[0].id);
  let raw = null;
  const adapter = { getItem: key => key === STORAGE_KEY ? raw : null, setItem: (_, value) => { raw = value; } };
  const storage = createStorage(() => adapter);
  assert.equal(storage.save(state).ok, true);
  assert.deepEqual(createStorage(() => adapter).load().data, state);
});

test('валидация отклоняет некорректные записи рутины и дубликаты периода', () => {
  let { state, profileId } = setup();
  state = mark(state, profileId, state.taskTemplates[0].id);
  for (const mutate of [
    s => { s.taskTemplates[0].target = 0; },
    s => { s.completions[0].count = 5; },
    s => { s.completions[0].periodKey = 'europe:daily:2026-02-30'; },
    s => { s.completions.push({ ...s.completions[0], id: 'duplicate' }); },
    s => { s.profiles[0].server = 'invalid'; },
  ]) {
    const invalid = structuredClone(state);
    mutate(invalid);
    assert.equal(validateState(invalid).ok, false);
  }
});
