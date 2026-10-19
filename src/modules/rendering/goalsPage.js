import { TASK_STATUSES, TASK_PRIORITIES, taskCategories, savePersonalTask, deletePersonalTask, setPersonalTaskStatus, filterPersonalTasks } from '../../core/personalTasks.js';
import { escapeHtml as esc } from './plannerViews.js';
import { icon } from './views.js';
const options = (values, selected) => Object.entries(values).map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
const action = (name, text, id = '') => `<button type="button" class="action-button ${name === 'delete' ? 'danger' : ''}" data-goal-action="${name}" data-id="${esc(id)}">${text}</button>`;

export function mountGoals({ host, getState, commit, now = () => Date.now() }) {
  const events = new AbortController(), on = { signal: events.signal };
  let filters = getState().settings.goalFilters ?? { status: 'all', priority: 'all', category: null };
  let editing = null, deleting = null;
  host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">У КАЖДОГО ПУТИ ЕСТЬ ЦЕЛЬ</p><h1>Мои цели</h1><p class="subtitle">Квесты, открытия и личные планы — в вашем темпе.</p></div>${icon('flag')}</div>
    <div class="card planner-toolbar">${action('new', '+ Новая задача')}<p>Категорию можно выбрать из списка или придумать свою.</p></div>
    <div class="card goal-filters"><label>Статус<select id="goal-filter-status"><option value="all">Все статусы</option>${options(TASK_STATUSES, filters.status)}</select></label><label>Категория<select id="goal-filter-category"></select></label><label>Приоритет<select id="goal-filter-priority"><option value="all">Все приоритеты</option>${options(TASK_PRIORITIES, filters.priority)}</select></label>${action('reset-filters', 'Сбросить фильтры')}</div>
    <p id="goal-status" class="planner-status" role="status" hidden></p><p id="goal-error" class="warning" role="alert" hidden></p>
    <section class="card planner-editor" id="goal-editor" hidden></section>
    <section class="card planner-delete" id="goal-delete" aria-labelledby="goal-delete-heading" hidden><h2 id="goal-delete-heading">Удалить задачу?</h2><p>Задача и её отметка выполнения будут удалены. Статистика пересчитается.</p><div class="planner-actions">${action('confirm-delete', 'Удалить')}${action('cancel-delete', 'Отмена')}</div></section>
    <div id="goal-list"></div>`;
  const editor = host.querySelector('#goal-editor');
  function report(error) { const box = host.querySelector('#goal-error'); box.hidden = !error; box.textContent = error?.message ?? ''; }
  function persist(next, text) {
    const result = commit(next), box = host.querySelector('#goal-status');
    box.hidden = false; box.textContent = result.ok ? text : 'Изменения учтены только в текущей вкладке: сохранить данные не удалось.'; report(null);
  }
  function draw() {
    const categories = [...new Set([...taskCategories(getState()), ...(filters.category ? [filters.category] : [])])];
    host.querySelector('#goal-filter-category').innerHTML = `<option value="">Все категории</option>${categories.map(category => `<option value="${esc(category)}" ${filters.category === category ? 'selected' : ''}>${esc(category)}</option>`).join('')}`;
    host.querySelector('#goal-filter-status').value = filters.status;
    host.querySelector('#goal-filter-priority').value = filters.priority;
    const tasks = filterPersonalTasks(getState(), filters);
    host.querySelector('#goal-list').innerHTML = tasks.length ? `<div class="personal-task-list">${tasks.map(task => `<article class="card personal-task" data-task-id="${esc(task.id)}"><div class="wide-card-heading"><h2>${esc(task.title)}</h2><span class="pill">${TASK_STATUSES[task.status]}</span></div><div class="goal-meta"><span>${esc(task.category)}</span><span>Приоритет: ${TASK_PRIORITIES[task.priority]}</span><span>${task.dueDate ? `Срок: ${task.dueDate}` : 'Без срока'}</span></div>${task.notes ? `<p class="planner-notes">${esc(task.notes)}</p>` : ''}${task.completedAt ? `<p class="goal-completed-time">Выполнено: ${task.completedAt.replace('T', ' ').replace('Z', ' UTC')}</p>` : ''}<div class="planner-actions">${task.status === 'completed' ? action('reopen', 'Вернуть в работу', task.id) : action('complete', 'Выполнить', task.id)}${task.status === 'planned' ? action('start', 'Начать', task.id) : ''}${action('edit', 'Редактировать', task.id)}${action('delete', 'Удалить', task.id)}</div></article>`).join('')}</div>` : '<section class="card planner-empty"><h2>Здесь пока пусто</h2><p>Создайте задачу или измените фильтры. Выполненные задачи можно вернуть в работу.</p></section>';
  }
  function closeEditor() { editor.hidden = true; editor.innerHTML = ''; editing = null; }
  function openEditor(task = null) {
    editing = task?.id ?? null;
    editor.innerHTML = `<h2>${task ? 'Редактирование задачи' : 'Новая задача'}</h2><form id="goal-form" class="planner-form"><label>Название<input name="title" required maxlength="100" value="${esc(task?.title ?? '')}"></label><label>Категория · можно свою<input name="category" required maxlength="50" list="goal-categories" value="${esc(task?.category ?? 'другое')}"><datalist id="goal-categories">${taskCategories(getState()).map(category => `<option value="${esc(category)}"></option>`).join('')}</datalist></label><div class="form-columns"><label>Приоритет<select name="priority">${options(TASK_PRIORITIES, task?.priority ?? 'normal')}</select></label><label>Статус<select name="status">${options(TASK_STATUSES, task?.status ?? 'planned')}</select></label></div><label>Срок · необязательно<input name="dueDate" type="date" value="${task?.dueDate ?? ''}"></label><label>Заметки<textarea name="notes" maxlength="2000" rows="3">${esc(task?.notes ?? '')}</textarea></label><div class="planner-actions"><button class="action-button primary" type="submit">Сохранить задачу</button>${action('cancel-editor', 'Отмена')}</div></form>`;
    editor.hidden = false; report(null); editor.querySelector('[name="title"]').focus();
  }
  host.addEventListener('submit', event => {
    if (event.target.id !== 'goal-form') return;
    event.preventDefault();
    const form = event.target.elements;
    try {
      persist(savePersonalTask(getState(), { title: form.title.value, category: form.category.value, priority: form.priority.value, status: form.status.value, dueDate: form.dueDate.value || null, notes: form.notes.value }, now(), editing), 'Задача сохранена.');
      closeEditor(); draw(); host.querySelector('[data-goal-action="new"]').focus();
    } catch (error) { report(error); }
  }, on);
  function saveFilters() {
    persist({ ...getState(), settings: { ...getState().settings, goalFilters: filters } }, 'Фильтры сохранены.'); draw();
  }
  host.addEventListener('change', event => {
    if (event.target.id.startsWith('goal-filter-')) {
      filters = { status: host.querySelector('#goal-filter-status').value, category: host.querySelector('#goal-filter-category').value || null, priority: host.querySelector('#goal-filter-priority').value };
      saveFilters();
    }
  }, on);
  host.addEventListener('click', event => {
    const button = event.target.closest('[data-goal-action]');
    if (!button) return;
    const { goalAction: type, id } = button.dataset;
    try {
      report(null);
      if (type === 'new') return openEditor();
      if (type === 'edit') return openEditor(getState().personalTasks.find(task => task.id === id));
      if (type === 'cancel-editor') { closeEditor(); host.querySelector('[data-goal-action="new"]').focus(); return; }
      if (type === 'reset-filters') { filters = { status: 'all', priority: 'all', category: null }; saveFilters(); return; }
      if (type === 'delete') { deleting = id; host.querySelector('#goal-delete').hidden = false; host.querySelector('[data-goal-action="cancel-delete"]').focus(); return; }
      if (type === 'cancel-delete') { deleting = null; host.querySelector('#goal-delete').hidden = true; host.querySelector('[data-goal-action="new"]').focus(); return; }
      if (type === 'confirm-delete' && deleting) {
        persist(deletePersonalTask(getState(), deleting), 'Задача удалена.'); deleting = null; host.querySelector('#goal-delete').hidden = true; closeEditor(); draw(); host.querySelector('[data-goal-action="new"]').focus(); return;
      }
      if (['complete', 'reopen', 'start'].includes(type)) {
        persist(setPersonalTaskStatus(getState(), id, type === 'complete' ? 'completed' : 'in-progress', now()), 'Статус обновлён. Статистика пересчитана.');
        draw();
        const nextFocus = [...host.querySelectorAll('[data-goal-action="edit"]')].find(button => button.dataset.id === id) ?? host.querySelector('[data-goal-action="new"]');
        nextFocus.focus({ preventScroll: true });
      }
    } catch (error) { report(error); }
  }, on);
  draw();
  return () => events.abort();
}
