export const RESIN_CAP = 200;
export const RESIN_INTERVAL_MS = 8 * 60 * 1000;

function timestamp(value) {
  const milliseconds = value instanceof Date ? value.getTime() : value;
  if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(new Date(milliseconds).getTime())) {
    throw new RangeError('Нужно корректное время: Date или целые миллисекунды UTC.');
  }
  return milliseconds;
}
function quantity(value, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum || value > RESIN_CAP) {
    throw new RangeError(`Введите целое количество смолы от ${minimum} до ${RESIN_CAP}.`);
  }
}

export function isResinSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const parsed = typeof snapshot.measuredAt === 'string' ? Date.parse(snapshot.measuredAt) : NaN;
  return Number.isInteger(snapshot.amount) && snapshot.amount >= 0 && snapshot.amount <= RESIN_CAP
    && Number.isFinite(parsed) && new Date(parsed).toISOString() === snapshot.measuredAt
    && Number.isInteger(snapshot.progressMs) && snapshot.progressMs >= 0 && snapshot.progressMs < RESIN_INTERVAL_MS
    && (snapshot.amount < RESIN_CAP || snapshot.progressMs === 0);
}

export function createResinSnapshot(amount, now) {
  quantity(amount);
  return { amount, measuredAt: new Date(timestamp(now)).toISOString(), progressMs: 0 };
}

// Чистая проекция от замера: чтение и обновление таймера ничего не начисляют
// в хранилище. Повторный вызов с тем же временем всегда даёт тот же результат.
export function calculateResin(snapshot, now) {
  if (!isResinSnapshot(snapshot)) throw new RangeError('Некорректный замер смолы.');
  const currentTime = timestamp(now);
  const measuredTime = Date.parse(snapshot.measuredAt);
  if (currentTime < measuredTime) {
    return { amount: snapshot.amount, progressMs: snapshot.progressMs, remainingMs: null, fullAt: null, nextPointMs: null, clockSkew: true };
  }
  const elapsed = currentTime - measuredTime + snapshot.progressMs;
  const amount = Math.min(RESIN_CAP, snapshot.amount + Math.floor(elapsed / RESIN_INTERVAL_MS));
  const progressMs = amount === RESIN_CAP ? 0 : elapsed % RESIN_INTERVAL_MS;
  const remainingMs = amount === RESIN_CAP ? 0 : (RESIN_CAP - amount) * RESIN_INTERVAL_MS - progressMs;
  return {
    amount, progressMs, remainingMs,
    fullAt: currentTime + remainingMs,
    nextPointMs: amount === RESIN_CAP ? null : RESIN_INTERVAL_MS - progressMs,
    clockSkew: false,
  };
}

// После расхода переносим незавершённую часть интервала в новый замер.
// На лимите накопленного интервала нет: восстановление начинается заново.
export function spendResin(snapshot, cost, now) {
  quantity(cost, 1);
  const current = calculateResin(snapshot, now);
  if (current.clockSkew) throw new RangeError('Замер находится в будущем. Проверьте часы и скорректируйте смолу вручную.');
  if (cost > current.amount) throw new RangeError('Расход превышает расчётное количество смолы. Уточните замер по игре.');
  return {
    amount: current.amount - cost,
    measuredAt: new Date(timestamp(now)).toISOString(),
    progressMs: current.progressMs,
  };
}
