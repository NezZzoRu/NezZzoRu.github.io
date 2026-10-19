import { getCurrentTasks } from '../routine/routine.js';
import { SERVERS } from '../time/gameClock.js';
import { characterOverview, goalsOverview } from './plannerViews.js';

export const sections = [
  { id: 'overview', label: 'Обзор', icon: 'compass', caption: 'Ваш журнал приключений' },
  { id: 'routine', label: 'Рутина', icon: 'check', caption: 'Маленькие шаги, большой путь' },
  { id: 'characters', label: 'Персонажи', icon: 'people', caption: 'Спутники в ваших приключениях' },
  { id: 'farm', label: 'Фарм', icon: 'leaf', caption: 'Ресурсы для будущих свершений' },
  { id: 'goals', label: 'Мои цели', icon: 'flag', caption: 'У каждого путешествия есть цель' },
  { id: 'statistics', label: 'Статистика', icon: 'chart', caption: 'История вашего пути' },
  { id: 'settings', label: 'Настройки', icon: 'settings', caption: 'Путешествуйте в своём ритме' },
];

// Геометрические иконки нарисованы для этого проекта.
const paths = {
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 12 3 3 5-6"/>',
  people: '<circle cx="10" cy="8" r="3"/><path d="M4 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 2 4v2"/>',
  leaf: '<path d="M19 4C8 3 3 9 6 15s14 5 13-11ZM5 21l10-12M10 15h5"/>',
  flag: '<path d="M5 21V4m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  chart: '<path d="M4 4v16h17M9 16v-5m5 5V7m5 9v-4"/>',
  settings: '<path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  moon: '<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  drop: '<path d="M12 3C9 8 5 11 5 15a7 7 0 0 0 14 0c0-4-4-7-7-12Z"/><path d="M9 16a3 3 0 0 0 3 3"/>',
  star: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
  book: '<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
};
export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.star}</svg>`;
}
const link = (page, text) => `<a class="text-link" href="#${page}">${text}${icon('arrow')}</a>`;

export function shell() {
  return `<aside class="sidebar" id="sidebar">
    <a class="brand" href="#overview" aria-label="Teyvat Tasks — Обзор"><span class="brand-mark">${icon('star')}</span><span>TEYVAT<span class="brand-sub">TASKS · ЖУРНАЛ ПУТЕШЕСТВИЙ</span></span></a>
    <p class="nav-label">ВАШЕ ПУТЕШЕСТВИЕ</p>
    <nav id="navigation" aria-label="Основная навигация">${sections.map(s => `<a href="#${s.id}" data-page="${s.id}">${icon(s.icon)}<span>${s.label}</span><span class="nav-dot" aria-hidden="true"></span></a>`).join('')}</nav>
    <div class="sidebar-note">${icon('star')}<p>Каждое приключение<br>начинается с одного шага.</p><span>Пусть ветер укажет путь</span></div>
    <div class="local-badge"><span class="status-dot"></span> Личный журнал <span>v1.0</span></div>
  </aside>
  <div class="workspace">
    <header class="topbar"><button class="icon-button mobile-menu" id="menu-toggle" aria-label="Открыть меню" aria-expanded="false" aria-controls="sidebar">${icon('menu')}</button><div class="breadcrumb">Журнал путешествий <span>/</span> <span id="breadcrumb-page">Обзор</span></div><div class="topbar-actions"><span class="local-label">${icon('shield')} Без привязки к аккаунту</span><button class="icon-button" id="theme-toggle" aria-label="Включить тёмную тему">${icon('moon')}</button><span class="traveler-badge" aria-label="Локальный путешественник">П</span></div></header>
    <main id="main-content" tabindex="-1"><div id="storage-warning" class="warning" role="alert" hidden></div><div id="view"></div></main>
    <footer><span>TEYVAT TASKS <span class="footer-star">✦</span> Ваш путь, ваши цели</span><span>Неофициальный проект · Не связан с HoYoverse</span></footer>
  </div>`;
}

function heading(title, subtitle, eyebrow = 'ЖУРНАЛ ПУТЕШЕСТВИЙ') {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><span class="chapter" aria-hidden="true">✦</span></div>`;
}
function landscape() {
  return `<svg class="landscape" viewBox="0 0 600 280" fill="none" aria-hidden="true"><circle cx="440" cy="73" r="41" fill="currentColor" opacity=".16"/><circle cx="440" cy="73" r="55" stroke="currentColor" opacity=".25"/><path d="m220 230 100-143 76 95 61-64 143 128" fill="#87aaa5" opacity=".22"/><path d="m320 87-18 69 23-16 20 11-8-35" fill="#e8ead5" opacity=".5"/><path d="m120 270 130-104 70 63 110-91 170 118v24H120Z" fill="#6f9991" opacity=".35"/><path d="M100 280c80-45 135-14 204-42s147-37 296 16v26Z" fill="#315c65" opacity=".7"/><path d="M240 280c60-15 75-37 104-40 30-3 32-18 56-20" stroke="#e0c68f" stroke-width="3" opacity=".55"/><path d="M484 191v-71l14-13 14 13v71m-36 0h45m-35-46h24m-12-38V91m-9 33h18m-5 31v14" stroke="#d6c596" stroke-width="2" opacity=".65"/><path d="m210 45 3 8 8 3-8 3-3 8-3-8-8-3 8-3Zm335 20 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="currentColor" opacity=".6"/><path d="m395 40 5-6 5 6m-32 42 4-4 4 4" stroke="currentColor" opacity=".55"/></svg>`;
}
function taskCard(title, description, period, state, now) {
  const profile = state?.profiles.find(profile => profile.id === state.settings.activeProfileId);
  const rows = profile && Object.hasOwn(SERVERS, profile.server)
    ? getCurrentTasks(state, profile.id, period, now).filter(row => row.template.enabled) : [];
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const target = rows.reduce((sum, row) => sum + row.target, 0);
  return `<article class="card task-card"><div class="card-top"><span class="icon-tile">${icon(period === 'daily' ? 'sun' : 'book')}</span><span class="pill">${rows.length ? 'Текущий период' : 'Пока пусто'}</span></div><h2>${title}</h2><p>${description}</p>${rows.length ? `<p class="task-summary">${count}/${target} действий выполнено</p>` : '<div class="empty-rule" aria-hidden="true"><span></span><span></span><span></span></div>'}<div class="card-bottom"><span class="muted">${rows.length ? `${rows.length} включённых шаблонов` : 'Нет запланированных задач'}</span>${link('routine', 'К рутине')}</div></article>`;
}
export function overview(state, now) {
  return `${heading('Навстречу приключениям', 'Всё важное для вашего путешествия — в одном месте.', 'ВАШ ТЕЙВАТ · ВАШ РИТМ')}
    <section class="hero" aria-labelledby="hero-title"><div class="hero-copy"><span class="hero-kicker">${icon('star')} НОВАЯ ГЛАВА</span><h2 id="hero-title">Большой путь<br>из маленьких шагов</h2><p>Оставьте место для открытий.<br>А планы на приключения сохраните здесь.</p><a href="#goals" class="primary-link">Открыть мои цели ${icon('arrow')}</a></div>${landscape()}<span class="hero-coordinate" aria-hidden="true">AD ASTRA · ВПЕРЁД К ЗВЁЗДАМ</span></section>
    <div class="section-label"><h2>Планы путешественника</h2><span>Без спешки. В своём темпе.</span></div>
    <div class="dashboard-grid">${taskCard('Ежедневные задачи', 'Небольшие дела для каждого игрового дня.', 'daily', state, now)}${taskCard('Еженедельные задачи', 'Планы, которым нужно чуть больше времени.', 'weekly', state, now)}
    <article class="card resin-card" id="resin-tracker" aria-labelledby="resin-title"></article>
    <article class="card companions-card"><div class="wide-card-heading"><div><span class="eyebrow">ВАША КОМАНДА</span><h2>Персонажи</h2></div>${icon('people')}</div>${characterOverview(state)}${link('characters', 'Открыть персонажей')}</article>
    <article class="card goals-card"><div class="wide-card-heading"><div><span class="eyebrow">СЛЕДУЮЩИЙ ШАГ</span><h2>Ближайшие цели</h2></div>${icon('flag')}</div>${goalsOverview(state)}${link('goals', 'Посмотреть мои цели')}</article></div>
    <div class="privacy-note">${icon('shield')} Ваш журнал остаётся в этом браузере. Игровой аккаунт подключать не нужно.</div>`;
}
export function settings(theme) {
  return `${heading('Настройки', 'Пусть журнал будет удобным именно для вас.')}<section class="card settings-card"><div class="settings-title">${icon('sun')}<div><h2>Оформление</h2><p>Выберите атмосферу своего журнала.</p></div></div><fieldset class="theme-options"><legend>Цветовая тема</legend>${['light', 'dark'].map(value => `<label class="theme-option"><input type="radio" name="theme" value="${value}" ${theme === value ? 'checked' : ''}><span class="theme-preview ${value}" aria-hidden="true"><span></span><span></span><span></span></span><span>${icon(value === 'light' ? 'sun' : 'moon')}${value === 'light' ? 'Светлая' : 'Тёмная'}</span></label>`).join('')}</fieldset><p class="settings-hint">Настройка сохраняется в этом браузере автоматически, если локальное хранилище доступно.</p></section><section class="card settings-card data-settings"><div class="settings-title">${icon('shield')}<div><h2>Данные и приватность</h2><p>Только ваш браузер. Только ваши планы.</p></div></div><dl><div><dt>Хранилище</dt><dd>Локальное · схема версии 1</dd></div><div><dt>Игровой аккаунт</dt><dd>Не подключается</dd></div><div><dt>Игровой сервер</dt><dd>Выбор ниже и в «Рутине»</dd></div><div><dt>Облачная синхронизация</dt><dd>Не подключена</dd></div></dl></section>`;
}
