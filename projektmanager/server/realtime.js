import { db } from './db.js';

// Server-Sent Events: one or more open streams per logged-in user.
const clients = new Map(); // userId -> Set<res>

export function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  res.on('close', () => {
    const set = clients.get(userId);
    set?.delete(res);
    if (set && !set.size) clients.delete(userId);
  });
}

export function closeClients(userId) {
  for (const res of clients.get(userId) || []) res.end();
}

/** Sends an event to the given user ids (or to everyone when userIds is null). */
export function push(userIds, event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const targets = userIds ? new Set(userIds) : clients.keys();
  for (const id of targets) for (const res of clients.get(id) || []) res.write(data);
}

setInterval(() => {
  for (const set of clients.values()) for (const res of set) res.write(': ping\n\n');
}, 25000).unref();

/** Ids of all active users who can see the project (members and admins). */
export function projectAudience(projectId) {
  return db.prepare(`SELECT id FROM users WHERE active = 1 AND (role = 'admin'
    OR id IN (SELECT user_id FROM project_members WHERE project_id = ?))`).all(projectId).map((r) => r.id);
}

/** Creates an inbox entry for userId (never for the acting person themselves). */
export function notify(userId, actorId, type, { taskId = null, projectId = null, text }) {
  if (!userId || userId === actorId) return;
  db.prepare('INSERT INTO notifications (user_id, actor_id, type, task_id, project_id, text) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, actorId, type, taskId, projectId, text);
  push([userId], { type: 'notify' });
}
