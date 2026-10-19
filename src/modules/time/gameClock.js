const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const SERVERS = Object.freeze({
  europe: Object.freeze({ label: 'Europe', offsetHours: 1 }),
  america: Object.freeze({ label: 'America', offsetHours: -5 }),
  asia: Object.freeze({ label: 'Asia', offsetHours: 8 }),
});
export const PERIOD_TYPES = Object.freeze(['daily', 'weekly']);

// Только UTC-операции: локальный часовой пояс и DST компьютера не участвуют.
export function getPeriod(serverId, type, now) {
  const server = Object.hasOwn(SERVERS, serverId) ? SERVERS[serverId] : null;
  const timestamp = now instanceof Date ? now.getTime() : now;
  if (!server || !PERIOD_TYPES.includes(type)) throw new RangeError('Неизвестный сервер или тип периода.');
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || Number.isNaN(new Date(timestamp).getTime())) {
    throw new RangeError('Нужна корректная дата или время в миллисекундах.');
  }
  // Сдвиг на -4 часа превращает границу 04:00 в полночь.
  const shifted = new Date(timestamp + server.offsetHours * HOUR - 4 * HOUR);
  let startLocal = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  if (type === 'weekly') startLocal -= ((shifted.getUTCDay() + 6) % 7) * DAY;
  const startMs = startLocal + 4 * HOUR - server.offsetHours * HOUR;
  const endMs = startMs + (type === 'daily' ? DAY : 7 * DAY);
  const startDate = new Date(startLocal).toISOString().slice(0, 10);
  return { serverId, type, startDate, periodKey: `${serverId}:${type}:${startDate}`, startMs, endMs, remainingMs: endMs - timestamp };
}

export function isPeriodKey(key) {
  if (typeof key !== 'string') return false;
  const match = /^(europe|america|asia):(daily|weekly):(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!match) return false;
  const [, serverId, type, date] = match;
  const timestamp = Date.parse(`${date}T04:00:00Z`) - SERVERS[serverId].offsetHours * HOUR;
  if (!Number.isFinite(timestamp)) return false;
  return getPeriod(serverId, type, timestamp).periodKey === key;
}

export function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor(seconds / 60) % 60;
  return `${days ? `${days} д ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
