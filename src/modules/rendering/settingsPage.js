import { settings } from './views.js';
import { activeProfile } from '../../core/charactersFarm.js';
import { changeServer } from '../../core/settings.js';
import { createInitialState } from '../storage/storage.js';
import { MAX_IMPORT_BYTES, COLLECTION_LABELS, parseImport, serializeExport, summarizeData, transferMessage } from '../storage/dataTransfer.js';
import { SERVERS } from '../time/gameClock.js';

function download(text, prefix) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function mountSettings({ host, getState, commit, storage, acceptReplacement, now = () => Date.now() }) {
  const events = new AbortController(), on = { signal: events.signal };
  let pendingImport = null, pendingClear = null, request = 0;
  host.innerHTML = settings(getState().settings.theme) + `
    <section class="card settings-card"><h2>Игровой сервер</h2><label class="settings-field" for="settings-server">Сервер текущего профиля<select id="settings-server">${Object.entries(SERVERS).map(([id, server]) => `<option value="${id}">${server.label} · UTC${server.offsetHours > 0 ? '+' : ''}${server.offsetHours}</option>`).join('')}</select></label><p>Смещения фиксированы, без DST. Смена сервера не удаляет историю. Настройка общая с разделом «Рутина».</p></section>
    <p id="settings-status" class="planner-status" role="status" hidden></p><p id="settings-error" class="warning" role="alert" tabindex="-1" hidden></p>
    <section class="card settings-card"><h2>Экспорт и резервная копия</h2><p>JSON включает все коллекции, настройки и профили текущей вкладки. Сохраните файл вне браузера: очистка данных сайта удаляет и локальную копию.</p><div class="planner-actions"><button type="button" class="action-button primary" id="export-data">Экспорт всех данных</button><button type="button" class="action-button" id="download-backup">Скачать резервную копию</button></div><p id="backup-description" class="settings-hint"></p><details class="recovery-details"><summary>Восстановление исходной записи</summary><p>Если текущий JSON повреждён или в другой вкладке есть изменения, сначала скачайте исходную запись. Это файл для ручного восстановления, он может не пройти импорт.</p><div class="planner-actions"><button type="button" class="action-button" id="export-raw">Скачать исходную запись</button><button type="button" class="action-button" id="export-backup-raw">Исходная запись из копии</button></div></details></section>
    <section class="card settings-card"><h2>Импорт JSON</h2><p>Будут заменены все рабочие данные, а не объединены записи. Принимается schemaVersion 1, до 5 МиБ. Закройте другие вкладки приложения перед импортом.</p><label class="settings-field" for="import-file">JSON-файл Teyvat Tasks<input type="file" id="import-file" accept=".json,application/json" aria-describedby="import-help"></label><p id="import-help" class="settings-hint">Выбор файла только проверяет данные. Перед заменой вы увидите предпросмотр и отдельное подтверждение.</p>
    <section id="import-preview" aria-labelledby="import-preview-title" hidden><h3 id="import-preview-title">Предпросмотр импорта</h3><p id="import-file-description"></p><div id="import-summary" class="table-scroll"></div><form id="confirm-import-form"><label class="confirmation-field"><input type="checkbox" id="confirm-import-check" required> Понимаю, что все рабочие данные будут заменены. Перед заменой будет создана локальная резервная копия.</label><div class="planner-actions"><button class="action-button primary" type="submit">Создать копию и заменить данные</button><button class="action-button" type="button" id="cancel-import">Отмена импорта</button></div></form></section></section>
    <section class="card settings-card danger-zone"><h2>Удаление рабочих данных</h2><p>Очистит все профили и коллекции. Перед очисткой будет создана резервная копия; она останется доступна для скачивания. Для удаления и копии используйте очистку данных сайта в браузере.</p><button type="button" class="action-button danger" id="request-clear">Удалить рабочие данные</button><form id="confirm-clear-form" hidden><p id="clear-summary"></p><label class="confirmation-field"><input type="checkbox" id="confirm-clear-check" required> Подтверждаю удаление рабочих данных всех профилей.</label><div class="planner-actions"><button type="submit" class="action-button danger">Создать копию и удалить данные</button><button type="button" class="action-button" id="cancel-clear">Отмена удаления</button></div></form></section>`;
  const errorBox = host.querySelector('#settings-error'), status = host.querySelector('#settings-status');
  function report(message, error = false) {
    errorBox.hidden = !error; status.hidden = error;
    (error ? errorBox : status).textContent = message;
    if (error) errorBox.focus({ preventScroll: false });
  }
  function refreshBackup() {
    const result = storage.loadBackup();
    const backup = result.ok ? result.backup : null;
    host.querySelector('#download-backup').disabled = !backup;
    host.querySelector('#export-backup-raw').disabled = !backup || backup.previousStoredRaw === null;
    host.querySelector('#backup-description').textContent = backup ? `Последняя копия: ${backup.createdAt.replace('T', ' ').replace('Z', ' UTC')}. Хранится одна последняя копия; следующая замена обновит её.` : result.ok ? 'Резервной копии пока нет.' : transferMessage(result.error);
  }
  function closeImport(resetFile = true) { if (resetFile) host.querySelector('#import-file').value = ''; pendingImport = null; host.querySelector('#import-preview').hidden = true; host.querySelector('#confirm-import-form').reset(); }
  function closeClear() { pendingClear = null; host.querySelector('#confirm-clear-form').hidden = true; host.querySelector('#confirm-clear-form').reset(); }
  function sync() {
    host.querySelector('#settings-server').value = activeProfile(getState())?.server ?? 'europe';
    const marker = JSON.stringify(getState());
    if ((pendingImport && pendingImport.memory !== marker) || (pendingClear && pendingClear.memory !== marker)) {
      closeImport(); closeClear(); report('Данные или настройки изменились. Повторите предпросмотр перед заменой или удалением.');
    }
    refreshBackup();
  }
  function prepare() {
    const current = structuredClone(getState());
    const raw = storage.readRaw();
    if (!raw.ok) throw new Error(transferMessage(raw.error));
    return { current, memory: JSON.stringify(current), expectedRaw: raw.raw };
  }
  function replace(pending, candidate, reason) {
    if (!pending || JSON.stringify(getState()) !== pending.memory) throw new Error(transferMessage('stale-preview'));
    const result = storage.replaceWithBackup(candidate, pending.current, pending.expectedRaw, now(), reason);
    refreshBackup();
    if (!result.ok) throw new Error(transferMessage(result.error));
    closeImport(); closeClear();
    acceptReplacement(result.data);
    sync();
    report(reason === 'before-import' ? 'Импорт завершён. Предыдущие данные сохранены в резервной копии.' : 'Рабочие данные удалены. Предыдущие данные доступны в резервной копии.');
  }
  host.querySelector('#settings-server').addEventListener('change', event => {
    try {
      const result = commit(changeServer(getState(), event.target.value));
      report(result.ok ? 'Игровой сервер сохранён.' : 'Сервер изменён только в текущей вкладке: сохранить настройку не удалось.');
    } catch (error) { report(error.message, true); }
  }, on);
  host.querySelector('#export-data').addEventListener('click', () => {
    try { download(serializeExport(getState()), 'teyvat-tasks'); report('JSON подготовлен для скачивания. Проверьте папку загрузок браузера.'); }
    catch (error) { report(error.message, true); }
  }, on);
  host.querySelector('#export-raw').addEventListener('click', () => {
    const result = storage.readRaw();
    if (!result.ok || result.raw === null) return report('Исходная запись недоступна или отсутствует.', true);
    download(result.raw, 'teyvat-tasks-original'); report('Исходная запись подготовлена для скачивания.');
  }, on);
  host.querySelector('#download-backup').addEventListener('click', () => {
    const result = storage.loadBackup();
    if (!result.ok || !result.backup) return report('Резервная копия недоступна.', true);
    download(serializeExport(result.backup.data), 'teyvat-tasks-backup'); report('Копия подготовлена для скачивания. Для восстановления выберите скачанный файл в импорте.');
  }, on);
  host.querySelector('#export-backup-raw').addEventListener('click', () => {
    const result = storage.loadBackup();
    if (!result.ok || !result.backup || result.backup.previousStoredRaw === null) return report('Исходная запись из копии недоступна.', true);
    download(result.backup.previousStoredRaw, 'teyvat-tasks-backup-original'); report('Исходная запись из резервной копии подготовлена для скачивания.');
  }, on);
  host.querySelector('#import-file').addEventListener('change', async event => {
    const requestId = ++request;
    closeImport(false); closeClear();
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error(transferMessage('file-too-large'));
      const text = await file.text();
      if (events.signal.aborted || requestId !== request) return;
      const parsed = parseImport(text);
      if (!parsed.ok) throw new Error(transferMessage(parsed.error));
      pendingImport = { ...prepare(), data: parsed.data };
      host.querySelector('#import-file-description').textContent = `${file.name} · схема 1 · тема ${parsed.data.settings.theme === 'dark' ? 'тёмная' : 'светлая'}. Проверьте количество записей.`;
      const current = summarizeData(pendingImport.current), imported = summarizeData(parsed.data);
      // Все подписи статичны, все численные значения получены из проверенных массивов.
      const table = document.createElement('table');
      const caption = document.createElement('caption'); caption.textContent = 'Текущие и импортируемые данные'; table.append(caption);
      const thead = document.createElement('thead'), header = document.createElement('tr');
      for (const label of ['Коллекция', 'Сейчас', 'Из файла']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; header.append(th); }
      thead.append(header); table.append(thead);
      const body = document.createElement('tbody');
      for (const [name, label] of Object.entries(COLLECTION_LABELS)) {
        const row = document.createElement('tr'), heading = document.createElement('th'); heading.scope = 'row'; heading.textContent = label; row.append(heading);
        for (const count of [current[name], imported[name]]) { const cell = document.createElement('td'); cell.textContent = String(count); row.append(cell); }
        body.append(row);
      }
      table.append(body); host.querySelector('#import-summary').replaceChildren(table);
      host.querySelector('#import-preview').hidden = false;
      report('Файл прошёл проверку. Рабочие данные пока не изменены.');
      host.querySelector('#confirm-import-check').focus();
    } catch (error) { if (!events.signal.aborted && requestId === request) { closeImport(); report(error.message, true); } }
  }, on);
  host.querySelector('#confirm-import-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    try { replace(pendingImport, pendingImport?.data, 'before-import'); }
    catch (error) { report(error.message, true); }
  }, on);
  host.querySelector('#cancel-import').addEventListener('click', () => { ++request; closeImport(); report('Импорт отменён. Данные не изменены.'); host.querySelector('#import-file').focus(); }, on);
  host.querySelector('#request-clear').addEventListener('click', () => {
    try { ++request; closeImport(); pendingClear = prepare(); host.querySelector('#clear-summary').textContent = `Будут удалены все профили (${pendingClear.current.profiles.length}) и все связанные записи. Тема и настройки вернутся к исходным.`; host.querySelector('#confirm-clear-form').hidden = false; host.querySelector('#confirm-clear-check').focus(); }
    catch (error) { report(error.message, true); }
  }, on);
  host.querySelector('#confirm-clear-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    try { replace(pendingClear, createInitialState(), 'before-delete'); }
    catch (error) { report(error.message, true); }
  }, on);
  host.querySelector('#cancel-clear').addEventListener('click', () => { closeClear(); report('Удаление отменено. Данные не изменены.'); host.querySelector('#request-clear').focus(); }, on);
  window.addEventListener('teyvat:change', sync, on);
  sync();
  return () => { ++request; events.abort(); };
}
