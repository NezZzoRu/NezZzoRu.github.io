import {
  WEEKDAYS, MAX_MATERIAL_AMOUNT, activeProfile, saveCharacter, deleteCharacter, saveMaterial, deleteMaterial,
  materialProgress, characterMaterials, profileCharacters, groupedMissingMaterials, saveFarmPlan, deleteFarmPlan,
  toggleFarmPlan, filteredFarmPlans, gameWeekday,
} from '../../core/charactersFarm.js';
import { getPeriod, SERVERS } from '../time/gameClock.js';
import { icon } from './views.js';

import { escapeHtml } from './plannerViews.js';
const dayText = days => days.length ? days.map(day => WEEKDAYS[day - 1]).join(', ') : 'Дни не указаны';
const button = (action, text, id = '', extra = '') => `<button type="button" class="action-button ${action.startsWith('delete') ? 'danger' : ''}" data-planner-action="${action}" data-id="${escapeHtml(id)}" ${extra}>${text}</button>`;
const dayFields = days => `<fieldset class="planner-days"><legend>Дни недели · понедельник = 1, воскресенье = 7</legend>${WEEKDAYS.map((name, index) => `<label><input type="checkbox" name="days" value="${index + 1}" ${days.includes(index + 1) ? 'checked' : ''}>${name}</label>`).join('')}</fieldset>`;
const actions = html => `<div class="planner-actions">${html}</div>`;


export function mountPlanner({ mode, host, getState, commit, now = () => Date.now() }) {
  const isFarm = mode === 'farm';
  const events = new AbortController();
  const on = { signal: events.signal };
  let editor = null;
  let pendingDelete = null;
  let filter = getState().settings.farmFilter ?? 'week';
  let lastPeriod = '';
  host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">${isFarm ? 'РЕСУРСЫ ДЛЯ НОВЫХ СВЕРШЕНИЙ' : 'ВАША КОМАНДА · ВАШИ ПЛАНЫ'}</p><h1>${isFarm ? 'Фарм' : 'Персонажи'}</h1><p class="subtitle">${isFarm ? 'Соберите недостающие материалы и составьте собственное расписание.' : 'Добавьте спутников и укажите, что нужно для их развития.'}</p></div>${icon(isFarm ? 'leaf' : 'people')}</div>
    <div class="card planner-toolbar">${isFarm ? `${button('new-material', '+ Добавить материал')}${button('new-plan', '+ План фарма')}<p>Материалы привязаны к персонажам. Расписания вводятся только вручную.</p>` : `${button('new-character', '+ Добавить персонажа')}<p>Без внешнего каталога. Готовность рассчитывается по указанным материалам.</p>`}</div>
    ${isFarm ? `<div class="farm-filters" role="group" aria-label="Фильтр дней">${[['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['week', 'Вся неделя']].map(([value, label]) => `<button class="action-button" type="button" data-filter="${value}" aria-pressed="${value === filter}">${label}</button>`).join('')}</div><p id="farm-date-context" class="planner-help"></p><p class="planner-help">Дни без расписания видны во «Всей неделе». Сегодня и завтра — игровые дни сервера со сбросом в 04:00. Сервер меняется в «Рутине».</p>` : ''}
    <p id="planner-status" class="planner-status" role="status" hidden></p><p id="planner-error" class="warning" role="alert" hidden></p>
    <section class="card planner-editor" id="planner-editor" hidden></section>
    <section class="card planner-delete" id="planner-delete" aria-labelledby="planner-delete-title" hidden><h2 id="planner-delete-title">Удалить запись?</h2><p id="planner-delete-description"></p>${actions(button('confirm-delete', 'Удалить') + button('cancel-delete', 'Отмена'))}</section>
    <div id="planner-content"></div>`;
  const content = host.querySelector('#planner-content');
  const editorHost = host.querySelector('#planner-editor');
  const errorBox = host.querySelector('#planner-error');
  const status = host.querySelector('#planner-status');
  function report(error) { errorBox.textContent = error?.message ?? ''; errorBox.hidden = !error; }
  function persist(next, text) {
    const result = commit(next);
    status.textContent = result.ok ? text : 'Изменение учтено только в текущей вкладке: сохранить данные не удалось.';
    status.hidden = false;
    report(null);
  }
  function progressView(materials, label) {
    const progress = materialProgress(materials);
    return `<div class="material-progress"><strong>${progress.percent}%</strong><span>${materials.length ? progress.needed === 0 ? 'Ничего не требуется' : `${progress.owned}/${progress.needed} ед. материалов` : 'Материалы ещё не указаны'}</span><progress max="100" value="${progress.percent}" aria-label="${escapeHtml(label)}"></progress></div>`;
  }
  function materialRow(goal) {
    return `<li class="material-row" data-material-id="${escapeHtml(goal.id)}"><div><strong>${escapeHtml(goal.name)}</strong><p>owned: ${goal.owned} · needed: ${goal.needed} · не хватает ${Math.max(0, goal.needed - goal.owned)}</p><p>${dayText(goal.days)}</p></div>${actions(button('edit-material', 'Изменить материал', goal.id) + button('delete-material', 'Удалить материал', goal.id))}</li>`;
  }
  function drawCharacters() {
    const characters = profileCharacters(getState());
    content.innerHTML = characters.length ? `<div class="character-grid">${characters.map(character => {
      const materials = characterMaterials(getState(), character.id);
      return `<article class="card character-card" data-character-id="${escapeHtml(character.id)}"><div class="character-title"><span class="character-initial" aria-hidden="true">${escapeHtml([...character.name][0])}</span><div><h2>${escapeHtml(character.name)}</h2><p>Целевой уровень: ${character.targetLevel}</p></div></div>${character.notes ? `<p class="planner-notes">${escapeHtml(character.notes)}</p>` : ''}${progressView(materials, `Прогресс материалов: ${character.name}`)}${actions(button('edit-character', 'Редактировать', character.id) + button('delete-character', 'Удалить персонажа', character.id))}<div class="character-material-heading"><h3>Необходимые материалы</h3>${button('new-material', '+ Материал', character.id)}</div><ul class="material-list">${materials.length ? materials.map(materialRow).join('') : '<li class="planner-help">Материалов пока нет. Добавьте свои данные — без автоматического каталога.</li>'}</ul></article>`;
    }).join('')}</div>` : '<section class="card planner-empty"><h2>Команда ещё не собрана</h2><p>Добавьте первого персонажа, его целевой уровень и материалы.</p></section>';
  }
  function drawFarm(timestamp) {
    const state = getState();
    const groups = groupedMissingMaterials(state, filter, timestamp);
    const plans = filteredFarmPlans(state, filter, timestamp);
    const profile = activeProfile(state);
    const server = profile?.server ?? 'europe';
    host.querySelector('#farm-date-context').textContent = `${SERVERS[server].label} · игровой день ${getPeriod(server, 'daily', timestamp).startDate} · ${WEEKDAYS[gameWeekday(server, timestamp) - 1]}`;
    content.innerHTML = `<section class="farm-materials" aria-labelledby="missing-title"><div class="section-label"><h2 id="missing-title">Недостающие материалы</h2><span>Дефицит по выбранному фильтру</span></div>${groups.length ? groups.map(group => `<article class="card missing-group"><div class="wide-card-heading"><h3>${escapeHtml(group.name)}</h3><span class="pill">Не хватает ${group.missing}</span></div><ul class="material-list">${group.materials.map(goal => `<li class="material-row" data-material-id="${escapeHtml(goal.id)}"><div><strong>${escapeHtml(goal.characterName)}</strong><p>owned: ${goal.owned} · needed: ${goal.needed} · не хватает ${goal.missing}</p><p>${dayText(goal.days)}</p></div>${actions(button('edit-material', 'Изменить материал', goal.id) + button('new-plan-for-material', 'Запланировать', goal.id))}</li>`).join('')}</ul></article>`).join('') : '<div class="card planner-empty"><p>Нет недостающих материалов по этому фильтру. Проверьте количество, расписания или выберите «Вся неделя».</p></div>'}</section>
      <section class="farm-plans" aria-labelledby="plans-title"><div class="section-label"><h2 id="plans-title">Планы фарма</h2><span>Выполнение не меняет инвентарь</span></div>${plans.length ? plans.map(plan => {
        const goal = state.materialGoals.find(goal => goal.id === plan.materialGoalId);
        const character = state.characters.find(character => character.id === goal.characterId);
        return `<article class="card farm-plan ${plan.completedAt ? 'plan-completed' : ''}" data-plan-id="${escapeHtml(plan.id)}"><div class="wide-card-heading"><h3>${escapeHtml(plan.title)}</h3><span class="pill">${plan.completedAt ? 'Выполнен' : 'Запланирован'}</span></div><p>${escapeHtml(character.name)} · ${escapeHtml(goal.name)}</p><p>${dayText(plan.days)}</p>${plan.notes ? `<p class="planner-notes">${escapeHtml(plan.notes)}</p>` : ''}${plan.completedAt ? `<p>Отмечен: ${plan.completedAt.replace('T', ' ').replace('Z', ' UTC')}</p>` : ''}${actions(button('toggle-plan', plan.completedAt ? 'Отменить выполнение' : 'Отметить выполненным', plan.id) + button('edit-plan', 'Редактировать план', plan.id) + button('delete-plan', 'Удалить план', plan.id))}</article>`;
      }).join('') : '<div class="card planner-empty"><p>Планов по этому фильтру пока нет. Создайте план и выберите дни вручную.</p></div>'}<p class="planner-help">Отметки не сбрасываются автоматически по неделям. Для повторного выполнения отмените отметку вручную. Количество owned меняется только при редактировании материала.</p></section>`;
  }
  function draw() { if (isFarm) drawFarm(now()); else drawCharacters(); }
  function closeEditor() { editorHost.hidden = true; editorHost.innerHTML = ''; editor = null; }
  function openEditor(kind, recordId = '', parentId = '') {
    const state = getState();
    const collection = kind === 'character' ? 'characters' : kind === 'material' ? 'materialGoals' : 'farmPlans';
    const record = recordId ? state[collection].find(record => record.id === recordId) : null;
    if (kind !== 'character' && !profileCharacters(state).length) throw new Error('Сначала добавьте персонажа в разделе «Персонажи».');
    const goals = state.materialGoals.filter(goal => goal.profileId === activeProfile(state)?.id);
    if (kind === 'plan' && !goals.length) throw new Error('Сначала добавьте персонажу хотя бы один материал.');
    editor = { kind, recordId };
    const labels = { character: 'персонажа', material: 'материала', plan: 'плана фарма' };
    let fields;
    if (kind === 'character') {
      fields = `<label>Имя<input name="name" required maxlength="100" value="${escapeHtml(record?.name ?? '')}"></label><label>Целевой уровень<input name="targetLevel" type="number" min="1" step="1" required value="${record?.targetLevel ?? 90}"></label><label>Заметки<textarea name="notes" maxlength="2000" rows="3">${escapeHtml(record?.notes ?? '')}</textarea></label>`;
    } else if (kind === 'material') {
      const selected = record?.characterId ?? parentId;
      fields = `<label>Персонаж<select name="characterId" ${record ? 'disabled' : ''}>${profileCharacters(state).map(character => `<option value="${escapeHtml(character.id)}" ${selected === character.id ? 'selected' : ''}>${escapeHtml(character.name)}</option>`).join('')}</select></label><label>Название материала<input name="name" required maxlength="100" value="${escapeHtml(record?.name ?? '')}"></label><div class="form-columns"><label>Есть · owned<input name="owned" type="number" min="0" max="${MAX_MATERIAL_AMOUNT}" step="1" required value="${record?.owned ?? 0}"></label><label>Нужно · needed<input name="needed" type="number" min="0" max="${MAX_MATERIAL_AMOUNT}" step="1" required value="${record?.needed ?? 0}"></label></div>${dayFields(record?.days ?? [])}<p class="planner-help">Пустое расписание означает «дни не указаны», а не ежедневную доступность. Числа относятся к этому персонажу и не являются общим складом.</p>`;
    } else {
      const selected = record?.materialGoalId ?? parentId;
      fields = `<label>Материал и персонаж<select name="materialGoalId">${goals.map(goal => `<option value="${escapeHtml(goal.id)}" ${selected === goal.id ? 'selected' : ''}>${escapeHtml(goal.name)} · ${escapeHtml(state.characters.find(character => character.id === goal.characterId).name)}</option>`).join('')}</select></label><label>Название плана<input name="title" required maxlength="100" value="${escapeHtml(record?.title ?? '')}"></label><label>Заметки<textarea name="notes" maxlength="2000" rows="3">${escapeHtml(record?.notes ?? '')}</textarea></label>${dayFields(record?.days ?? [])}<p class="planner-help">Выберите хотя бы один день. Дни плана задаются отдельно и не меняют доступность материала. Проверьте расписание в списке материалов.</p>`;
    }
    editorHost.innerHTML = `<h2>${record ? 'Редактирование' : 'Добавление'} ${labels[kind]}</h2><form id="planner-form" class="planner-form">${fields}<div class="planner-actions"><button class="action-button primary" type="submit">Сохранить</button>${button('cancel-editor', 'Отмена')}</div></form>`;
    editorHost.hidden = false;
    report(null);
    editorHost.querySelector('input:not(:disabled), select:not(:disabled)').focus();
  }
  host.addEventListener('submit', event => {
    if (event.target.id !== 'planner-form') return;
    event.preventDefault();
    try {
      const form = event.target.elements;
      const days = [...event.target.querySelectorAll('input[name="days"]:checked')].map(input => Number(input.value));
      let next;
      if (editor.kind === 'character') next = saveCharacter(getState(), { name: form.name.value, notes: form.notes.value, targetLevel: form.targetLevel.valueAsNumber }, editor.recordId || null);
      else if (editor.kind === 'material') next = saveMaterial(getState(), form.characterId.value, { name: form.name.value, owned: form.owned.valueAsNumber, needed: form.needed.valueAsNumber, days }, editor.recordId || null);
      else next = saveFarmPlan(getState(), { materialGoalId: form.materialGoalId.value, title: form.title.value, notes: form.notes.value, days }, editor.recordId || null);
      persist(next, 'Изменения сохранены.');
      closeEditor(); draw();
      host.querySelector('.planner-toolbar button').focus();
    } catch (error) { report(error); }
  }, on);
  host.addEventListener('click', event => {
    const filterButton = event.target.closest('[data-filter]');
    if (filterButton) {
      filter = filterButton.dataset.filter;
      persist({ ...getState(), settings: { ...getState().settings, farmFilter: filter } }, 'Фильтр сохранён.');
      host.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
      draw(); return;
    }
    const target = event.target.closest('[data-planner-action]');
    if (!target) return;
    const action = target.dataset.plannerAction, recordId = target.dataset.id;
    try {
      report(null);
      if (action === 'new-character') return openEditor('character');
      if (action === 'edit-character') return openEditor('character', recordId);
      if (action === 'new-material') return openEditor('material', '', recordId);
      if (action === 'edit-material') return openEditor('material', recordId);
      if (action === 'new-plan' || action === 'new-plan-for-material') return openEditor('plan', '', recordId);
      if (action === 'edit-plan') return openEditor('plan', recordId);
      if (action === 'cancel-editor') { closeEditor(); host.querySelector('.planner-toolbar button').focus(); return; }
      if (action === 'cancel-delete') { host.querySelector('#planner-delete').hidden = true; pendingDelete = null; host.querySelector('.planner-toolbar button').focus(); return; }
      if (['delete-character', 'delete-material', 'delete-plan'].includes(action)) {
        pendingDelete = { action, recordId };
        host.querySelector('#planner-delete-description').textContent = action === 'delete-character' ? 'Удалятся персонаж, его материалы и все связанные планы фарма.' : action === 'delete-material' ? 'Удалятся материал и все связанные с ним планы фарма.' : 'Удалится только план. Количество материалов не изменится.';
        host.querySelector('#planner-delete').hidden = false;
        host.querySelector('[data-planner-action="cancel-delete"]').focus(); return;
      }
      if (action === 'confirm-delete' && pendingDelete) {
        const remove = { 'delete-character': deleteCharacter, 'delete-material': deleteMaterial, 'delete-plan': deleteFarmPlan }[pendingDelete.action];
        persist(remove(getState(), pendingDelete.recordId), 'Запись удалена.');
        pendingDelete = null; host.querySelector('#planner-delete').hidden = true; closeEditor(); draw();
        host.querySelector('.planner-toolbar button').focus(); return;
      }
      if (action === 'toggle-plan') {
        persist(toggleFarmPlan(getState(), recordId, now()), 'Отметка плана сохранена. Инвентарь не изменён.'); draw();
        [...host.querySelectorAll('[data-planner-action="toggle-plan"]')].find(button => button.dataset.id === recordId)?.focus({ preventScroll: true });
      }
    } catch (error) { report(error); }
  }, on);
  function tick() {
    const profile = activeProfile(getState());
    const key = getPeriod(profile?.server ?? 'europe', 'daily', now()).periodKey;
    if (key !== lastPeriod) { lastPeriod = key; draw(); }
  }
  let timer;
  if (isFarm) {
    tick(); timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); }, on);
  } else draw();
  return () => { clearInterval(timer); events.abort(); };
}
