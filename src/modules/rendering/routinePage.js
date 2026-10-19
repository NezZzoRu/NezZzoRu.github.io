import { SERVERS, getPeriod, formatCountdown } from '../time/gameClock.js';
import { initializeRoutine, createTemplate, editTemplate, deleteTemplate, setServer, getCurrentTasks, adjustCompletion } from '../routine/routine.js';
import { icon } from './views.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const periodLabel = type => type === 'daily' ? 'Ежедневные' : 'Еженедельные';

export function mountRoutine({ host, getState, commit, now = () => Date.now() }) {
  const initial = initializeRoutine(getState());
  if (initial.changed) commit(initial.state);
  const profileId = initial.profileId;
  const events = new AbortController();
  const on = { signal: events.signal };
  let editorId = null;
  let deleteId = null;
  let lastKeys = '';
  const profile = () => getState().profiles.find(profile => profile.id === profileId);

  host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">ДЕНЬ ЗА ДНЁМ · НЕДЕЛЯ ЗА НЕДЕЛЕЙ</p><h1>Рутина</h1><p class="subtitle">Соберите свой ритм приключений. Один шаг — одна отметка.</p></div>${icon('check')}</div>
    <div class="routine-toolbar card"><label for="routine-server">Игровой сервер<select id="routine-server">${Object.entries(SERVERS).map(([id, server]) => `<option value="${id}">${server.label} · UTC${server.offsetHours > 0 ? '+' : ''}${server.offsetHours}</option>`).join('')}</select></label><p>Сброс в 04:00 сервера, неделя — с понедельника.<br>Смещения фиксированы, без перехода на летнее время.</p><button class="action-button primary" id="new-template" type="button">+ Новый шаблон</button></div>
    <p class="routine-help">Начальные шаблоны — редактируемые примеры. Настройте их под себя или удалите. Отключённые шаблоны остаются в списке, но новые отметки для них недоступны.</p>
    <div id="routine-message" class="warning" role="alert" hidden></div>
    <section id="template-editor" class="card" aria-labelledby="editor-title" hidden>
      <h2 id="editor-title">Новый шаблон</h2><p>Название и цель сохраняются в истории при первой отметке. Изменения шаблона не переписывают уже начатые периоды.</p>
      <form id="template-form"><label>Название<input name="title" required maxlength="100" placeholder="Например, награды за поручения"></label><div class="form-columns"><label>Повторение<select name="period"><option value="daily">Ежедневно</option><option value="weekly">Еженедельно</option></select></label><label>Действий за период<input name="target" type="number" min="1" max="999" step="1" value="1" required></label></div><label class="checkbox-field"><input name="enabled" type="checkbox" checked> Шаблон включён</label><div class="form-actions"><button class="action-button primary" type="submit">Сохранить шаблон</button><button class="action-button" id="cancel-template" type="button">Отмена</button></div></form>
    </section>
    <section id="delete-confirm" class="card delete-confirm" aria-labelledby="delete-title" hidden><h2 id="delete-title">Удалить шаблон?</h2><p id="delete-description"></p><p>История отметок останется. Сам шаблон восстановить через интерфейс нельзя.</p><div class="form-actions"><button class="action-button danger" id="confirm-delete" type="button">Удалить шаблон</button><button class="action-button" id="cancel-delete" type="button">Отмена</button></div></section>
    <div class="reset-grid"><section class="card reset-card"><div>${icon('sun')}<h2>Ежедневное обновление</h2></div><p>До следующего сброса</p><strong id="daily-countdown"></strong><p id="daily-period"></p></section><section class="card reset-card"><div>${icon('book')}<h2>Еженедельное обновление</h2></div><p>До следующего сброса</p><strong id="weekly-countdown"></strong><p id="weekly-period"></p></section></div>
    <div id="routine-current"></div>
    <section class="routine-history card" aria-labelledby="history-title"><h2 id="history-title">История по периодам</h2><p>Предыдущие периоды доступны только для чтения. Смена сервера, редактирование и удаление шаблонов не меняют историю.</p><div id="routine-history"></div></section>`;
  const serverSelect = host.querySelector('#routine-server');
  serverSelect.value = profile().server;
  const editor = host.querySelector('#template-editor');
  const form = host.querySelector('#template-form');
  const message = host.querySelector('#routine-message');

  function report(error) {
    message.textContent = error?.message ?? '';
    message.hidden = !error;
  }
  function closeEditor() {
    editor.hidden = true;
    editorId = null;
  }
  function openEditor(template = null) {
    editorId = template?.id ?? null;
    form.reset();
    form.elements.title.value = template?.title ?? '';
    form.elements.period.value = template?.period ?? 'daily';
    form.elements.target.value = template?.target ?? 1;
    form.elements.enabled.checked = template?.enabled ?? true;
    host.querySelector('#editor-title').textContent = template ? 'Редактирование шаблона' : 'Новый шаблон';
    editor.hidden = false;
    report(null);
    form.elements.title.focus();
  }
  function taskRow(row) {
    const { template, period, count, target, title } = row;
    const changed = title !== template.title || target !== template.target;
    return `<article class="routine-task ${template.enabled ? '' : 'is-disabled'}" data-template="${escape(template.id)}">
      <div class="routine-task-copy"><h3>${escape(title)}</h3><span class="pill">${template.enabled ? 'Включён' : 'Отключён'}</span>${changed ? `<p class="snapshot-note">Шаблон теперь: «${escape(template.title)}», цель ${template.target}. В этом периоде сохранена прежняя цель.</p>` : ''}</div>
      <div class="routine-counter"><button class="action-button counter-button" type="button" data-action="minus" data-id="${escape(template.id)}" data-key="${period.periodKey}" aria-label="Отменить отметку: ${escape(title)}" ${count === 0 ? 'disabled' : ''}>−</button><output aria-label="Выполнение: ${escape(title)}">${count}/${target}</output><button class="action-button counter-button" type="button" data-action="plus" data-id="${escape(template.id)}" data-key="${period.periodKey}" aria-label="Отметить действие: ${escape(title)}" ${!template.enabled || count === target ? 'disabled' : ''}>+</button></div>
      <div class="routine-task-actions"><button class="action-button" type="button" data-action="edit" data-id="${escape(template.id)}">Редактировать</button><button class="action-button" type="button" data-action="toggle" data-id="${escape(template.id)}">${template.enabled ? 'Отключить' : 'Включить'}</button><button class="action-button danger" type="button" data-action="delete" data-id="${escape(template.id)}">Удалить</button></div>
    </article>`;
  }
  function drawCurrent(timestamp) {
    const focus = document.activeElement?.closest('[data-action]');
    const restore = focus && { id: focus.dataset.id, action: focus.dataset.action };
    host.querySelector('#routine-current').innerHTML = ['daily', 'weekly'].map(type => {
      const rows = getCurrentTasks(getState(), profileId, type, timestamp);
      return `<section class="routine-group" aria-labelledby="${type}-title"><div class="section-label"><h2 id="${type}-title">${periodLabel(type)} шаблоны</h2><span>${rows.filter(row => row.template.enabled).length} включено</span></div><div class="card routine-list">${rows.length ? rows.map(taskRow).join('') : '<p class="routine-empty">Шаблонов пока нет. Создайте собственный — примеры автоматически не возвращаются.</p>'}</div></section>`;
    }).join('');
    if (restore) {
      const target = [...host.querySelectorAll('[data-action]')].find(button => button.dataset.id === restore.id && button.dataset.action === restore.action);
      if (target && !target.disabled) target.focus({ preventScroll: true });
      else host.querySelector('#routine-current').focus({ preventScroll: true });
    }
  }
  host.querySelector('#routine-current').tabIndex = -1;
  function drawHistory(timestamp) {
    const container = host.querySelector('#routine-history');
    const opened = new Set([...container.querySelectorAll('details[open]')].map(details => details.dataset.key));
    const groups = new Map();
    for (const record of getState().completions.filter(record => record.profileId === profileId)) {
      if (!groups.has(record.periodKey)) groups.set(record.periodKey, []);
      groups.get(record.periodKey).push(record);
    }
    container.innerHTML = [...groups.entries()].sort(([a], [b]) => b.split(':')[2].localeCompare(a.split(':')[2]) || a.localeCompare(b)).map(([key, records]) => {
      const [serverId, type, date] = key.split(':');
      const current = serverId === profile().server && key === getPeriod(serverId, type, timestamp).periodKey;
      return `<details data-key="${key}" ${opened.has(key) ? 'open' : ''}><summary>${SERVERS[serverId].label} · ${periodLabel(type)} · с ${date}<span>${current ? 'Текущий период' : 'История'} · ${records.reduce((sum, record) => sum + record.count, 0)} отметок</span></summary><code>${key}</code><ul>${records.map(record => `<li><span>${escape(record.title)}</span><strong>${record.count}/${record.target}</strong></li>`).join('')}</ul></details>`;
    }).join('') || '<p class="routine-empty">История появится после первой отметки. При обновлении периода она останется здесь.</p>';
  }
  function tick(force = false) {
    const timestamp = now();
    const periods = ['daily', 'weekly'].map(type => getPeriod(profile().server, type, timestamp));
    for (const period of periods) {
      host.querySelector(`#${period.type}-countdown`).textContent = formatCountdown(period.remainingMs);
      host.querySelector(`#${period.type}-period`).textContent = `Начало периода: ${period.startDate} · 04:00 сервера`;
    }
    const keys = periods.map(period => period.periodKey).join('|');
    if (force || keys !== lastKeys) {
      lastKeys = keys;
      drawCurrent(timestamp);
      drawHistory(timestamp);
    }
  }
  host.querySelector('#new-template').addEventListener('click', () => openEditor(), on);
  host.querySelector('#cancel-template').addEventListener('click', () => { closeEditor(); host.querySelector('#new-template').focus(); }, on);
  host.querySelector('#cancel-delete').addEventListener('click', () => {
    host.querySelector('#delete-confirm').hidden = true;
    deleteId = null;
    host.querySelector('#new-template').focus();
  }, on);
  host.querySelector('#confirm-delete').addEventListener('click', () => {
    try {
      commit(deleteTemplate(getState(), profileId, deleteId));
      if (editorId === deleteId) closeEditor();
      host.querySelector('#delete-confirm').hidden = true;
      deleteId = null;
      tick(true);
      host.querySelector('#new-template').focus();
    } catch (error) { report(error); }
  }, on);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const fields = { title: form.elements.title.value, period: form.elements.period.value, target: Number(form.elements.target.value), enabled: form.elements.enabled.checked };
    try {
      commit(editorId ? editTemplate(getState(), profileId, editorId, fields) : createTemplate(getState(), profileId, fields));
      closeEditor();
      report(null);
      tick(true);
      host.querySelector('#new-template').focus();
    } catch (error) { report(error); }
  }, on);
  serverSelect.addEventListener('change', () => {
    commit(setServer(getState(), profileId, serverSelect.value));
    report(null);
    tick(true);
  }, on);
  host.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const template = getState().taskTemplates.find(template => template.id === button.dataset.id && template.profileId === profileId);
    if (!template) return;
    const action = button.dataset.action;
    try {
      report(null);
      if (action === 'edit') return openEditor(template);
      if (action === 'delete') {
        deleteId = template.id;
        host.querySelector('#delete-description').textContent = `«${template.title}»`;
        host.querySelector('#delete-confirm').hidden = false;
        host.querySelector('#cancel-delete').focus();
        return;
      }
      if (action === 'toggle') commit(editTemplate(getState(), profileId, template.id, { enabled: !template.enabled }));
      else commit(adjustCompletion(getState(), profileId, template.id, action === 'plus' ? 1 : -1, now(), button.dataset.key));
      tick(true);
    } catch (error) { report(error); tick(true); }
  }, on);
  const visibility = () => { if (!document.hidden) tick(); };
  document.addEventListener('visibilitychange', visibility, on);
  tick(true);
  const timer = setInterval(tick, 1000);
  return () => { clearInterval(timer); events.abort(); };
}
