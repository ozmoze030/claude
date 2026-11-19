import express from 'express';
import path from 'node:path';
import { db, tx } from './db.js';
import {
  COOKIE_NAME, hashPassword, verifyPassword, validatePassword, createSession, destroySession,
  destroyUserSessions, userFromToken, setSessionCookie, parseCookies,
  loginBlocked, recordFailure, clearFailures,
} from './auth.js';
import { notify, closeClients } from './realtime.js';
import {
  registerExtras, listSubtasks, listAttachments, listFields, collectFiles, unlinkFiles, cleanOrphanedFiles, MAX_UPLOAD_MB,
} from './extras.js';

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.use(express.json({ limit: '200kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (err) { next(err); }
};
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail(400, 'Ungültige ID.');
  return n;
};
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const COLORS = /^#[0-9a-fA-F]{6}$/;
const PRIORITIES = ['none', 'low', 'medium', 'high'];

const publicUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active, weeklyCapacity: u.weekly_capacity });

// ---------- auth middleware ----------
app.use('/api', (req, res, next) => {
  // CSRF protection: every state-changing request must come from our own frontend (custom header + JSON).
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'projektmanager') {
    return res.status(403).json({ error: 'Ungültige Anfrage.' });
  }
  req.token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  req.user = userFromToken(req.token);
  next();
});

const requireUser = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Bitte melde dich an.' });
  if (req.user.mustChangePassword && !['/me', '/me/password', '/logout'].includes(req.path)) {
    return res.status(403).json({ error: 'Bitte ändere zuerst dein Passwort.', code: 'MUST_CHANGE_PASSWORD' });
  }
  next();
};
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Nur für Administratoren.' });
  next();
};

function projectAccess(user, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) fail(404, 'Projekt nicht gefunden.');
  if (user.role === 'admin') return project;
  const member = db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, user.id);
  if (!member) fail(404, 'Projekt nicht gefunden.');
  return project;
}
function taskAccess(user, taskId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) fail(404, 'Aufgabe nicht gefunden.');
  projectAccess(user, task.project_id);
  return task;
}
function sectionAccess(user, sectionId) {
  const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
  if (!section) fail(404, 'Spalte nicht gefunden.');
  projectAccess(user, section.project_id);
  return section;
}
function assertAssignable(projectId, userId) {
  if (userId == null) return;
  const ok = db.prepare(`
    SELECT 1 FROM users u WHERE u.id = ? AND u.active = 1 AND (
      u.role = 'admin' OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ? AND m.user_id = u.id))
  `).get(userId, projectId);
  if (!ok) fail(400, 'Diese Person ist kein Mitglied des Projekts.');
}

const TASK_SELECT = `
  SELECT t.*, a.name AS assignee_name, p.name AS project_name, p.color AS project_color, s.name AS section_name,
    (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count,
    (SELECT COUNT(*) FROM subtasks st WHERE st.task_id = t.id) AS subtask_count,
    (SELECT COUNT(*) FROM subtasks st WHERE st.task_id = t.id AND st.completed = 1) AS subtask_done,
    (SELECT COUNT(*) FROM attachments at WHERE at.task_id = t.id) AS attachment_count
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  JOIN sections s ON s.id = t.section_id
  LEFT JOIN users a ON a.id = t.assignee_id
`;
const mapTask = (t) => t && ({
  id: t.id, projectId: t.project_id, projectName: t.project_name, projectColor: t.project_color,
  sectionId: t.section_id, sectionName: t.section_name, title: t.title, description: t.description,
  assigneeId: t.assignee_id, assigneeName: t.assignee_name, dueDate: t.due_date, priority: t.priority,
  completed: !!t.completed, completedAt: t.completed_at, position: t.position,
  createdBy: t.created_by, createdAt: t.created_at, updatedAt: t.updated_at, commentCount: t.comment_count,
  estimateHours: t.estimate_hours, subtaskCount: t.subtask_count, subtaskDone: t.subtask_done,
  attachmentCount: t.attachment_count, fields: {},
});
/** Adds custom field values ({ fieldId: value }) to mapped tasks. */
function withFields(tasks, rows) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const r of rows) { const t = byId.get(r.task_id); if (t) t.fields[r.field_id] = r.value; }
  return tasks;
}
const getTask = (id) => {
  const t = mapTask(db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id));
  return t && withFields([t], db.prepare('SELECT * FROM task_field_values WHERE task_id = ?').all(id))[0];
};
const quote = (s) => `„${s}“`;

// ---------- setup & session ----------
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

app.get('/api/status', wrap((req) => ({ needsSetup: userCount() === 0, user: req.user })));

app.post('/api/setup', wrap((req, res) => {
  const name = str(req.body.name, 100);
  const email = str(req.body.email, 200).toLowerCase();
  const password = req.body.password;
  if (!name || !isEmail(email)) fail(400, 'Bitte Name und gültige E-Mail angeben.');
  const pwErr = validatePassword(password);
  if (pwErr) fail(400, pwErr);
  const id = tx(() => {
    if (userCount() > 0) fail(409, 'Die Einrichtung wurde bereits abgeschlossen.');
    return Number(db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')`)
      .run(name, email, hashPassword(password)).lastInsertRowid);
  });
  const { token, expires } = createSession(id);
  setSessionCookie(res, token, expires);
  return { user: userFromToken(token) };
}));

app.post('/api/login', wrap((req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const key = `${req.ip}|${email}`;
  if (loginBlocked(key)) fail(429, 'Zu viele Fehlversuche. Bitte warte 15 Minuten.');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    recordFailure(key);
    fail(401, 'E-Mail oder Passwort ist falsch.');
  }
  clearFailures(key);
  const { token, expires } = createSession(user.id);
  setSessionCookie(res, token, expires);
  return { user: userFromToken(token) };
}));

app.post('/api/logout', wrap((req, res) => {
  destroySession(req.token);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return { ok: true };
}));

app.use('/api', requireUser);

app.get('/api/me', wrap((req) => ({ user: req.user })));

app.patch('/api/me', wrap((req) => {
  const name = str(req.body.name, 100);
  if (!name) fail(400, 'Name darf nicht leer sein.');
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  return { user: userFromToken(req.token) };
}));

app.post('/api/me/password', wrap((req) => {
  const { currentPassword, newPassword } = req.body;
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(currentPassword ?? ''), row.password_hash)) fail(400, 'Das aktuelle Passwort ist falsch.');
  const pwErr = validatePassword(newPassword);
  if (pwErr) fail(400, pwErr);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hashPassword(newPassword), req.user.id);
  destroyUserSessions(req.user.id, req.token);
  return { user: userFromToken(req.token) };
}));

// ---------- users ----------
app.get('/api/users', wrap((req) => {
  const all = req.user.role === 'admin' && req.query.all === '1';
  const rows = db.prepare(`SELECT * FROM users ${all ? '' : 'WHERE active = 1'} ORDER BY name COLLATE NOCASE`).all();
  return { users: rows.map(publicUser) };
}));

app.post('/api/users', requireAdmin, wrap((req) => {
  const name = str(req.body.name, 100);
  const email = str(req.body.email, 200).toLowerCase();
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  if (!name || !isEmail(email)) fail(400, 'Bitte Name und gültige E-Mail angeben.');
  const pwErr = validatePassword(req.body.password);
  if (pwErr) fail(400, pwErr);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'Diese E-Mail ist bereits vergeben.');
  const id = db.prepare(`INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 1)`)
    .run(name, email, hashPassword(req.body.password), role).lastInsertRowid;
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) };
}));

app.patch('/api/users/:id', requireAdmin, wrap((req) => {
  const id = intId(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) fail(404, 'Benutzer nicht gefunden.');
  const b = req.body;
  const self = id === req.user.id;
  const activeAdmins = () => db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`).get().n;

  tx(() => {
    if (b.name !== undefined) {
      const name = str(b.name, 100);
      if (!name) fail(400, 'Name darf nicht leer sein.');
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
    }
    if (b.email !== undefined) {
      const email = str(b.email, 200).toLowerCase();
      if (!isEmail(email)) fail(400, 'Ungültige E-Mail.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, id)) fail(409, 'Diese E-Mail ist bereits vergeben.');
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, id);
    }
    if (b.role !== undefined) {
      const role = b.role === 'admin' ? 'admin' : 'member';
      if (self && role !== 'admin') fail(400, 'Du kannst dir die Admin-Rechte nicht selbst entziehen.');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    }
    if (b.active !== undefined) {
      if (self && !b.active) fail(400, 'Du kannst dich nicht selbst deaktivieren.');
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, id);
      if (!b.active) { destroyUserSessions(id); closeClients(id); }
    }
    if (b.weeklyCapacity !== undefined) {
      const cap = Number(b.weeklyCapacity);
      if (!Number.isFinite(cap) || cap < 0 || cap > 168) fail(400, 'Ungültige Wochenkapazität.');
      db.prepare('UPDATE users SET weekly_capacity = ? WHERE id = ?').run(cap, id);
    }
    if (b.password !== undefined) {
      const pwErr = validatePassword(b.password);
      if (pwErr) fail(400, pwErr);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?')
        .run(hashPassword(b.password), self ? 0 : 1, id);
      destroyUserSessions(id, self ? req.token : undefined);
    }
    if (activeAdmins() === 0) fail(400, 'Es muss mindestens einen aktiven Administrator geben.');
  });
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) };
}));

// ---------- projects ----------
app.get('/api/projects', wrap((req) => {
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.completed = 1) AS done_count
    FROM projects p
    WHERE ? = 'admin' OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)
    ORDER BY p.name COLLATE NOCASE
  `).all(req.user.role, req.user.id);
  return {
    projects: rows.map((p) => ({
      id: p.id, name: p.name, description: p.description, color: p.color, ownerId: p.owner_id,
      taskCount: p.task_count, doneCount: p.done_count,
    })),
  };
}));

app.post('/api/projects', wrap((req) => {
  const name = str(req.body.name, 120);
  if (!name) fail(400, 'Bitte einen Projektnamen angeben.');
  const color = COLORS.test(req.body.color) ? req.body.color : '#6366f1';
  const description = str(req.body.description, 5000);
  const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(Number).filter(Number.isInteger) : [];
  const id = tx(() => {
    const pid = Number(db.prepare('INSERT INTO projects (name, description, color, owner_id) VALUES (?, ?, ?, ?)')
      .run(name, description, color, req.user.id).lastInsertRowid);
    const addMember = db.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id)
      SELECT ?, id FROM users WHERE id = ? AND active = 1`);
    for (const uid of new Set([req.user.id, ...memberIds])) addMember.run(pid, uid);
    const addSection = db.prepare('INSERT INTO sections (project_id, name, position) VALUES (?, ?, ?)');
    ['Zu erledigen', 'In Arbeit', 'Erledigt'].forEach((s, i) => addSection.run(pid, s, i + 1));
    return pid;
  });
  for (const uid of new Set(memberIds)) {
    if (db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(id, uid)) {
      notify(uid, req.user.id, 'project_added', { projectId: id, text: `hat dich zum Projekt ${quote(name)} hinzugefügt` });
    }
  }
  return { id };
}));

app.get('/api/projects/:id', wrap((req) => {
  const p = projectAccess(req.user, intId(req.params.id));
  const sections = db.prepare('SELECT id, name, position FROM sections WHERE project_id = ? ORDER BY position').all(p.id);
  const tasks = withFields(
    db.prepare(`${TASK_SELECT} WHERE t.project_id = ? ORDER BY t.position`).all(p.id).map(mapTask),
    db.prepare('SELECT v.* FROM task_field_values v JOIN tasks t ON t.id = v.task_id WHERE t.project_id = ?').all(p.id),
  );
  const members = db.prepare(`
    SELECT u.* FROM users u JOIN project_members m ON m.user_id = u.id
    WHERE m.project_id = ? ORDER BY u.name COLLATE NOCASE`).all(p.id).map(publicUser);
  return {
    project: { id: p.id, name: p.name, description: p.description, color: p.color, ownerId: p.owner_id },
    sections: sections.map((s) => ({ ...s })), tasks, members, fields: listFields(p.id),
  };
}));

const canManageProject = (user, project) => user.role === 'admin' || project.owner_id === user.id;

app.patch('/api/projects/:id', wrap((req) => {
  const p = projectAccess(req.user, intId(req.params.id));
  const b = req.body;
  if (b.name !== undefined) {
    const name = str(b.name, 120);
    if (!name) fail(400, 'Bitte einen Projektnamen angeben.');
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, p.id);
  }
  if (b.description !== undefined) db.prepare('UPDATE projects SET description = ? WHERE id = ?').run(str(b.description, 5000), p.id);
  if (b.color !== undefined && COLORS.test(b.color)) db.prepare('UPDATE projects SET color = ? WHERE id = ?').run(b.color, p.id);
  return { ok: true };
}));

app.delete('/api/projects/:id', wrap((req) => {
  const p = projectAccess(req.user, intId(req.params.id));
  if (!canManageProject(req.user, p)) fail(403, 'Nur der Projektersteller oder ein Admin kann das Projekt löschen.');
  const files = collectFiles('t.project_id = ?', p.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  unlinkFiles(files);
  return { ok: true };
}));

app.put('/api/projects/:id/members', wrap((req) => {
  const p = projectAccess(req.user, intId(req.params.id));
  if (!canManageProject(req.user, p)) fail(403, 'Nur der Projektersteller oder ein Admin kann Mitglieder verwalten.');
  const ids = Array.isArray(req.body.userIds) ? req.body.userIds.map(Number).filter(Number.isInteger) : [];
  const before = new Set(db.prepare('SELECT user_id FROM project_members WHERE project_id = ?').all(p.id).map((r) => r.user_id));
  tx(() => {
    db.prepare('DELETE FROM project_members WHERE project_id = ?').run(p.id);
    const add = db.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id) SELECT ?, id FROM users WHERE id = ?`);
    for (const uid of new Set(ids)) add.run(p.id, uid);
    if (p.owner_id) add.run(p.id, p.owner_id);
    // Unassign tasks from people who are no longer in the project (admins keep access anyway).
    db.prepare(`UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id IS NOT NULL
      AND assignee_id NOT IN (SELECT user_id FROM project_members WHERE project_id = ?)
      AND assignee_id NOT IN (SELECT id FROM users WHERE role = 'admin')`).run(p.id, p.id);
  });
  for (const r of db.prepare('SELECT user_id FROM project_members WHERE project_id = ?').all(p.id)) {
    if (!before.has(r.user_id)) notify(r.user_id, req.user.id, 'project_added', { projectId: p.id, text: `hat dich zum Projekt ${quote(p.name)} hinzugefügt` });
  }
  return { ok: true };
}));

// ---------- sections ----------
app.post('/api/projects/:id/sections', wrap((req) => {
  const p = projectAccess(req.user, intId(req.params.id));
  const name = str(req.body.name, 80);
  if (!name) fail(400, 'Bitte einen Spaltennamen angeben.');
  const max = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM sections WHERE project_id = ?').get(p.id).m;
  const id = db.prepare('INSERT INTO sections (project_id, name, position) VALUES (?, ?, ?)').run(p.id, name, max + 1).lastInsertRowid;
  return { id: Number(id) };
}));

app.patch('/api/sections/:id', wrap((req) => {
  const s = sectionAccess(req.user, intId(req.params.id));
  if (req.body.name !== undefined) {
    const name = str(req.body.name, 80);
    if (!name) fail(400, 'Bitte einen Spaltennamen angeben.');
    db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(name, s.id);
  }
  if (typeof req.body.position === 'number' && Number.isFinite(req.body.position)) {
    db.prepare('UPDATE sections SET position = ? WHERE id = ?').run(req.body.position, s.id);
  }
  return { ok: true };
}));

app.delete('/api/sections/:id', wrap((req) => {
  const s = sectionAccess(req.user, intId(req.params.id));
  const other = db.prepare('SELECT id FROM sections WHERE project_id = ? AND id != ? ORDER BY position LIMIT 1').get(s.project_id, s.id);
  if (!other) fail(400, 'Die letzte Spalte kann nicht gelöscht werden.');
  tx(() => {
    const max = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM tasks WHERE section_id = ?').get(other.id).m;
    db.prepare('UPDATE tasks SET section_id = ?, position = position + ? WHERE section_id = ?').run(other.id, max + 1, s.id);
    db.prepare('DELETE FROM sections WHERE id = ?').run(s.id);
  });
  return { ok: true };
}));

// ---------- tasks ----------
function normalizeEstimate(v) {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10000) fail(400, 'Ungültiger Aufwand.');
  return n;
}
function normalizeDate(v) {
  if (v === null || v === '') return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  fail(400, 'Ungültiges Datum.');
}

app.post('/api/projects/:id/tasks', wrap((req) => {
  const p = projectAccess(req.user, intId(req.params.id));
  const title = str(req.body.title, 300);
  if (!title) fail(400, 'Bitte einen Titel angeben.');
  let sectionId = req.body.sectionId ? intId(req.body.sectionId) : null;
  if (sectionId) {
    if (sectionAccess(req.user, sectionId).project_id !== p.id) fail(400, 'Spalte gehört nicht zum Projekt.');
  } else {
    sectionId = db.prepare('SELECT id FROM sections WHERE project_id = ? ORDER BY position LIMIT 1').get(p.id)?.id;
    if (!sectionId) fail(400, 'Das Projekt hat keine Spalten.');
  }
  const assigneeId = req.body.assigneeId ? intId(req.body.assigneeId) : null;
  assertAssignable(p.id, assigneeId);
  const dueDate = req.body.dueDate !== undefined ? normalizeDate(req.body.dueDate) : null;
  const priority = PRIORITIES.includes(req.body.priority) ? req.body.priority : 'none';
  const max = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM tasks WHERE section_id = ?').get(sectionId).m;
  const id = Number(db.prepare(`INSERT INTO tasks (project_id, section_id, title, description, assignee_id, due_date, priority, position, created_by, estimate_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(p.id, sectionId, title, str(req.body.description, 20000), assigneeId, dueDate, priority, max + 1, req.user.id,
      normalizeEstimate(req.body.estimateHours)).lastInsertRowid);
  notify(assigneeId, req.user.id, 'assigned', { taskId: id, projectId: p.id, text: `hat dir die Aufgabe ${quote(title)} zugewiesen` });
  return { task: getTask(id) };
}));

app.get('/api/tasks/:id', wrap((req) => {
  const t = taskAccess(req.user, intId(req.params.id));
  const comments = db.prepare(`
    SELECT c.id, c.body, c.created_at AS createdAt, c.user_id AS userId, u.name AS userName
    FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.id`).all(t.id);
  return {
    task: getTask(t.id), comments: comments.map((c) => ({ ...c })),
    subtasks: listSubtasks(t.id), attachments: listAttachments(t.id), fields: listFields(t.project_id),
  };
}));

app.patch('/api/tasks/:id', wrap((req) => {
  const t = taskAccess(req.user, intId(req.params.id));
  const b = req.body;
  const sets = [];
  const vals = [];
  const set = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };

  if (b.title !== undefined) {
    const title = str(b.title, 300);
    if (!title) fail(400, 'Titel darf nicht leer sein.');
    set('title', title);
  }
  if (b.description !== undefined) set('description', str(b.description, 20000));
  if (b.assigneeId !== undefined) {
    const aid = b.assigneeId ? intId(b.assigneeId) : null;
    assertAssignable(t.project_id, aid);
    set('assignee_id', aid);
  }
  if (b.dueDate !== undefined) set('due_date', normalizeDate(b.dueDate));
  if (b.estimateHours !== undefined) set('estimate_hours', normalizeEstimate(b.estimateHours));
  if (b.priority !== undefined) {
    if (!PRIORITIES.includes(b.priority)) fail(400, 'Ungültige Priorität.');
    set('priority', b.priority);
  }
  if (b.completed !== undefined) {
    set('completed', b.completed ? 1 : 0);
    set('completed_at', b.completed ? new Date().toISOString() : null);
  }
  if (b.sectionId !== undefined) {
    const s = sectionAccess(req.user, intId(b.sectionId));
    if (s.project_id !== t.project_id) fail(400, 'Spalte gehört nicht zum Projekt.');
    set('section_id', s.id);
  }
  if (b.position !== undefined) {
    if (typeof b.position !== 'number' || !Number.isFinite(b.position)) fail(400, 'Ungültige Position.');
    set('position', b.position);
  }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, t.id);
  }
  const now = db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id);
  const ctx = { taskId: t.id, projectId: t.project_id };
  if (now.assignee_id && now.assignee_id !== t.assignee_id) {
    notify(now.assignee_id, req.user.id, 'assigned', { ...ctx, text: `hat dir die Aufgabe ${quote(now.title)} zugewiesen` });
  }
  if (now.completed && !t.completed) {
    for (const uid of new Set([now.assignee_id, now.created_by])) {
      notify(uid, req.user.id, 'completed', { ...ctx, text: `hat die Aufgabe ${quote(now.title)} als erledigt markiert` });
    }
  }
  return { task: getTask(t.id) };
}));

app.delete('/api/tasks/:id', wrap((req) => {
  const t = taskAccess(req.user, intId(req.params.id));
  const files = collectFiles('t.id = ?', t.id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  unlinkFiles(files);
  return { ok: true };
}));

app.get('/api/my-tasks', wrap((req) => {
  const rows = db.prepare(`${TASK_SELECT}
    WHERE t.assignee_id = ? AND (t.completed = 0 OR t.completed_at >= datetime('now', '-7 days'))
    ORDER BY t.completed, t.due_date IS NULL, t.due_date, t.position`).all(req.user.id);
  return { tasks: rows.map(mapTask) };
}));

app.get('/api/all-tasks', wrap((req) => {
  const rows = db.prepare(`${TASK_SELECT}
    WHERE (? = 'admin' OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = t.project_id AND m.user_id = ?))
      AND (t.completed = 0 OR t.completed_at >= datetime('now', '-90 days'))
    ORDER BY t.due_date, t.position`).all(req.user.role, req.user.id);
  return { tasks: rows.map(mapTask) };
}));

// ---------- comments ----------
app.post('/api/tasks/:id/comments', wrap((req) => {
  const t = taskAccess(req.user, intId(req.params.id));
  const body = str(req.body.body, 10000);
  if (!body) fail(400, 'Kommentar darf nicht leer sein.');
  const audience = new Set([t.assignee_id, t.created_by,
    ...db.prepare('SELECT DISTINCT user_id FROM comments WHERE task_id = ?').all(t.id).map((r) => r.user_id)]);
  db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)').run(t.id, req.user.id, body);
  for (const uid of audience) {
    if (!uid || uid === req.user.id) continue;
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(uid);
    try { if (u) projectAccess(u, t.project_id); else continue; } catch { continue; }
    notify(uid, req.user.id, 'comment', { taskId: t.id, projectId: t.project_id, text: `hat ${quote(t.title)} kommentiert` });
  }
  return { ok: true };
}));

app.delete('/api/comments/:id', wrap((req) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(intId(req.params.id));
  if (!c) fail(404, 'Kommentar nicht gefunden.');
  taskAccess(req.user, c.task_id);
  if (c.user_id !== req.user.id && req.user.role !== 'admin') fail(403, 'Du kannst nur eigene Kommentare löschen.');
  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  return { ok: true };
}));

registerExtras(app, { wrap, fail, str, intId, projectAccess, taskAccess, getTask });
cleanOrphanedFiles();

// ---------- errors & static ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden.' }));

app.use((err, req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: `Die Datei ist zu groß (maximal ${MAX_UPLOAD_MB} MB).` });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültige Anfrage.' });
  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

const publicDir = path.join(import.meta.dirname, '..', 'public');
app.use(express.static(publicDir, { index: 'index.html' }));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Projektmanager läuft auf http://localhost:${port}`);
});
