import { calculateStatistics } from '../../core/statistics.js';
import { getPeriod, SERVERS } from '../time/gameClock.js';
import { activeProfile } from '../../core/charactersFarm.js';
import { escapeHtml as esc } from './plannerViews.js';
import { icon } from './views.js';

const progress = (label, row) => `<article class="card stats-progress"><h2>${label}</h2><strong>${row.percent}%</strong><progress max="100" value="${row.percent}" aria-label="${label}"></progress><p>${row.target ? `${row.count}/${row.target} действий · ${row.recorded ? 'Есть отметки' : 'Отметок пока нет'}` : 'Нет шаблонов или отметок для этого периода'}</p><code>${row.periodKey}</code></article>`;
export function mountStatistics({ host, getState, now = () => Date.now() }) {
  const events = new AbortController(), on = { signal: events.signal };
  let range = 7, lastPeriod = '';
  function draw() {
    const focusedRange = document.activeElement?.closest('[data-stats-range]')?.dataset.statsRange;
    const stats = calculateStatistics(getState(), now());
    const days = stats.days.slice(-range), max = Math.max(1, ...days.map(day => day.count));
    host.innerHTML = `<div class="page-heading"><div><p class="eyebrow">ИСТОРИЯ ВАШЕГО ПУТИ</p><h1>Статистика</h1><p class="subtitle">Только сохранённые отметки. Без предположений о пропущенных днях.</p></div>${icon('chart')}</div>
      <p class="planner-help">${SERVERS[stats.server].label} · периоды 7 и 30 игровых дней включают текущий день со сбросом в 04:00 сервера. Рутина учитывается по всем серверам текущего профиля; прогресс ниже — для выбранного сервера.</p>
      <div class="stats-metrics"><article class="card"><span>Действия за 7 дней</span><strong id="stats-actions7">${stats.actions7}</strong><p>По датированным отметкам</p></article><article class="card"><span>Действия за 30 дней</span><strong id="stats-actions30">${stats.actions30}</strong><p>По датированным отметкам</p></article><article class="card"><span>Завершённые личные задачи</span><strong id="stats-personal">${stats.completedPersonal}</strong><p>Из ${stats.totalPersonal} сохранённых задач</p></article><article class="card"><span>Готовность материалов</span><strong id="stats-materials">${stats.materials.percent}%</strong><p>Не хватает ${stats.materials.missing} ед.</p></article></div>
      <section class="card activity-card" aria-labelledby="activity-title"><div class="wide-card-heading"><h2 id="activity-title">Зафиксированные действия</h2><div class="farm-filters" role="group" aria-label="Период графика"><button class="action-button" type="button" data-stats-range="7" aria-pressed="${range === 7}">7 дней</button><button class="action-button" type="button" data-stats-range="30" aria-pressed="${range === 30}">30 дней</button></div></div><p>Одна отметка рутины, завершённая личная задача или выполненный план фарма = одно действие. Отменённые отметки не учитываются.</p>
      ${stats.undatedRoutineActions ? `<p class="warning" id="stats-undated">Старых отметок рутины без точного времени: ${stats.undatedRoutineActions}. Они сохранены в истории, но не включены в итог 7/30 дней и столбцы графика.</p>` : ''}
      <div class="activity-chart" style="--days:${range}" role="img" aria-label="График датированных действий за ${range} дней. Подробные значения доступны в таблице ниже.">${days.map(day => `<div class="activity-column ${day.hasRecords ? 'has-records' : 'no-records'}" title="${day.date}: ${day.hasRecords ? `${day.count} датированных действий` : 'нет записей'}"><span class="activity-bar" style="height:${day.count / max * 100}%"></span><span class="activity-marker">${day.hasRecords ? '·' : '—'}</span></div>`).join('')}</div><div class="activity-axis"><span>${days[0].date}</span><span>${days.at(-1).date}</span></div><p class="planner-help">Пунктир и «—» означают «нет записей», а не пропуск. Нулевое число при наличии записи означает отсутствие датированных выполнений в этой записи.</p><details class="stats-table-details"><summary>Посмотреть значения по дням</summary><div class="table-scroll"><table><caption>Датированные действия по игровым дням</caption><thead><tr><th scope="col">Дата</th><th scope="col">Действия</th><th scope="col">Данные</th></tr></thead><tbody>${days.map(day => `<tr><th scope="row">${day.date}</th><td>${day.hasRecords ? day.count : '—'}</td><td>${day.hasRecords ? 'Есть записи' : 'Нет записей'}</td></tr>`).join('')}</tbody></table></div></details></section>
      <div class="stats-progress-grid">${progress('Ежедневные задачи', stats.daily)}${progress('Еженедельные задачи', stats.weekly)}</div><p class="planner-help">Текущие периоды учитывают включённые шаблоны и сохранённые снимки, в том числе отключённых или удалённых шаблонов. Отсутствие записи в прошлом не считается пропуском.</p>
      <section class="card"><h2>Материалы персонажей</h2>${stats.characters.length ? `<ul class="stats-character-list">${stats.characters.map(character => `<li><div><strong>${esc(character.name)}</strong><span>${character.percent}% · ${character.owned}/${character.needed} ед.</span></div><progress max="100" value="${character.percent}" aria-label="Материалы: ${esc(character.name)}"></progress></li>`).join('')}</ul>` : '<p>Персонажи и материалы пока не добавлены.</p>'}<p class="planner-help">Показана готовность материалов, а не фактический уровень в игре.</p></section>
      <p class="planner-help">Показатели вычисляются заново из сохранённых данных. Возврат задачи в работу, отмена плана или отметки рутины убирает соответствующее выполнение из текущих итогов; это не журнал всех когда-либо выполненных действий. Удалённые личные задачи также не учитываются.</p>`;
    if (focusedRange) host.querySelector(`[data-stats-range="${focusedRange}"]`)?.focus({ preventScroll: true });
  }
  host.addEventListener('click', event => {
    const button = event.target.closest('[data-stats-range]');
    if (button) { range = Number(button.dataset.statsRange); draw(); }
  }, on);
  window.addEventListener('teyvat:change', draw, on);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); }, on);
  function tick() {
    const key = getPeriod(activeProfile(getState())?.server ?? 'europe', 'daily', now()).periodKey;
    if (key !== lastPeriod) { lastPeriod = key; draw(); }
  }
  tick(); const timer = setInterval(tick, 1000);
  return () => { clearInterval(timer); events.abort(); };
}
