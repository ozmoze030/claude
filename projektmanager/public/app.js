// Projektmanager Frontend (Vanilla JS, kein Build-Schritt nötig)

// ---------------------------------------------------------------- utilities
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'projektmanager' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/login')) { state.me = null; disconnectEvents(); render(); }
    if (data.code === 'MUST_CHANGE_PASSWORD') { state.me.mustChangePassword = true; render(); }
    const err = new Error(data.error || 'Unbekannter Fehler.');
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Tiny hyperscript helper: h('div', { class: 'x', onclick }, 'text', child) */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2800);
}
const showError = (e) => toast(e.message || String(e), true);

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];
function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
function avatar(user, cls = '') {
  if (!user) return h('span', { class: `avatar empty ${cls}`, title: 'Nicht zugewiesen' }, '?');
  return h('span', {
    class: `avatar ${cls}`, title: user.name,
    style: { background: AVATAR_COLORS[user.id % AVATAR_COLORS.length] },
  }, initials(user.name));
}
const userById = (id) => state.users.find((u) => u.id === id);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dueInfo(dateStr, completed) {
  if (!dateStr) return null;
  const today = todayStr();
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((d - new Date(today + 'T00:00:00')) / 864e5);
  let label;
  if (diff === 0) label = 'Heute';
  else if (diff === 1) label = 'Morgen';
  else if (diff === -1) label = 'Gestern';
  else label = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: d.getFullYear() !== new Date().getFullYear() ? '2-digit' : undefined });
  const cls = completed ? '' : diff < 0 ? 'overdue' : diff === 0 ? 'today' : '';
  return h('span', { class: `due ${cls}`, title: d.toLocaleDateString('de-DE') }, '📅 ', label);
}
const PRIO_LABEL = { none: 'Keine', low: 'Niedrig', medium: 'Mittel', high: 'Hoch' };
const prioBadge = (p) => (p && p !== 'none' ? h('span', { class: `badge prio-${p}` }, PRIO_LABEL[p]) : null);
function formatDateTime(s) {
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}
const PROJECT_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];

// ---------------------------------------------------------------- state & routing
const state = {
  me: null,
  needsSetup: false,
  users: [],
  projects: [],
  project: null,       // { project, sections, tasks, members } of the open project
  myTasks: null,
  route: { name: 'my-tasks' },
  baseHash: '',
  openTaskId: null,
  navOpen: false,
  filterAssignee: 'all',
  showCompleted: true,
  allTasks: null,      // tasks of all accessible projects (calendar, workload)
  counts: { inbox: 0, chat: 0 },
  notifications: null,
  chat: { channels: [], messages: [] },
  calMonth: todayStr().slice(0, 7),
  calMine: false,
  resOffset: 0,
  resSel: null,
};

function parseHash() {
  let hash = location.hash.replace(/^#/, '') || '/my-tasks';
  let taskId = null;
  const tm = hash.match(/^(.*)\/task\/(\d+)$/);
  if (tm) { hash = tm[1]; taskId = Number(tm[2]); }
  let route;
  let m;
  if ((m = hash.match(/^\/project\/(\d+)(?:\/(board|list|calendar))?$/))) route = { name: 'project', id: Number(m[1]), view: m[2] || 'board' };
  else if ((m = hash.match(/^\/chat(?:\/(general|project:\d+|dm:\d+))?$/))) route = { name: 'chat', key: m[1] || (innerWidth > 800 ? 'general' : null) };
  else if (hash === '/inbox') route = { name: 'inbox' };
  else if (hash === '/calendar') route = { name: 'calendar' };
  else if (hash === '/resources') route = { name: 'resources' };
  else if (hash === '/projects') route = { name: 'projects' };
  else if (hash === '/team') route = { name: 'team' };
  else if (hash === '/settings') route = { name: 'settings' };
  else { route = { name: 'my-tasks' }; hash = '/my-tasks'; }
  return { route, base: hash, taskId };
}
const go = (hash) => { location.hash = hash; };
const openTask = (id) => go(`${state.baseHash}/task/${id}`);
const closeTask = () => go(state.baseHash);

window.addEventListener('hashchange', onRoute);

async function onRoute() {
  if (!state.me) return render();
  const { route, base, taskId } = parseHash();
  const baseChanged = base !== state.baseHash;
  state.route = route;
  state.baseHash = base;
  state.openTaskId = taskId;
  state.navOpen = false;
  if (baseChanged) {
    state.filterAssignee = 'all';
    await loadRouteData();
    render();
  } else {
    renderPanel();
  }
}

async function loadRouteData() {
  try {
    if (state.route.name === 'project') {
      state.project = null;
      state.project = await api('GET', `/api/projects/${state.route.id}`);
    } else if (state.route.name === 'my-tasks') {
      state.myTasks = (await api('GET', '/api/my-tasks')).tasks;
    } else if (state.route.name === 'team') {
      state.allUsers = (await api('GET', '/api/users?all=1')).users;
    } else if (state.route.name === 'calendar' || state.route.name === 'resources') {
      state.resSel = null;
      const [tasks] = await Promise.all([api('GET', '/api/all-tasks'), refreshUsers()]);
      state.allTasks = tasks.tasks;
    } else if (state.route.name === 'inbox') {
      state.notifications = (await api('GET', '/api/notifications')).notifications;
    } else if (state.route.name === 'chat') {
      const key = state.route.key;
      // Loading the messages marks the channel as read, so fetch them before the channel list.
      state.chat.messages = key ? (await api('GET', `/api/chat/messages?channel=${encodeURIComponent(key)}`)).messages : [];
      state.chat.channels = (await api('GET', '/api/chat/channels')).channels;
      refreshCounts();
    }
  } catch (e) {
    if (e.status === 404) { toast(e.message, true); go('/my-tasks'); } else showError(e);
  }
}

async function refreshProjects() {
  state.projects = (await api('GET', '/api/projects')).projects;
}
async function refreshUsers() {
  state.users = (await api('GET', '/api/users')).users;
}
async function reloadCurrent() {
  await Promise.all([loadRouteData(), refreshProjects()]);
  render();
}

// ---------------------------------------------------------------- root render
const root = document.getElementById('app');

function render() {
  root.replaceChildren();
  if (state.needsSetup) return root.append(setupView());
  if (!state.me) return root.append(loginView());
  if (state.me.mustChangePassword) return root.append(forcePasswordView());
  root.append(h('div', { class: `layout ${state.navOpen ? 'nav-open' : ''}` }, sidebar(), mainView()));
  renderPanel();
}

// ---------------------------------------------------------------- auth views
function authCard(title, sub, fields, buttonLabel, onSubmit) {
  const err = h('p', { class: 'error-text', hidden: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, buttonLabel);
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      btn.disabled = true;
      try { await onSubmit(Object.fromEntries(new FormData(form))); } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { btn.disabled = false; }
    },
  }, err, fields, btn);
  return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, '✓'), 'Projektmanager'),
    h('h1', {}, title), h('p', { class: 'sub' }, sub), form));
}
const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint && h('div', { class: 'hint' }, hint));

function loginView() {
  return authCard('Anmelden', 'Melde dich mit deinem Firmenkonto an.', [
    field('E-Mail', h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username', autofocus: true })),
    field('Passwort', h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' })),
  ], 'Anmelden', async (d) => {
    const { user } = await api('POST', '/api/login', d);
    await afterLogin(user);
  });
}

function setupView() {
  return authCard('Ersteinrichtung', 'Lege das erste Administrator-Konto an. Danach kannst du deine Teammitglieder einladen.', [
    field('Dein Name', h('input', { type: 'text', name: 'name', required: true, autofocus: true })),
    field('E-Mail', h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' })),
    field('Passwort', h('input', { type: 'password', name: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), 'Mindestens 8 Zeichen'),
  ], 'Konto erstellen', async (d) => {
    const { user } = await api('POST', '/api/setup', d);
    state.needsSetup = false;
    await afterLogin(user);
  });
}

function forcePasswordView() {
  return authCard('Neues Passwort festlegen', `Hallo ${state.me.name}! Bitte ersetze dein vorläufiges Passwort durch ein eigenes.`, [
    field('Vorläufiges Passwort', h('input', { type: 'password', name: 'currentPassword', required: true, autocomplete: 'current-password' })),
    field('Neues Passwort', h('input', { type: 'password', name: 'newPassword', required: true, minlength: 8, autocomplete: 'new-password' }), 'Mindestens 8 Zeichen'),
  ], 'Passwort speichern', async (d) => {
    const { user } = await api('POST', '/api/me/password', d);
    await afterLogin(user);
    toast('Passwort gespeichert. Willkommen!');
  });
}

async function afterLogin(user) {
  state.me = user;
  state.baseHash = '';
  if (!user.mustChangePassword) {
    await Promise.all([refreshUsers(), refreshProjects()]);
    connectEvents();
    await onRoute();
  } else {
    render();
  }
}

async function logout() {
  await api('POST', '/api/logout').catch(() => {});
  disconnectEvents();
  state.me = null;
  state.project = null;
  state.allTasks = null;
  state.notifications = null;
  state.chat = { channels: [], messages: [] };
  state.counts = { inbox: 0, chat: 0 };
  state.baseHash = '';
  document.title = 'Projektmanager';
  render();
}

// ---------------------------------------------------------------- sidebar
function sidebar() {
  const r = state.route;
  const navLink = (hash, icon, label, active, badge) => h('a', { class: `nav-item ${active ? 'active' : ''}`, href: `#${hash}` },
    h('span', {}, icon), h('span', { class: 'label' }, label),
    badge && h('span', { class: 'badge-count', id: `badge-${badge}`, hidden: !state.counts[badge] }, state.counts[badge] || ''));
  return h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, '✓'), 'Projektmanager'),
    navLink('/my-tasks', '☑', 'Meine Aufgaben', r.name === 'my-tasks'),
    navLink('/inbox', '🔔', 'Inbox', r.name === 'inbox', 'inbox'),
    navLink('/chat', '💬', 'Chat', r.name === 'chat', 'chat'),
    navLink('/calendar', '📅', 'Kalender', r.name === 'calendar'),
    navLink('/resources', '📊', 'Auslastung', r.name === 'resources'),
    navLink('/projects', '▦', 'Alle Projekte', r.name === 'projects'),
    state.me.role === 'admin' && navLink('/team', '👥', 'Team verwalten', r.name === 'team'),
    h('div', { class: 'nav-section' }, 'Projekte',
      h('button', { class: 'icon-btn', title: 'Neues Projekt', onclick: projectDialog }, '+')),
    state.projects.map((p) => h('a', {
      class: `nav-item ${r.name === 'project' && r.id === p.id ? 'active' : ''}`, href: `#/project/${p.id}`,
    }, h('span', { class: 'dot', style: { background: p.color } }), h('span', { class: 'label' }, p.name))),
    !state.projects.length && h('div', { class: 'nav-item', style: { opacity: 0.6, cursor: 'default' } }, 'Noch keine Projekte'),
    h('div', { class: 'sidebar-footer' },
      h('div', { class: 'user-chip' }, avatar(state.me, 'lg'),
        h('div', { class: 'who' }, h('b', {}, state.me.name), h('small', {}, state.me.role === 'admin' ? 'Administrator' : 'Mitglied'))),
      navLink('/settings', '⚙', 'Mein Konto', r.name === 'settings'),
      h('button', { class: 'nav-item', onclick: logout }, h('span', {}, '⎋'), h('span', { class: 'label' }, 'Abmelden'))),
  );
}

function topbar(...children) {
  return h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn menu-toggle', title: 'Menü', onclick: () => { state.navOpen = !state.navOpen; render(); } }, '☰'),
    children);
}

function mainView() {
  const r = state.route;
  let view;
  if (r.name === 'project') view = projectView();
  else if (r.name === 'projects') view = projectsView();
  else if (r.name === 'team') view = teamView();
  else if (r.name === 'settings') view = settingsView();
  else if (r.name === 'inbox') view = inboxView();
  else if (r.name === 'chat') view = chatView();
  else if (r.name === 'calendar') view = globalCalendarView();
  else if (r.name === 'resources') view = resourcesView();
  else view = myTasksView();
  return h('main', { class: 'main', onclick: () => { if (state.navOpen) { state.navOpen = false; render(); } } }, view);
}

// ---------------------------------------------------------------- my tasks
function myTasksView() {
  const tasks = state.myTasks;
  const head = topbar(h('h1', {}, 'Meine Aufgaben'));
  if (!tasks) return [head, h('div', { class: 'content loading' }, 'Lädt…')];
  const today = todayStr();
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const groups = [
    ['Überfällig', (t) => !t.completed && t.dueDate && t.dueDate < today],
    ['Heute', (t) => !t.completed && t.dueDate === today],
    ['Nächste 7 Tage', (t) => !t.completed && t.dueDate > today && t.dueDate <= in7],
    ['Später', (t) => !t.completed && t.dueDate > in7],
    ['Ohne Fälligkeitsdatum', (t) => !t.completed && !t.dueDate],
    ['Kürzlich erledigt', (t) => t.completed],
  ];
  const open = tasks.filter((t) => !t.completed).length;
  return [
    head,
    h('div', { class: 'content' },
      h('p', { style: { color: 'var(--muted)', marginTop: 0 } }, open ? `Du hast ${open} offene Aufgabe${open === 1 ? '' : 'n'}.` : 'Alles erledigt. 🎉'),
      !tasks.length
        ? h('div', { class: 'empty' }, 'Dir sind noch keine Aufgaben zugewiesen.')
        : h('div', { class: 'task-groups' }, groups.map(([label, fn]) => {
          const list = tasks.filter(fn);
          if (!list.length) return null;
          return h('div', { class: 'task-group' }, h('h2', {}, `${label} (${list.length})`), taskTable(list, { showProject: true }));
        })),
    ),
  ];
}

// ---------------------------------------------------------------- projects overview
function projectsView() {
  return [
    topbar(h('h1', {}, 'Alle Projekte'), h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: projectDialog }, '+ Neues Projekt')),
    h('div', { class: 'content' },
      !state.projects.length
        ? h('div', { class: 'empty' }, 'Noch keine Projekte. Lege dein erstes Projekt an!')
        : h('div', { class: 'stats' }, state.projects.map((p) => {
          const pct = p.taskCount ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
          return h('a', { class: 'project-card', href: `#/project/${p.id}` },
            h('h3', {}, h('span', { class: 'dot', style: { background: p.color } }), p.name),
            h('p', {}, p.description || 'Keine Beschreibung'),
            h('div', { class: 'progress' }, h('div', { style: { width: `${pct}%` } })),
            h('div', { class: 'hint' }, `${p.doneCount} von ${p.taskCount} Aufgaben erledigt`));
        })),
    ),
  ];
}

// ---------------------------------------------------------------- project view
function projectView() {
  const data = state.project;
  if (!data) return [topbar(h('h1', {}, 'Projekt')), h('div', { class: 'content loading' }, 'Lädt…')];
  const { project, members } = data;
  const r = state.route;
  const base = `#/project/${project.id}`;
  return [
    topbar(
      h('h1', {}, h('span', { class: 'dot', style: { background: project.color, width: '14px', height: '14px' } }), project.name),
      h('div', { class: 'tabs' },
        h('a', { href: `${base}/board`, class: r.view === 'board' ? 'active' : '' }, 'Board'),
        h('a', { href: `${base}/list`, class: r.view === 'list' ? 'active' : '' }, 'Liste'),
        h('a', { href: `${base}/calendar`, class: r.view === 'calendar' ? 'active' : '' }, 'Kalender')),
      h('div', { class: 'spacer' }),
      h('div', { class: 'filter-bar' },
        h('select', {
          title: 'Filtern nach Person',
          onchange: (e) => { state.filterAssignee = e.target.value; render(); },
        },
        h('option', { value: 'all', selected: state.filterAssignee === 'all' }, 'Alle Aufgaben'),
        h('option', { value: 'me', selected: state.filterAssignee === 'me' }, 'Mir zugewiesen'),
        h('option', { value: 'none', selected: state.filterAssignee === 'none' }, 'Nicht zugewiesen'),
        members.filter((m) => m.id !== state.me.id).map((m) => h('option', { value: String(m.id), selected: state.filterAssignee === String(m.id) }, m.name)))),
      h('div', { class: 'avatars', title: 'Projektmitglieder' }, members.slice(0, 5).map((m) => avatar(m))),
      h('button', { class: 'btn', title: 'Eigene Felder für Aufgaben in diesem Projekt', onclick: () => fieldsDialog(data) }, '＋ Felder'),
      h('button', { class: 'btn', onclick: () => projectDialog(data) }, '⚙ Einstellungen'),
    ),
    h('div', { class: 'content' }, r.view === 'list' ? listView(data) : r.view === 'calendar' ? calendarView(filteredTasks(data.tasks), data) : boardView(data)),
  ];
}

function filteredTasks(tasks) {
  const f = state.filterAssignee;
  if (f === 'all') return tasks;
  if (f === 'me') return tasks.filter((t) => t.assigneeId === state.me.id);
  if (f === 'none') return tasks.filter((t) => !t.assigneeId);
  return tasks.filter((t) => t.assigneeId === Number(f));
}

async function toggleComplete(task) {
  try {
    const { task: updated } = await api('PATCH', `/api/tasks/${task.id}`, { completed: !task.completed });
    applyTaskUpdate(updated);
    if (updated.completed) toast('Aufgabe erledigt ✓');
  } catch (e) { showError(e); }
}

function applyTaskUpdate(updated) {
  if (state.project) {
    const i = state.project.tasks.findIndex((t) => t.id === updated.id);
    if (i >= 0) state.project.tasks[i] = updated;
  }
  if (state.allTasks) {
    const i = state.allTasks.findIndex((t) => t.id === updated.id);
    if (i >= 0) state.allTasks[i] = updated;
  }
  if (state.myTasks) {
    const i = state.myTasks.findIndex((t) => t.id === updated.id);
    if (i >= 0) {
      if (updated.assigneeId === state.me.id) state.myTasks[i] = updated;
      else state.myTasks.splice(i, 1);
    }
  }
  render();
  refreshProjects().then(() => { /* counters in sidebar/overview */ }).catch(() => {});
}

function checkButton(task) {
  return h('button', {
    class: `check ${task.completed ? 'on' : ''}`, title: task.completed ? 'Als offen markieren' : 'Als erledigt markieren',
    onclick: (e) => { e.stopPropagation(); toggleComplete(task); },
  }, '✓');
}

// ----- board
let dragTaskId = null;

function boardView(data) {
  const tasks = filteredTasks(data.tasks);
  return h('div', { class: 'board' },
    data.sections.map((s) => boardColumn(s, tasks.filter((t) => t.sectionId === s.id).sort((a, b) => a.position - b.position))),
    h('div', { class: 'add-column' }, h('button', { class: 'btn ghost', onclick: () => addSection(data.project.id) }, '+ Spalte hinzufügen')),
  );
}

function boardColumn(section, tasks) {
  const body = h('div', { class: 'column-body' }, tasks.map(card));
  let indicator = null;
  const dropIndex = (y) => {
    const cards = [...body.querySelectorAll('.card:not(.dragging)')];
    const idx = cards.findIndex((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
    return idx < 0 ? cards.length : idx;
  };
  body.addEventListener('dragover', (e) => {
    if (dragTaskId == null) return;
    e.preventDefault();
    body.classList.add('drag-over');
    const idx = dropIndex(e.clientY);
    const cards = [...body.querySelectorAll('.card:not(.dragging)')];
    indicator ??= h('div', { class: 'drop-indicator' });
    if (cards[idx]) body.insertBefore(indicator, cards[idx]); else body.append(indicator);
  });
  body.addEventListener('dragleave', (e) => {
    if (!body.contains(e.relatedTarget)) { body.classList.remove('drag-over'); indicator?.remove(); }
  });
  body.addEventListener('drop', async (e) => {
    e.preventDefault();
    body.classList.remove('drag-over');
    indicator?.remove();
    const id = dragTaskId;
    dragTaskId = null;
    if (id == null) return;
    const all = state.project.tasks.filter((t) => t.sectionId === section.id && t.id !== id).sort((a, b) => a.position - b.position);
    // Map index among visible (filtered) cards to a position among all tasks of the section.
    const visible = tasks.filter((t) => t.id !== id);
    const idx = dropIndex(e.clientY);
    const after = visible[idx];
    const before = idx > 0 ? visible[idx - 1] : (after ? all[all.indexOf(after) - 1] : all[all.length - 1]);
    let position;
    if (before && after) position = (before.position + after.position) / 2;
    else if (before) position = before.position + 1;
    else if (after) position = after.position - 1;
    else position = 1;
    const task = state.project.tasks.find((t) => t.id === id);
    if (!task) return;
    const prev = { sectionId: task.sectionId, position: task.position };
    Object.assign(task, { sectionId: section.id, position, sectionName: section.name });
    render();
    try {
      const { task: updated } = await api('PATCH', `/api/tasks/${id}`, { sectionId: section.id, position });
      applyTaskUpdate(updated);
    } catch (err) {
      Object.assign(task, prev);
      render();
      showError(err);
    }
  });

  const nameEl = h('span', { class: 'name', title: 'Klicken zum Umbenennen', onclick: () => renameSection(section, nameEl) }, section.name);
  const quickInput = h('input', {
    type: 'text', placeholder: '+ Aufgabe hinzufügen',
    onkeydown: async (e) => {
      if (e.key !== 'Enter' || !quickInput.value.trim()) return;
      const title = quickInput.value.trim();
      quickInput.value = '';
      try {
        const assigneeId = state.filterAssignee === 'me' ? state.me.id : /^\d+$/.test(state.filterAssignee) ? Number(state.filterAssignee) : null;
        const { task } = await api('POST', `/api/projects/${state.project.project.id}/tasks`, { title, sectionId: section.id, assigneeId });
        state.project.tasks.push(task);
        render();
        document.querySelector(`[data-quick="${section.id}"]`)?.focus();
        refreshProjects().catch(() => {});
      } catch (err) { showError(err); }
    },
  });
  quickInput.dataset.quick = section.id;

  return h('section', { class: 'column' },
    h('div', { class: 'column-head' }, nameEl, h('span', { class: 'count' }, tasks.length),
      h('button', { class: 'icon-btn', title: 'Spalte löschen', onclick: () => deleteSection(section) }, '🗑')),
    body,
    h('div', { class: 'quick-add' }, quickInput));
}

function card(task) {
  const assignee = task.assigneeId ? userById(task.assigneeId) || { id: task.assigneeId, name: task.assigneeName } : null;
  const el = h('div', {
    class: `card ${task.completed ? 'done' : ''}`, draggable: 'true',
    onclick: () => openTask(task.id),
    ondragstart: (e) => { dragTaskId = task.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(task.id)); requestAnimationFrame(() => el.classList.add('dragging')); },
    ondragend: () => { el.classList.remove('dragging'); dragTaskId = null; document.querySelectorAll('.drop-indicator').forEach((n) => n.remove()); document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over')); },
  },
  h('div', { class: 'card-top' }, checkButton(task), h('div', { class: 'card-title' }, task.title)),
  h('div', { class: 'card-meta' },
    prioBadge(task.priority), dueInfo(task.dueDate, task.completed),
    task.subtaskCount ? h('span', { title: 'Unteraufgaben' }, `☑ ${task.subtaskDone}/${task.subtaskCount}`) : null,
    task.attachmentCount ? h('span', { title: 'Dateianhänge' }, `📎 ${task.attachmentCount}`) : null,
    task.commentCount ? h('span', { title: 'Kommentare' }, `💬 ${task.commentCount}`) : null,
    h('span', { class: 'spacer' }), assignee ? avatar(assignee) : null));
  return el;
}

async function addSection(projectId) {
  const name = prompt('Name der neuen Spalte:');
  if (!name?.trim()) return;
  try {
    await api('POST', `/api/projects/${projectId}/sections`, { name });
    await reloadCurrent();
  } catch (e) { showError(e); }
}

function renameSection(section, nameEl) {
  const input = h('input', { type: 'text', class: 'inline-edit', value: section.name });
  const finish = async (save) => {
    if (!input.isConnected) return;
    const name = input.value.trim();
    if (save && name && name !== section.name) {
      try { await api('PATCH', `/api/sections/${section.id}`, { name }); section.name = name; } catch (e) { showError(e); }
    }
    render();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
  nameEl.replaceWith(input);
  input.focus();
  input.select();
}

async function deleteSection(section) {
  if (!confirm(`Spalte „${section.name}“ löschen? Enthaltene Aufgaben werden in die erste andere Spalte verschoben.`)) return;
  try {
    await api('DELETE', `/api/sections/${section.id}`);
    await reloadCurrent();
  } catch (e) { showError(e); }
}

// ----- list
function listView(data) {
  let tasks = filteredTasks(data.tasks);
  const toggle = h('label', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center', marginBottom: '12px', cursor: 'pointer' } },
    h('input', { type: 'checkbox', checked: state.showCompleted, onchange: (e) => { state.showCompleted = e.target.checked; render(); } }),
    'Erledigte Aufgaben anzeigen');
  if (!state.showCompleted) tasks = tasks.filter((t) => !t.completed);
  const newBtn = h('button', { class: 'btn primary', style: { marginLeft: '12px' }, onclick: () => newTaskDialog(data) }, '+ Aufgabe');
  return h('div', {},
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, toggle, newBtn),
    h('div', { class: 'res-scroll' }, taskTable(tasks, { groupBy: data.sections, fields: data.fields })));
}

function taskTable(tasks, { showProject = false, groupBy = null, fields = [] } = {}) {
  const row = (t) => {
    const assignee = t.assigneeId ? userById(t.assigneeId) || { id: t.assigneeId, name: t.assigneeName } : null;
    return h('tr', { class: `task-row ${t.completed ? 'done' : ''}`, onclick: () => openTask(t.id) },
      h('td', {}, h('div', { class: 'title-cell' }, checkButton(t), h('span', { class: 'title' }, t.title),
        t.subtaskCount ? h('span', { class: 'hint', style: { margin: 0 } }, `☑ ${t.subtaskDone}/${t.subtaskCount}`) : null,
        t.attachmentCount ? h('span', { class: 'hint', style: { margin: 0 } }, `📎 ${t.attachmentCount}`) : null,
        t.commentCount ? h('span', { class: 'hint', style: { margin: 0 } }, `💬 ${t.commentCount}`) : null)),
      showProject && h('td', { class: 'hide-sm' }, h('span', { class: 'project-pill' }, h('span', { class: 'dot', style: { background: t.projectColor } }), t.projectName)),
      h('td', { class: 'hide-sm' }, assignee ? h('div', { class: 'assignee-cell' }, avatar(assignee), assignee.name) : h('span', { class: 'hint' }, '–')),
      h('td', {}, dueInfo(t.dueDate, t.completed) || h('span', { class: 'hint' }, '–')),
      h('td', { class: 'hide-sm' }, prioBadge(t.priority)),
      fields.map((f) => h('td', { class: 'hide-sm' }, fieldDisplay(f, t.fields?.[f.id]))));
  };
  const cols = 3 + (showProject ? 1 : 0) + 1 + fields.length;
  let bodyRows;
  if (groupBy) {
    bodyRows = groupBy.map((s) => {
      const list = tasks.filter((t) => t.sectionId === s.id).sort((a, b) => a.position - b.position);
      return [h('tr', { class: 'group' }, h('td', { colspan: cols }, `${s.name} `, h('span', { class: 'hint' }, `(${list.length})`))), list.map(row)];
    });
  } else {
    bodyRows = tasks.map(row);
  }
  return h('table', { class: 'list-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Aufgabe'), showProject && h('th', { class: 'hide-sm' }, 'Projekt'),
      h('th', { class: 'hide-sm' }, 'Zuständig'), h('th', {}, 'Fällig'), h('th', { class: 'hide-sm' }, 'Priorität'),
      fields.map((f) => h('th', { class: 'hide-sm' }, f.name)))),
    h('tbody', {}, bodyRows));
}

// ---------------------------------------------------------------- task panel
let panelEl = null;

async function renderPanel() {
  const id = state.openTaskId;
  if (!id) { panelEl?.remove(); panelEl = null; return; }
  if (panelEl?.dataset.taskId === String(id)) { if (!panelEl.isConnected) document.body.append(panelEl); return; }
  panelEl?.remove();
  panelEl = h('div', {}, h('div', { class: 'panel-backdrop', onclick: closeTask }),
    h('aside', { class: 'panel' }, h('div', { class: 'loading' }, 'Lädt…')));
  panelEl.dataset.taskId = String(id);
  document.body.append(panelEl);
  try {
    const data = await api('GET', `/api/tasks/${id}`);
    if (state.openTaskId !== id) return;
    const members = await taskMembers(data.task.projectId);
    panelEl.querySelector('.panel').replaceWith(taskPanel(data, members));
  } catch (e) {
    showError(e);
    closeTask();
  }
}

async function taskMembers(projectId) {
  let members = state.project?.project.id === projectId ? state.project.members : null;
  if (!members) members = (await api('GET', `/api/projects/${projectId}`)).members;
  // Admins can always be assigned (they see every project).
  const ids = new Set(members.map((m) => m.id));
  return [...members, ...state.users.filter((u) => u.role === 'admin' && !ids.has(u.id))];
}

function taskPanel({ task, comments, subtasks, attachments, fields }, members) {
  const save = async (patch) => {
    try {
      const { task: updated } = await api('PATCH', `/api/tasks/${task.id}`, patch);
      Object.assign(task, updated);
      applyTaskUpdate(updated);
      return updated;
    } catch (e) { showError(e); }
  };

  const titleInput = h('textarea', { class: 'panel-title', rows: 1, value: task.title });
  const autosize = () => { titleInput.style.height = 'auto'; titleInput.style.height = titleInput.scrollHeight + 'px'; };
  titleInput.addEventListener('input', autosize);
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); } });
  titleInput.addEventListener('change', () => { const v = titleInput.value.trim(); if (v && v !== task.title) save({ title: v }); else titleInput.value = task.title; });
  requestAnimationFrame(autosize);

  const completeBtn = h('button', {
    class: `btn ${task.completed ? '' : 'primary'}`,
    onclick: async () => {
      const u = await save({ completed: !task.completed });
      if (u) { completeBtn.className = `btn ${u.completed ? '' : 'primary'}`; completeBtn.textContent = u.completed ? '↺ Wieder öffnen' : '✓ Als erledigt markieren'; }
    },
  }, task.completed ? '↺ Wieder öffnen' : '✓ Als erledigt markieren');

  const sections = state.project?.project.id === task.projectId ? state.project.sections : null;

  const commentList = h('div', {}, comments.map((c) => commentEl(c, task)));
  const commentInput = h('textarea', { placeholder: 'Kommentar schreiben… (Strg+Enter zum Senden)' });
  const sendComment = async () => {
    const body = commentInput.value.trim();
    if (!body) return;
    try {
      await api('POST', `/api/tasks/${task.id}/comments`, { body });
      commentInput.value = '';
      const data = await api('GET', `/api/tasks/${task.id}`);
      commentList.replaceChildren(...data.comments.map((c) => commentEl(c, task)));
      applyTaskUpdate(data.task);
    } catch (e) { showError(e); }
  };
  commentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComment(); });

  const creator = userById(task.createdBy);
  const adopt = (updated) => { Object.assign(task, updated); applyTaskUpdate(updated); };

  // custom fields
  const saveField = async (f, value) => {
    try { adopt((await api('PUT', `/api/tasks/${task.id}/fields/${f.id}`, { value })).task); } catch (e) { showError(e); }
  };
  const fieldInput = (f) => {
    const v = task.fields?.[f.id];
    if (f.type === 'checkbox') return h('input', { type: 'checkbox', checked: v === '1', style: { width: 'auto', justifySelf: 'start' }, onchange: (e) => saveField(f, e.target.checked) });
    if (f.type === 'select') {
      return h('select', { onchange: (e) => saveField(f, e.target.value) }, h('option', { value: '' }, '–'),
        f.options.map((o) => h('option', { value: o, selected: o === v }, o)));
    }
    return h('input', { type: f.type, step: f.type === 'number' ? 'any' : null, value: v ?? '', onchange: (e) => saveField(f, e.target.value) });
  };

  // subtasks
  const subHead = h('h3', {});
  const subWrap = h('div', { class: 'subtasks' });
  const subReq = async (method, url, body) => {
    try { const r = await api(method, url, body); drawSubs(r.subtasks); adopt(r.task); } catch (e) { showError(e); }
  };
  function drawSubs(list) {
    subHead.textContent = list.length ? `Unteraufgaben (${list.filter((s) => s.completed).length}/${list.length})` : 'Unteraufgaben';
    subWrap.replaceChildren(...list.map((s) => h('div', { class: `subtask ${s.completed ? 'done' : ''}` },
      h('button', { class: `check ${s.completed ? 'on' : ''}`, title: 'Erledigt', onclick: () => subReq('PATCH', `/api/subtasks/${s.id}`, { completed: !s.completed }) }, '✓'),
      h('input', { type: 'text', class: 'subtask-title', value: s.title, maxlength: 300, onchange: (e) => subReq('PATCH', `/api/subtasks/${s.id}`, { title: e.target.value }) }),
      h('button', { class: 'icon-btn', title: 'Unteraufgabe löschen', onclick: () => subReq('DELETE', `/api/subtasks/${s.id}`) }, '✕'))));
  }
  drawSubs(subtasks);
  const subInput = h('input', {
    type: 'text', placeholder: '+ Unteraufgabe hinzufügen (Enter)', maxlength: 300,
    onkeydown: (e) => {
      if (e.key !== 'Enter' || !subInput.value.trim()) return;
      const title = subInput.value.trim();
      subInput.value = '';
      subReq('POST', `/api/tasks/${task.id}/subtasks`, { title });
    },
  });

  // attachments
  const attWrap = h('div', { class: 'attachments' });
  function drawAtts(list) {
    attWrap.replaceChildren(...list.map((a) => h('div', { class: 'attachment' },
      a.isImage
        ? h('a', { href: `/api/attachments/${a.id}?inline=1`, target: '_blank', rel: 'noopener' }, h('img', { src: `/api/attachments/${a.id}?inline=1`, alt: '', loading: 'lazy' }))
        : h('span', { class: 'file-icon' }, '📄'),
      h('div', { class: 'att-info' }, h('a', { href: `/api/attachments/${a.id}`, download: a.filename }, a.filename),
        h('div', { class: 'hint' }, `${fmtSize(a.size)} · ${a.userName || 'Unbekannt'} · ${formatDateTime(a.createdAt)}`)),
      (a.userId === state.me.id || state.me.role === 'admin') && h('button', {
        class: 'icon-btn', title: 'Datei löschen',
        onclick: async () => {
          if (!confirm(`Datei „${a.filename}“ löschen?`)) return;
          try { const r = await api('DELETE', `/api/attachments/${a.id}`); drawAtts(r.attachments); adopt(r.task); } catch (e) { showError(e); }
        },
      }, '✕'))));
  }
  drawAtts(attachments);
  const uploadBtn = h('button', { class: 'btn small', onclick: () => fileInput.click() }, '📎 Datei anhängen');
  const uploadFiles = async (files) => {
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Lädt hoch…';
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) { toast(`„${f.name}“ ist größer als 25 MB.`, true); continue; }
      try { const r = await uploadFile(task.id, f); drawAtts(r.attachments); adopt(r.task); } catch (e) { showError(e); }
    }
    uploadBtn.disabled = false;
    uploadBtn.textContent = '📎 Datei anhängen';
  };
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: async () => { await uploadFiles([...fileInput.files]); fileInput.value = ''; } });
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  return h('aside', { class: 'panel', role: 'dialog', 'aria-label': 'Aufgabendetails' },
    h('div', { class: 'panel-head' }, completeBtn, h('span', { class: 'spacer' }),
      h('button', {
        class: 'icon-btn', title: 'Link kopieren',
        onclick: () => navigator.clipboard?.writeText(`${location.origin}/#/project/${task.projectId}/board/task/${task.id}`).then(() => toast('Link kopiert')),
      }, '🔗'),
      h('button', {
        class: 'icon-btn', title: 'Aufgabe löschen',
        onclick: async () => {
          if (!confirm(`Aufgabe „${task.title}“ wirklich löschen?`)) return;
          try {
            await api('DELETE', `/api/tasks/${task.id}`);
            if (state.project) state.project.tasks = state.project.tasks.filter((t) => t.id !== task.id);
            if (state.myTasks) state.myTasks = state.myTasks.filter((t) => t.id !== task.id);
            closeTask();
            render();
            refreshProjects().catch(() => {});
            toast('Aufgabe gelöscht');
          } catch (e) { showError(e); }
        },
      }, '🗑'),
      h('button', { class: 'icon-btn', title: 'Schließen', onclick: closeTask }, '✕')),
    h('div', {
      class: 'panel-body',
      ondragover: (e) => { if (hasFiles(e)) { e.preventDefault(); e.currentTarget.classList.add('file-over'); } },
      ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('file-over'); },
      ondrop: (e) => { if (hasFiles(e)) { e.preventDefault(); e.currentTarget.classList.remove('file-over'); uploadFiles([...e.dataTransfer.files]); } },
    },
      titleInput,
      h('div', { class: 'props' },
        h('span', {}, 'Projekt'),
        h('a', { href: `#/project/${task.projectId}`, class: 'project-pill', style: { color: 'var(--text)', textDecoration: 'none' } },
          h('span', { class: 'dot', style: { background: task.projectColor } }), task.projectName),
        h('span', {}, 'Zuständig'),
        h('select', { onchange: (e) => save({ assigneeId: e.target.value ? Number(e.target.value) : null }) },
          h('option', { value: '' }, '– Niemand –'),
          members.map((m) => h('option', { value: String(m.id), selected: m.id === task.assigneeId }, m.id === state.me.id ? `${m.name} (ich)` : m.name))),
        h('span', {}, 'Fälligkeitsdatum'),
        h('input', { type: 'date', value: task.dueDate || '', onchange: (e) => save({ dueDate: e.target.value || null }) }),
        h('span', {}, 'Priorität'),
        h('select', { onchange: (e) => save({ priority: e.target.value }) },
          Object.entries(PRIO_LABEL).map(([v, l]) => h('option', { value: v, selected: task.priority === v }, l))),
        h('span', {}, 'Spalte'),
        sections
          ? h('select', {
            onchange: (e) => {
              const sid = Number(e.target.value);
              const max = Math.max(0, ...state.project.tasks.filter((t) => t.sectionId === sid).map((t) => t.position));
              save({ sectionId: sid, position: max + 1 });
            },
          }, sections.map((s) => h('option', { value: String(s.id), selected: s.id === task.sectionId }, s.name)))
          : h('span', {}, task.sectionName),
        h('span', {}, 'Aufwand (Std.)'),
        h('input', {
          type: 'number', min: 0, step: 0.5, placeholder: 'z. B. 4', value: task.estimateHours ?? '', title: 'Geschätzter Aufwand, wird für die Auslastung verwendet',
          onchange: (e) => save({ estimateHours: e.target.value === '' ? null : Number(e.target.value) }),
        }),
        fields.map((f) => [h('span', {}, f.name), fieldInput(f)]),
      ),
      h('label', { class: 'field' }, h('span', {}, 'Beschreibung'),
        h('textarea', {
          rows: 6, placeholder: 'Details, Links, Notizen…', value: task.description,
          onchange: (e) => save({ description: e.target.value }),
        })),
      h('div', { class: 'panel-section' }, subHead, subWrap, subInput),
      h('div', { class: 'panel-section' },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' } },
          h('h3', { style: { margin: 0 } }, 'Dateien'), uploadBtn, fileInput),
        attWrap, h('div', { class: 'hint' }, 'Dateien bis 25 MB. Du kannst sie auch einfach hierher ziehen.')),
      h('div', { class: 'hint', style: { marginTop: '16px' } }, `Erstellt ${creator ? `von ${creator.name} ` : ''}am ${formatDateTime(task.createdAt)}`),
      h('div', { class: 'comments' },
        h('h3', {}, 'Kommentare'),
        commentList,
        h('div', { class: 'comment-form' }, commentInput, h('button', { class: 'btn primary small', onclick: sendComment }, 'Kommentieren'))),
    ));
}

function commentEl(c, task) {
  const u = c.userId ? userById(c.userId) || { id: c.userId, name: c.userName || 'Ehemaliger Benutzer' } : null;
  const canDelete = c.userId === state.me.id || state.me.role === 'admin';
  const el = h('div', { class: 'comment' }, avatar(u),
    h('div', { class: 'bubble' },
      h('div', { class: 'meta' }, h('b', { style: { color: 'var(--text)' } }, u?.name || 'Gelöschter Benutzer'), formatDateTime(c.createdAt),
        canDelete && h('button', {
          class: 'icon-btn', title: 'Kommentar löschen', style: { width: '20px', height: '20px', fontSize: '12px' },
          onclick: async () => {
            if (!confirm('Kommentar löschen?')) return;
            try {
              await api('DELETE', `/api/comments/${c.id}`);
              el.remove();
              const { task: updated } = await api('GET', `/api/tasks/${task.id}`);
              applyTaskUpdate(updated);
            } catch (e) { showError(e); }
          },
        }, '✕')),
      h('div', { class: 'text' }, c.body)));
  return el;
}

// ---------------------------------------------------------------- dialogs
function openDialog(title, content, submitLabel, onSubmit, extraActions = []) {
  const err = h('p', { class: 'error-text', hidden: true });
  const submitBtn = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
  const dlg = h('dialog', {});
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      submitBtn.disabled = true;
      try {
        const keep = await onSubmit(new FormData(form), form);
        if (keep !== true) dlg.close();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { submitBtn.disabled = false; }
    },
  },
  h('h2', {}, title), err, content,
  h('div', { class: 'dialog-actions' }, extraActions, h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Abbrechen'), submitBtn));
  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function colorPicker(selected) {
  return h('div', { class: 'colors' }, PROJECT_COLORS.map((c) => h('label', {},
    h('input', { type: 'radio', name: 'color', value: c, checked: c === selected }),
    h('span', { style: { background: c } }))));
}

function memberPicker(selectedIds, ownerId, disabled) {
  return h('div', { class: 'member-list' }, state.users.map((u) => h('label', {},
    h('input', { type: 'checkbox', name: 'member', value: String(u.id), checked: selectedIds.has(u.id), disabled: disabled || u.id === ownerId }),
    avatar(u), h('span', { style: { flex: 1 } }, u.name),
    u.id === ownerId ? h('span', { class: 'tag' }, 'Ersteller') : u.role === 'admin' ? h('span', { class: 'tag admin' }, 'Admin') : null)));
}

function projectDialog(existing) {
  const isEdit = existing && existing.project;
  const p = isEdit ? existing.project : { name: '', description: '', color: PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)], ownerId: state.me.id };
  const canManage = !isEdit || state.me.role === 'admin' || p.ownerId === state.me.id;
  const selected = new Set(isEdit ? existing.members.map((m) => m.id) : [state.me.id]);

  const extra = [];
  if (isEdit && canManage) {
    extra.push(h('button', {
      class: 'btn danger', type: 'button',
      onclick: async () => {
        if (!confirm(`Projekt „${p.name}“ mit allen Aufgaben endgültig löschen?`)) return;
        try {
          await api('DELETE', `/api/projects/${p.id}`);
          document.querySelector('dialog')?.close();
          await refreshProjects();
          go('/projects');
          toast('Projekt gelöscht');
        } catch (e) { showError(e); }
      },
    }, 'Projekt löschen'));
  }

  openDialog(isEdit ? 'Projekteinstellungen' : 'Neues Projekt', [
    field('Projektname', h('input', { type: 'text', name: 'name', required: true, value: p.name, autofocus: true, maxlength: 120 })),
    field('Beschreibung', h('textarea', { name: 'description', rows: 3, value: p.description })),
    h('div', { class: 'field' }, h('span', { style: { display: 'block', fontWeight: 600, fontSize: '13px', marginBottom: '6px' } }, 'Farbe'), colorPicker(p.color)),
    h('div', { class: 'field', style: { marginTop: '14px' } },
      h('span', { style: { display: 'block', fontWeight: 600, fontSize: '13px', marginBottom: '6px' } }, 'Mitglieder'),
      memberPicker(selected, p.ownerId, !canManage),
      h('div', { class: 'hint' }, canManage
        ? 'Nur Mitglieder (und Administratoren) sehen dieses Projekt.'
        : 'Nur der Ersteller oder ein Admin kann Mitglieder ändern.')),
  ], isEdit ? 'Speichern' : 'Projekt erstellen', async (fd) => {
    const body = { name: fd.get('name'), description: fd.get('description'), color: fd.get('color') };
    const memberIds = fd.getAll('member').map(Number);
    if (isEdit) {
      await api('PATCH', `/api/projects/${p.id}`, body);
      if (canManage) await api('PUT', `/api/projects/${p.id}/members`, { userIds: memberIds });
      await reloadCurrent();
      toast('Projekt gespeichert');
    } else {
      const { id } = await api('POST', '/api/projects', { ...body, memberIds });
      await refreshProjects();
      go(`/project/${id}`);
      toast('Projekt erstellt');
    }
  }, extra);
}

function newTaskDialog(data, preset = {}) {
  openDialog('Neue Aufgabe', [
    field('Titel', h('input', { type: 'text', name: 'title', required: true, autofocus: true, maxlength: 300 })),
    field('Spalte', h('select', { name: 'sectionId' }, data.sections.map((s) => h('option', { value: String(s.id) }, s.name)))),
    field('Zuständig', h('select', { name: 'assigneeId' }, h('option', { value: '' }, '– Niemand –'),
      data.members.map((m) => h('option', { value: String(m.id) }, m.name)))),
    field('Fälligkeitsdatum', h('input', { type: 'date', name: 'dueDate', value: preset.dueDate || '' })),
    field('Aufwand (Std.)', h('input', { type: 'number', name: 'estimateHours', min: 0, step: 0.5 })),
    field('Priorität', h('select', { name: 'priority' }, Object.entries(PRIO_LABEL).map(([v, l]) => h('option', { value: v }, l)))),
    field('Beschreibung', h('textarea', { name: 'description', rows: 3 })),
  ], 'Aufgabe erstellen', async (fd) => {
    const body = Object.fromEntries(fd);
    body.sectionId = Number(body.sectionId);
    body.assigneeId = body.assigneeId ? Number(body.assigneeId) : null;
    body.dueDate = body.dueDate || null;
    body.estimateHours = body.estimateHours === '' ? null : Number(body.estimateHours);
    const { task } = await api('POST', `/api/projects/${data.project.id}/tasks`, body);
    state.project.tasks.push(task);
    render();
    refreshProjects().catch(() => {});
    toast('Aufgabe erstellt');
  });
}

// ---------------------------------------------------------------- team (admin)
function teamView() {
  const users = state.allUsers || [];
  return [
    topbar(h('h1', {}, 'Team verwalten'), h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: newUserDialog }, '+ Person hinzufügen')),
    h('div', { class: 'content' },
      h('p', { class: 'hint', style: { marginTop: 0, fontSize: '13px' } },
        'Jede Person bekommt ein eigenes Konto. Beim ersten Login muss das vorläufige Passwort geändert werden.'),
      h('table', { class: 'list-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', { class: 'hide-sm' }, 'E-Mail'), h('th', {}, 'Rolle'), h('th', {}, ''))),
        h('tbody', {}, users.map((u) => h('tr', {},
          h('td', {}, h('div', { class: 'assignee-cell' }, avatar(u), u.name, u.id === state.me.id ? h('span', { class: 'hint', style: { margin: 0 } }, '(du)') : null)),
          h('td', { class: 'hide-sm' }, u.email),
          h('td', {}, h('span', { class: `tag ${u.role === 'admin' ? 'admin' : ''}` }, u.role === 'admin' ? 'Admin' : 'Mitglied'), ' ',
            !u.active && h('span', { class: 'tag off' }, 'Deaktiviert')),
          h('td', { style: { textAlign: 'right' } },
            h('button', { class: 'btn small', onclick: () => editUserDialog(u) }, 'Bearbeiten'), ' ',
            h('button', { class: 'btn small', onclick: () => resetPasswordDialog(u) }, 'Passwort zurücksetzen'))))))),
  ];
}

function credentialsNotice(email, password) {
  const text = `Zugang zum Projektmanager\nAdresse: ${location.origin}\nE-Mail: ${email}\nVorläufiges Passwort: ${password}`;
  openDialog('Zugangsdaten', [
    h('p', {}, 'Teile diese Zugangsdaten mit der Person. Beim ersten Login wird sie aufgefordert, ein eigenes Passwort festzulegen.'),
    h('pre', { style: { background: 'var(--surface-2)', padding: '12px', borderRadius: '8px', whiteSpace: 'pre-wrap', userSelect: 'all' } }, text),
  ], 'In Zwischenablage kopieren', async () => {
    await navigator.clipboard.writeText(text);
    toast('Kopiert');
  });
}

function newUserDialog() {
  openDialog('Person hinzufügen', [
    field('Name', h('input', { type: 'text', name: 'name', required: true, autofocus: true })),
    field('E-Mail', h('input', { type: 'email', name: 'email', required: true })),
    field('Rolle', h('select', { name: 'role' }, h('option', { value: 'member' }, 'Mitglied'), h('option', { value: 'admin' }, 'Administrator')),
      'Administratoren sehen alle Projekte und können das Team verwalten.'),
    field('Vorläufiges Passwort', h('input', { type: 'text', name: 'password', required: true, minlength: 8, value: randomPassword() })),
  ], 'Hinzufügen', async (fd) => {
    const body = Object.fromEntries(fd);
    await api('POST', '/api/users', body);
    await Promise.all([refreshUsers(), loadRouteData()]);
    render();
    credentialsNotice(body.email, body.password);
  });
}

function editUserDialog(u) {
  const self = u.id === state.me.id;
  openDialog(`${u.name} bearbeiten`, [
    field('Name', h('input', { type: 'text', name: 'name', required: true, value: u.name })),
    field('E-Mail', h('input', { type: 'email', name: 'email', required: true, value: u.email })),
    field('Rolle', h('select', { name: 'role', disabled: self },
      h('option', { value: 'member', selected: u.role === 'member' }, 'Mitglied'),
      h('option', { value: 'admin', selected: u.role === 'admin' }, 'Administrator'))),
    field('Wochenkapazität (Std.)', h('input', { type: 'number', name: 'weeklyCapacity', min: 0, max: 168, step: 0.5, required: true, value: u.weeklyCapacity }),
      'Verfügbare Arbeitsstunden pro Woche, Grundlage für die Auslastung.'),
    h('label', { class: 'field', style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      h('input', { type: 'checkbox', name: 'active', checked: u.active, disabled: self, style: { width: 'auto' } }),
      'Konto aktiv (deaktivierte Personen können sich nicht mehr anmelden)'),
  ], 'Speichern', async (fd) => {
    const body = { name: fd.get('name'), email: fd.get('email'), weeklyCapacity: Number(fd.get('weeklyCapacity')) };
    if (!self) { body.role = fd.get('role'); body.active = fd.get('active') === 'on'; }
    await api('PATCH', `/api/users/${u.id}`, body);
    await Promise.all([refreshUsers(), loadRouteData()]);
    if (self) state.me = (await api('GET', '/api/me')).user;
    render();
    toast('Gespeichert');
  });
}

function resetPasswordDialog(u) {
  openDialog(`Passwort für ${u.name} zurücksetzen`, [
    field('Neues vorläufiges Passwort', h('input', { type: 'text', name: 'password', required: true, minlength: 8, value: randomPassword() }),
      'Die Person wird abgemeldet und muss beim nächsten Login ein eigenes Passwort festlegen.'),
  ], 'Zurücksetzen', async (fd) => {
    const password = fd.get('password');
    await api('PATCH', `/api/users/${u.id}`, { password });
    if (u.id !== state.me.id) credentialsNotice(u.email, password);
    else toast('Passwort geändert');
  });
}

// ---------------------------------------------------------------- settings
function settingsView() {
  const nameForm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const { user } = await api('PATCH', '/api/me', { name: new FormData(nameForm).get('name') });
        state.me = user;
        await refreshUsers();
        render();
        toast('Name gespeichert');
      } catch (ex) { showError(ex); }
    },
  },
  field('Name', h('input', { type: 'text', name: 'name', required: true, value: state.me.name })),
  field('E-Mail', h('input', { type: 'email', value: state.me.email, disabled: true }), 'Die E-Mail-Adresse kann ein Administrator ändern.'),
  h('button', { class: 'btn primary', type: 'submit' }, 'Speichern'));

  const pwForm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(pwForm);
      if (fd.get('newPassword') !== fd.get('repeat')) return toast('Die Passwörter stimmen nicht überein.', true);
      try {
        await api('POST', '/api/me/password', { currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword') });
        pwForm.reset();
        toast('Passwort geändert. Andere Geräte wurden abgemeldet.');
      } catch (ex) { showError(ex); }
    },
  },
  field('Aktuelles Passwort', h('input', { type: 'password', name: 'currentPassword', required: true, autocomplete: 'current-password' })),
  field('Neues Passwort', h('input', { type: 'password', name: 'newPassword', required: true, minlength: 8, autocomplete: 'new-password' }), 'Mindestens 8 Zeichen'),
  field('Neues Passwort wiederholen', h('input', { type: 'password', name: 'repeat', required: true, minlength: 8, autocomplete: 'new-password' })),
  h('button', { class: 'btn primary', type: 'submit' }, 'Passwort ändern'));

  return [
    topbar(h('h1', {}, 'Mein Konto')),
    h('div', { class: 'content' },
      h('div', { class: 'card-box' }, h('h2', {}, 'Profil'), nameForm),
      h('div', { class: 'card-box' }, h('h2', {}, 'Passwort ändern'), pwForm)),
  ];
}

// ---------------------------------------------------------------- date helpers
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}
const parseServerDate = (s) => new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
const fmtHours = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// ---------------------------------------------------------------- calendar
function calendarView(tasks, data) {
  const [y, m] = state.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const days = [];
  for (let d = mondayOf(first); d <= last || d.getDay() !== 1; d = addDays(d, 1)) days.push(d);
  const byDate = {};
  for (const t of tasks) if (t.dueDate) (byDate[t.dueDate] ??= []).push(t);
  const today = todayStr();
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1); state.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; render(); };
  const undated = tasks.filter((t) => !t.dueDate && !t.completed).length;

  const cell = (d) => {
    const key = ymd(d);
    const el = h('div', { class: `cal-day ${d.getMonth() !== m - 1 ? 'other' : ''} ${key === today ? 'today' : ''}` },
      h('div', { class: 'cal-num' }, h('span', {}, d.getDate()),
        data && h('button', { class: 'icon-btn cal-add', title: 'Aufgabe an diesem Tag anlegen', onclick: () => newTaskDialog(data, { dueDate: key }) }, '+')),
      (byDate[key] || []).map((t) => calChip(t, !data)));
    el.addEventListener('dragover', (e) => { if (dragTaskId != null) { e.preventDefault(); el.classList.add('drag-over'); } });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over'); });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const id = dragTaskId;
      dragTaskId = null;
      if (id == null) return;
      try { applyTaskUpdate((await api('PATCH', `/api/tasks/${id}`, { dueDate: key })).task); } catch (err) { showError(err); }
    });
    return el;
  };

  return h('div', { class: 'calendar' },
    h('div', { class: 'cal-head' },
      h('button', { class: 'btn small', title: 'Vorheriger Monat', onclick: () => shift(-1) }, '‹'),
      h('button', { class: 'btn small', onclick: () => { state.calMonth = todayStr().slice(0, 7); render(); } }, 'Heute'),
      h('button', { class: 'btn small', title: 'Nächster Monat', onclick: () => shift(1) }, '›'),
      h('b', { class: 'cal-title' }, first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })),
      h('span', { style: { flex: 1 } }),
      undated ? h('span', { class: 'hint', style: { margin: 0 } }, `${undated} offene Aufgabe${undated === 1 ? '' : 'n'} ohne Fälligkeitsdatum`) : null),
    h('div', { class: 'cal-scroll' }, h('div', { class: 'cal-grid' },
      ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => h('div', { class: 'cal-dow' }, d)), days.map(cell))),
    h('div', { class: 'hint' }, 'Tipp: Aufgaben lassen sich per Drag & Drop auf einen anderen Tag verschieben.'));
}

function calChip(t, showProject) {
  return h('div', {
    class: `cal-chip ${t.completed ? 'done' : ''}`, draggable: 'true',
    title: showProject ? `${t.title} (${t.projectName})` : t.title,
    style: { borderLeftColor: t.projectColor },
    onclick: () => openTask(t.id),
    ondragstart: (e) => { dragTaskId = t.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)); },
    ondragend: () => { dragTaskId = null; document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over')); },
  }, t.title);
}

function globalCalendarView() {
  const head = topbar(h('h1', {}, 'Kalender'), h('div', { class: 'spacer' }),
    h('label', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center', cursor: 'pointer' } },
      h('input', { type: 'checkbox', checked: state.calMine, onchange: (e) => { state.calMine = e.target.checked; render(); } }),
      'Nur meine Aufgaben'));
  if (!state.allTasks) return [head, h('div', { class: 'content loading' }, 'Lädt…')];
  const tasks = state.calMine ? state.allTasks.filter((t) => t.assigneeId === state.me.id) : state.allTasks;
  return [head, h('div', { class: 'content' }, calendarView(tasks, null))];
}

// ---------------------------------------------------------------- resources / workload
function resourcesView() {
  const head = topbar(h('h1', {}, 'Auslastung'));
  if (!state.allTasks) return [head, h('div', { class: 'content loading' }, 'Lädt…')];
  const open = state.allTasks.filter((t) => !t.completed);
  const thisMonday = mondayOf(new Date());
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const start = addDays(thisMonday, (state.resOffset + i) * 7);
    const end = addDays(start, 6);
    const s = ymd(start);
    const e = ymd(end);
    return {
      key: s, week: true, label: `KW ${isoWeek(start)}`, sub: `${start.getDate()}.${start.getMonth() + 1}.–${end.getDate()}.${end.getMonth() + 1}.`,
      current: s === ymd(thisMonday), test: (t) => !!t.dueDate && t.dueDate >= s && t.dueDate <= e,
    };
  });
  const overdueBefore = ymd(thisMonday);
  const cols = [
    { key: 'overdue', label: 'Überfällig', sub: 'vor dieser Woche', test: (t) => !!t.dueDate && t.dueDate < overdueBefore },
    ...weeks,
    { key: 'none', label: 'Ohne Datum', sub: '', test: (t) => !t.dueDate },
  ];
  const people = [...state.users, null];
  const tasksFor = (uid, col) => open.filter((t) => (t.assigneeId ?? null) === uid && col.test(t));
  const sumHours = (list) => list.reduce((s, t) => s + (t.estimateHours || 0), 0);

  const cellFor = (u, col) => {
    const uid = u ? u.id : null;
    const list = tasksFor(uid, col);
    if (!list.length) return h('td', { class: col.current ? 'cur' : '' }, h('span', { class: 'hint' }, '–'));
    const hours = sumHours(list);
    const cap = u?.weeklyCapacity || 0;
    const sel = state.resSel && state.resSel.userId === uid && state.resSel.col === col.key;
    let level = '';
    if (col.key === 'overdue') level = 'over';
    else if (col.week && u && hours) level = cap && hours / cap <= 0.8 ? 'ok' : cap && hours / cap <= 1 ? 'high' : 'over';
    return h('td', { class: col.current ? 'cur' : '' }, h('button', {
      class: `res-cell ${level} ${sel ? 'sel' : ''}`, title: 'Aufgaben anzeigen',
      onclick: () => { state.resSel = sel ? null : { userId: uid, col: col.key }; render(); },
    },
    h('span', {}, h('b', {}, list.length), ' Aufg.'),
    hours ? h('small', {}, col.week && u ? `${fmtHours(hours)} / ${fmtHours(cap)} h` : `${fmtHours(hours)} h`) : h('small', {}, 'kein Aufwand'),
    col.week && u && hours ? h('div', { class: 'res-bar' }, h('div', { style: { width: `${Math.min(100, cap ? (hours / cap) * 100 : 100)}%` } })) : null));
  };

  let detail = null;
  if (state.resSel) {
    const col = cols.find((c) => c.key === state.resSel.col);
    const u = state.resSel.userId ? userById(state.resSel.userId) : null;
    if (col) {
      const list = tasksFor(state.resSel.userId, col);
      detail = h('div', { style: { marginTop: '20px' } },
        h('h2', { style: { fontSize: '15px' } }, `${u ? u.name : 'Nicht zugewiesen'}: ${col.label} ${col.sub ? `(${col.sub})` : ''}`),
        taskTable(list, { showProject: true }));
    }
  }

  return [head, h('div', { class: 'content' },
    h('div', { class: 'cal-head' },
      h('button', { class: 'btn small', title: 'Frühere Wochen', onclick: () => { state.resOffset -= 1; state.resSel = null; render(); } }, '‹'),
      h('button', { class: 'btn small', onclick: () => { state.resOffset = 0; state.resSel = null; render(); } }, 'Aktuelle Woche'),
      h('button', { class: 'btn small', title: 'Spätere Wochen', onclick: () => { state.resOffset += 1; state.resSel = null; render(); } }, '›'),
      h('span', { style: { flex: 1 } }),
      h('span', { class: 'legend' }, h('i', { class: 'ok' }), 'bis 80 %', h('i', { class: 'high' }), 'bis 100 %', h('i', { class: 'over' }), 'überlastet')),
    h('div', { class: 'res-scroll' }, h('table', { class: 'list-table res-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Person'), h('th', {}, 'Offen gesamt'),
        cols.map((c) => h('th', { class: c.current ? 'cur' : '' }, c.label, h('div', { class: 'th-sub' }, c.sub))))),
      h('tbody', {}, people.map((u) => {
        const all = open.filter((t) => (t.assigneeId ?? null) === (u ? u.id : null));
        if (!u && !all.length) return null;
        const hrs = sumHours(all);
        return h('tr', {},
          h('td', {}, h('div', { class: 'assignee-cell' }, avatar(u), h('div', {}, u ? u.name : 'Nicht zugewiesen',
            u && h('div', { class: 'hint', style: { margin: 0 } }, `${fmtHours(u.weeklyCapacity)} h pro Woche`)))),
          h('td', {}, h('b', {}, all.length), hrs ? ` · ${fmtHours(hrs)} h` : ''),
          cols.map((c) => cellFor(u, c)));
      })))),
    h('p', { class: 'hint', style: { fontSize: '13px', maxWidth: '760px' } },
      'Die Auslastung vergleicht den geschätzten Aufwand der offenen Aufgaben einer Woche mit der Wochenkapazität der Person. ',
      'Den Aufwand trägst du in der jeweiligen Aufgabe ein, die Kapazität legt ein Admin unter „Team verwalten“ fest. ',
      state.me.role === 'admin' ? '' : 'Du siehst nur Aufgaben aus Projekten, in denen du Mitglied bist.'),
    detail)];
}

// ---------------------------------------------------------------- inbox
function inboxView() {
  const list = state.notifications;
  const head = topbar(h('h1', {}, 'Inbox'), h('div', { class: 'spacer' }),
    list?.some((n) => !n.read) && h('button', {
      class: 'btn',
      onclick: async () => {
        try { await api('POST', '/api/notifications/read', { all: true }); list.forEach((n) => { n.read = true; }); render(); refreshCounts(); } catch (e) { showError(e); }
      },
    }, '✓ Alle als gelesen markieren'));
  if (!list) return [head, h('div', { class: 'content loading' }, 'Lädt…')];
  const item = (n) => h('a', {
    class: `inbox-item ${n.read ? '' : 'unread'}`, href: '#',
    onclick: async (e) => {
      e.preventDefault();
      if (!n.read) { n.read = true; await api('POST', '/api/notifications/read', { id: n.id }).catch(() => {}); refreshCounts(); }
      go(n.taskId ? `/project/${n.projectId}/board/task/${n.taskId}` : `/project/${n.projectId}`);
    },
  },
  avatar(n.actorId ? { id: n.actorId, name: n.actorName || '?' } : null, 'lg'),
  h('div', { class: 'inbox-text' },
    h('div', {}, h('b', {}, n.actorName || 'Jemand'), ' ', n.text),
    h('div', { class: 'hint' }, formatDateTime(n.createdAt), n.projectName ? [' · ', h('span', { class: 'dot', style: { background: n.projectColor, display: 'inline-block' } }), ' ', n.projectName] : null)),
  !n.read && h('span', { class: 'unread-dot', title: 'Ungelesen' }));
  return [head, h('div', { class: 'content' },
    !list.length
      ? h('div', { class: 'empty' }, 'Keine Benachrichtigungen. Hier erscheint, wenn dir jemand eine Aufgabe zuweist, kommentiert oder dich zu einem Projekt hinzufügt.')
      : h('div', { class: 'inbox' }, list.map(item)))];
}

async function refreshCounts() {
  if (!state.me || state.me.mustChangePassword) return;
  try { state.counts = await api('GET', '/api/counts'); updateBadges(); } catch { /* ignore */ }
}
function updateBadges() {
  for (const k of ['inbox', 'chat']) {
    const el = document.getElementById(`badge-${k}`);
    if (el) { el.textContent = state.counts[k] || ''; el.hidden = !state.counts[k]; }
  }
  const total = state.counts.inbox + state.counts.chat;
  document.title = total ? `(${total}) Projektmanager` : 'Projektmanager';
}

// ---------------------------------------------------------------- live events
let events = null;
function connectEvents() {
  events?.close();
  events = new EventSource('/api/events');
  events.onopen = refreshCounts;
  events.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch (err) { console.error(err); } };
}
function disconnectEvents() { events?.close(); events = null; }

async function handleEvent(ev) {
  if (ev.type === 'notify') {
    refreshCounts();
    if (state.route.name === 'inbox') { await loadRouteData(); render(); }
  } else if (ev.type === 'chat') {
    const open = state.route.name === 'chat' && state.route.key === ev.channel && chatUI?.listEl?.isConnected;
    if (open) {
      appendChatMessage(ev.message);
      if (ev.message.senderId !== state.me.id) await api('POST', '/api/chat/read', { channel: ev.channel }).catch(() => {});
    } else if (state.route.name === 'chat') {
      state.chat.channels = (await api('GET', '/api/chat/channels')).channels;
      if (chatUI) fillChannels(chatUI.channelsEl);
    }
    refreshCounts();
  }
}

// ---------------------------------------------------------------- chat
let chatUI = null;

function channelIcon(c) {
  if (c.kind === 'dm') return avatar({ id: c.userId, name: c.name });
  if (c.kind === 'project') return h('span', { class: 'dot', style: { background: c.color } });
  return h('span', { class: 'chan-hash' }, '#');
}

function fillChannels(el) {
  const chans = state.chat.channels || [];
  const item = (c) => h('a', { class: `chan ${state.route.key === c.key ? 'active' : ''}`, href: `#/chat/${c.key}` },
    channelIcon(c), h('span', { class: 'label' }, c.name), c.unread ? h('span', { class: 'badge-count' }, c.unread) : null);
  const group = (label, kind) => {
    const list = chans.filter((c) => c.kind === kind);
    return list.length ? [h('div', { class: 'chan-group' }, label), list.map(item)] : null;
  };
  el.replaceChildren(h('div', {}, group('Team', 'general'), group('Projekte', 'project'), group('Direktnachrichten', 'dm')));
}

function appendChatMessage(m) {
  if (!chatUI?.listEl || chatUI.ids.has(m.id)) return;
  chatUI.ids.add(m.id);
  const list = chatUI.listEl;
  list.querySelector('.chat-empty')?.remove();
  const d = parseServerDate(m.createdAt);
  const day = ymd(d);
  if (day !== chatUI.lastDay) {
    chatUI.lastDay = day;
    list.append(h('div', { class: 'chat-day' }, day === todayStr() ? 'Heute' : d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })));
  }
  const sender = m.senderId ? userById(m.senderId) || { id: m.senderId, name: m.senderName || 'Ehemaliges Mitglied' } : null;
  list.append(h('div', { class: `chat-msg ${m.senderId === state.me.id ? 'mine' : ''}` }, avatar(sender, 'lg'),
    h('div', { class: 'bubble' },
      h('div', { class: 'meta' }, h('b', {}, sender?.name || 'Unbekannt'), d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })),
      h('div', { class: 'text' }, m.body))));
  list.scrollTop = list.scrollHeight;
}

function chatView() {
  const key = state.route.key;
  const current = (state.chat.channels || []).find((c) => c.key === key);
  const channelsEl = h('div', { class: 'chat-channels' });
  chatUI = { channelsEl, listEl: null, ids: new Set(), lastDay: null };
  fillChannels(channelsEl);

  let conv;
  if (!current) {
    conv = h('div', { class: 'chat-conv' }, h('div', { class: 'empty' }, 'Wähle links eine Unterhaltung aus.'));
  } else {
    const listEl = h('div', { class: 'chat-messages' });
    chatUI.listEl = listEl;
    const msgs = state.chat.messages || [];
    if (!msgs.length) listEl.append(h('div', { class: 'empty chat-empty' }, 'Noch keine Nachrichten. Schreib die erste!'));
    msgs.forEach(appendChatMessage);
    const input = h('textarea', { rows: 2, placeholder: `Nachricht an ${current.kind === 'dm' ? current.name : `#${current.name}`} (Enter zum Senden)` });
    const send = async () => {
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      try { appendChatMessage((await api('POST', '/api/chat/messages', { channel: key, body })).message); } catch (e) { input.value = body; showError(e); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    const sub = current.kind === 'dm' ? 'Direktnachricht' : current.kind === 'project' ? 'Projekt-Kanal, sichtbar für alle Projektmitglieder' : 'Sichtbar für das gesamte Team';
    conv = h('div', { class: 'chat-conv' },
      h('div', { class: 'chat-title' }, h('a', { class: 'btn small chat-back', href: '#/chat' }, '‹'), channelIcon(current),
        h('div', {}, h('b', {}, current.name), h('div', { class: 'hint', style: { margin: 0 } }, sub))),
      listEl,
      h('div', { class: 'chat-form' }, input, h('button', { class: 'btn primary', onclick: send }, 'Senden')));
    requestAnimationFrame(() => { listEl.scrollTop = listEl.scrollHeight; if (innerWidth > 800) input.focus(); });
  }
  return [topbar(h('h1', {}, 'Chat')), h('div', { class: `chat ${current ? 'has-open' : ''}` }, channelsEl, conv)];
}

// ---------------------------------------------------------------- custom fields dialog
const FIELD_TYPE_LABEL = { text: 'Text', number: 'Zahl', date: 'Datum', checkbox: 'Checkbox', select: 'Auswahlliste' };
const splitOptions = (s) => s.split(',').map((o) => o.trim()).filter(Boolean);

function fieldsDialog(data) {
  const listEl = h('div', { class: 'field-list' });
  const draw = (fields) => {
    data.fields = fields;
    listEl.replaceChildren(...(fields.length ? fields.map(row) : [h('p', { class: 'hint' }, 'Dieses Projekt hat noch keine eigenen Felder.')]));
  };
  const call = async (method, url, body) => { try { draw((await api(method, url, body)).fields); return true; } catch (e) { showError(e); draw(data.fields); return false; } };
  const row = (f) => h('div', { class: 'field-row' },
    h('input', { type: 'text', value: f.name, maxlength: 60, title: 'Feldname', onchange: (e) => call('PATCH', `/api/fields/${f.id}`, { name: e.target.value }) }),
    f.type === 'select'
      ? h('input', { type: 'text', value: f.options.join(', '), title: 'Optionen, durch Komma getrennt', onchange: (e) => call('PATCH', `/api/fields/${f.id}`, { options: splitOptions(e.target.value) }) })
      : h('span', { class: 'tag' }, FIELD_TYPE_LABEL[f.type]),
    h('button', {
      class: 'icon-btn', type: 'button', title: 'Feld löschen',
      onclick: () => { if (confirm(`Feld „${f.name}“ mit allen eingetragenen Werten löschen?`)) call('DELETE', `/api/fields/${f.id}`); },
    }, '🗑'));

  const nameIn = h('input', { type: 'text', placeholder: 'Feldname, z. B. Kunde', maxlength: 60 });
  const optIn = h('input', { type: 'text', placeholder: 'Optionen, durch Komma getrennt', hidden: true });
  const typeSel = h('select', { onchange: () => { optIn.hidden = typeSel.value !== 'select'; } },
    Object.entries(FIELD_TYPE_LABEL).map(([v, l]) => h('option', { value: v }, l)));
  const add = async () => {
    if (!nameIn.value.trim()) return nameIn.focus();
    const ok = await call('POST', `/api/projects/${data.project.id}/fields`, { name: nameIn.value, type: typeSel.value, options: splitOptions(optIn.value) });
    if (ok) { nameIn.value = ''; optIn.value = ''; nameIn.focus(); }
  };
  for (const el of [nameIn, optIn]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  draw(data.fields);
  const dlg = openDialog('Eigene Felder', [
    h('p', { class: 'hint', style: { fontSize: '13px', marginTop: 0 } }, 'Eigene Felder gelten nur für dieses Projekt und erscheinen optional in jeder Aufgabe sowie als Spalten in der Listen-Ansicht.'),
    listEl,
    h('div', { class: 'field-add' }, h('b', {}, 'Neues Feld'), h('div', { class: 'field-row' }, nameIn, typeSel), optIn,
      h('button', { class: 'btn', type: 'button', onclick: add }, '+ Feld hinzufügen')),
  ], 'Fertig', async () => {});
  dlg.addEventListener('close', () => reloadCurrent());
}

function fieldDisplay(f, v) {
  if (v == null || v === '') return h('span', { class: 'hint' }, '–');
  if (f.type === 'checkbox') return '✓';
  if (f.type === 'date') return new Date(`${v}T00:00:00`).toLocaleDateString('de-DE');
  if (f.type === 'number') return String(v).replace('.', ',');
  if (f.type === 'select') return h('span', { class: 'tag' }, v);
  return v;
}

async function uploadFile(taskId, file) {
  const res = await fetch(`/api/tasks/${taskId}/attachments?name=${encodeURIComponent(file.name)}`, {
    method: 'POST', body: file, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'projektmanager' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen.');
  return data;
}

// ---------------------------------------------------------------- keyboard & boot
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.openTaskId && !document.querySelector('dialog[open]')) closeTask();
});

(async function boot() {
  root.append(h('div', { class: 'loading' }, 'Lädt…'));
  try {
    const status = await api('GET', '/api/status');
    state.needsSetup = status.needsSetup;
    if (status.user) await afterLogin(status.user);
    else render();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'loading' }, 'Server nicht erreichbar: ', e.message));
  }
}());
