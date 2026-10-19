import { nearestGoals, TASK_STATUSES } from '../../core/personalTasks.js';
import { activeProfile, profileCharacters, characterMaterials, materialProgress } from '../../core/charactersFarm.js';

export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function characterOverview(state) {
  const characters = profileCharacters(state);
  if (!characters.length) return '<div class="companion-empty"><div class="portrait-slots" aria-hidden="true"><span>✧</span><span>✧</span><span>✧</span></div><div><h3>Здесь будут ваши спутники</h3><p>Добавьте персонажа и нужные материалы вручную.</p></div></div>';
  const materials = state.materialGoals.filter(goal => goal.profileId === activeProfile(state)?.id);
  const progress = materialProgress(materials);
  return `<div class="roster-summary"><p><strong>${progress.percent}%</strong> готовности материалов · не хватает ${progress.missing} ед.</p><progress max="100" value="${progress.percent}" aria-label="Общий прогресс материалов"></progress><ul>${characters.slice(0, 3).map(character => {
    const goals = characterMaterials(state, character.id);
    return `<li><span>${escapeHtml(character.name)} · цель ур. ${character.targetLevel}</span><strong>${goals.length ? `${materialProgress(goals).percent}%` : 'Нет материалов'}</strong></li>`;
  }).join('')}</ul>${characters.length > 3 ? `<p>Ещё персонажей: ${characters.length - 3}</p>` : ''}<p>Процент относится к материалам, а не к фактическому уровню в игре.</p></div>`;
}


export function goalsOverview(state) {
  const tasks = nearestGoals(state).slice(0, 3);
  if (!tasks.length) return '<div class="goal-empty"><p>Активных целей пока нет. Создайте личную задачу и выберите следующий шаг.</p></div>';
  return `<ul class="overview-goals">${tasks.map(task => `<li><strong>${escapeHtml(task.title)}</strong><p>${task.dueDate ?? 'Без срока'} · ${TASK_STATUSES[task.status]}</p></li>`).join('')}</ul>`;
}
