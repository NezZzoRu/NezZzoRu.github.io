import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { SERVERS, DAY, getPeriod, isPeriodKey, formatCountdown } from '../src/modules/time/gameClock.js';

const serverTime = (server, date, time) => Date.parse(`${date}T${time}Z`) - SERVERS[server].offsetHours * 3600000;

for (const server of Object.keys(SERVERS)) {
  for (const [date, previous] of [
    ['2026-10-19', '2026-10-18'],
    ['2026-04-01', '2026-03-31'],
    ['2026-01-01', '2025-12-31'],
    ['2024-03-01', '2024-02-29'],
  ]) {
    test(`${server}: ежедневный сброс ${date}, 03:59 и 04:00`, () => {
      const before = getPeriod(server, 'daily', serverTime(server, date, '03:59:00'));
      const exact = getPeriod(server, 'daily', serverTime(server, date, '04:00:00'));
      assert.equal(before.periodKey, `${server}:daily:${previous}`);
      assert.equal(before.remainingMs, 60000);
      assert.equal(exact.periodKey, `${server}:daily:${date}`);
      assert.equal(exact.startMs, before.endMs);
      assert.equal(exact.remainingMs, DAY);
      const lastMillisecond = getPeriod(server, 'daily', exact.startMs - 1);
      assert.equal(lastMillisecond.periodKey, before.periodKey);
      assert.equal(lastMillisecond.remainingMs, 1);
    });
  }
  for (const [monday, previousMonday] of [
    ['2026-10-19', '2026-10-12'],
    ['2026-06-01', '2026-05-25'],
    ['2024-12-30', '2024-12-23'],
    ['2026-01-05', '2025-12-29'],
  ]) {
    test(`${server}: понедельник ${monday}, недельный сброс 03:59 и 04:00`, () => {
      const before = getPeriod(server, 'weekly', serverTime(server, monday, '03:59:00'));
      const exact = getPeriod(server, 'weekly', serverTime(server, monday, '04:00:00'));
      assert.equal(before.periodKey, `${server}:weekly:${previousMonday}`);
      assert.equal(before.remainingMs, 60000);
      assert.equal(exact.periodKey, `${server}:weekly:${monday}`);
      assert.equal(exact.startMs, before.endMs);
      assert.equal(exact.remainingMs, 7 * DAY);
      assert.equal(getPeriod(server, 'weekly', exact.startMs - 1).periodKey, before.periodKey);
    });
  }
  test(`${server}: воскресенье и смена года не запускают недельный сброс`, () => {
    assert.equal(getPeriod(server, 'weekly', serverTime(server, '2026-10-18', '04:00:00')).startDate, '2026-10-12');
    assert.equal(getPeriod(server, 'weekly', serverTime(server, '2026-01-01', '04:00:00')).startDate, '2025-12-29');
  });
}

test('фиксированные UTC-смещения серверов', () => {
  for (const [server, expected] of [
    ['europe', '2026-10-19T03:00:00.000Z'],
    ['america', '2026-10-19T09:00:00.000Z'],
    ['asia', '2026-10-18T20:00:00.000Z'],
  ]) {
    assert.equal(new Date(getPeriod(server, 'daily', serverTime(server, '2026-10-19', '04:00:00')).startMs).toISOString(), expected);
  }
});

test('часовой пояс компьютера и его DST не влияют на игровые периоды', () => {
  const moduleUrl = new URL('../src/modules/time/gameClock.js', import.meta.url).href;
  const source = `import {getPeriod} from ${JSON.stringify(moduleUrl)};
    const results = ['2026-01-01T00:00:00Z','2026-03-29T03:00:00Z','2026-07-01T03:00:00Z','2026-10-25T03:00:00Z'].flatMap(date =>
      ['europe','america','asia'].flatMap(server => ['daily','weekly'].map(type => getPeriod(server,type,Date.parse(date)))));
    console.log(JSON.stringify(results));`;
  const outputs = ['UTC', 'Europe/Berlin', 'America/New_York', 'Asia/Irkutsk', 'Pacific/Kiritimati'].map(TZ => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  });
  outputs.forEach(output => assert.equal(output, outputs[0]));
});

test('некорректные параметры отклоняются, ключи проверяют реальные даты и понедельники', () => {
  for (const args of [['invalid','daily',0], ['europe','monthly',0], ['asia','daily',NaN], ['asia','daily','2026-01-01'], ['asia','daily',new Date('bad')]]) {
    assert.throws(() => getPeriod(...args), RangeError);
  }
  for (const key of ['europe:daily:2026-02-30', 'asia:weekly:2026-10-20', 'europe:daily:2026-13-01', 'x:daily:2026-01-01', null]) assert.equal(isPeriodKey(key), false);
  assert.equal(isPeriodKey('asia:weekly:2026-10-19'), true);
  assert.equal(isPeriodKey('america:daily:2024-02-29'), true);
});

test('обратный отсчёт не отрицательный и округляется вверх', () => {
  assert.equal(formatCountdown(7 * DAY), '7 д 00:00:00');
  assert.equal(formatCountdown(60000), '00:01:00');
  assert.equal(formatCountdown(1), '00:00:01');
  assert.equal(formatCountdown(-1), '00:00:00');
});
