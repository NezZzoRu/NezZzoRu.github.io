import { calculateResin, RESIN_CAP } from '../../core/resin.js';
import { latestResinSnapshot, recordResinMeasurement, recordResinSpend } from '../resin/resinTracker.js';
import { formatCountdown } from '../time/gameClock.js';
import { icon } from './views.js';

const displayTime = milliseconds => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(milliseconds);

export function mountResinWidget({ host, getState, commit, now = () => Date.now() }) {
  const events = new AbortController();
  const on = { signal: events.signal };
  host.innerHTML = `<div class="resin-readout"><div class="card-top"><span class="icon-tile blue">${icon('drop')}</span><span class="pill" id="resin-status">Нет замера</span></div>
    <h2 id="resin-title">Первородная смола</h2>
    <div class="resin-value"><span id="resin-amount">—</span><span> / ${RESIN_CAP}</span></div>
    <progress id="resin-progress" max="200" value="0" aria-label="Приблизительное количество смолы" hidden></progress>
    <p id="resin-estimate">Введите количество из игры, чтобы начать отсчёт.</p>
    <p id="resin-fill-time" class="resin-detail"></p>
    <p id="resin-clock-warning" class="resin-clock-warning" role="alert" hidden>Замер находится в будущем. Проверьте часы устройства и скорректируйте смолу вручную. Расчёт и запись расхода приостановлены.</p>
    </div><div class="resin-controls"><form id="resin-measure-form" class="resin-form"><label for="resin-measure">Количество из игры · 0–200</label><div class="resin-input-row"><input id="resin-measure" type="number" min="0" max="200" step="1" required placeholder="0–200" inputmode="numeric"><button type="submit" class="action-button primary">Сохранить замер</button></div></form>
    <fieldset class="resin-spending" id="resin-spending" disabled><legend>Записать расход</legend><div class="resin-quick">${[20, 40, 60].map(cost => `<button type="button" class="action-button" data-resin-cost="${cost}" aria-label="Потратить ${cost} смолы">−${cost}</button>`).join('')}</div><form id="resin-spend-form" class="resin-form"><label for="resin-cost">Другое количество · 1–200</label><div class="resin-input-row"><input id="resin-cost" type="number" min="1" max="200" step="1" required placeholder="Например, 30" inputmode="numeric"><button type="submit" class="action-button">Записать расход</button></div></form></fieldset></div>
    <p class="resin-disclaimer">Приблизительный расчёт: +1 смола за 8 минут, максимум 200. Информация из аккаунта HoYoverse не считывается. После входа в игру уточните количество новым замером.</p>
    <p id="resin-last-measure" class="resin-detail"></p>
    <p id="resin-feedback" class="resin-feedback" role="status" hidden></p>
    <p id="resin-error" class="resin-clock-warning" role="alert" hidden></p>`;

  const error = host.querySelector('#resin-error');
  const feedback = host.querySelector('#resin-feedback');
  function tick() {
    const snapshot = latestResinSnapshot(getState());
    const result = snapshot ? calculateResin(snapshot, now()) : null;
    host.querySelector('#resin-amount').textContent = result?.amount ?? '—';
    host.querySelector('#resin-status').textContent = !result ? 'Нет замера' : result.clockSkew ? 'Проверьте часы' : 'Примерно';
    const progress = host.querySelector('#resin-progress');
    progress.hidden = !result;
    progress.value = result?.amount ?? 0;
    host.querySelector('#resin-clock-warning').hidden = !result?.clockSkew;
    host.querySelector('#resin-estimate').textContent = !result ? 'Введите количество из игры, чтобы начать отсчёт.'
      : result.clockSkew ? 'Показывается последнее записанное количество.'
      : result.amount === RESIN_CAP ? 'Смола заполнена. Восстановление остановлено.' : `До заполнения ≈ ${formatCountdown(result.remainingMs)}`;
    host.querySelector('#resin-fill-time').textContent = result && !result.clockSkew && result.amount < RESIN_CAP
      ? `Заполнится примерно ${displayTime(result.fullAt)} (время устройства).` : '';
    host.querySelector('#resin-spending').disabled = !result || result.clockSkew || result.amount === 0;
    host.querySelectorAll('[data-resin-cost]').forEach(button => { button.disabled = !result || Number(button.dataset.resinCost) > result.amount; });
    host.querySelector('#resin-last-measure').textContent = snapshot
      ? `${snapshot.source === 'spend' ? `После расхода ${snapshot.spent}:` : 'Ручной замер:'} ${snapshot.amount} ед. · ${snapshot.measuredAt.replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC')}` : '';
  }
  function perform(operation, message) {
    try {
      const result = commit(operation());
      tick();
      error.hidden = true;
      feedback.textContent = result.ok ? message : 'Изменение учтено только в текущей вкладке: сохранить данные не удалось.';
      feedback.hidden = false;
      return true;
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
      feedback.hidden = true;
      return false;
    }
  }
  const measureForm = host.querySelector('#resin-measure-form');
  measureForm.addEventListener('submit', event => {
    event.preventDefault();
    const amount = host.querySelector('#resin-measure').valueAsNumber;
    if (perform(() => recordResinMeasurement(getState(), amount, now()), 'Замер сохранён. Отсчёт начинается с введённого количества.')) measureForm.reset();
  }, on);
  const spendForm = host.querySelector('#resin-spend-form');
  spendForm.addEventListener('submit', event => {
    event.preventDefault();
    const amount = host.querySelector('#resin-cost').valueAsNumber;
    if (perform(() => recordResinSpend(getState(), amount, now()), `Расход ${amount} смолы сохранён.`)) spendForm.reset();
  }, on);
  host.addEventListener('click', event => {
    const button = event.target.closest('[data-resin-cost]');
    if (!button) return;
    const amount = Number(button.dataset.resinCost);
    perform(() => recordResinSpend(getState(), amount, now()), `Расход ${amount} смолы сохранён.`);
  }, on);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); }, on);
  tick();
  const timer = setInterval(tick, 1000);
  return () => { clearInterval(timer); events.abort(); };
}
