/* MBSP Fleet Command Center — laporan harian + dashboard (SPA, tiada pelayan) */
'use strict';

// ---------- Storan (IndexedDB) ----------
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open('mbsp-fleet', 1);
      rq.onupgradeneeded = () => {
        rq.result.createObjectStore('reports', { keyPath: 'date' });
        rq.result.createObjectStore('kv');
      };
      rq.onsuccess = () => { DB.db = rq.result; res(); };
      rq.onerror = () => rej(rq.error);
      rq.onblocked = () => rej(new Error('Storan browser sedang digunakan oleh tab lain. Tutup tab sistem yang lain dan muat semula.'));
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = DB.db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  },
  getReport: d => DB.tx('reports', 'readonly', s => s.get(d)),
  putReport: r => DB.tx('reports', 'readwrite', s => s.put(r)),
  delReport: d => DB.tx('reports', 'readwrite', s => s.delete(d)),
  allReports: () => DB.tx('reports', 'readonly', s => s.getAll()),
  get: k => DB.tx('kv', 'readonly', s => s.get(k)),
  set: (k, v) => DB.tx('kv', 'readwrite', s => s.put(v, k))
};

// ---------- Lapisan storan: tempatan (IndexedDB) atau Google Sheets (Apps Script) ----------
const LS = {
  get(k) { try { return localStorage.getItem('fleet.' + k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem('fleet.' + k) : localStorage.setItem('fleet.' + k, v); } catch (e) { /* storan disekat */ } }
};

// Token sesi hanya untuk tab ini — tutup tab = log keluar
const SS = {
  get(k) { try { return sessionStorage.getItem('fleet.' + k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem('fleet.' + k) : sessionStorage.setItem('fleet.' + k, v); } catch (e) { /* storan disekat */ } }
};
const NEED_SERVER = 'Akaun panel dan PIC depoh memerlukan pangkalan data pusat Google Sheets. Mod tempatan hanya menyokong akaun pentadbir.';

async function localHash(pw, salt) {
  let h = salt + '|' + pw;
  for (let i = 0; i < 300; i++) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(h + salt));
      h = btoa(String.fromCharCode(...new Uint8Array(buf)));
    } else { // tiada Web Crypto: cincangan ringkas (mod demo tempatan sahaja)
      let x = 2166136261; for (const c of h + salt) x = Math.imul(x ^ c.charCodeAt(0), 16777619); h = (x >>> 0).toString(36) + h.length;
    }
  }
  return h;
}

const LocalStore = {
  mode: 'local',
  label: 'Tempatan (browser ini sahaja)',
  async users() {
    if (!DB.db) await DB.open();
    let list = (await DB.get('users')) || [];
    if (!list.length) { // akaun admin lalai untuk mod tempatan
      const salt = uid();
      list = [{ username: 'admin', nama: 'Pentadbir Sistem', peranan: 'admin', skop: '', aktif: true, mustChange: true, salt, hash: await localHash('admin123', salt), dicipta: new Date().toISOString() }];
      await DB.set('users', list);
    }
    return list;
  },
  async login({ username, password }) {
    const un = String(username || '').trim().toLowerCase();
    const u = (await this.users()).find(x => x.username === un);
    if (!u || !u.aktif || await localHash(String(password || ''), u.salt) !== u.hash) throw new Error('Nama pengguna atau kata laluan salah.');
    const s = { username: u.username, name: u.nama, role: u.peranan, scope: u.skop, mustChange: u.mustChange };
    SS.set('localUser', JSON.stringify(s));
    u.lastLogin = new Date().toISOString(); await DB.set('users', await this.users().then(l => l.map(x => x.username === un ? u : x)));
    await this.audit(u.nama, 'Log masuk', 'tempatan');
    return { token: 'local', user: s };
  },
  async me() {
    const s = SS.get('localUser');
    if (!s) throw new Error('SESI_TAMAT: Sila log masuk.');
    if (!DB.db) await DB.open();
    return { user: JSON.parse(s) };
  },
  async logout() { SS.set('localUser', null); },
  async changePassword({ oldPassword, newPassword }) {
    const s = JSON.parse(SS.get('localUser'));
    const list = await this.users();
    const u = list.find(x => x.username === s.username);
    if (await localHash(oldPassword, u.salt) !== u.hash) throw new Error('Kata laluan semasa salah.');
    if (String(newPassword).length < 8) throw new Error('Kata laluan baru mesti sekurang-kurangnya 8 aksara.');
    if (newPassword === oldPassword || newPassword.toLowerCase() === u.username) throw new Error('Pilih kata laluan baru yang berbeza.');
    u.salt = uid(); u.hash = await localHash(newPassword, u.salt); u.mustChange = false;
    await DB.set('users', list);
    s.mustChange = false; SS.set('localUser', JSON.stringify(s));
    await this.audit(u.nama, 'Tukar kata laluan', '');
    return { user: s };
  },
  async listUsers() { return { users: (await this.users()).map(({ salt, hash, ...u }) => u) }; },
  async saveUser(x) {
    if (x.peranan !== 'admin') throw new Error(NEED_SERVER);
    const list = await this.users();
    const un = String(x.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(un)) throw new Error('Nama pengguna mesti 3-30 aksara: huruf kecil, nombor, titik, sengkang.');
    let u = list.find(y => y.username === un);
    if (x.isNew && u) throw new Error(`Nama pengguna "${un}" sudah wujud.`);
    if (!x.isNew && !u) throw new Error('Pengguna tidak dijumpai.');
    if (u && !x.aktif && list.filter(y => y.aktif && y.peranan === 'admin').length <= 1) throw new Error('Mesti ada sekurang-kurangnya seorang admin aktif.');
    if (!u) { u = { username: un, dicipta: new Date().toISOString() }; list.push(u); }
    Object.assign(u, { nama: String(x.nama || '').trim() || un, peranan: 'admin', skop: '', aktif: x.aktif !== false });
    let pw = null;
    if (x.isNew || x.resetPassword) { pw = uid() + uid().slice(0, 2); u.salt = uid(); u.hash = await localHash(pw, u.salt); u.mustChange = true; }
    await DB.set('users', list);
    await this.audit(userName(), x.isNew ? 'Cipta pengguna' : 'Kemaskini pengguna', un);
    return { tempPassword: pw, users: (await this.listUsers()).users };
  },
  panelData() { throw new Error(NEED_SERVER); },
  panelSave() { throw new Error(NEED_SERVER); },
  depoData() { throw new Error(NEED_SERVER); },
  async init() {
    if (!DB.db) await DB.open();
    return { settings: await DB.get('settings'), reports: await DB.allReports(), transfers: (await DB.get('transfers')) || [], email: '' };
  },
  getReport: d => DB.getReport(d),
  async saveReport(rep, baseRev, auditDetail) {
    const old = await DB.getReport(rep.date);
    if (old && (old.rev || 0) !== (baseRev || 0)) return { conflict: true, savedBy: old.savedBy, savedAt: old.savedAt };
    rep.rev = (baseRev || 0) + 1; rep.savedAt = new Date().toISOString();
    await DB.putReport(rep);
    await this.audit(rep.savedBy, 'Simpan laporan', auditDetail);
    return { rev: rep.rev, savedAt: rep.savedAt };
  },
  async deleteReport(date, user) { await DB.delReport(date); await this.audit(user, 'Padam laporan', date); },
  async saveSettings(s, user, detail) { await DB.set('settings', s); if (detail) await this.audit(user, 'Kemaskini tetapan', detail); },
  async audit(user, action, detail) {
    const log = (await DB.get('audit')) || [];
    log.push({ ts: new Date().toISOString(), user: user || '-', action, detail });
    await DB.set('audit', log);
  },
  async getAudit() { return (await DB.get('audit')) || []; },
  async addTransfer(dec) {
    const t = (await DB.get('transfers')) || []; t.push(dec); await DB.set('transfers', t);
    await this.audit(dec.user, dec.ok ? 'Lulus mobiliti silang' : 'Tolak mobiliti silang', `${dec.qty} unit standby ${dec.from} → ${dec.to} (laporan ${dec.date})`);
  },
  async restore(d) {
    for (const r of d.reports) await DB.putReport(r);
    if (d.settings) await DB.set('settings', d.settings);
    if (d.transfers) await DB.set('transfers', d.transfers);
    await this.audit(d.user, 'Pulih backup', `${d.reports.length} laporan`);
  }
};

// Google Sheets: sama ada halaman di-host oleh Apps Script (google.script.run) atau di luar (URL Web App)
function makeRemoteStore(rawCall, label) {
  const call = async (action, payload) => {
    try { return await rawCall(action, payload); } catch (e) {
      if (/^SESI_TAMAT/.test(e.message)) sessionExpired(e.message.replace(/^SESI_TAMAT:\s*/, ''));
      throw e;
    }
  };
  return {
    mode: 'sheets',
    label,
    login: (cred) => rawCall('login', cred),
    me: () => call('me', {}),
    logout: () => rawCall('logout', {}).catch(() => {}),
    changePassword: (p) => call('changePassword', p),
    listUsers: () => call('listUsers', {}),
    saveUser: (userData) => call('saveUser', { userData }),
    panelData: () => call('panelData', {}),
    panelSave: (p) => call('panelSave', p),
    depoData: () => call('depoData', {}),
    init: () => call('bootstrap', { days: 180 }),
    getReport: async d => (await call('getReport', { date: d })).report,
    saveReport: (rep, baseRev, auditDetail) => call('saveReport', { report: rep, baseRev, auditDetail }),
    deleteReport: (date, user) => call('deleteReport', { date, user }),
    saveSettings: (settings, user, detail) => call('saveSettings', { settings, user, detail }),
    audit: (user, action, detail) => call('audit', { user, action, detail }),
    getAudit: async () => (await call('getAudit', { limit: 1000 })).audit,
    addTransfer: dec => call('addTransfer', { dec }),
    restore: d => call('restore', d),
    askArc: payload => call('askArc', payload)
  };
}

function gasCall(action, payload) {
  return new Promise((res, rej) => google.script.run
    .withSuccessHandler(s => res(JSON.parse(s)))
    .withFailureHandler(e => rej(new Error(String(e && e.message || e).replace(/^Error:\s*/, ''))))
    .api(action, payload, SS.get('token')));
}

async function httpCall(action, payload) {
  // text/plain mengelakkan CORS preflight yang tidak disokong Apps Script
  const r = await fetch(LS.get('apiUrl'), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: SS.get('token'), action, payload }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error);
  return j.data;
}

function pickStore() {
  if (window.google && google.script && google.script.run) return makeRemoteStore(gasCall, 'Google Sheets (Apps Script)');
  if (LS.get('apiUrl')) return makeRemoteStore(httpCall, 'Google Sheets (API)');
  return LocalStore;
}
let Store = null;
let USER = null; // pengguna log masuk: { username, name, role, scope, mustChange }
let EMAIL = '';
let TRANSFERS = [];
let AI_ENABLED = false; // pelayan Apps Script ada ANTHROPIC_API_KEY

// ---------- Utiliti ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const fmt = iso => iso ? iso.split('-').reverse().map((x, i) => i < 2 ? String(+x) : x).join('/') : '';
const days = (a, b) => (a && b) ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : null;
const norm = s => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

function parseDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return new Date(v - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (typeof v === 'number') { // nombor siri Excel
    const d = new Date(Math.round((v - 25569) * 864e5));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

let S = null;               // tetapan
let REPORTS = [];           // semua laporan (disusun ikut tarikh)
let cur = null;             // laporan yang sedang diedit
let dirty = false;
const charts = {};
let map = null, mapLayer = null, tileLayer = null;

// ---------- Tema ----------
const isHud = () => document.body.classList.contains('hud');
// Warna status yang sama untuk carta, peta dan kad
const COL = { rosak: '#e5243b', standby: '#009edb', operasi: '#4c9f38', amber: '#f5a300', grey: '#94a3b8', dark: '#7a1323' };
function applyChartTheme() {
  const hud = isHud();
  Chart.defaults.color = hud ? '#94a3b8' : '#5f6b7a';
  Chart.defaults.borderColor = hud ? 'rgba(148,163,184,.14)' : '#e9eef3';
  Chart.defaults.font.family = hud ? "'Rajdhani', system-ui, sans-serif" : "'Roboto', system-ui, sans-serif";
  Chart.defaults.font.size = hud ? 13 : 12;
  const b = $('#btnTheme');
  if (b) b.textContent = hud ? '☀ Tema Cerah' : '☾ Tema Gelap';
}
function toggleTheme() {
  const hud = !isHud();
  document.body.classList.toggle('hud', hud);
  document.body.classList.toggle('un', !hud);
  LS.set('theme', hud ? 'hud' : 'un');
  applyChartTheme();
  showTab(location.hash.slice(1) || 'dashboard', !$('#view-dashboard').classList.contains('hidden') ? false : true);
}

// ---------- Peraturan perniagaan ----------
const depotNames = () => S.depots.map(d => d.name);
const isDepot = n => depotNames().includes(norm(n));
const isSiap = r => !!r.siap;
const tempoh = r => days(r.masuk, r.jangkaan);
const hariBengkel = (r, date) => days(r.masuk, r.siap || date);
const isDalaman = p => (S.panels.find(x => x.name === norm(p)) || {}).dalaman;
const JENIS_RINGKAS = ['COMPACT', 'RORO', 'TIPPER', 'OPEN TRUCK'];

function bucket(t) {
  if (t == null) return null;
  return t <= 3 ? 'le3' : t <= 7 ? 'm47' : 'ge8';
}

function summarize(rep) {
  const perb = rep.rows.filter(r => isDepot(r.depo));
  const aktif = perb.filter(r => !isSiap(r));
  const jenis = { COMPACT: 0, RORO: 0, TIPPER: 0, 'OPEN TRUCK': 0, 'LAIN-LAIN': 0 };
  aktif.forEach(r => { const j = JENIS_RINGKAS.includes(norm(r.jenis)) ? norm(r.jenis) : 'LAIN-LAIN'; jenis[j]++; });
  jenis.SIAP = perb.length - aktif.length;
  jenis.JUMLAH = perb.length;

  const compRosak = aktif.filter(r => norm(r.jenis) === 'COMPACT');
  const depot = S.depots.map(d => {
    const rosak = compRosak.filter(r => norm(r.depo) === d.name).length;
    const standby = +(rep.standby?.[d.name] ?? 0);
    return { ...d, rosak, standby, operasi: Math.max(0, d.jum - rosak - standby) };
  });

  const tem = { le3: 0, m47: 0, ge8: 0 };
  aktif.forEach(r => { const b = bucket(tempoh(r)); if (b) tem[b]++; });
  tem.siap = jenis.SIAP; tem.total = perb.length;

  const panel = {};
  compRosak.forEach(r => { const p = norm(r.panel) || '(TIADA)'; panel[p] = (panel[p] || 0) + 1; });

  const tot = depot.reduce((a, d) => ({ jum: a.jum + d.jum, rosak: a.rosak + d.rosak, standby: a.standby + d.standby, operasi: a.operasi + d.operasi }), { jum: 0, rosak: 0, standby: 0, operasi: 0 });
  return { jenis, depot, tem, panel, tot, compRosak };
}

function alertsFor(rep) {
  const sm = summarize(rep);
  const out = [];
  sm.depot.filter(d => d.standby === 0).forEach(d =>
    out.push({ lvl: 'red', text: `RED ALERT: Depoh ${d.name} mempunyai 0 unit standby (${d.rosak} kompaktor rosak).` }));
  sm.depot.filter(d => d.standby > 0 && d.rosak > d.standby).forEach(d =>
    out.push({ lvl: 'amber', text: `Depoh ${d.name}: ${d.rosak} kompaktor rosak melebihi ${d.standby} unit standby.` }));
  rep.rows.filter(r => !isSiap(r) && !isDalaman(r.panel) && hariBengkel(r, rep.date) > S.eskalasiHari)
    .sort((a, b) => hariBengkel(b, rep.date) - hariBengkel(a, rep.date))
    .forEach(r => out.push({ lvl: 'red', text: `ESKALASI: ${r.plat} (${r.jenis}, ${r.depo}) di ${r.panel} sudah ${hariBengkel(r, rep.date)} hari.` }));
  return out;
}

function transferSuggestions(rep) {
  const sm = summarize(rep);
  const need = sm.depot.map(d => ({ ...d, need: d.standby === 0 ? Math.max(1, d.rosak - d.standby) : Math.max(0, d.rosak - d.standby) })).filter(d => d.need > 0);
  const donors = sm.depot.map(d => ({ ...d, spare: d.standby - d.rosak - 1 })).filter(d => d.spare > 0); // simpan 1 unit rizab
  const dist = (a, b) => Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos(a.lat * Math.PI / 180)) * 111;
  const out = [];
  need.sort((a, b) => (a.standby - b.standby) || (b.need - a.need)).forEach(n => {
    donors.filter(d => d.spare > 0).sort((a, b) => dist(a, n) - dist(b, n)).forEach(d => {
      if (n.need <= 0) return;
      const q = Math.min(n.need, d.spare);
      d.spare -= q; n.need -= q;
      out.push({ from: d.name, to: n.name, qty: q, km: dist(d, n).toFixed(1), reason: n.standby === 0 ? '0 standby' : `${n.rosak} rosak > ${n.standby} standby` });
    });
  });
  return out;
}

// ---------- Audit ----------
const userName = () => (USER && USER.name) || '-';
function audit(action, detail) {
  return Store.audit(userName(), action, detail).catch(e => console.warn('audit gagal', e));
}

async function refreshAll() {
  if (dirty && !confirm('Perubahan belum disimpan akan hilang. Muat semula?')) return;
  dirty = false;
  if (USER && USER.role !== 'admin') { showTab(location.hash.slice(1)); return; }
  busy('Memuat semula data…');
  try {
    const boot = await Store.init();
    S = boot.settings || S;
    REPORTS = boot.reports.sort((a, b) => a.date.localeCompare(b.date));
    TRANSFERS = boot.transfers || [];
    fillDatalists();
  } catch (e) { alert('Gagal memuat semula: ' + e.message); }
  busy();
  showTab(location.hash.slice(1) || 'dashboard');
}

// ---------- Log masuk & peranan ----------
const ROLE_LABEL = { admin: 'Pentadbir', panel: 'Panel Bengkel', depo: 'PIC Depoh' };
const TABS = {
  admin: ['dashboard', 'harian', 'ringkasan', 'analisis', 'data', 'tetapan', 'pengguna'],
  panel: ['panel'],
  depo: ['depo']
};

async function init() {
  applyChartTheme();
  Store = pickStore();
  bindLogin();
  bindUI();
  if (SS.get('token')) {
    try { busy('Menyemak sesi…'); const r = await Store.me(); busy(); return startSession(r.user); } catch (e) { busy(); SS.set('token', null); }
  }
  showLogin();
}

async function showLogin(msg) {
  USER = null;
  document.body.classList.remove('role-admin', 'role-panel', 'role-depo');
  document.body.classList.add('logged-out');
  const err = $('#loginErr');
  err.textContent = msg || ''; err.style.display = msg ? 'block' : 'none';
  if (Store.mode === 'local') {
    let hint = 'Mod tempatan: data disimpan dalam browser ini sahaja.';
    try { const l = await Store.users(); if (l.length === 1 && l[0].mustChange) hint += ' Log masuk pertama: <b>admin</b> / <b>admin123</b>. Anda akan diminta menukar kata laluan.'; } catch (e) { /* abaikan */ }
    $('#loginNote').innerHTML = hint;
  }
  setTimeout(() => $('#loginUser').focus(), 50);
}

function sessionExpired(msg) {
  SS.set('token', null);
  dirty = false;
  busy();
  showLogin(msg || 'Sesi anda telah tamat. Sila log masuk semula.');
}

function bindLogin() {
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#loginBtn'), err = $('#loginErr');
    btn.disabled = true; btn.textContent = 'Menyemak…'; err.style.display = 'none';
    try {
      const r = await Store.login({ username: $('#loginUser').value, password: $('#loginPass').value });
      SS.set('token', r.token);
      $('#loginPass').value = '';
      await startSession(r.user);
    } catch (ex) {
      err.textContent = ex.message; err.style.display = 'block';
    } finally { btn.disabled = false; btn.textContent = 'Log Masuk'; }
  };
  document.querySelectorAll('[data-showpw]').forEach(b => b.onclick = () => {
    const i = document.getElementById(b.dataset.showpw);
    i.type = i.type === 'password' ? 'text' : 'password';
    b.textContent = i.type === 'password' ? 'Tunjuk' : 'Sembunyi';
  });
  $('#btnLogout').onclick = async () => {
    if (dirty && !confirm('Perubahan belum disimpan akan hilang. Log keluar juga?')) return;
    dirty = false;
    await Store.logout();
    SS.set('token', null);
    location.hash = '';
    location.reload();
  };
  $('#btnChangePw').onclick = () => openPwModal(false);
  $('#pwCancel').onclick = () => { if (!pwForced) closePwModal(); };
  $('#pwForm').onsubmit = async e => {
    e.preventDefault();
    const err = $('#pwErr'); err.style.display = 'none';
    const show = m => { err.textContent = m; err.style.display = 'block'; };
    if ($('#pwNew').value !== $('#pwNew2').value) return show('Pengesahan kata laluan baru tidak sepadan.');
    if ($('#pwNew').value.length < 8) return show('Kata laluan baru mesti sekurang-kurangnya 8 aksara.');
    try {
      const r = await Store.changePassword({ oldPassword: $('#pwOld').value, newPassword: $('#pwNew').value });
      USER = Object.assign(USER, r.user, { mustChange: false });
      closePwModal();
      alert('Kata laluan berjaya ditukar.');
    } catch (ex) { show(ex.message); }
  };
}

let pwForced = false, pwResolve = null;
function openPwModal(forced) {
  pwForced = forced;
  ['#pwOld', '#pwNew', '#pwNew2'].forEach(s => { $(s).value = ''; });
  $('#pwErr').style.display = 'none';
  $('#pwReason').textContent = forced
    ? 'Anda sedang menggunakan kata laluan sementara. Sila tetapkan kata laluan anda sendiri (sekurang-kurangnya 8 aksara) sebelum meneruskan.'
    : 'Kata laluan baru mesti sekurang-kurangnya 8 aksara.';
  $('#pwCancel').style.display = forced ? 'none' : '';
  $('#pwModal').classList.add('open');
  setTimeout(() => $('#pwOld').focus(), 50);
  return new Promise(res => { pwResolve = res; });
}
function closePwModal() { $('#pwModal').classList.remove('open'); pwResolve && pwResolve(); pwResolve = null; }

async function startSession(user) {
  USER = user;
  document.body.classList.remove('logged-out', 'role-admin', 'role-panel', 'role-depo');
  document.body.classList.add('role-' + user.role);
  $('#userName').textContent = user.name;
  $('#userRole').textContent = ROLE_LABEL[user.role] + (user.scope ? ' · ' + user.scope : '');
  document.querySelectorAll('.tab-btn').forEach(b => { b.style.display = TABS[user.role].includes(b.dataset.tab) ? '' : 'none'; });
  $('#connBadge').innerHTML = `<span class="${Store.mode === 'local' ? 'text-amber-300' : 'text-emerald-300'}">● ${esc(Store.label)}</span>`;
  if (user.mustChange) await openPwModal(true);
  if (user.role === 'admin') return startAdmin();
  const want = location.hash.slice(1);
  showTab(TABS[user.role].includes(want) ? want : TABS[user.role][0]);
}

// ---------- Mula (pentadbir) ----------
async function startAdmin() {
  busy('Memuatkan data…');
  let boot;
  try { boot = await Store.init(); } catch (e) {
    busy();
    $('#connBadge').innerHTML = `<span class="text-red-300">Gagal sambung: ${esc(e.message)}</span>`;
    if (Store.mode === 'local') throw e;
    // sambungan API gagal — beri peluang betulkan URL di Tetapan
    S = clone(window.SEED_SETTINGS); fillDatalists(); showTab('tetapan'); return;
  }
  EMAIL = boot.email || '';
  AI_ENABLED = !!boot.ai && typeof Store.askArc === 'function';
  S = boot.settings || clone(window.SEED_SETTINGS);
  REPORTS = boot.reports.sort((a, b) => a.date.localeCompare(b.date));
  TRANSFERS = boot.transfers || [];
  if (!boot.settings) await Store.saveSettings(S, 'Sistem', 'Tetapan awal');
  if (!REPORTS.length) {
    const seed = clone(window.SEED_REPORT);
    seed.rows.forEach(r => r.id = uid());
    const res = await Store.saveReport(seed, 0, 'Data awal: laporan 15/10/2026 dari PDF asal');
    Object.assign(seed, { rev: res.rev });
    REPORTS = [seed];
  }
  busy();
  fillDatalists();
  $('#rptUser').value = USER.name;
  $('#rptUser').readOnly = true;
  $('#rptDate').value = todayISO();
  showTab(location.hash.slice(1) || 'dashboard');
}

function busy(msg) {
  let el = $('#busy');
  if (!msg) { el && el.remove(); return; }
  if (!el) { document.body.insertAdjacentHTML('beforeend', '<div id="busy" class="no-print fixed inset-0 bg-slate-900/30 grid place-items-center z-[2000]"><div class="bg-white rounded shadow px-5 py-3 font-semibold"></div></div>'); el = $('#busy'); }
  el.firstChild.textContent = msg;
}

function upsertReport(rep) {
  REPORTS = REPORTS.filter(r => r.date !== rep.date).concat([rep]).sort((a, b) => a.date.localeCompare(b.date));
}
const latest = () => REPORTS[REPORTS.length - 1];

function fillDatalists() {
  $('#dlJenis').innerHTML = S.jenis.map(j => `<option value="${esc(j)}">`).join('');
  $('#dlDepo').innerHTML = [...depotNames(), ...S.jabatanLain].map(j => `<option value="${esc(j)}">`).join('');
  $('#dlPanel').innerHTML = S.panels.map(p => `<option value="${esc(p.name)}">`).join('');
}

function bindUI() {
  document.querySelectorAll('.tab-btn').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $('#rptDate').onchange = () => loadEditor();
  $('#btnRefresh').onclick = refreshAll;
  $('#btnNewUser').onclick = () => openUserModal(null);
  $('#btnPanelSave').onclick = panelSave;
  $('#panelNewForm').onsubmit = panelAddNew;
  $('#btnTheme').onclick = toggleTheme;
  $('#btnSave').onclick = saveReport;
  $('#btnTemplate').onclick = downloadTemplate;
  $('#importXlsx').onchange = e => { importExcel(e.target.files[0]); e.target.value = ''; };
  $('#sumDate').onchange = renderRingkasan;
  $('#btnPrint').onclick = () => window.print();
  $('#btnExportDay').onclick = () => exportDay(REPORTS.find(r => r.date === $('#sumDate').value));
  $('#btnExportAll').onclick = exportAll;
  $('#btnBackup').onclick = backupJson;
  $('#restoreJson').onchange = e => { restoreJson(e.target.files[0]); e.target.value = ''; };
  $('#btnSaveSettings').onclick = saveSettings;
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}

function showTab(t, noRender) {
  const allowed = USER ? TABS[USER.role] : [];
  if (!allowed.includes(t)) t = allowed[0];
  if (!t) return;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + t));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  history.replaceState(null, '', '#' + t);
  renderAlertBar();
  if (noRender) return;
  ({ dashboard: renderDashboard, harian: loadEditor, ringkasan: renderRingkasan, analisis: renderAnalisis, data: renderData, tetapan: renderSettings,
    pengguna: renderUsers, panel: renderPanel, depo: renderDepo })[t]();
}

function renderAlertBar() {
  const rep = latest();
  const al = rep ? alertsFor(rep) : [];
  const red = al.filter(a => a.lvl === 'red');
  if (!red.length) { $('#alertBar').innerHTML = ''; return; }
  $('#alertBar').innerHTML = `<div class="bg-red-600 text-white"><div class="max-w-[1500px] mx-auto px-4 py-2 text-sm flex gap-3 items-start">
    <span class="blink font-black bg-white text-red-700 rounded px-2">RED ALERT</span>
    <div class="space-y-0.5">${red.map(a => `<div>${esc(a.text)}</div>`).join('')}</div>
    <span class="ml-auto text-xs opacity-80 whitespace-nowrap">Laporan ${fmt(rep.date)}</span></div></div>`;
}

// ---------- Borang Laporan Harian ----------
async function loadEditor() {
  if (dirty && cur && !confirm('Perubahan belum disimpan akan hilang. Teruskan?')) { $('#rptDate').value = cur.date; return; }
  const date = $('#rptDate').value || todayISO();
  dirty = false;
  $('#rptMsgs').innerHTML = '';
  // sentiasa ambil versi terkini dari pelayan — staf lain mungkin baru menyimpan
  busy('Memuatkan laporan…');
  let existing;
  try { existing = await Store.getReport(date); } catch (e) { existing = REPORTS.find(r => r.date === date); }
  busy();
  if (existing) upsertReport(existing);
  const draft = loadDraft(date);
  const stale = draft && existing && (draft.baseRev || 0) !== (existing.rev || 0);
  if (draft && confirm(`Ada draf yang belum disimpan untuk ${fmt(date)} (${new Date(draft.ts).toLocaleString('ms-MY')}).` +
      (stale ? `\n\nAMARAN: laporan ini telah dikemaskini oleh ${existing.savedBy || 'pengguna lain'} selepas draf dibuat. Jika anda sambung draf dan simpan, versi mereka akan ditimpa.` : '') +
      '\n\nSambung draf tersebut?')) {
    cur = draft.report; dirty = true;
    if (existing) cur.rev = existing.rev; // pengguna sedar dan memilih untuk menimpa
    $('#rptStatus').innerHTML = `<span class="text-blue-700">Draf dipulihkan — belum disimpan.</span>`;
    renderEditor();
    return;
  }
  if (draft) saveDraft(null, date);
  if (existing) {
    cur = clone(existing);
    cur.rows.forEach(r => r.id = r.id || uid());
    $('#rptStatus').innerHTML = `<span class="text-emerald-700">Laporan ${fmt(date)} sudah wujud${existing.savedBy ? ' · disimpan oleh ' + esc(existing.savedBy) : ''}. Anda sedang mengemaskini.</span>`;
    renderEditor();
    return;
  }
  const prev = [...REPORTS].reverse().find(r => r.date < date);
  cur = null;
  $('#rptStatus').innerHTML = `<span class="text-amber-700">Tiada laporan untuk ${fmt(date)}.</span>`;
  $('#rptBody').innerHTML = `<div class="bg-white rounded-lg shadow p-6 text-center space-y-3">
    <div class="text-lg font-semibold">Mula laporan ${fmt(date)}</div>
    ${prev ? `<p class="text-sm text-slate-600">Kes yang belum siap dari laporan <b>${fmt(prev.date)}</b> (${prev.rows.filter(r => !isSiap(r)).length} kenderaan), senarai breakdown, lori sewa dan bilangan standby akan dibawa ke hadapan. Kes yang sudah SIAP tidak dibawa.</p>
    <button id="btnCarry" class="px-4 py-2 rounded bg-blue-600 text-white font-semibold">Bawa dari ${fmt(prev.date)}</button>` : ''}
    <button id="btnBlank" class="px-4 py-2 rounded border">Borang kosong</button></div>`;
  if (prev) $('#btnCarry').onclick = () => startReport(date, prev);
  $('#btnBlank').onclick = () => startReport(date, null);
}

function startReport(date, prev) {
  cur = prev ? {
    date,
    rows: clone(prev.rows.filter(r => !isSiap(r))).map(r => ({ ...r, id: r.id || uid() })), // id kekal merentas hari (dipadankan oleh portal panel)
    breakdown: clone(prev.breakdown || []),
    sewa: clone(prev.sewa || []),
    standby: clone(prev.standby || {}),
    carriedFrom: prev.date
  } : { date, rows: [], breakdown: [], sewa: [], standby: {} };
  dirty = true;
  $('#rptStatus').innerHTML = `<span class="text-blue-700">Laporan baru ${fmt(date)}${prev ? ' (dibawa dari ' + fmt(prev.date) + ')' : ''} — belum disimpan.</span>`;
  renderEditor();
}

// Draf disimpan dalam browser supaya kerja tidak hilang jika internet terputus / tab tertutup
let draftTimer = null;
function saveDraft(rep, date, now) {
  clearTimeout(draftTimer);
  if (!rep) { LS.set('draft:' + date, null); return; }
  const write = () => LS.set('draft:' + rep.date, JSON.stringify({ ts: Date.now(), baseRev: rep.rev || 0, report: rep }));
  now ? write() : (draftTimer = setTimeout(write, 800));
}
function loadDraft(date) {
  try { return JSON.parse(LS.get('draft:' + date)); } catch (e) { return null; }
}

function statusCell(r) {
  const t = tempoh(r), h = hariBengkel(r, cur.date);
  if (isSiap(r)) return `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">SIAP</span><div class="text-[10px] text-slate-500">${h ?? ''} hari</div>`;
  const lewat = r.jangkaan && cur.date > r.jangkaan ? days(r.jangkaan, cur.date) : 0;
  const cls = h > S.eskalasiHari ? 'bg-red-600 text-white' : h > S.kritikalHari ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';
  return `<span class="px-1.5 py-0.5 rounded ${cls} font-semibold whitespace-nowrap">${h ?? '?'} hari</span>`
    + (lewat ? `<div class="text-[10px] text-red-700 font-semibold">lewat ${lewat} hari</div>` : '')
    + (t != null && t < 0 ? `<div class="text-[10px] text-red-700">tarikh salah</div>` : '');
}

const inp = (sec, i, f, v, extra = '') => `<input class="cell" data-sec="${sec}" data-i="${i}" data-f="${f}" value="${esc(v)}" ${extra}>`;
const dateInp = (sec, i, f, v) => `<input type="date" class="cell" data-sec="${sec}" data-i="${i}" data-f="${f}" value="${esc(v)}">`;

function renderEditor() {
  const rows = cur.rows;
  const standbyRows = S.depots.map(d => `<tr><td class="px-2">${esc(d.name)}</td><td class="text-center">${d.jum}</td>
    <td><input type="number" min="0" class="cell w-20 text-center border-slate-300" data-sec="standby" data-f="${esc(d.name)}" value="${cur.standby[d.name] ?? ''}"></td></tr>`).join('');

  $('#rptBody').innerHTML = `
  <div class="bg-white rounded-lg shadow">
    <div class="flex flex-wrap items-center gap-2 p-3 border-b">
      <div class="font-semibold">A. Laporan Pembaikan Kenderaan Majlis <span class="text-slate-500 font-normal text-sm">(${rows.length} kenderaan · ${rows.filter(isSiap).length} siap)</span></div>
      <input id="filterRows" placeholder="Cari no plat / depoh / panel…" class="ml-auto border rounded px-2 py-1 text-sm w-60">
      <button id="btnSort" class="px-3 py-1 rounded border text-sm">Susun ikut format laporan</button>
      <button id="btnAddRow" class="px-3 py-1 rounded bg-slate-900 text-white text-sm">+ Tambah Kenderaan</button>
    </div>
    <div class="overflow-x-auto max-h-[65vh]">
    <table class="grid-table w-full min-w-[1250px]">
      <thead><tr>
        <th class="w-8">BIL</th><th class="w-24">NO PLAT</th><th class="w-28">JENIS KENDERAAN</th><th class="w-32">JABATAN / DEPO</th>
        <th>KETERANGAN KEROSAKAN</th><th class="w-32">TARIKH MASUK</th><th class="w-14">TEMPOH (HARI)</th><th class="w-32">TARIKH JANGKAAN SIAP</th>
        <th class="w-32">TARIKH SIAP SEBENAR</th><th class="w-32">PANEL</th><th class="w-24">STATUS</th><th class="w-8"></th></tr></thead>
      <tbody id="rowsBody">${rows.map((r, i) => `
        <tr data-row="${i}" class="${isSiap(r) ? 'bg-emerald-50' : ''}">
          <td class="text-center text-slate-500 pt-1.5">${i + 1}</td>
          <td>${inp('rows', i, 'plat', r.plat, 'style="text-transform:uppercase;font-weight:600"')}</td>
          <td>${inp('rows', i, 'jenis', r.jenis, 'list="dlJenis"')}</td>
          <td>${inp('rows', i, 'depo', r.depo, 'list="dlDepo"')}</td>
          <td><textarea class="cell" rows="2" data-sec="rows" data-i="${i}" data-f="kerosakan">${esc(r.kerosakan)}</textarea></td>
          <td>${dateInp('rows', i, 'masuk', r.masuk)}</td>
          <td class="text-center pt-1.5" data-auto="tempoh">${tempoh(r) ?? ''}</td>
          <td>${dateInp('rows', i, 'jangkaan', r.jangkaan)}</td>
          <td>${dateInp('rows', i, 'siap', r.siap)}</td>
          <td>${inp('rows', i, 'panel', r.panel, 'list="dlPanel"')}</td>
          <td class="pt-1" data-auto="status">${statusCell(r)}</td>
          <td><button class="text-red-500 hover:text-red-700 px-1" data-del="rows" data-i="${i}" title="Buang">✕</button></td>
        </tr>`).join('')}</tbody>
    </table></div>
  </div>

  <div class="grid lg:grid-cols-3 gap-3 mt-3">
    <div class="bg-white rounded-lg shadow">
      <div class="flex items-center p-3 border-b"><div class="font-semibold">B. Bilangan Standby Kompaktor</div></div>
      <table class="w-full text-sm"><thead class="bg-slate-100 text-xs"><tr><th class="text-left px-2 py-1">DEPOH</th><th>JUM. KEN.</th><th>STANDBY</th></tr></thead>
      <tbody>${standbyRows}</tbody></table>
    </div>
    <div class="bg-white rounded-lg shadow">
      <div class="flex items-center p-3 border-b"><div class="font-semibold">C. Senarai Kenderaan Breakdown</div>
        <button class="ml-auto px-2 py-0.5 rounded border text-xs" data-add="breakdown">+ Tambah</button></div>
      <table class="grid-table w-full"><thead><tr><th>NO PLAT</th><th>JENIS</th><th>JABATAN / DEPO</th><th>KETERANGAN KEROSAKAN</th><th></th></tr></thead>
      <tbody>${cur.breakdown.map((r, i) => `<tr>
        <td>${inp('breakdown', i, 'plat', r.plat, 'style="text-transform:uppercase"')}</td><td>${inp('breakdown', i, 'jenis', r.jenis, 'list="dlJenis"')}</td>
        <td>${inp('breakdown', i, 'depo', r.depo, 'list="dlDepo"')}</td><td>${inp('breakdown', i, 'kerosakan', r.kerosakan)}</td>
        <td><button class="text-red-500 px-1" data-del="breakdown" data-i="${i}">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-2">Tiada</td></tr>'}</tbody></table>
    </div>
    <div class="bg-white rounded-lg shadow">
      <div class="flex items-center p-3 border-b"><div class="font-semibold">D. Senarai Lori Sewa (Compactor)</div>
        <button class="ml-auto px-2 py-0.5 rounded border text-xs" data-add="sewa">+ Tambah</button></div>
      <table class="grid-table w-full"><thead><tr><th>NO PLAT</th><th>JABATAN / DEPO</th><th>TARIKH</th><th></th></tr></thead>
      <tbody>${cur.sewa.map((r, i) => `<tr>
        <td>${inp('sewa', i, 'plat', r.plat, 'style="text-transform:uppercase"')}</td><td>${inp('sewa', i, 'depo', r.depo, 'list="dlDepo"')}</td>
        <td>${dateInp('sewa', i, 'tarikh', r.tarikh)}</td><td><button class="text-red-500 px-1" data-del="sewa" data-i="${i}">✕</button></td></tr>`).join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-2">Tiada</td></tr>'}</tbody></table>
    </div>
  </div>`;

  const body = $('#rptBody');
  body.oninput = e => {
    const el = e.target, sec = el.dataset.sec;
    if (!sec) return;
    dirty = true;
    saveDraft(cur);
    if (sec === 'standby') { cur.standby[el.dataset.f] = el.value === '' ? '' : +el.value; return; }
    const r = cur[sec][+el.dataset.i];
    r[el.dataset.f] = el.value;
    if (sec === 'rows') {
      const tr = el.closest('tr');
      tr.querySelector('[data-auto=tempoh]').textContent = tempoh(r) ?? '';
      tr.querySelector('[data-auto=status]').innerHTML = statusCell(r);
      tr.classList.toggle('bg-emerald-50', isSiap(r));
    }
  };
  body.onclick = e => {
    const del = e.target.dataset.del, add = e.target.dataset.add;
    if (del) {
      const r = cur[del][+e.target.dataset.i];
      if (!confirm(`Buang ${r.plat || 'baris ini'}?\n(Jika kenderaan sudah siap, isi Tarikh Siap Sebenar — jangan buang.)`)) return;
      cur[del].splice(+e.target.dataset.i, 1); dirty = true; renderEditor();
    }
    if (add) { cur[add].push({}); dirty = true; renderEditor(); }
  };
  $('#btnAddRow').onclick = () => {
    cur.rows.push({ id: uid(), plat: '', jenis: 'COMPACT', depo: '', kerosakan: '', masuk: cur.date, jangkaan: '', siap: '', panel: '' });
    dirty = true; renderEditor();
    const last = document.querySelector('#rowsBody tr:last-child input');
    last.scrollIntoView({ block: 'center' }); last.focus();
  };
  $('#btnSort').onclick = () => { cur.rows = sortRows(cur.rows); dirty = true; renderEditor(); };
  $('#filterRows').oninput = e => {
    const q = norm(e.target.value);
    document.querySelectorAll('#rowsBody tr').forEach(tr => {
      const r = cur.rows[+tr.dataset.row];
      tr.style.display = !q || norm([r.plat, r.depo, r.panel, r.jenis, r.kerosakan].join(' ')).includes(q) ? '' : 'none';
    });
  };
}

function sortRows(rows) {
  const jo = j => { const i = ['COMPACT', 'RORO', 'TIPPER', 'OPEN TRUCK', 'BACKHOE', 'ROAD SWEEPER'].indexOf(norm(j)); return i < 0 ? 99 : i; };
  const dn = depotNames();
  const dOrd = d => { const i = dn.indexOf(norm(d)); return i < 0 ? 100 : i; };
  return [...rows].sort((a, b) =>
    (isDepot(a.depo) ? 0 : 1) - (isDepot(b.depo) ? 0 : 1) || jo(a.jenis) - jo(b.jenis) || dOrd(a.depo) - dOrd(b.depo) || norm(a.depo).localeCompare(norm(b.depo)) || (a.masuk || '').localeCompare(b.masuk || ''));
}

function validate(rep) {
  const err = [], warn = [];
  const seen = {};
  rep.rows.forEach((r, i) => {
    const n = `Baris ${i + 1}${r.plat ? ' (' + r.plat + ')' : ''}`;
    if (!r.plat) err.push(`${n}: No Plat wajib diisi.`);
    if (!r.masuk) err.push(`${n}: Tarikh Masuk wajib diisi.`);
    if (!r.depo) err.push(`${n}: Jabatan/Depo wajib diisi.`);
    if (r.jangkaan && r.masuk && r.jangkaan < r.masuk) err.push(`${n}: Tarikh Jangkaan Siap sebelum Tarikh Masuk.`);
    if (r.siap && r.masuk && r.siap < r.masuk) err.push(`${n}: Tarikh Siap sebelum Tarikh Masuk.`);
    if (r.siap && r.siap > rep.date) warn.push(`${n}: Tarikh Siap selepas tarikh laporan.`);
    if (r.masuk > rep.date) warn.push(`${n}: Tarikh Masuk selepas tarikh laporan.`);
    if (!r.panel) warn.push(`${n}: Panel belum diisi.`);
    if (!r.jangkaan) warn.push(`${n}: Tarikh Jangkaan Siap belum diisi.`);
    if (r.plat && !isSiap(r)) { if (seen[r.plat]) warn.push(`${r.plat} disenaraikan lebih dari sekali.`); seen[r.plat] = 1; }
  });
  S.depots.forEach(d => { if (rep.standby[d.name] === '' || rep.standby[d.name] == null) warn.push(`Standby depoh ${d.name} belum diisi (dikira 0).`); });
  return { err, warn };
}

async function saveReport() {
  if (!cur) return alert('Tiada laporan untuk disimpan. Pilih "Bawa dari…" atau "Borang kosong" dahulu.');
  const user = $('#rptUser').value.trim();
  if (!user) { alert('Sila isi Nama Pengisi untuk rekod audit.'); $('#rptUser').focus(); return; }
  // normalisasi
  cur.rows = cur.rows.filter(r => r.plat || r.kerosakan); // buang baris kosong
  cur.rows.forEach(r => ['plat', 'jenis', 'depo', 'panel'].forEach(f => r[f] = norm(r[f])));
  cur.breakdown = cur.breakdown.filter(r => r.plat).map(r => ({ ...r, plat: norm(r.plat), jenis: norm(r.jenis), depo: norm(r.depo) }));
  cur.sewa = cur.sewa.filter(r => r.plat).map(r => ({ ...r, plat: norm(r.plat), depo: norm(r.depo) }));
  const { err, warn } = validate(cur);
  const box = l => l.map(x => `<li>${esc(x)}</li>`).join('');
  if (err.length) {
    $('#rptMsgs').innerHTML = `<div class="bg-red-50 border border-red-300 text-red-800 rounded p-3 text-sm"><b>Tidak boleh simpan — betulkan dahulu:</b><ul class="list-disc ml-5">${box(err)}</ul></div>`;
    renderEditor(); return;
  }
  if (warn.length && !confirm(`Terdapat ${warn.length} amaran:\n\n• ${warn.slice(0, 12).join('\n• ')}${warn.length > 12 ? '\n…' : ''}\n\nSimpan juga?`)) return;

  // jejak perubahan untuk audit
  const before = REPORTS.find(r => r.date === cur.date) || REPORTS.slice().reverse().find(r => r.date < cur.date);
  const changes = diffReports(before, cur);
  LS.set('user', user);
  const toSave = clone(cur);
  toSave.savedBy = user;
  busy('Menyimpan…');
  let res;
  try {
    res = await Store.saveReport(toSave, cur.rev || 0, `${fmt(cur.date)}: ${cur.rows.length} kenderaan` + (changes.length ? ' · ' + changes.join('; ') : ''));
  } catch (e) {
    busy();
    saveDraft(cur, null, true);
    $('#rptMsgs').innerHTML = `<div class="bg-red-50 border border-red-300 text-red-800 rounded p-3 text-sm"><b>Gagal menyimpan:</b> ${esc(e.message)}<br>Data anda disimpan sebagai draf dalam browser ini. Cuba tekan Simpan semula apabila sambungan pulih.</div>`;
    return;
  }
  busy();
  if (res.conflict) {
    saveDraft(cur, null, true);
    $('#rptMsgs').innerHTML = `<div class="bg-amber-50 border border-amber-300 text-amber-900 rounded p-3 text-sm"><b>Laporan ${fmt(cur.date)} telah dikemaskini oleh ${esc(res.savedBy || 'pengguna lain')}</b>${res.savedAt ? ' pada ' + new Date(res.savedAt).toLocaleString('ms-MY') : ''} selepas anda membukanya.
      Perubahan anda tidak disimpan (masih ada dalam draf). Tekan <b>Muat semula</b> di atas untuk lihat versi terkini, kemudian masukkan semula perubahan anda.</div>`;
    return;
  }
  Object.assign(cur, { savedBy: user, savedAt: res.savedAt, rev: res.rev });
  upsertReport(clone(cur));
  saveDraft(null, cur.date);
  dirty = false;
  $('#rptMsgs').innerHTML = `<div class="bg-emerald-50 border border-emerald-300 text-emerald-800 rounded p-3 text-sm">Laporan ${fmt(cur.date)} disimpan.${changes.length ? '<ul class="list-disc ml-5 mt-1">' + box(changes) + '</ul>' : ''}${warn.length ? `<div class="mt-1 text-amber-700">${warn.length} amaran diabaikan.</div>` : ''}</div>`;
  $('#rptStatus').innerHTML = `<span class="text-emerald-700">Disimpan oleh ${esc(user)}.</span>`;
  renderAlertBar();
  renderEditor();
}

function diffReports(a, b) {
  if (!a) return ['laporan pertama'];
  const out = [];
  const key = r => r.plat + '|' + r.masuk;
  const am = new Map(a.rows.map(r => [key(r), r]));
  const bm = new Map(b.rows.map(r => [key(r), r]));
  b.rows.forEach(r => {
    const o = am.get(key(r));
    if (!o) out.push(`Kes baru ${r.plat} (${r.depo}, ${r.panel || '-'})`);
    else {
      if (!isSiap(o) && isSiap(r)) out.push(`${r.plat}: Dalam Pembaikan → SIAP (${fmt(r.siap)})`);
      if (o.jangkaan !== r.jangkaan) out.push(`${r.plat}: jangkaan siap ${fmt(o.jangkaan) || '-'} → ${fmt(r.jangkaan) || '-'}`);
      if (o.panel !== r.panel) out.push(`${r.plat}: panel ${o.panel || '-'} → ${r.panel || '-'}`);
    }
  });
  if (a.date === b.date) a.rows.forEach(r => { if (!bm.has(key(r))) out.push(`${r.plat} dibuang dari senarai`); });
  S.depots.forEach(d => { const x = +(a.standby?.[d.name] ?? 0), y = +(b.standby?.[d.name] ?? 0); if (x !== y) out.push(`Standby ${d.name}: ${x} → ${y}`); });
  return out;
}

// ---------- Ringkasan & Cetak (format PDF asal) ----------
function renderRingkasan() {
  const sel = $('#sumDate');
  const keep = sel.value;
  sel.innerHTML = [...REPORTS].reverse().map(r => `<option value="${r.date}">${fmt(r.date)}</option>`).join('');
  if (keep && REPORTS.some(r => r.date === keep)) sel.value = keep;
  const rep = REPORTS.find(r => r.date === sel.value);
  if (!rep) { $('#printArea').innerHTML = '<p class="text-slate-500">Tiada laporan tersimpan.</p>'; return; }
  const sm = summarize(rep);
  const rows = sortRows(rep.rows);
  const maxBS = Math.max(rep.breakdown.length, rep.sewa.length, 7);
  $('#printArea').innerHTML = `
  <div class="text-center font-bold text-base">LAPORAN PEMBAIKAN KENDERAAN MAJLIS</div>
  <div class="text-right font-bold text-sm mb-2">TARIKH KEMASKINI : ${fmt(rep.date)}</div>
  <table class="rpt"><thead><tr><th>BIL</th><th>NO PLAT</th><th>JENIS KENDERAAN</th><th>JABATAN / DEPO</th><th>KETERANGAN KEROSAKAN</th><th>TARIKH MASUK PERMOHONAN</th><th>TEMPOH PEMBAIKAN</th><th>TARIKH JANGKAAN SIAP</th><th>TARIKH SIAP SEBENAR</th><th>PANEL</th><th></th></tr></thead>
  <tbody>${rows.map((r, i) => `<tr><td class="text-center">${i + 1}</td><td class="whitespace-nowrap">${esc(r.plat)}</td><td>${esc(r.jenis)}</td><td>${esc(r.depo)}</td><td>${esc(r.kerosakan)}</td>
    <td class="text-center">${fmt(r.masuk)}</td><td class="text-center">${tempoh(r) ?? ''}</td><td class="text-center">${fmt(r.jangkaan)}</td><td class="text-center">${fmt(r.siap)}</td><td>${esc(r.panel)}</td><td class="text-center font-bold">${isSiap(r) ? 'SIAP' : ''}</td></tr>`).join('')}</tbody></table>

  <div class="grid grid-cols-2 gap-4 mt-4" style="break-inside:avoid">
    <table class="rpt"><thead><tr><th colspan="5">SENARAI KENDERAAN BREAKDOWN</th></tr><tr><th>BIL</th><th>NO PLAT</th><th>JENIS KENDERAAN</th><th>JABATAN / DEPO</th><th>KETERANGAN KEROSAKAN</th></tr></thead>
      <tbody>${Array.from({ length: maxBS }, (_, i) => { const r = rep.breakdown[i] || {}; return `<tr><td class="text-center">${i + 1}</td><td>${esc(r.plat)}</td><td>${esc(r.jenis)}</td><td>${esc(r.depo)}</td><td>${esc(r.kerosakan)}</td></tr>`; }).join('')}</tbody></table>
    <table class="rpt"><thead><tr><th colspan="4">SENARAI LORI SEWA (COMPACTOR)</th></tr><tr><th>BIL</th><th>NO PLAT</th><th>JABATAN / DEPO</th><th>TARIKH</th></tr></thead>
      <tbody>${Array.from({ length: maxBS }, (_, i) => { const r = rep.sewa[i] || {}; return `<tr><td class="text-center">${i + 1}</td><td>${esc(r.plat)}</td><td>${esc(r.depo)}</td><td>${fmt(r.tarikh)}</td></tr>`; }).join('')}</tbody></table>
  </div>

  <div class="grid grid-cols-2 gap-4 mt-4" style="break-inside:avoid">
    <div class="space-y-4">
      <table class="rpt"><thead><tr><th colspan="2">BILANGAN KENDERAAN JABATAN PERBANDARAN DALAM PEMBAIKAN</th></tr><tr><th>JENIS KENDERAAN</th><th>JUMLAH</th></tr></thead>
        <tbody>${['COMPACT', 'RORO', 'TIPPER', 'OPEN TRUCK', 'LAIN-LAIN'].map(j => `<tr><td>${j}</td><td class="text-center">${sm.jenis[j]}</td></tr>`).join('')}
        <tr><td>KENDERAAN SIAP</td><td class="text-center">${sm.jenis.SIAP}</td></tr><tr><th class="text-left">JUMLAH KENDERAAN</th><th>${sm.jenis.JUMLAH}</th></tr></tbody></table>
      <table class="rpt"><thead><tr><th colspan="2">BILANGAN KENDERAAN JABATAN PERBANDARAN MENGIKUT TEMPOH PEMBAIKAN</th></tr></thead>
        <tbody><tr><td>&lt; 3 hari</td><td class="text-center">${sm.tem.le3}</td></tr><tr><td>4 - 7 hari</td><td class="text-center">${sm.tem.m47}</td></tr><tr><td>&gt; 8 hari</td><td class="text-center">${sm.tem.ge8}</td></tr>
        <tr><td>SIAP</td><td class="text-center">${sm.tem.siap}</td></tr><tr><th class="text-left">JUMLAH</th><th>${sm.tem.total}</th></tr></tbody></table>
    </div>
    <div class="space-y-4">
      <table class="rpt"><thead><tr><th colspan="5">BILANGAN KOMPAKTOR ROSAK MENGIKUT DEPOH</th></tr><tr><th>BIL</th><th>DEPOH</th><th>ROSAK</th><th>JUM. KEN.</th><th>KEN. STANDBY</th></tr></thead>
        <tbody>${sm.depot.map((d, i) => `<tr class="${d.standby === 0 ? 'bg-red-200' : ''}"><td class="text-center">${i + 1}</td><td>${d.name}</td><td class="text-center">${d.rosak}</td><td class="text-center">${d.jum}</td><td class="text-center">${d.standby}</td></tr>`).join('')}
        <tr><th colspan="2">JUMLAH</th><th>${sm.tot.rosak}</th><th>${sm.tot.jum}</th><th>${sm.tot.standby}</th></tr></tbody></table>
      <table class="rpt"><thead><tr><th colspan="2">BILANGAN KOMPAKTOR ROSAK MENGIKUT PANEL</th></tr><tr><th>PANEL</th><th>JUMLAH</th></tr></thead>
        <tbody>${Object.entries(sm.panel).sort((a, b) => b[1] - a[1]).map(([p, n]) => `<tr><td>${esc(p)}</td><td class="text-center">${n}</td></tr>`).join('')}
        <tr><th class="text-left">JUMLAH</th><th>${sm.compRosak.length}</th></tr></tbody></table>
    </div>
  </div>
  <div class="text-[10px] text-slate-500 mt-3">Disimpan oleh: ${esc(rep.savedBy || '-')} · ${rep.savedAt ? new Date(rep.savedAt).toLocaleString('ms-MY') : ''}</div>`;
}

// ---------- Dashboard ----------
function renderDashboard() {
  const rep = latest();
  if (!rep) return;
  const sm = summarize(rep);
  const allActive = rep.rows.filter(r => !isSiap(r));
  const kritikal = allActive.filter(r => hariBengkel(r, rep.date) > S.kritikalHari).length;
  $('#dashDate').textContent = `Data laporan terkini: ${fmt(rep.date)} · ${REPORTS.length} laporan tersimpan`;
  const card = (label, val, sub, cls) => `<div class="bg-white rounded-lg shadow p-3 border-l-4 ${cls}"><div class="text-xs text-slate-500">${label}</div><div class="text-3xl font-black">${val}</div><div class="text-xs text-slate-500">${sub}</div></div>`;
  $('#kpiCards').innerHTML =
    card('Kompaktor Beroperasi', sm.tot.operasi, `daripada ${sm.tot.jum} unit`, 'border-emerald-500') +
    card('Kompaktor Standby', sm.tot.standby, `${sm.depot.filter(d => d.standby === 0).length} depoh tiada standby`, 'border-blue-500') +
    card('Kompaktor Rosak', sm.tot.rosak, `${(sm.tot.rosak / sm.tot.jum * 100).toFixed(0)}% daripada armada kompaktor`, 'border-red-500') +
    card('Jumlah Kompaktor', sm.tot.jum, `${sm.tot.jum - sm.tot.standby} aktif + ${sm.tot.standby} standby`, 'border-slate-500') +
    card('Semua Kenderaan Dlm Pembaikan', allActive.length, `daripada ${S.fleetTotal} unit armada MBSP`, 'border-amber-500') +
    card(`Kes Kritikal (> ${S.kritikalHari} hari)`, kritikal, `${allActive.filter(r => hariBengkel(r, rep.date) > S.eskalasiHari).length} melebihi ${S.eskalasiHari} hari`, 'border-red-700');

  // peta
  if (!map) {
    map = L.map('map').setView([5.38, 100.45], 10);
    mapLayer = L.layerGroup().addTo(map);
  }
  const tiles = isHud() ? 'Canvas/World_Dark_Gray_Base' : 'Canvas/World_Light_Gray_Base';
  if (!tileLayer || tileLayer._fleetTiles !== tiles) {
    tileLayer && map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${tiles}/MapServer/tile/{z}/{y}/{x}`, { attribution: 'Tiles &copy; Esri', maxZoom: 16 }).addTo(map);
    tileLayer._fleetTiles = tiles;
  }
  mapLayer.clearLayers();
  sm.depot.forEach(d => {
    const color = d.standby === 0 ? COL.rosak : d.standby >= S.lebihanStandby ? COL.standby : COL.operasi;
    const m = L.circleMarker([d.lat, d.lng], { radius: 9 + d.jum / 3, color: '#fff', weight: 2, fillColor: color, fillOpacity: .9 }).addTo(mapLayer);
    m.bindTooltip(d.name, { permanent: true, direction: 'top', offset: [0, -10], className: 'font-semibold' });
    const list = sm.compRosak.filter(r => norm(r.depo) === d.name).map(r => `${esc(r.plat)} — ${esc(r.panel)} (${hariBengkel(r, rep.date)} hari)`).join('<br>');
    m.bindPopup(`<b>Depoh ${d.name}</b><br>Jumlah: ${d.jum} · Beroperasi: ${d.operasi}<br>Rosak: <b>${d.rosak}</b> · Standby: <b style="color:${color}">${d.standby}</b>${list ? '<hr style="margin:4px 0">' + list : ''}`);
  });
  setTimeout(() => map.invalidateSize(), 50);

  // carta depoh
  mkChart('chDepot', 'bar', {
    labels: sm.depot.map(d => d.name),
    datasets: [
      { label: 'Rosak', data: sm.depot.map(d => d.rosak), backgroundColor: COL.rosak },
      { label: 'Standby', data: sm.depot.map(d => d.standby), backgroundColor: COL.standby },
      { label: 'Beroperasi', data: sm.depot.map(d => d.operasi), backgroundColor: COL.operasi }
    ]
  }, { indexAxis: 'y', scales: { x: { stacked: true }, y: { stacked: true } } });

  const pl = {};
  allActive.forEach(r => { const p = norm(r.panel) || '(TIADA)'; pl[p] = pl[p] || { n: 0, krit: 0 }; pl[p].n++; if (hariBengkel(r, rep.date) > S.kritikalHari) pl[p].krit++; });
  const pk = Object.keys(pl).sort((a, b) => pl[b].n - pl[a].n);
  mkChart('chPanel', 'bar', {
    labels: pk,
    datasets: [
      { label: `≤ ${S.kritikalHari} hari`, data: pk.map(p => pl[p].n - pl[p].krit), backgroundColor: COL.standby },
      { label: `> ${S.kritikalHari} hari`, data: pk.map(p => pl[p].krit), backgroundColor: COL.rosak }
    ]
  }, { scales: { x: { stacked: true }, y: { stacked: true, ticks: { precision: 0 } } } });

  mkChart('chTempoh', 'doughnut', {
    labels: ['< 3 hari', '4 - 7 hari', '> 8 hari', 'Siap'],
    datasets: [{ data: [sm.tem.le3, sm.tem.m47, sm.tem.ge8, sm.tem.siap], backgroundColor: [COL.operasi, COL.amber, COL.rosak, COL.grey] }]
  }, {});

  const tr = REPORTS.map(r => ({ d: r.date, s: summarize(r), k: r.rows.filter(x => !isSiap(x) && hariBengkel(x, r.date) > S.kritikalHari).length }));
  mkChart('chTrend', 'line', {
    labels: tr.map(t => fmt(t.d)),
    datasets: [
      { label: 'Kompaktor rosak', data: tr.map(t => t.s.tot.rosak), borderColor: COL.rosak, backgroundColor: COL.rosak },
      { label: 'Standby', data: tr.map(t => t.s.tot.standby), borderColor: COL.standby, backgroundColor: COL.standby },
      { label: 'Kes kritikal', data: tr.map(t => t.k), borderColor: COL.dark, backgroundColor: COL.dark, borderDash: [4, 3] }
    ]
  }, { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } });

  renderTransfers(rep);
}

function mkChart(id, type, data, options) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), { type, data, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, ...options } });
}

async function renderTransfers(rep) {
  const sug = transferSuggestions(rep);
  const decisions = TRANSFERS;
  const keyOf = s => `${rep.date}|${s.from}|${s.to}`;
  if (!sug.length) { $('#transferList').innerHTML = '<div class="text-sm text-slate-500">Tiada depoh defisit. Tiada cadangan pemindahan.</div>'; return; }
  $('#transferList').innerHTML = `<table class="w-full text-sm"><thead class="bg-slate-100 text-xs"><tr><th class="text-left p-2">Dari (lebihan)</th><th class="text-left">Ke (defisit)</th><th>Unit</th><th>Jarak anggaran</th><th class="text-left">Sebab</th><th>Keputusan</th></tr></thead><tbody>
    ${sug.map(s => {
      const dec = decisions.find(d => d.key === keyOf(s));
      return `<tr class="border-b"><td class="p-2 font-semibold">${s.from}</td><td class="font-semibold text-red-700">${s.to}</td><td class="text-center">${s.qty}</td><td class="text-center">${s.km} km</td><td>${s.reason}</td>
      <td class="text-center">${dec ? `<span class="px-2 py-0.5 rounded text-xs font-semibold ${dec.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200'}">${dec.ok ? 'DILULUSKAN' : 'DITOLAK'} · ${esc(dec.user)}</span>`
        : `<button class="px-2 py-0.5 rounded bg-emerald-600 text-white text-xs" data-tr="1" data-k="${esc(keyOf(s))}" data-s='${esc(JSON.stringify(s))}'>Lulus</button>
           <button class="px-2 py-0.5 rounded border text-xs" data-tr="0" data-k="${esc(keyOf(s))}" data-s='${esc(JSON.stringify(s))}'>Tolak</button>`}</td></tr>`;
    }).join('')}</tbody></table>`;
  $('#transferList').onclick = async e => {
    const b = e.target.closest('[data-tr]'); if (!b) return;
    const user = prompt('Nama pegawai yang membuat keputusan:', LS.get('user') || '');
    if (!user) return;
    const s = JSON.parse(b.dataset.s), ok = b.dataset.tr === '1';
    const dec = { key: b.dataset.k, date: rep.date, ok, user, ts: new Date().toISOString(), ...s };
    busy('Menyimpan keputusan…');
    try { await Store.addTransfer(dec); TRANSFERS.push(dec); } catch (err) { alert('Gagal: ' + err.message); }
    busy();
    renderTransfers(rep);
  };
}

// ---------- Analisis & Penalti ----------
function renderAnalisis() {
  const rep = latest(); if (!rep) return;
  const lad = +S.kadarLAD || 0;
  const pen = rep.rows.filter(r => !isDalaman(r.panel) && r.panel && hariBengkel(r, rep.date) > S.kritikalHari)
    .map(r => ({ r, h: hariBengkel(r, rep.date), lewat: Math.max(0, days(r.jangkaan, r.siap || rep.date) || 0) }))
    .sort((a, b) => b.h - a.h);
  $('#penaltyTable').innerHTML = `<table class="w-full text-sm min-w-[800px]"><thead class="bg-slate-100 text-xs"><tr>
    <th class="p-2 text-left">No Plat</th><th class="text-left">Jenis</th><th class="text-left">Depo</th><th class="text-left">Panel</th><th>Tarikh Masuk</th><th>Hari di Bengkel</th><th>Melebihi SLA ${S.kritikalHari} hari</th><th>Lewat dari Jangkaan</th><th>Anggaran LAD</th><th>Status</th></tr></thead><tbody>
    ${pen.map(({ r, h, lewat }) => `<tr class="border-b ${h > S.eskalasiHari ? 'bg-red-50' : ''}"><td class="p-2 font-semibold">${esc(r.plat)}</td><td>${esc(r.jenis)}</td><td>${esc(r.depo)}</td><td>${esc(r.panel)}</td>
      <td class="text-center">${fmt(r.masuk)}</td><td class="text-center font-bold ${h > S.eskalasiHari ? 'text-red-700' : ''}">${h}</td><td class="text-center">${h - S.kritikalHari}</td><td class="text-center">${lewat || '-'}</td>
      <td class="text-center">${lad ? 'RM ' + ((h - S.kritikalHari) * lad).toLocaleString('ms-MY') : '<span class="text-slate-400 text-xs">tetapkan kadar</span>'}</td><td class="text-center">${isSiap(r) ? 'SIAP' : 'Dalam Pembaikan'}</td></tr>`).join('') || '<tr><td colspan="10" class="p-3 text-center text-slate-500">Tiada kes.</td></tr>'}</tbody></table>`;

  // prestasi 3 hari pertama: dari semua sejarah, kes unik (plat+masuk)
  const cases = allCases();
  const per = {};
  cases.filter(c => c.siap).forEach(c => {
    const p = c.panel || '(TIADA)'; per[p] = per[p] || { cepat: 0, lambat: 0, tot: 0, sum: 0 };
    const d = days(c.masuk, c.siap); per[p].tot++; per[p].sum += d; d <= 3 ? per[p].cepat++ : per[p].lambat++;
  });
  const open = {};
  cases.filter(c => !c.siap).forEach(c => { const p = c.panel || '(TIADA)'; open[p] = (open[p] || 0) + 1; });
  const pk = [...new Set([...Object.keys(per), ...Object.keys(open)])].sort();
  $('#perfTable').innerHTML = `<table class="w-full text-sm"><thead class="bg-slate-100 text-xs"><tr><th class="p-2 text-left">Panel</th><th>Siap ≤ 3 hari</th><th>Siap &gt; 3 hari</th><th>Purata hari (siap)</th><th>Masih dibaiki</th></tr></thead><tbody>
    ${pk.map(p => { const x = per[p] || { cepat: 0, lambat: 0, tot: 0, sum: 0 }; return `<tr class="border-b"><td class="p-2">${esc(p)}</td><td class="text-center">${x.cepat}</td><td class="text-center">${x.lambat}</td><td class="text-center">${x.tot ? (x.sum / x.tot).toFixed(1) : '-'}</td><td class="text-center">${open[p] || 0}</td></tr>`; }).join('')}</tbody></table>
    <div class="text-xs text-slate-500 mt-2">Berdasarkan ${cases.length} kes unik dari ${REPORTS.length} laporan. Ketepatan meningkat apabila lebih banyak laporan harian disimpan.</div>`;

  const kw = {};
  const KEYS = ['PTO', 'CYLINDER', 'HOSE', 'BRAKE', 'BELTING', 'CLUTCH', 'GEAR BOX', 'POWER STEERING', 'CHASIS', 'REPUT', 'BINLIFT', 'CONTROL VALVE', 'ENGINE', 'RADIATOR', 'TYRE', 'WIRING', 'HANDBRAKE', 'PACKER', 'EJECTOR', 'CARRIER'];
  cases.forEach(c => KEYS.forEach(k => { if (norm(c.kerosakan).includes(k)) { kw[k] = kw[k] || { n: 0, jenis: {} }; kw[k].n++; kw[k].jenis[c.jenis] = (kw[k].jenis[c.jenis] || 0) + 1; } }));
  const byPlat = {};
  cases.forEach(c => { byPlat[c.plat] = (byPlat[c.plat] || 0) + 1; });
  const rep2 = Object.entries(byPlat).filter(([, n]) => n > 1);
  $('#chronicTable').innerHTML = `<table class="w-full text-sm"><thead class="bg-slate-100 text-xs"><tr><th class="p-2 text-left">Komponen</th><th>Kes</th><th class="text-left">Jenis kenderaan terlibat</th></tr></thead><tbody>
    ${Object.entries(kw).sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([k, v]) => `<tr class="border-b"><td class="p-2 font-semibold">${k}</td><td class="text-center">${v.n}</td><td class="text-xs">${Object.entries(v.jenis).map(([j, n]) => `${esc(j)} (${n})`).join(', ')}</td></tr>`).join('')}</tbody></table>
    <div class="mt-3 text-sm"><b>Kenderaan berulang masuk bengkel:</b> ${rep2.length ? rep2.map(([p, n]) => `${esc(p)} (${n}x)`).join(', ') : '<span class="text-slate-500">belum ada (perlu lebih banyak data sejarah)</span>'}</div>`;
}

function allCases() {
  const m = new Map();
  REPORTS.forEach(rep => rep.rows.forEach(r => m.set(r.plat + '|' + r.masuk, { ...r, lastSeen: rep.date })));
  return [...m.values()];
}

// ---------- Sejarah & Data ----------
async function renderData() {
  $('#historyTable').innerHTML = `<table class="w-full text-sm"><thead class="bg-slate-100 text-xs"><tr><th class="p-2 text-left">Tarikh</th><th>Kenderaan</th><th>Siap</th><th>Kompaktor rosak</th><th>Standby</th><th>Depoh 0 standby</th><th class="text-left">Disimpan oleh</th><th></th></tr></thead><tbody>
    ${[...REPORTS].reverse().map(r => { const s = summarize(r); return `<tr class="border-b"><td class="p-2 font-semibold">${fmt(r.date)}</td><td class="text-center">${r.rows.length}</td><td class="text-center">${r.rows.filter(isSiap).length}</td><td class="text-center">${s.tot.rosak}</td><td class="text-center">${s.tot.standby}</td>
      <td class="text-center ${s.depot.some(d => d.standby === 0) ? 'text-red-700 font-semibold' : ''}">${s.depot.filter(d => d.standby === 0).map(d => d.name).join(', ') || '-'}</td><td>${esc(r.savedBy || '-')}</td>
      <td class="text-right whitespace-nowrap"><button class="px-2 py-0.5 rounded border text-xs" data-open="${r.date}">Buka</button> <button class="px-2 py-0.5 rounded border text-xs text-red-600" data-rm="${r.date}">Padam</button></td></tr>`; }).join('')}</tbody></table>`;
  $('#historyTable').onclick = async e => {
    if (e.target.dataset.open) { $('#rptDate').value = e.target.dataset.open; showTab('harian'); }
    if (e.target.dataset.rm) {
      const d = e.target.dataset.rm;
      if (!confirm(`Padam laporan ${fmt(d)}? Tindakan ini direkodkan dalam log audit.`)) return;
      busy('Memadam…');
      try { await Store.deleteReport(d, userName()); REPORTS = REPORTS.filter(r => r.date !== d); } catch (err) { alert('Gagal: ' + err.message); }
      busy(); renderData(); renderAlertBar();
    }
  };
  $('#auditTable').innerHTML = '<div class="text-sm text-slate-500 p-2">Memuatkan…</div>';
  let log = [];
  try { log = (await Store.getAudit()).slice().reverse(); } catch (e) { $('#auditTable').innerHTML = `<div class="text-red-700 text-sm p-2">Gagal memuatkan log: ${esc(e.message)}</div>`; return; }
  $('#auditTable').innerHTML = `<table class="w-full text-sm"><thead class="bg-slate-100 text-xs sticky top-0"><tr><th class="p-2 text-left">Masa</th><th class="text-left">Pengguna</th><th class="text-left">Emel</th><th class="text-left">Tindakan</th><th class="text-left">Butiran</th></tr></thead><tbody>
    ${log.map(a => `<tr class="border-b align-top"><td class="p-2 whitespace-nowrap">${new Date(a.ts).toLocaleString('ms-MY')}</td><td>${esc(a.user)}</td><td class="text-xs">${esc(a.email || '')}</td><td class="whitespace-nowrap">${esc(a.action)}</td><td class="text-xs">${esc(a.detail)}</td></tr>`).join('')}</tbody></table>`;
}

// ---------- Excel ----------
const HDR = ['BIL', 'NO PLAT', 'JENIS KENDERAAN', 'JABATAN / DEPO', 'KETERANGAN KEROSAKAN', 'TARIKH MASUK', 'TEMPOH PEMBAIKAN', 'TARIKH JANGKAAN SIAP', 'TARIKH SIAP SEBENAR', 'PANEL', 'STATUS'];
const rowOut = (r, i) => [i + 1, r.plat, r.jenis, r.depo, r.kerosakan, fmt(r.masuk), tempoh(r) ?? '', fmt(r.jangkaan), fmt(r.siap), r.panel, isSiap(r) ? 'SIAP' : 'DALAM PEMBAIKAN'];

function sheet(aoa, widths) { const ws = XLSX.utils.aoa_to_sheet(aoa); if (widths) ws['!cols'] = widths.map(w => ({ wch: w })); return ws; }

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([['LAPORAN PEMBAIKAN KENDERAAN MAJLIS'], ['TARIKH KEMASKINI :', ''], HDR.slice(0, 10), [1, 'PXX 1234', 'COMPACT', 'JAWI', 'contoh: PTO GEAR LEAKING', '15/10/2026', '', '20/10/2026', '', 'PUSKEB']], [5, 12, 16, 18, 50, 13, 10, 14, 14, 18]), 'PEMBAIKAN');
  XLSX.utils.book_append_sheet(wb, sheet([['BIL', 'NO PLAT', 'JENIS KENDERAAN', 'JABATAN / DEPO', 'KETERANGAN KEROSAKAN']], [5, 12, 16, 18, 40]), 'BREAKDOWN');
  XLSX.utils.book_append_sheet(wb, sheet([['BIL', 'NO PLAT', 'JABATAN / DEPO', 'TARIKH']], [5, 12, 18, 12]), 'LORI SEWA');
  XLSX.utils.book_append_sheet(wb, sheet([['DEPOH', 'JUM. KEN.', 'KEN. STANDBY'], ...S.depots.map(d => [d.name, d.jum, ''])], [18, 10, 12]), 'STANDBY');
  XLSX.utils.book_append_sheet(wb, sheet([['PANDUAN'], ['1. Satu baris = satu kenderaan dalam pembaikan. Tarikh dalam format HH/BB/TTTT.'], ['2. TEMPOH dikira automatik (Jangkaan Siap - Tarikh Masuk). Boleh dibiarkan kosong.'], ['3. Isi TARIKH SIAP SEBENAR apabila kenderaan siap — status bertukar SIAP automatik.'], ['4. Jenis: ' + S.jenis.join(', ')], ['5. Depoh: ' + depotNames().join(', ') + '. Jabatan lain: ' + S.jabatanLain.join(', ')], ['6. Panel: ' + S.panels.map(p => p.name).join(', ')]], [100]), 'PANDUAN');
  XLSX.writeFile(wb, 'Templat_Laporan_Pembaikan_Harian_MBSP.xlsx');
}

function exportDay(rep) {
  if (!rep) return;
  const sm = summarize(rep);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([['LAPORAN PEMBAIKAN KENDERAAN MAJLIS'], ['TARIKH KEMASKINI :', fmt(rep.date)], HDR, ...sortRows(rep.rows).map(rowOut)], [5, 12, 16, 18, 60, 13, 10, 14, 14, 18, 16]), 'PEMBAIKAN');
  XLSX.utils.book_append_sheet(wb, sheet([['BIL', 'NO PLAT', 'JENIS KENDERAAN', 'JABATAN / DEPO', 'KETERANGAN KEROSAKAN'], ...rep.breakdown.map((r, i) => [i + 1, r.plat, r.jenis, r.depo, r.kerosakan])]), 'BREAKDOWN');
  XLSX.utils.book_append_sheet(wb, sheet([['BIL', 'NO PLAT', 'JABATAN / DEPO', 'TARIKH'], ...rep.sewa.map((r, i) => [i + 1, r.plat, r.depo, fmt(r.tarikh)])]), 'LORI SEWA');
  XLSX.utils.book_append_sheet(wb, sheet([['DEPOH', 'JUM. KEN.', 'KEN. STANDBY', 'ROSAK'], ...sm.depot.map(d => [d.name, d.jum, d.standby, d.rosak]), ['JUMLAH', sm.tot.jum, sm.tot.standby, sm.tot.rosak]]), 'STANDBY');
  XLSX.utils.book_append_sheet(wb, sheet([
    ['JENIS KENDERAAN (JAB. PERBANDARAN)', 'JUMLAH'], ...['COMPACT', 'RORO', 'TIPPER', 'OPEN TRUCK', 'LAIN-LAIN'].map(j => [j, sm.jenis[j]]), ['KENDERAAN SIAP', sm.jenis.SIAP], ['JUMLAH KENDERAAN', sm.jenis.JUMLAH], [],
    ['TEMPOH PEMBAIKAN', 'JUMLAH'], ['< 3 hari', sm.tem.le3], ['4 - 7 hari', sm.tem.m47], ['> 8 hari', sm.tem.ge8], ['SIAP', sm.tem.siap], ['JUMLAH', sm.tem.total], [],
    ['KOMPAKTOR ROSAK MENGIKUT PANEL', 'JUMLAH'], ...Object.entries(sm.panel), ['JUMLAH', sm.compRosak.length]], [36, 10]), 'RINGKASAN');
  XLSX.writeFile(wb, `Laporan_Pembaikan_${rep.date}.xlsx`);
}

function exportAll() {
  const data = [['TARIKH LAPORAN', ...HDR.slice(1), 'HARI DI BENGKEL', 'JAB. PERBANDARAN']];
  const sb = [['TARIKH LAPORAN', 'DEPOH', 'JUM. KEN.', 'KOMPAKTOR ROSAK', 'STANDBY']];
  const bd = [['TARIKH LAPORAN', 'NO PLAT', 'JENIS KENDERAAN', 'JABATAN / DEPO', 'KETERANGAN KEROSAKAN']];
  REPORTS.forEach(rep => {
    rep.rows.forEach((r, i) => data.push([fmt(rep.date), ...rowOut(r, i).slice(1), hariBengkel(r, rep.date), isDepot(r.depo) ? 'YA' : 'TIDAK']));
    summarize(rep).depot.forEach(d => sb.push([fmt(rep.date), d.name, d.jum, d.rosak, d.standby]));
    rep.breakdown.forEach(r => bd.push([fmt(rep.date), r.plat, r.jenis, r.depo, r.kerosakan]));
  });
  const cases = allCases().map(c => [c.plat, c.jenis, c.depo, c.kerosakan, fmt(c.masuk), fmt(c.jangkaan), fmt(c.siap), c.panel, days(c.masuk, c.siap || c.lastSeen), c.siap ? 'SIAP' : 'DALAM PEMBAIKAN', fmt(c.lastSeen)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(data), 'DATA HARIAN');
  XLSX.utils.book_append_sheet(wb, sheet([['NO PLAT', 'JENIS KENDERAAN', 'JABATAN / DEPO', 'KETERANGAN KEROSAKAN', 'TARIKH MASUK', 'TARIKH JANGKAAN SIAP', 'TARIKH SIAP SEBENAR', 'PANEL', 'JUMLAH HARI', 'STATUS', 'KALI TERAKHIR DILAPOR'], ...cases]), 'KES UNIK');
  XLSX.utils.book_append_sheet(wb, sheet(sb), 'STANDBY HARIAN');
  XLSX.utils.book_append_sheet(wb, sheet(bd), 'BREAKDOWN HARIAN');
  XLSX.writeFile(wb, `Data_Raya_Fleet_MBSP_${todayISO()}.xlsx`);
  audit('Eksport data raya', `${REPORTS.length} laporan`);
}

async function importExcel(file) {
  if (!file) return;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const aoa = n => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true }) : null;
    const findSheet = re => wb.SheetNames.find(n => re.test(n.toUpperCase()));
    const main = aoa(findSheet(/PEMBAIKAN/) || wb.SheetNames[0]);
    const hIdx = main.findIndex(r => r.some(c => norm(c) === 'NO PLAT'));
    if (hIdx < 0) throw new Error('Lajur "NO PLAT" tidak dijumpai. Guna templat Excel rasmi.');
    const H = main[hIdx].map(norm);
    const col = (...names) => H.findIndex(h => names.some(n => h.startsWith(n)));
    const C = { plat: col('NO PLAT'), jenis: col('JENIS'), depo: col('JABATAN', 'DEPO'), kerosakan: col('KETERANGAN'), masuk: col('TARIKH MASUK'), jangkaan: col('TARIKH JANGKAAN'), siap: col('TARIKH SIAP'), panel: col('PANEL') };
    const missing = Object.entries(C).filter(([, v]) => v < 0).map(([k]) => k);
    if (missing.includes('plat') || missing.includes('masuk')) throw new Error('Lajur wajib tiada: ' + missing.join(', '));
    // tarikh laporan dari baris "TARIKH KEMASKINI"
    let rDate = '';
    main.slice(0, hIdx).forEach(r => r.forEach((c, i) => { if (/TARIKH KEMASKINI/i.test(c)) rDate = parseDate(String(c).split(':')[1]?.trim() || r[i + 1]); }));
    const rows = main.slice(hIdx + 1).filter(r => norm(r[C.plat]) && !/^PXX/.test(norm(r[C.plat]))).map(r => ({
      id: uid(), plat: norm(r[C.plat]), jenis: norm(r[C.jenis]), depo: norm(r[C.depo]), kerosakan: String(r[C.kerosakan] || '').trim(),
      masuk: parseDate(r[C.masuk]), jangkaan: C.jangkaan >= 0 ? parseDate(r[C.jangkaan]) : '', siap: C.siap >= 0 ? parseDate(r[C.siap]) : '', panel: C.panel >= 0 ? norm(r[C.panel]) : ''
    }));
    const tbl = (n, keys) => { const a = aoa(findSheet(n)); if (!a) return []; return a.slice(1).filter(r => norm(r[1])).map(r => Object.fromEntries(keys.map((k, i) => [k, k === 'tarikh' ? parseDate(r[i + 1]) : k === 'kerosakan' ? String(r[i + 1]) : norm(r[i + 1])]))); };
    const standby = {};
    const sa = aoa(findSheet(/STANDBY/));
    if (sa) sa.slice(1).forEach(r => { if (isDepot(r[0]) && r[2] !== '') standby[norm(r[0])] = +r[2]; });
    const date = rDate || $('#rptDate').value;
    if (!confirm(`Import ${rows.length} kenderaan untuk laporan ${fmt(date)}?${missing.length ? '\nLajur tidak dijumpai: ' + missing.join(', ') : ''}\nData akan dimuatkan ke borang untuk disemak sebelum disimpan.`)) return;
    const prev = cur && cur.date === date ? cur : REPORTS.find(r => r.date === date);
    cur = { date, rev: prev?.rev || 0, rows, breakdown: tbl(/BREAKDOWN/, ['plat', 'jenis', 'depo', 'kerosakan']), sewa: tbl(/SEWA/, ['plat', 'depo', 'tarikh']), standby: Object.keys(standby).length ? standby : (prev?.standby || {}) };
    dirty = true;
    $('#rptDate').value = date;
    showTab('harian', true);
    $('#rptMsgs').innerHTML = '';
    renderEditor();
    $('#rptStatus').innerHTML = `<span class="text-blue-700">Diimport dari ${esc(file.name)} — semak dan tekan Simpan.</span>`;
    await audit('Import Excel', `${file.name}: ${rows.length} kenderaan untuk ${fmt(date)} (belum disimpan)`);
  } catch (e) {
    $('#rptMsgs').innerHTML = `<div class="bg-red-50 border border-red-300 text-red-800 rounded p-3 text-sm"><b>Import gagal:</b> ${esc(e.message)}</div>`;
  }
}

async function backupJson() {
  let log = [];
  try { log = await Store.getAudit(); } catch (e) { /* backup tetap diteruskan tanpa log */ }
  const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), settings: S, reports: REPORTS, audit: log, transfers: TRANSFERS }, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `Backup_Fleet_MBSP_${todayISO()}.json` });
  a.click();
  audit('Backup', `${REPORTS.length} laporan`);
}

async function restoreJson(file) {
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.reports)) throw new Error('Format fail backup tidak sah.');
    if (!confirm(`Pulihkan ${d.reports.length} laporan? Laporan dengan tarikh sama akan ditimpa.`)) return;
    busy('Memulihkan…');
    await Store.restore({ reports: d.reports, settings: d.settings, transfers: d.transfers, user: userName() });
    busy();
    dirty = false;
    await refreshAll();
  } catch (e) { busy(); alert('Gagal: ' + e.message); }
}

// ---------- Tetapan ----------
function renderSettings() {
  $('#depotSettings').innerHTML = `<table class="w-full text-sm"><thead class="bg-slate-100 text-xs"><tr><th class="p-2 text-left">Nama Depoh</th><th>Jumlah Kompaktor</th><th>Latitud</th><th>Longitud</th><th></th></tr></thead><tbody>
    ${S.depots.map((d, i) => `<tr class="border-b"><td><input class="border rounded px-2 py-1 w-full" data-dep="${i}" data-f="name" value="${esc(d.name)}"></td>
      <td><input type="number" class="border rounded px-2 py-1 w-24" data-dep="${i}" data-f="jum" value="${d.jum}"></td>
      <td><input type="number" step="0.0001" class="border rounded px-2 py-1 w-32" data-dep="${i}" data-f="lat" value="${d.lat}"></td>
      <td><input type="number" step="0.0001" class="border rounded px-2 py-1 w-32" data-dep="${i}" data-f="lng" value="${d.lng}"></td>
      <td><button class="text-red-500 px-2" data-deldep="${i}">✕</button></td></tr>`).join('')}</tbody></table>
    <button id="addDepot" class="mt-2 px-2 py-0.5 border rounded text-xs">+ Tambah Depoh</button>`;
  const num = (k, label) => `<label>${label}</label><input type="number" class="border rounded px-2 py-1" data-rule="${k}" value="${S[k]}">`;
  $('#ruleSettings').innerHTML = num('fleetTotal', 'Jumlah armada MBSP (unit)') + num('kritikalHari', 'Kes kritikal jika di bengkel melebihi (hari)')
    + num('eskalasiHari', 'Eskalasi Red Alert panel melebihi (hari)') + num('lebihanStandby', 'Depoh "lebihan" jika standby ≥') + num('kadarLAD', 'Kadar LAD (RM sehari)');
  const list = (k, label, v) => `<div><label class="text-xs text-slate-500">${label} (pisahkan dengan koma)</label><textarea class="border rounded px-2 py-1 w-full" rows="2" data-list="${k}">${esc(v)}</textarea></div>`;
  $('#listSettings').innerHTML = list('jenis', 'Jenis kenderaan', S.jenis.join(', ')) + list('jabatanLain', 'Jabatan lain (bukan depoh)', S.jabatanLain.join(', '))
    + list('panelLuar', 'Panel bengkel luar', S.panels.filter(p => !p.dalaman).map(p => p.name).join(', ')) + list('panelDalam', 'Bengkel dalaman', S.panels.filter(p => p.dalaman).map(p => p.name).join(', '));
  const inGas = window.google && google.script && google.script.run;
  $('#connSettings').innerHTML = inGas
    ? `<div class="text-sm">Disambung terus ke Google Sheets melalui Apps Script. Tiada tetapan diperlukan.</div>`
    : `<div class="text-sm mb-2">Mod semasa: <b>${esc(Store.label)}</b>. Untuk halaman yang di-host di luar Google (GitHub Pages / pelayan web), isi URL Web App dari Apps Script. Selepas disambung, log masuk dengan akaun dari Google Sheets. Biarkan kosong untuk simpan dalam browser ini sahaja.</div>
      <div class="grid md:grid-cols-[1fr_auto_auto] gap-2">
        <input id="apiUrl" class="border rounded px-2 py-1 text-sm" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(LS.get('apiUrl') || '')}">
        <button id="btnTestConn" class="px-3 py-1 rounded border text-sm">Uji &amp; Sambung</button>
        <button id="btnLocal" class="px-3 py-1 rounded border text-sm">Guna tempatan</button>
      </div><div id="connMsg" class="text-sm mt-2"></div>`;
  if (!inGas) {
    $('#btnTestConn').onclick = async () => {
      const url = $('#apiUrl').value.trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { $('#connMsg').innerHTML = '<span class="text-red-700">URL mesti bermula dengan https://script.google.com/</span>'; return; }
      const oldU = LS.get('apiUrl');
      LS.set('apiUrl', url);
      $('#connMsg').textContent = 'Menguji…';
      try {
        await httpCall('ping', {});
        $('#connMsg').innerHTML = '<span class="text-emerald-700">Berjaya disambung. Anda akan dibawa ke halaman log masuk pelayan…</span>';
        SS.set('token', null);
        setTimeout(() => location.reload(), 900);
      } catch (e) {
        LS.set('apiUrl', oldU);
        $('#connMsg').innerHTML = `<span class="text-red-700">Gagal: ${esc(e.message)}</span>`;
      }
    };
    $('#btnLocal').onclick = () => { if (confirm('Putuskan sambungan Google Sheets dan guna storan browser ini?')) { LS.set('apiUrl', null); SS.set('token', null); location.reload(); } };
  }
  $('#depotSettings').onclick = e => {
    if (e.target.id === 'addDepot') { collectSettings(); S.depots.push({ name: '', jum: 0, lat: 5.38, lng: 100.45 }); renderSettings(); }
    if (e.target.dataset.deldep) { collectSettings(); S.depots.splice(+e.target.dataset.deldep, 1); renderSettings(); }
  };
}

function collectSettings() {
  document.querySelectorAll('[data-dep]').forEach(el => { const d = S.depots[+el.dataset.dep]; d[el.dataset.f] = el.dataset.f === 'name' ? norm(el.value) : +el.value; });
  document.querySelectorAll('[data-rule]').forEach(el => S[el.dataset.rule] = +el.value);
  const L = k => norm(document.querySelector(`[data-list=${k}]`).value).split(',').map(s => s.trim()).filter(Boolean);
  S.jenis = L('jenis'); S.jabatanLain = L('jabatanLain');
  S.panels = [...L('panelDalam').map(name => ({ name, dalaman: true })), ...L('panelLuar').map(name => ({ name, dalaman: false }))];
}

async function saveSettings() {
  collectSettings();
  S.depots = S.depots.filter(d => d.name);
  busy('Menyimpan tetapan…');
  try { await Store.saveSettings(S, userName(), `${S.depots.length} depoh, ${S.panels.length} panel`); } catch (e) { busy(); return alert('Gagal: ' + e.message); }
  busy();
  fillDatalists();
  renderSettings(); renderAlertBar();
  alert('Tetapan disimpan.');
}

// ---------- Pengurusan Pengguna (admin) ----------
let USERS = [];
const msgBox = (kind, html) => {
  const c = { ok: 'bg-emerald-50 border-emerald-300 text-emerald-800', err: 'bg-red-50 border-red-300 text-red-800', info: 'bg-amber-50 border-amber-300 text-amber-900' }[kind];
  return `<div class="border rounded p-3 text-sm ${c}">${html}</div>`;
};

async function renderUsers(notice) {
  $('#usersTable').innerHTML = (notice || '') + '<div class="text-sm text-slate-500 p-2">Memuatkan…</div>';
  try { USERS = (await Store.listUsers()).users; } catch (e) { $('#usersTable').innerHTML = msgBox('err', esc(e.message)); return; }
  const roleTag = r => `<span class="tag ${r === 'admin' ? 'bg-slate-200' : r === 'panel' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">${ROLE_LABEL[r] || esc(r)}</span>`;
  $('#usersTable').innerHTML = (notice ? `<div class="mb-3">${notice}</div>` : '') +
    (Store.mode === 'local' ? `<div class="mb-3">${msgBox('info', esc(NEED_SERVER))}</div>` : '') +
    `<table class="w-full text-sm min-w-[760px]"><thead class="bg-slate-100 text-xs"><tr><th class="p-2 text-left">Nama pengguna</th><th class="text-left">Nama</th><th class="text-left">Peranan</th><th class="text-left">Panel / Depoh</th><th>Status</th><th class="text-left">Log masuk terakhir</th><th></th></tr></thead><tbody>
    ${USERS.map(u => `<tr class="border-b"><td class="p-2 font-semibold">${esc(u.username)}${u.username === USER.username ? ' <span class="text-xs text-slate-500">(anda)</span>' : ''}</td>
      <td>${esc(u.nama)}</td><td>${roleTag(u.peranan)}</td><td>${esc(u.skop || '-')}</td>
      <td class="text-center">${u.aktif ? (u.mustChange ? '<span class="tag bg-amber-100 text-amber-800">Belum log masuk</span>' : '<span class="tag bg-emerald-100 text-emerald-800">Aktif</span>') : '<span class="tag bg-red-100 text-red-800">Tidak aktif</span>'}</td>
      <td class="text-xs">${u.lastLogin ? new Date(u.lastLogin).toLocaleString('ms-MY') : '-'}</td>
      <td class="text-right"><button class="px-2 py-0.5 rounded border bg-white text-xs" data-edit="${esc(u.username)}">Sunting</button></td></tr>`).join('')}</tbody></table>`;
  $('#usersTable').onclick = e => { const b = e.target.closest('[data-edit]'); if (b) openUserModal(USERS.find(u => u.username === b.dataset.edit)); };
}

function openUserModal(u) {
  const isNew = !u;
  $('#userFormTitle').textContent = isNew ? 'Pengguna Baru' : 'Sunting Pengguna';
  $('#ufUsername').value = u ? u.username : ''; $('#ufUsername').readOnly = !isNew;
  $('#ufNama').value = u ? u.nama : '';
  $('#ufPeranan').value = u ? u.peranan : 'panel';
  $('#ufAktif').checked = u ? u.aktif : true;
  $('#ufReset').checked = false;
  $('#ufResetWrap').style.display = isNew ? 'none' : '';
  $('#ufErr').style.display = 'none';
  const fillSkop = () => {
    const r = $('#ufPeranan').value;
    $('#ufSkopWrap').style.display = r === 'admin' ? 'none' : '';
    $('#ufSkopLabel').textContent = r === 'panel' ? 'Bengkel panel' : 'Depoh';
    const opts = r === 'panel' ? S.panels.map(p => p.name) : depotNames();
    $('#ufSkop').innerHTML = opts.map(o => `<option ${u && u.skop === o ? 'selected' : ''}>${esc(o)}</option>`).join('');
  };
  $('#ufPeranan').onchange = fillSkop; fillSkop();
  $('#ufCancel').onclick = () => $('#userModal').classList.remove('open');
  $('#userForm').onsubmit = async e => {
    e.preventDefault();
    const r = $('#ufPeranan').value;
    try {
      const res = await Store.saveUser({ isNew, username: $('#ufUsername').value, nama: $('#ufNama').value, peranan: r,
        skop: r === 'admin' ? '' : $('#ufSkop').value, aktif: $('#ufAktif').checked, resetPassword: $('#ufReset').checked });
      $('#userModal').classList.remove('open');
      const un = esc($('#ufUsername').value.trim().toLowerCase());
      renderUsers(res.tempPassword
        ? msgBox('ok', `<b>${isNew ? 'Akaun dicipta' : 'Kata laluan ditetapkan semula'}.</b> Serahkan maklumat ini kepada pengguna secara selamat — kata laluan sementara <b>hanya dipaparkan sekali</b>:<br>
            Nama pengguna: <code class="px-1 bg-white border rounded">${un}</code> &nbsp; Kata laluan sementara: <code class="px-1 bg-white border rounded">${esc(res.tempPassword)}</code><br>
            Pengguna akan diminta menukar kata laluan semasa log masuk pertama.`)
        : msgBox('ok', `Pengguna <b>${un}</b> dikemaskini.`));
    } catch (ex) { $('#ufErr').textContent = ex.message; $('#ufErr').style.display = 'block'; }
  };
  $('#userModal').classList.add('open');
  setTimeout(() => (isNew ? $('#ufUsername') : $('#ufNama')).focus(), 50);
}

// ---------- Portal Panel Bengkel ----------
let PANEL = null, panelNew = [], panelEdits = {};

async function renderPanel() {
  $('#panelName').textContent = USER.scope;
  $('#panelRows').innerHTML = '<div class="text-sm text-slate-500 p-2">Memuatkan…</div>';
  try { PANEL = await Store.panelData(); } catch (e) { $('#panelRows').innerHTML = msgBox('err', esc(e.message)); return; }
  panelNew = []; panelEdits = {}; dirty = false;
  $('#panelNewForm').masuk.value = PANEL.today;
  $('#dlJenis').innerHTML = PANEL.lists.jenis.map(j => `<option value="${esc(j)}">`).join('');
  $('#dlDepo').innerHTML = PANEL.lists.depo.map(j => `<option value="${esc(j)}">`).join('');
  drawPanel();
}

function drawPanel() {
  const d = PANEL, today = d.today;
  const act = d.rows.filter(r => !r.siap);
  const lewat = act.filter(r => r.jangkaan && r.jangkaan < today);
  const lama = act.filter(r => days(r.masuk, today) > 8);
  const kpi = (label, v, sub, color) => `<div class="bg-white rounded-lg shadow p-3 border-l-4 ${color}"><div class="text-xs text-slate-500">${label}</div><div class="text-3xl font-black">${v}</div><div class="text-xs text-slate-500">${sub}</div></div>`;
  $('#panelKpi').innerHTML = kpi('Dalam pembaikan', act.length, 'kenderaan MBSP di bengkel anda', 'border-blue-500')
    + kpi('Lewat dari jangkaan', lewat.length, 'sila kemaskini tarikh jangkaan', lewat.length ? 'border-red-500' : 'border-emerald-500')
    + kpi('Melebihi 8 hari', lama.length, 'tertakluk kepada semakan penalti', lama.length ? 'border-amber-500' : 'border-emerald-500')
    + kpi('Siap (30 hari)', d.recentDone.length, 'kenderaan diserahkan semula', 'border-emerald-500');
  $('#panelDate').textContent = `· Laporan ${fmt(d.date)}${d.isNew ? ' (akan dicipta apabila anda hantar)' : ''}`;
  const cell = (r, f, type) => `<input ${type === 'date' ? 'type="date"' : ''} class="cell border-slate-300" style="border-color:#cbd5e1" data-id="${esc(r.id)}" data-f="${f}" value="${esc((panelEdits[r.id] || {})[f] ?? r[f] ?? '')}" ${f === 'siap' ? `max="${today}" min="${esc(r.masuk)}"` : `min="${esc(r.masuk)}"`}>`;
  const rows = d.rows.map(r => {
    const e = Object.assign({}, r, panelEdits[r.id] || {});
    const h = days(e.masuk, e.siap || today);
    const late = !e.siap && e.jangkaan && e.jangkaan < today;
    const status = e.siap ? '<span class="tag bg-emerald-100 text-emerald-800">SIAP</span>' : late ? `<span class="tag bg-red-100 text-red-800">Lewat ${days(e.jangkaan, today)} hari</span>` : '<span class="tag bg-amber-100 text-amber-800">Dalam pembaikan</span>';
    return `<tr class="${panelEdits[r.id] ? 'bg-amber-50' : r.siap ? 'bg-emerald-50' : ''}">
      <td class="font-semibold whitespace-nowrap p-2">${esc(r.plat)}</td><td>${esc(r.jenis)}</td><td>${esc(r.depo)}</td>
      <td style="min-width:260px"><textarea class="cell" style="border-color:#cbd5e1" rows="2" data-id="${esc(r.id)}" data-f="kerosakan">${esc(e.kerosakan)}</textarea></td>
      <td class="whitespace-nowrap">${fmt(r.masuk)}</td><td>${cell(r, 'jangkaan', 'date')}</td><td>${cell(r, 'siap', 'date')}</td>
      <td class="text-center">${h ?? '-'}</td><td>${status}</td><td></td></tr>`;
  }).join('');
  const news = panelNew.map((r, i) => `<tr class="bg-blue-50"><td class="font-semibold p-2">${esc(r.plat)}</td><td>${esc(r.jenis)}</td><td>${esc(r.depo)}</td><td>${esc(r.kerosakan)}</td>
      <td>${fmt(r.masuk)}</td><td>${fmt(r.jangkaan) || '-'}</td><td>-</td><td class="text-center">${days(r.masuk, today)}</td>
      <td><span class="tag bg-slate-200">Baru · belum dihantar</span></td><td><button class="text-red-600 px-2" data-rmnew="${i}" title="Buang">✕</button></td></tr>`).join('');
  $('#panelRows').innerHTML = (rows || news) ? `<table class="grid-table w-full min-w-[980px]"><thead><tr><th>NO PLAT</th><th>JENIS</th><th>JABATAN / DEPOH</th><th>KETERANGAN KEROSAKAN</th><th>MASUK</th><th>JANGKAAN SIAP</th><th>TARIKH SIAP</th><th>HARI</th><th>STATUS</th><th></th></tr></thead><tbody>${rows}${news}</tbody></table>`
    : '<div class="text-sm text-slate-500 p-3">Tiada kenderaan MBSP di bengkel anda sekarang. Daftar kenderaan baru di bawah apabila diterima.</div>';
  $('#panelRows').oninput = e => {
    const el = e.target; if (!el.dataset.id) return;
    const r = PANEL.rows.find(x => x.id === el.dataset.id);
    const ed = panelEdits[r.id] = panelEdits[r.id] || {};
    ed[el.dataset.f] = el.value;
    if (Object.keys(ed).every(k => (ed[k] || '') === (r[k] || ''))) delete panelEdits[r.id];
    dirty = Object.keys(panelEdits).length > 0 || panelNew.length > 0;
    el.closest('tr').classList.toggle('bg-amber-50', !!panelEdits[r.id]);
  };
  $('#panelRows').onchange = e => { if (e.target.dataset.f === 'siap' || e.target.dataset.f === 'jangkaan') drawPanel(); };
  $('#panelRows').onclick = e => { const b = e.target.closest('[data-rmnew]'); if (b) { panelNew.splice(+b.dataset.rmnew, 1); dirty = Object.keys(panelEdits).length > 0 || panelNew.length > 0; drawPanel(); } };
  $('#panelDone').innerHTML = d.recentDone.length ? `<table class="w-full text-sm"><thead class="bg-slate-100 text-xs"><tr><th class="p-2 text-left">No plat</th><th class="text-left">Jenis</th><th class="text-left">Depoh</th><th>Masuk</th><th>Siap</th><th>Hari</th></tr></thead><tbody>
    ${d.recentDone.map(r => `<tr class="border-b"><td class="p-2 font-semibold">${esc(r.plat)}</td><td>${esc(r.jenis)}</td><td>${esc(r.depo)}</td><td class="text-center">${fmt(r.masuk)}</td><td class="text-center">${fmt(r.siap)}</td><td class="text-center">${days(r.masuk, r.siap)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="text-sm text-slate-500">Belum ada.</div>';
}

function panelAddNew(e) {
  e.preventDefault();
  const f = e.target;
  const r = { plat: norm(f.plat.value), jenis: norm(f.jenis.value), depo: norm(f.depo.value), kerosakan: f.kerosakan.value.trim(), masuk: f.masuk.value, jangkaan: f.jangkaan.value };
  const today = PANEL.today;
  const err = !r.plat ? 'No plat wajib diisi.' : !r.depo ? 'Jabatan / depoh wajib diisi.' : !r.kerosakan ? 'Keterangan kerosakan wajib diisi.'
    : !r.masuk || r.masuk > today ? 'Tarikh masuk tidak sah.' : r.jangkaan && r.jangkaan < r.masuk ? 'Jangkaan siap tidak boleh sebelum tarikh masuk.'
    : PANEL.rows.some(x => x.plat === r.plat && !x.siap) || panelNew.some(x => x.plat === r.plat) ? `${r.plat} sudah ada dalam senarai.` : '';
  if (err) { $('#panelMsgs').innerHTML = msgBox('err', esc(err)); return; }
  panelNew.push(r); dirty = true;
  f.reset(); f.masuk.value = today;
  $('#panelMsgs').innerHTML = msgBox('info', `<b>${esc(r.plat)}</b> ditambah ke senarai. Tekan <b>Hantar Kemaskini</b> untuk simpan.`);
  drawPanel();
  $('#panelRows').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function panelSave() {
  const updates = Object.entries(panelEdits).map(([id, ch]) => ({ id, plat: (PANEL.rows.find(r => r.id === id) || {}).plat, ...ch }));
  if (!updates.length && !panelNew.length) { $('#panelMsgs').innerHTML = msgBox('info', 'Tiada perubahan untuk dihantar.'); return; }
  const siapCount = updates.filter(u => u.siap).length;
  if (!confirm(`Hantar kemaskini?\n\n• ${updates.length} kenderaan dikemaskini${siapCount ? ` (${siapCount} ditanda SIAP)` : ''}\n• ${panelNew.length} kenderaan baru`)) return;
  busy('Menghantar…');
  try {
    const res = await Store.panelSave({ updates, newRows: panelNew });
    PANEL = res.data; panelEdits = {}; panelNew = []; dirty = false;
    $('#panelMsgs').innerHTML = msgBox('ok', `<b>Kemaskini diterima.</b><ul class="list-disc ml-5">${res.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`);
    drawPanel();
  } catch (e) {
    $('#panelMsgs').innerHTML = msgBox('err', `<b>Gagal dihantar:</b> ${esc(e.message)}. Perubahan anda masih di skrin — cuba lagi.`);
  }
  busy();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Portal PIC Depoh ----------
async function renderDepo() {
  $('#depoName').textContent = USER.scope;
  $('#depoRows').innerHTML = '<div class="text-sm text-slate-500 p-2">Memuatkan…</div>';
  let d;
  try { d = await Store.depoData(); } catch (e) { $('#depoRows').innerHTML = msgBox('err', esc(e.message)); return; }
  $('#depoDate').textContent = d.date ? `Laporan terkini: ${fmt(d.date)}.` : 'Belum ada laporan.';
  const s = d.summary || { jum: 0, rosak: 0, standby: 0, operasi: 0 };
  $('#depoAlert').innerHTML = !d.summary ? '' : s.standby === 0
    ? msgBox('err', `<b>RED ALERT:</b> Depoh ${esc(d.depot)} tiada unit kompaktor standby (${s.rosak} rosak). Pentadbir fleet dimaklumkan melalui dashboard.`)
    : s.rosak > s.standby ? msgBox('info', `Kompaktor rosak (${s.rosak}) melebihi unit standby (${s.standby}).`) : '';
  const kpi = (label, v, sub, color) => `<div class="bg-white rounded-lg shadow p-3 border-l-4 ${color}"><div class="text-xs text-slate-500">${label}</div><div class="text-3xl font-black">${v}</div><div class="text-xs text-slate-500">${sub}</div></div>`;
  $('#depoKpi').innerHTML = kpi('Kompaktor beroperasi', s.operasi, `daripada ${s.jum} unit`, 'border-emerald-500')
    + kpi('Standby', s.standby, s.standby === 0 ? 'tiada unit ganti' : 'unit ganti tersedia', s.standby === 0 ? 'border-red-500' : 'border-blue-500')
    + kpi('Kompaktor rosak', s.rosak, 'dalam pembaikan', 'border-red-500')
    + kpi('Semua kenderaan di bengkel', d.rows.filter(r => !r.siap).length, 'semua jenis kenderaan depoh', 'border-amber-500');
  const today = d.date || todayISO();
  const list = [...d.rows].sort((a, b) => (a.siap ? 1 : 0) - (b.siap ? 1 : 0) || (a.masuk || '').localeCompare(b.masuk || ''));
  $('#depoRows').innerHTML = list.length ? `<table class="w-full text-sm min-w-[720px]"><thead class="bg-slate-100 text-xs"><tr><th class="p-2 text-left">No plat</th><th class="text-left">Jenis</th><th class="text-left">Bengkel</th><th class="text-left">Kerosakan</th><th>Masuk</th><th>Jangkaan siap</th><th>Hari</th><th>Status</th></tr></thead><tbody>
    ${list.map(r => {
      const h = days(r.masuk, r.siap || today), late = !r.siap && r.jangkaan && r.jangkaan < today;
      return `<tr class="border-b align-top"><td class="p-2 font-semibold whitespace-nowrap">${esc(r.plat)}</td><td>${esc(r.jenis)}</td><td>${esc(r.panel || '-')}</td><td class="text-xs" style="max-width:280px">${esc(r.kerosakan)}</td>
        <td class="text-center whitespace-nowrap">${fmt(r.masuk)}</td><td class="text-center whitespace-nowrap">${fmt(r.jangkaan) || '-'}</td><td class="text-center font-semibold ${h > d.rules.kritikalHari && !r.siap ? 'text-red-700' : ''}">${h ?? '-'}</td>
        <td class="text-center">${r.siap ? `<span class="tag bg-emerald-100 text-emerald-800">Siap ${fmt(r.siap)}</span>` : late ? `<span class="tag bg-red-100 text-red-800">Lewat ${days(r.jangkaan, today)} hari</span>` : '<span class="tag bg-amber-100 text-amber-800">Dalam pembaikan</span>'}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="text-sm text-slate-500 p-2">Tiada kenderaan depoh anda dalam pembaikan.</div>';
  $('#depoBreakdown').innerHTML = d.breakdown.length ? `<div class="text-sm font-semibold mt-2 mb-1">Breakdown</div>${d.breakdown.map(b => `<div class="text-sm">• <b>${esc(b.plat)}</b> ${esc(b.jenis)} — ${esc(b.kerosakan)}</div>`).join('')}` : '';
  mkChart('chDepoTrend', 'line', {
    labels: d.trend.map(t => fmt(t.date)),
    datasets: [
      { label: 'Kompaktor rosak', data: d.trend.map(t => t.rosak), borderColor: COL.rosak, backgroundColor: COL.rosak },
      { label: 'Standby', data: d.trend.map(t => t.standby), borderColor: COL.standby, backgroundColor: COL.standby },
      { label: 'Semua di bengkel', data: d.trend.map(t => t.aktif), borderColor: COL.amber, backgroundColor: COL.amber, borderDash: [4, 3] }
    ]
  }, { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } });
  const dot = { 'MASUK BENGKEL': COL.rosak, SIAP: COL.operasi, BREAKDOWN: COL.dark, 'PINDAH MASUK': COL.standby, 'PINDAH KELUAR': COL.amber };
  $('#depoMoves').innerHTML = d.movements.length ? `<div class="tl">${d.movements.map(m => `<div class="tl-item" style="--dot:${dot[m.type] || COL.grey}">
      <div class="text-xs text-slate-500">${fmt(m.date)} · <b style="color:${dot[m.type] || COL.grey}">${esc(m.type)}</b></div>
      <div class="text-sm">${m.plat ? `<b>${esc(m.plat)}</b> ${esc(m.jenis)}` : ''}${m.panel ? ` — ${esc(m.panel)}` : ''}${m.plat ? ': ' : ''}${esc(m.text)}</div></div>`).join('')}</div>`
    : '<div class="text-sm text-slate-500">Tiada pergerakan dalam 60 hari terkini.</div>';
}

init().catch(e => { document.body.insertAdjacentHTML('afterbegin', `<div class="bg-red-600 text-white p-3">Ralat memulakan sistem: ${esc(e.message)}</div>`); console.error(e); });
