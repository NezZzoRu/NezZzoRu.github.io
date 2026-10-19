import { activeProfile } from './charactersFarm.js';
import { SERVERS } from '../modules/time/gameClock.js';

export function changeServer(state, server, id = () => crypto.randomUUID()) {
  if (!Object.hasOwn(SERVERS, server)) throw new Error('Выберите Europe, America или Asia.');
  const next = structuredClone(state);
  let profile = activeProfile(next);
  if (!profile) { profile = { id: id(), name: 'Путешественник' }; next.profiles.push(profile); }
  profile.server = server;
  next.settings.activeProfileId = profile.id;
  return next;
}
