// Subtasks, attachments, custom fields, inbox, chat and live events.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, uploadsDir } from './db.js';
import { addClient, push, projectAudience } from './realtime.js';

export const MAX_UPLOAD_MB = 25;
const FIELD_TYPES = ['text', 'number', 'date', 'checkbox', 'select'];
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

// ---------- shared readers ----------
export const listSubtasks = (taskId) => db.prepare('SELECT id, title, completed FROM subtasks WHERE task_id = ? ORDER BY position, id')
  .all(taskId).map((s) => ({ id: s.id, title: s.title, completed: !!s.completed }));

export const listAttachments = (taskId) => db.prepare(`
  SELECT a.id, a.filename, a.size, a.user_id, a.created_at, u.name AS user_name
  FROM attachments a LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = ? ORDER BY a.id`)
  .all(taskId).map((a) => ({
    id: a.id, filename: a.filename, size: a.size, userId: a.user_id, userName: a.user_name, createdAt: a.created_at,
    isImage: path.extname(a.filename).toLowerCase() in IMAGE_MIME,
  }));

export const listFields = (projectId) => db.prepare('SELECT id, name, type, options FROM custom_fields WHERE project_id = ? ORDER BY position, id')
  .all(projectId).map((f) => ({ id: f.id, name: f.name, type: f.type, options: JSON.parse(f.options) }));

/** Stored file names of all attachments matching the condition (call before deleting rows). */
export function collectFiles(where, param) {
  return db.prepare(`SELECT a.stored_name FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE ${where}`).all(param).map((r) => r.stored_name);
}
export function unlinkFiles(names) {
  for (const n of names) fs.rm(path.join(uploadsDir, n), { force: true }, () => {});
}

// ---------- routes ----------
export function registerExtras(app, { wrap, fail, str, intId, projectAccess, taskAccess, getTask }) {
  // ----- live events
  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    addClient(req.user.id, res);
  });

  // ----- subtasks
  const subtaskResult = (taskId) => ({ subtasks: listSubtasks(taskId), task: getTask(taskId) });
  const subtaskAccess = (user, id) => {
    const s = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id);
    if (!s) fail(404, 'Unteraufgabe nicht gefunden.');
    taskAccess(user, s.task_id);
    return s;
  };

  app.post('/api/tasks/:id/subtasks', wrap((req) => {
    const t = taskAccess(req.user, intId(req.params.id));
    const title = str(req.body.title, 300);
    if (!title) fail(400, 'Bitte einen Titel angeben.');
    const max = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM subtasks WHERE task_id = ?').get(t.id).m;
    db.prepare('INSERT INTO subtasks (task_id, title, position) VALUES (?, ?, ?)').run(t.id, title, max + 1);
    return subtaskResult(t.id);
  }));

  app.patch('/api/subtasks/:id', wrap((req) => {
    const s = subtaskAccess(req.user, intId(req.params.id));
    if (req.body.title !== undefined) {
      const title = str(req.body.title, 300);
      if (!title) fail(400, 'Titel darf nicht leer sein.');
      db.prepare('UPDATE subtasks SET title = ? WHERE id = ?').run(title, s.id);
    }
    if (req.body.completed !== undefined) db.prepare('UPDATE subtasks SET completed = ? WHERE id = ?').run(req.body.completed ? 1 : 0, s.id);
    return subtaskResult(s.task_id);
  }));

  app.delete('/api/subtasks/:id', wrap((req) => {
    const s = subtaskAccess(req.user, intId(req.params.id));
    db.prepare('DELETE FROM subtasks WHERE id = ?').run(s.id);
    return subtaskResult(s.task_id);
  }));

  // ----- attachments
  const attachmentResult = (taskId) => ({ attachments: listAttachments(taskId), task: getTask(taskId) });

  app.post('/api/tasks/:id/attachments',
    express.raw({ type: 'application/octet-stream', limit: `${MAX_UPLOAD_MB}mb` }),
    wrap((req) => {
      const t = taskAccess(req.user, intId(req.params.id));
      if (!Buffer.isBuffer(req.body) || !req.body.length) fail(400, 'Die Datei ist leer.');
      // Keep only the base name and strip control characters.
      const filename = path.basename(String(req.query.name || 'datei').replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'datei';
      const stored = crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(path.join(uploadsDir, stored), req.body);
      db.prepare('INSERT INTO attachments (task_id, user_id, filename, stored_name, size) VALUES (?, ?, ?, ?, ?)')
        .run(t.id, req.user.id, filename, stored, req.body.length);
      return attachmentResult(t.id);
    }));

  const attachmentAccess = (user, id) => {
    const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
    if (!a) fail(404, 'Datei nicht gefunden.');
    taskAccess(user, a.task_id);
    return a;
  };

  app.get('/api/attachments/:id', wrap((req, res) => {
    const a = attachmentAccess(req.user, intId(req.params.id));
    const file = path.join(uploadsDir, a.stored_name);
    if (!fs.existsSync(file)) fail(404, 'Datei nicht gefunden.');
    // Only known image types are ever shown inline; everything else is a forced download.
    const imageType = IMAGE_MIME[path.extname(a.filename).toLowerCase()];
    const inline = req.query.inline === '1' && imageType;
    res.setHeader('Content-Type', inline ? imageType : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Length', a.size);
    fs.createReadStream(file).pipe(res);
  }));

  app.delete('/api/attachments/:id', wrap((req) => {
    const a = attachmentAccess(req.user, intId(req.params.id));
    if (a.user_id !== req.user.id && req.user.role !== 'admin') fail(403, 'Du kannst nur eigene Dateien löschen.');
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
    unlinkFiles([a.stored_name]);
    return attachmentResult(a.task_id);
  }));

  // ----- custom fields
  const parseOptions = (v) => [...new Set((Array.isArray(v) ? v : []).map((o) => str(o, 80)).filter(Boolean))].slice(0, 50);
  const fieldAccess = (user, id) => {
    const f = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(id);
    if (!f) fail(404, 'Feld nicht gefunden.');
    projectAccess(user, f.project_id);
    return f;
  };

  app.post('/api/projects/:id/fields', wrap((req) => {
    const p = projectAccess(req.user, intId(req.params.id));
    const name = str(req.body.name, 60);
    if (!name) fail(400, 'Bitte einen Feldnamen angeben.');
    if (!FIELD_TYPES.includes(req.body.type)) fail(400, 'Ungültiger Feldtyp.');
    const options = req.body.type === 'select' ? parseOptions(req.body.options) : [];
    if (req.body.type === 'select' && !options.length) fail(400, 'Bitte mindestens eine Auswahloption angeben.');
    const count = db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS m FROM custom_fields WHERE project_id = ?').get(p.id);
    if (count.n >= 20) fail(400, 'Maximal 20 Felder pro Projekt.');
    db.prepare('INSERT INTO custom_fields (project_id, name, type, options, position) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, name, req.body.type, JSON.stringify(options), count.m + 1);
    return { fields: listFields(p.id) };
  }));

  app.patch('/api/fields/:id', wrap((req) => {
    const f = fieldAccess(req.user, intId(req.params.id));
    if (req.body.name !== undefined) {
      const name = str(req.body.name, 60);
      if (!name) fail(400, 'Bitte einen Feldnamen angeben.');
      db.prepare('UPDATE custom_fields SET name = ? WHERE id = ?').run(name, f.id);
    }
    if (req.body.options !== undefined && f.type === 'select') {
      const options = parseOptions(req.body.options);
      if (!options.length) fail(400, 'Bitte mindestens eine Auswahloption angeben.');
      db.prepare('UPDATE custom_fields SET options = ? WHERE id = ?').run(JSON.stringify(options), f.id);
    }
    return { fields: listFields(f.project_id) };
  }));

  app.delete('/api/fields/:id', wrap((req) => {
    const f = fieldAccess(req.user, intId(req.params.id));
    db.prepare('DELETE FROM custom_fields WHERE id = ?').run(f.id);
    return { fields: listFields(f.project_id) };
  }));

  app.put('/api/tasks/:id/fields/:fieldId', wrap((req) => {
    const t = taskAccess(req.user, intId(req.params.id));
    const f = db.prepare('SELECT * FROM custom_fields WHERE id = ? AND project_id = ?').get(intId(req.params.fieldId), t.project_id);
    if (!f) fail(404, 'Feld nicht gefunden.');
    let v = req.body.value;
    if (v === null || v === undefined || v === '' || v === false) v = null;
    else if (f.type === 'text') v = str(v, 1000) || null;
    else if (f.type === 'number') { v = Number(v); if (!Number.isFinite(v)) fail(400, 'Bitte eine Zahl angeben.'); v = String(v); }
    else if (f.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(400, 'Ungültiges Datum.'); }
    else if (f.type === 'checkbox') v = '1';
    else if (f.type === 'select') { if (!JSON.parse(f.options).includes(v)) fail(400, 'Ungültige Auswahl.'); }
    if (v === null) db.prepare('DELETE FROM task_field_values WHERE task_id = ? AND field_id = ?').run(t.id, f.id);
    else db.prepare('INSERT INTO task_field_values (task_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT (task_id, field_id) DO UPDATE SET value = excluded.value').run(t.id, f.id, v);
    return { task: getTask(t.id) };
  }));

  // ----- inbox
  const unreadNotifications = (uid) => db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(uid).n;

  app.get('/api/notifications', wrap((req) => {
    const rows = db.prepare(`
      SELECT n.id, n.type, n.text, n.read, n.created_at, n.task_id, n.project_id, n.actor_id,
        a.name AS actor_name, p.name AS project_name, p.color AS project_color
      FROM notifications n LEFT JOIN users a ON a.id = n.actor_id LEFT JOIN projects p ON p.id = n.project_id
      WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`).all(req.user.id);
    return {
      notifications: rows.map((n) => ({
        id: n.id, type: n.type, text: n.text, read: !!n.read, createdAt: n.created_at, taskId: n.task_id, projectId: n.project_id,
        actorId: n.actor_id, actorName: n.actor_name, projectName: n.project_name, projectColor: n.project_color,
      })),
    };
  }));

  app.post('/api/notifications/read', wrap((req) => {
    if (req.body.all) db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
    else if (req.body.id) db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?').run(req.user.id, intId(req.body.id));
    return { ok: true };
  }));

  // ----- chat
  function resolveChannel(user, key) {
    let m;
    if (key === 'general') return { kind: 'general', where: 'recipient_id IS NULL AND project_id IS NULL', params: [] };
    if ((m = /^project:(\d+)$/.exec(key))) {
      const p = projectAccess(user, Number(m[1]));
      return { kind: 'project', projectId: p.id, where: 'project_id = ?', params: [p.id] };
    }
    if ((m = /^dm:(\d+)$/.exec(key))) {
      const other = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(m[1]));
      if (!other || other.id === user.id) fail(404, 'Unterhaltung nicht gefunden.');
      return {
        kind: 'dm', otherId: other.id,
        where: '((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))',
        params: [user.id, other.id, other.id, user.id],
      };
    }
    return fail(404, 'Unterhaltung nicht gefunden.');
  }

  function channelList(user) {
    const reads = Object.fromEntries(db.prepare('SELECT channel, last_read_id FROM chat_reads WHERE user_id = ?').all(user.id).map((r) => [r.channel, r.last_read_id]));
    const stat = (key, where, params) => {
      const r = db.prepare(`SELECT COALESCE(MAX(id), 0) AS last,
        COALESCE(SUM(CASE WHEN id > ? AND (sender_id IS NULL OR sender_id != ?) THEN 1 ELSE 0 END), 0) AS unread
        FROM messages WHERE ${where}`).get(reads[key] || 0, user.id, ...params);
      return { lastId: r.last, unread: r.unread };
    };
    const channels = [{ key: 'general', kind: 'general', name: 'Allgemein', ...stat('general', 'recipient_id IS NULL AND project_id IS NULL', []) }];
    const projects = db.prepare(`SELECT id, name, color FROM projects p
      WHERE ? = 'admin' OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)
      ORDER BY name COLLATE NOCASE`).all(user.role, user.id);
    for (const p of projects) channels.push({ key: `project:${p.id}`, kind: 'project', name: p.name, color: p.color, ...stat(`project:${p.id}`, 'project_id = ?', [p.id]) });
    const users = db.prepare('SELECT id, name FROM users WHERE active = 1 AND id != ? ORDER BY name COLLATE NOCASE').all(user.id);
    for (const u of users) {
      channels.push({
        key: `dm:${u.id}`, kind: 'dm', name: u.name, userId: u.id,
        ...stat(`dm:${u.id}`, '((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))', [user.id, u.id, u.id, user.id]),
      });
    }
    return channels;
  }

  const mapMessage = (m) => ({ id: m.id, senderId: m.sender_id, senderName: m.sender_name, body: m.body, createdAt: m.created_at });
  const markRead = (uid, key, ch) => {
    const last = db.prepare(`SELECT COALESCE(MAX(id), 0) AS last FROM messages WHERE ${ch.where}`).get(...ch.params).last;
    db.prepare('INSERT INTO chat_reads (user_id, channel, last_read_id) VALUES (?, ?, ?) ON CONFLICT (user_id, channel) DO UPDATE SET last_read_id = excluded.last_read_id')
      .run(uid, key, last);
  };

  app.get('/api/chat/channels', wrap((req) => ({ channels: channelList(req.user) })));

  app.get('/api/chat/messages', wrap((req) => {
    const key = String(req.query.channel || '');
    const ch = resolveChannel(req.user, key);
    const rows = db.prepare(`SELECT m.*, u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id
      WHERE ${ch.where.replaceAll('sender_id', 'm.sender_id')} ORDER BY m.id DESC LIMIT 300`).all(...ch.params);
    markRead(req.user.id, key, ch);
    return { messages: rows.reverse().map(mapMessage) };
  }));

  app.post('/api/chat/messages', wrap((req) => {
    const key = String(req.body.channel || '');
    const ch = resolveChannel(req.user, key);
    const body = str(req.body.body, 5000);
    if (!body) fail(400, 'Die Nachricht ist leer.');
    const id = db.prepare('INSERT INTO messages (sender_id, recipient_id, project_id, body) VALUES (?, ?, ?, ?)')
      .run(req.user.id, ch.otherId ?? null, ch.projectId ?? null, body).lastInsertRowid;
    const message = mapMessage(db.prepare('SELECT m.*, u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(id));
    markRead(req.user.id, key, ch);
    if (ch.kind === 'dm') {
      push([ch.otherId], { type: 'chat', channel: `dm:${req.user.id}`, message });
      push([req.user.id], { type: 'chat', channel: key, message });
    } else {
      push(ch.kind === 'project' ? projectAudience(ch.projectId) : null, { type: 'chat', channel: key, message });
    }
    return { message };
  }));

  app.post('/api/chat/read', wrap((req) => {
    const key = String(req.body.channel || '');
    markRead(req.user.id, key, resolveChannel(req.user, key));
    return { ok: true };
  }));

  // ----- badge counters
  app.get('/api/counts', wrap((req) => ({
    inbox: unreadNotifications(req.user.id),
    chat: channelList(req.user).reduce((sum, c) => sum + c.unread, 0),
  })));
}

// Uploaded files whose database row is gone (e.g. after a crash) are removed on startup.
export function cleanOrphanedFiles() {
  const known = new Set(db.prepare('SELECT stored_name FROM attachments').all().map((r) => r.stored_name));
  for (const f of fs.readdirSync(uploadsDir)) if (!known.has(f)) fs.rm(path.join(uploadsDir, f), { force: true }, () => {});
}
