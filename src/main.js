import { createStorage, createInitialState, PAGES, storageErrorMessage } from './modules/storage/storage.js';
import { shell, sections, overview, icon } from './modules/rendering/views.js';
import { mountRoutine } from './modules/rendering/routinePage.js';
import { mountResinWidget } from './modules/rendering/resinWidget.js';
import { mountPlanner } from './modules/rendering/plannerPage.js';
import { mountGoals } from './modules/rendering/goalsPage.js';
import { mountStatistics } from './modules/rendering/statisticsPage.js';
import { mountSettings } from './modules/rendering/settingsPage.js';

const storage = createStorage();
const loaded = storage.load();
const initialRaw = storage.readRaw();
let expectedStoredRaw = initialRaw.ok ? initialRaw.raw : null;
let state = loaded.ok ? loaded.data : createInitialState();
let error = loaded.ok ? null : loaded.error;
let activePage;
let disposePage = () => {};

document.querySelector('#app').innerHTML = shell();
const view = document.querySelector('#view');
const menu = document.querySelector('#menu-toggle');
const sidebar = document.querySelector('#sidebar');

function showStorageStatus() {
  const warning = document.querySelector('#storage-warning');
  warning.hidden = !error;
  warning.textContent = error ? storageErrorMessage(error) : '';
}
function persistSettings(patch) {
  commitState({ ...state, settings: { ...state.settings, ...patch } });
}
function commitState(next) {
  state = next;
  const result = storage.save(state, { expectedRaw: expectedStoredRaw });
  if (result.ok) {
    state = result.data;
    expectedStoredRaw = JSON.stringify(state);
    error = null;
  } else error = result.error;
  showStorageStatus();
  window.dispatchEvent(new Event('teyvat:change'));
  return result;
}
function acceptReplacement(next) {
  state = next;
  expectedStoredRaw = JSON.stringify(next);
  error = null;
  showStorageStatus();
  applyTheme();
  window.dispatchEvent(new Event('teyvat:change'));
}
function applyTheme() {
  const dark = state.settings.theme === 'dark';
  document.documentElement.dataset.theme = state.settings.theme;
  document.querySelector('meta[name="theme-color"]').content = dark ? '#121e29' : '#eee9dd';
  const button = document.querySelector('#theme-toggle');
  button.innerHTML = icon(dark ? 'sun' : 'moon');
  button.setAttribute('aria-label', `Включить ${dark ? 'светлую' : 'тёмную'} тему`);
  view.querySelectorAll('input[name="theme"]').forEach(input => { input.checked = input.value === state.settings.theme; });
}
function setMenu(open) {
  sidebar.classList.toggle('is-open', open);
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
}
function renderPage({ focus = false } = {}) {
  let requested = location.hash.slice(1);
  if (!requested) requested = state.settings.lastPage;
  if (!PAGES.includes(requested)) requested = 'overview';
  if (location.hash !== `#${requested}`) history.replaceState(null, '', `#${requested}`);
  activePage = requested;
  const section = sections.find(section => section.id === activePage);
  document.title = `Teyvat Tasks — ${section.label}`;
  document.querySelector('#breadcrumb-page').textContent = section.label;
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === activePage) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  disposePage();
  disposePage = () => {};
  if (activePage === 'routine') {
    disposePage = mountRoutine({ host: view, getState: () => state, commit: commitState });
  } else if (activePage === 'characters' || activePage === 'farm') {
    disposePage = mountPlanner({ mode: activePage, host: view, getState: () => state, commit: commitState });
  } else if (activePage === 'goals') {
    disposePage = mountGoals({ host: view, getState: () => state, commit: commitState });
  } else if (activePage === 'statistics') {
    disposePage = mountStatistics({ host: view, getState: () => state });
  } else if (activePage === 'settings') {
    disposePage = mountSettings({ host: view, getState: () => state, commit: commitState, storage, acceptReplacement });
  } else {
    view.innerHTML = overview(state, Date.now());
    if (activePage === 'overview') {
      disposePage = mountResinWidget({ host: view.querySelector('#resin-tracker'), getState: () => state, commit: commitState });
    }
  }
  if (state.settings.lastPage !== activePage) persistSettings({ lastPage: activePage });
  setMenu(false);
  applyTheme();
  if (focus) {
    document.querySelector('#main-content').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  setMenu(open);
  if (open) sidebar.querySelector('[aria-current="page"]').focus();
});
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('#main-content').focus();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    menu.focus();
  }
});
sidebar.addEventListener('click', event => {
  if (event.target.closest('a')) {
    setMenu(false);
    document.querySelector('#main-content').focus({ preventScroll: true });
  }
});
document.querySelector('#theme-toggle').addEventListener('click', () => {
  persistSettings({ theme: state.settings.theme === 'light' ? 'dark' : 'light' });
  applyTheme();
});
view.addEventListener('change', event => {
  if (event.target.matches('input[name="theme"]')) {
    persistSettings({ theme: event.target.value });
    applyTheme();
  }
});
window.addEventListener('hashchange', () => renderPage({ focus: true }));
if (loaded.ok && loaded.isNew) {
  const saved = storage.save(state);
  if (!saved.ok) error = saved.error;
  else expectedStoredRaw = JSON.stringify(state);
}
showStorageStatus();
renderPage();
