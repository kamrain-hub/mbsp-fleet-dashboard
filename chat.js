/* A.R.C. — Asisten Respons Command Center
   Pembantu AI gaya HUD untuk MBSP Fleet Command Center.
   Menjawab soalan berdasarkan data laporan harian (tiada data dihantar keluar). */
'use strict';

(function () {
  const BOT = 'A.R.C.';
  const pref = k => LS.get('arc.' + k);
  const setPref = (k, v) => LS.set('arc.' + k, v);

  // ---------- Gaya ----------
  document.head.insertAdjacentHTML('beforeend', `<style>
  #arcFab { position: fixed; right: 22px; bottom: 22px; width: 74px; height: 74px; border-radius: 50%; z-index: 1500; cursor: pointer; border: 0; padding: 0;
    background: radial-gradient(circle, #0b1220 58%, #111827 60%); box-shadow: 0 0 22px rgba(56,189,248,.55), 0 0 0 2px rgba(245,179,1,.7); }
  #arcFab:hover { transform: scale(1.06); }
  #arcFab .lbl { position: absolute; bottom: -18px; left: 50%; transform: translateX(-50%); font: 700 10px 'Orbitron', sans-serif; color: #f5b301; letter-spacing: .15em; text-shadow: 0 0 6px #000; white-space: nowrap; }
  .arc-core { width: 100%; height: 100%; display: block; }
  .arc-core .spin { transform-origin: 50px 50px; animation: arcSpin 9s linear infinite; }
  .arc-core .spin2 { transform-origin: 50px 50px; animation: arcSpin 14s linear infinite reverse; }
  .arc-core .glow { animation: arcPulse 2.4s ease-in-out infinite; transform-origin: 50px 50px; }
  .arc-speaking .arc-core .glow { animation-duration: .45s; }
  .arc-thinking .arc-core .spin { animation-duration: 1.6s; }
  @keyframes arcSpin { to { transform: rotate(360deg); } }
  @keyframes arcPulse { 0%,100% { opacity: .75; transform: scale(.94); } 50% { opacity: 1; transform: scale(1.04); } }

  #arcPanel { position: fixed; right: 22px; bottom: 112px; width: 400px; max-width: calc(100vw - 32px); height: 600px; max-height: calc(100vh - 140px); z-index: 1500;
    display: none; flex-direction: column; color: #e2e8f0; font-family: 'Rajdhani', system-ui, sans-serif; font-size: 15px;
    background: linear-gradient(180deg, rgba(8,13,24,.97), rgba(5,8,15,.97)); border: 1px solid rgba(56,189,248,.45);
    box-shadow: 0 0 40px rgba(56,189,248,.25), inset 0 0 40px rgba(56,189,248,.06);
    clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 22px 100%, 0 calc(100% - 22px)); }
  #arcPanel.open { display: flex; animation: arcIn .28s ease-out; }
  @keyframes arcIn { from { opacity: 0; transform: translateY(14px) scale(.98); } }
  #arcPanel::after { content: ''; position: absolute; inset: 0; pointer-events: none;
    background: repeating-linear-gradient(0deg, rgba(56,189,248,.035) 0 1px, transparent 1px 3px); }
  .arc-head { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid rgba(245,179,1,.35);
    background: linear-gradient(90deg, rgba(127,29,29,.55), rgba(124,45,18,.25) 60%, transparent); }
  .arc-avatar { width: 64px; height: 64px; flex: none; position: relative; }
  .arc-avatar img { position: absolute; inset: 9px; width: 46px; height: 46px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 12px #38bdf8; }
  .arc-avatar svg { position: absolute; inset: 0; }
  .arc-name { font: 900 18px 'Orbitron', sans-serif; letter-spacing: .18em; color: #f5b301; text-shadow: 0 0 10px rgba(245,179,1,.5); }
  .arc-sub { font-size: 11px; color: #7dd3fc; letter-spacing: .08em; text-transform: uppercase; }
  .arc-sub .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px #22c55e; margin-right: 5px; }
  .arc-ico { background: transparent; border: 1px solid rgba(56,189,248,.35); color: #bae6fd; width: 30px; height: 30px; border-radius: 4px; cursor: pointer; font-size: 14px; }
  .arc-ico:hover { background: rgba(56,189,248,.15); }
  .arc-ico.off { opacity: .45; }
  .arc-log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; scrollbar-color: #1e3a5f transparent; }
  .arc-msg { max-width: 92%; padding: 8px 11px; line-height: 1.35; word-wrap: break-word; }
  .arc-msg.bot { align-self: flex-start; background: rgba(56,189,248,.07); border-left: 2px solid #38bdf8; }
  .arc-msg.user { align-self: flex-end; background: rgba(245,179,1,.12); border-right: 2px solid #f5b301; color: #fde68a; }
  .arc-msg.sys { align-self: stretch; font: 500 11px 'Orbitron', sans-serif; color: #38bdf8; letter-spacing: .06em; padding: 0 2px; background: none; }
  .arc-msg b { color: #fde68a; }
  .arc-msg .red { color: #f87171; font-weight: 700; }
  .arc-msg .ok { color: #34d399; font-weight: 700; }
  .arc-msg ul { margin: 4px 0 0 0; padding-left: 16px; list-style: square; }
  .arc-msg li::marker { color: #38bdf8; }
  .arc-msg table { border-collapse: collapse; margin-top: 4px; font-size: 13px; width: 100%; }
  .arc-msg td, .arc-msg th { padding: 1px 6px 1px 0; text-align: left; }
  .arc-msg th { color: #7dd3fc; font-weight: 600; font-size: 11px; text-transform: uppercase; }
  .arc-typing span { display: inline-block; width: 6px; height: 6px; margin-right: 3px; background: #38bdf8; border-radius: 50%; animation: arcDot 1s infinite; }
  .arc-typing span:nth-child(2) { animation-delay: .15s; } .arc-typing span:nth-child(3) { animation-delay: .3s; }
  @keyframes arcDot { 50% { opacity: .2; transform: translateY(-3px); } }
  .arc-chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 14px 8px; }
  .arc-chip { font: 600 12px 'Rajdhani', sans-serif; padding: 3px 9px; border: 1px solid rgba(245,179,1,.45); color: #fcd34d; background: rgba(245,179,1,.06); cursor: pointer; border-radius: 2px; }
  .arc-chip:hover { background: rgba(245,179,1,.18); }
  .arc-input { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid rgba(56,189,248,.3); }
  .arc-input input { flex: 1; background: rgba(2,6,23,.8); border: 1px solid rgba(56,189,248,.4); color: #e2e8f0; padding: 7px 10px; font: 500 15px 'Rajdhani', sans-serif; outline: none; }
  .arc-input input:focus { border-color: #f5b301; box-shadow: 0 0 8px rgba(245,179,1,.35); }
  .arc-input button { background: linear-gradient(180deg, #b91c1c, #7f1d1d); border: 1px solid #f5b301; color: #fde68a; font: 700 12px 'Orbitron', sans-serif; padding: 0 12px; cursor: pointer; letter-spacing: .08em; }
  .arc-input button.mic { background: rgba(56,189,248,.12); border-color: rgba(56,189,248,.5); color: #7dd3fc; padding: 0 10px; font-size: 16px; }
  .arc-input button.mic.live { background: #b91c1c; color: #fff; box-shadow: 0 0 12px #ef4444; animation: arcPulse 1s infinite; }
  .arc-set { padding: 12px 14px; border-bottom: 1px solid rgba(56,189,248,.25); font-size: 13px; display: none; gap: 8px; flex-direction: column; background: rgba(2,6,23,.6); }
  .arc-set.open { display: flex; }
  .arc-set label { color: #7dd3fc; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
  .arc-set input, .arc-set select { background: rgba(2,6,23,.8); border: 1px solid rgba(56,189,248,.35); color: #e2e8f0; padding: 4px 6px; font: 500 14px 'Rajdhani', sans-serif; }
  .arc-set .row { display: flex; gap: 8px; align-items: center; }

  /* Tema cerah */
  body.un #arcFab { background: radial-gradient(circle, #0b2a3d 58%, #0b2a3d 60%); box-shadow: 0 4px 14px rgba(0,119,184,.35), 0 0 0 3px #fff, 0 0 0 5px #009edb; }
  body.un #arcFab .lbl { color: #0077b8; text-shadow: none; font-family: 'Roboto', sans-serif; letter-spacing: .08em; }
  body.un #arcPanel { background: #fff; color: #2b3440; font-family: 'Roboto', system-ui, sans-serif; font-size: 14px; border: 1px solid #d6dee8;
    box-shadow: 0 12px 40px rgba(16,24,40,.18); clip-path: none; border-radius: 14px; overflow: hidden; }
  body.un #arcPanel::after { display: none; }
  body.un .arc-head { background: linear-gradient(90deg, #009edb, #0077b8); border-bottom: 0; color: #fff; }
  body.un .arc-avatar svg circle[stroke="#f5b301"] { stroke: #fff; }
  body.un .arc-name { color: #fff; text-shadow: none; font-family: 'Roboto', sans-serif; font-weight: 700; letter-spacing: .12em; font-size: 17px; }
  body.un .arc-sub { color: #e0f4fc; letter-spacing: .02em; text-transform: none; font-size: 12px; }
  body.un .arc-ico { border-color: rgba(255,255,255,.55); color: #fff; border-radius: 6px; }
  body.un .arc-ico:hover { background: rgba(255,255,255,.18); }
  body.un .arc-log { background: #f7f9fb; scrollbar-color: #cbd5e1 transparent; }
  body.un .arc-msg { border-radius: 10px; }
  body.un .arc-msg.bot { background: #fff; border: 1px solid #e3e8ef; border-left: 3px solid #009edb; color: #2b3440; }
  body.un .arc-msg.user { background: #009edb; border: 0; color: #fff; }
  body.un .arc-msg.sys { color: #0077b8; font-family: 'Roboto', monospace; font-size: 11px; }
  body.un .arc-msg b { color: #1d3557; }
  body.un .arc-msg.user b { color: #fff; }
  body.un .arc-msg .red { color: #c8102e; }
  body.un .arc-msg .ok { color: #3f8a2e; }
  body.un .arc-msg th { color: #0077b8; }
  body.un .arc-typing span { background: #009edb; }
  body.un .arc-chips { background: #f7f9fb; padding-top: 4px; }
  body.un .arc-chip { font-family: 'Roboto', sans-serif; font-size: 12px; border-color: #b9dff2; color: #0077b8; background: #fff; border-radius: 999px; padding: 4px 10px; }
  body.un .arc-chip:hover { background: #e6f5fc; }
  body.un .arc-input { border-top: 1px solid #e3e8ef; background: #fff; }
  body.un .arc-input input { background: #fff; border: 1px solid #cbd5e1; color: #2b3440; font-family: 'Roboto', sans-serif; font-size: 14px; border-radius: 8px; }
  body.un .arc-input input:focus { border-color: #009edb; box-shadow: 0 0 0 3px rgba(0,158,219,.15); }
  body.un .arc-input button { background: #009edb; border: 0; color: #fff; font-family: 'Roboto', sans-serif; font-weight: 600; letter-spacing: .02em; border-radius: 8px; }
  body.un .arc-input button:hover { background: #0077b8; }
  body.un .arc-input button.mic { background: #eef6fb; color: #0077b8; border: 1px solid #b9dff2; }
  body.un .arc-input button.mic.live { background: #e5243b; color: #fff; }
  body.un .arc-set { background: #f3f6f9; border-bottom: 1px solid #e3e8ef; }
  body.un .arc-set label { color: #1d3557; }
  body.un .arc-set label[style*="text-transform:none"] { color: #2b3440 !important; }
  body.un .arc-set input, body.un .arc-set select { background: #fff; border: 1px solid #cbd5e1; color: #2b3440; font-family: 'Roboto', sans-serif; font-size: 13px; border-radius: 6px; }
  body.un #arcPanel .arc-set div[style*="color:#94a3b8"], body.un #arcAiNote { color: #5f6b7a !important; }
  @media (max-width: 520px) { #arcPanel { right: 8px; left: 8px; width: auto; bottom: 96px; height: calc(100vh - 120px); } #arcFab { right: 14px; bottom: 14px; } }
  @media print { #arcFab, #arcPanel { display: none !important; } }
  </style>`);

  // Teras tenaga asal (bukan logo / watak berhak cipta)
  const CORE = `<svg class="arc-core" viewBox="0 0 100 100" aria-hidden="true">
    <defs><radialGradient id="arcG" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#f0f9ff"/><stop offset=".35" stop-color="#7dd3fc"/><stop offset=".7" stop-color="#0284c7" stop-opacity=".6"/><stop offset="1" stop-color="#0c4a6e" stop-opacity="0"/></radialGradient></defs>
    <circle cx="50" cy="50" r="47" fill="none" stroke="#f5b301" stroke-width="1.2" stroke-dasharray="3 5" class="spin2"/>
    <g class="spin">${Array.from({ length: 10 }, (_, i) => `<rect x="47" y="9" width="6" height="13" rx="1" fill="#38bdf8" fill-opacity=".85" transform="rotate(${i * 36} 50 50)"/>`).join('')}</g>
    <circle cx="50" cy="50" r="27" fill="none" stroke="#38bdf8" stroke-width="2" stroke-opacity=".9"/>
    <circle cx="50" cy="50" r="22" fill="none" stroke="#bae6fd" stroke-width=".8" stroke-dasharray="1.5 2.5" class="spin2"/>
    <circle cx="50" cy="50" r="19" fill="url(#arcG)" class="glow"/>
    <circle cx="50" cy="50" r="7" fill="#f0f9ff" class="glow"/>
  </svg>`;
  const RING = CORE.replace('<circle cx="50" cy="50" r="19" fill="url(#arcG)" class="glow"/>\n    <circle cx="50" cy="50" r="7" fill="#f0f9ff" class="glow"/>', '');

  // ---------- Markup ----------
  document.body.insertAdjacentHTML('beforeend', `
  <button id="arcFab" class="no-print" title="Buka ${BOT}">${CORE}<span class="lbl">${BOT}</span></button>
  <section id="arcPanel" class="no-print" aria-label="Pembantu ${BOT}">
    <div class="arc-head">
      <div class="arc-avatar" id="arcAvatar"></div>
      <div style="flex:1;min-width:0">
        <div class="arc-name">${BOT}</div>
        <div class="arc-sub"><span class="dot"></span><span id="arcStatus">Dalam talian</span></div>
      </div>
      <button class="arc-ico" id="arcVoice" title="Suara on/off">🔊</button>
      <button class="arc-ico" id="arcGear" title="Tetapan pembantu">⚙</button>
      <button class="arc-ico" id="arcClose" title="Tutup">✕</button>
    </div>
    <div class="arc-set" id="arcSet">
      <div class="row"><label style="width:90px">Panggil saya</label>
        <input id="arcAddr" placeholder="cth: Tuan / Puan / Encik Ali" style="flex:1"></div>
      <div class="row"><label style="width:90px">Suara</label><select id="arcVoiceSel" style="flex:1"></select></div>
      <div class="row"><label style="width:90px">Otak AI</label>
        <label style="flex:1;text-transform:none;letter-spacing:0;font-size:13px;color:#e2e8f0"><input type="checkbox" id="arcAi"> Guna Claude untuk soalan bebas</label></div>
      <div id="arcAiNote" style="font-size:11px;color:#94a3b8"></div>
      <div class="row"><label style="width:90px">Gambar avatar</label>
        <input type="file" id="arcImg" accept="image/*" style="flex:1;font-size:12px"><button class="arc-ico" id="arcImgClr" title="Buang gambar">✕</button></div>
      <div style="font-size:11px;color:#94a3b8">Gambar disimpan dalam browser ini sahaja. Gunakan gambar milik jabatan atau yang anda ada hak untuk gunakan.</div>
    </div>
    <div class="arc-log" id="arcLog"></div>
    <div class="arc-chips" id="arcChips"></div>
    <form class="arc-input" id="arcForm" autocomplete="off">
      <button type="button" class="mic" id="arcMic" title="Cakap">🎙</button>
      <input id="arcIn" placeholder="Tanya ${BOT}… cth: standby Kepala Batas">
      <button type="submit">HANTAR</button>
    </form>
  </section>`);

  const panel = $('#arcPanel'), log = $('#arcLog'), input = $('#arcIn');
  const CHIPS = ['Ringkasan hari ini', 'Red alert', 'Standby semua depoh', 'Kes kritikal', 'Beban bengkel panel', 'Cadangan pindah standby', 'Apa boleh awak buat?'];
  $('#arcChips').innerHTML = CHIPS.map(c => `<button type="button" class="arc-chip">${c}</button>`).join('');

  function renderAvatar() {
    const img = pref('avatar');
    $('#arcAvatar').innerHTML = img ? `${RING}<img src="${img}" alt="">` : CORE;
  }
  renderAvatar();

  // ---------- Suara ----------
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices();
    const sel = $('#arcVoiceSel');
    const pick = pref('voice');
    const ranked = [...voices].sort((a, b) => score(b) - score(a));
    sel.innerHTML = ranked.map(v => `<option value="${esc(v.name)}" ${v.name === pick ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('') || '<option>Tiada suara</option>';
  }
  const score = v => (/^ms/i.test(v.lang) ? 30 : /^id/i.test(v.lang) ? 20 : /^en-GB/i.test(v.lang) ? 5 : 0) + (/male|lelaki|daniel|george|ryan/i.test(v.name) ? 2 : 0);
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
  const voiceOn = () => pref('mute') !== '1' && !!synth;
  function setVoiceBtn() { $('#arcVoice').classList.toggle('off', !voiceOn()); $('#arcVoice').textContent = voiceOn() ? '🔊' : '🔇'; }
  setVoiceBtn();

  function speak(text) {
    if (!voiceOn() || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find(x => x.name === pref('voice')) || [...voices].sort((a, b) => score(b) - score(a))[0];
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ms-MY';
    u.rate = 1.02; u.pitch = .92;
    u.onstart = () => panel.classList.add('arc-speaking');
    u.onend = u.onerror = () => panel.classList.remove('arc-speaking');
    synth.speak(u);
  }
  const plain = html => {
    const d = document.createElement('div'); d.innerHTML = html.replace(/<\/(li|tr|p|div)>/g, '. ').replace(/<br\s*\/?>/g, '. ');
    let t = d.textContent.replace(/\s+/g, ' ').replace(/(\. ){2,}/g, '. ').trim();
    if (t.length > 320) { const cut = t.lastIndexOf('. ', 320); t = t.slice(0, cut > 120 ? cut + 1 : 320); }
    return t;
  };

  // ---------- Pengecaman suara ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  if (!SR) $('#arcMic').style.display = 'none';
  $('#arcMic').onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'ms-MY'; rec.interimResults = true;
    $('#arcMic').classList.add('live'); setStatus('Mendengar…');
    rec.onresult = e => { input.value = [...e.results].map(r => r[0].transcript).join(''); if (e.results[e.results.length - 1].isFinal) send(input.value); };
    rec.onerror = e => { if (e.error === 'not-allowed') addMsg('sys', 'AKSES MIKROFON DITOLAK OLEH BROWSER'); };
    rec.onend = () => { rec = null; $('#arcMic').classList.remove('live'); setStatus(); };
    rec.start();
  };

  // ---------- UI ----------
  const aiOn = () => AI_ENABLED && pref('ai') !== '0';
  const setStatus = s => { $('#arcStatus').textContent = s || `${aiOn() ? 'AI Claude' : 'Mod asas'} · data ${latest() ? fmt(latest().date) : '-'}`; };
  function addMsg(who, html) {
    const el = document.createElement('div');
    el.className = 'arc-msg ' + who;
    el.innerHTML = html;
    log.appendChild(el); log.scrollTop = log.scrollHeight;
    return el;
  }
  let booted = false;
  async function open() {
    panel.classList.add('open');
    setStatus();
    if (!booted) { booted = true; await boot(); }
    input.focus();
  }
  function close() { panel.classList.remove('open'); synth && synth.cancel(); }
  $('#arcFab').onclick = () => panel.classList.contains('open') ? close() : open();
  $('#arcClose').onclick = close;
  $('#arcGear').onclick = () => {
    $('#arcSet').classList.toggle('open'); $('#arcAddr').value = pref('addr') || '';
    $('#arcAi').checked = aiOn(); $('#arcAi').disabled = !AI_ENABLED;
    $('#arcAiNote').textContent = AI_ENABLED
      ? 'Soalan dan data laporan semasa dihantar ke Claude (Anthropic) melalui pelayan Apps Script. Matikan untuk guna jawapan asas sahaja.'
      : 'AI tidak tersedia: sistem perlu dipasang di Google Apps Script dengan ANTHROPIC_API_KEY. Kini guna jawapan asas.';
  };
  $('#arcAi').onchange = e => { setPref('ai', e.target.checked ? null : '0'); setStatus(); };
  $('#arcAddr').onchange = e => setPref('addr', e.target.value.trim());
  $('#arcVoiceSel').onchange = e => setPref('voice', e.target.value);
  $('#arcVoice').onclick = () => { setPref('mute', voiceOn() ? '1' : null); if (!voiceOn()) synth && synth.cancel(); setVoiceBtn(); };
  $('#arcImg').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { // kecilkan ke 160px supaya muat dalam storan browser
      const im = new Image();
      im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 160; const s = Math.min(im.width, im.height);
        c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 160, 160);
        setPref('avatar', c.toDataURL('image/jpeg', .85)); renderAvatar(); };
      im.src = r.result;
    };
    r.readAsDataURL(f);
  };
  $('#arcImgClr').onclick = () => { setPref('avatar', null); renderAvatar(); };
  $('#arcChips').onclick = e => { if (e.target.classList.contains('arc-chip')) send(e.target.textContent); };
  $('#arcForm').onsubmit = e => { e.preventDefault(); send(input.value); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('open')) close(); });

  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function boot() {
    const rep = latest();
    const lines = ['MEMULAKAN A.R.C. v1.0 …', 'MENYAMBUNG KE PANGKALAN DATA FLEET … OK',
      rep ? `MENGANALISIS ${rep.rows.length} REKOD PEMBAIKAN · ${S.depots.length} DEPOH … OK` : 'TIADA LAPORAN DIJUMPAI'];
    for (const l of lines) { addMsg('sys', '› ' + l); await wait(380); }
    reply(greeting());
  }

  let busyReply = false;
  async function send(text) {
    text = (text || '').trim();
    if (!text || busyReply) return;
    input.value = '';
    addMsg('user', esc(text));
    busyReply = true;
    panel.classList.add('arc-thinking'); setStatus('Menganalisis…');
    const t = addMsg('bot', '<span class="arc-typing"><span></span><span></span><span></span></span>');
    let ans;
    // Arahan navigasi sentiasa dijalankan secara tempatan (ia mengawal skrin)
    if (aiOn() && !NAV_RE.test(low(text))) {
      try {
        const res = await Store.askArc({ question: text, context: buildContext(), history: aiHistory.slice(-12), addr: pref('addr') || '', user: userName() });
        ans = md(res.text);
        aiHistory.push({ role: 'user', text }, { role: 'assistant', text: res.text });
      } catch (e) {
        console.warn('AI gagal', e);
        try { ans = answer(text); } catch (e2) { ans = `Maaf${addr()}, berlaku ralat: ${esc(e2.message)}`; }
        ans += `<div style="font-size:11px;color:#94a3b8;margin-top:6px">⚠ AI tidak tersedia (${esc(e.message)}). Jawapan dari enjin asas.</div>`;
      }
    } else {
      await wait(350 + Math.random() * 350);
      try { ans = answer(text); } catch (e) { console.error(e); ans = `Maaf${addr()}, berlaku ralat semasa menganalisis: ${esc(e.message)}`; }
    }
    t.remove();
    panel.classList.remove('arc-thinking'); setStatus();
    busyReply = false;
    reply(ans);
  }
  function reply(html) { addMsg('bot', html); speak(plain(html)); }

  // ---------- AI: konteks & paparan ----------
  const aiHistory = [];

  // Teks AI dipaparkan selamat: escape dahulu, kemudian hanya **tebal** dan senarai "- "
  function md(text) {
    const lines = esc(String(text || '')).split(/\r?\n/);
    let html = '', inList = false;
    lines.forEach(l => {
      const m = l.match(/^\s*[-•*]\s+(.*)$/);
      if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; return; }
      if (inList) { html += '</ul>'; inList = false; }
      html += l.trim() ? `${l}<br>` : '<br>';
    });
    if (inList) html += '</ul>';
    return html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(<br>)+$/, '').replace(/^(<br>)+/, '');
  }

  function buildContext() {
    const r = rep();
    if (!r) return 'Tiada laporan harian dalam sistem.';
    const sm = summarize(r), prev = REPORTS[REPORTS.length - 2];
    const act = active(r);
    const L = [];
    L.push(`Tarikh hari ini: ${fmt(todayISO())}. Laporan terkini: ${fmt(r.date)} (disimpan oleh ${r.savedBy || '-'}). Laporan dalam sistem: ${REPORTS.length}${prev ? `, sebelum ini ${fmt(prev.date)}` : ''}.`);
    L.push(`Peraturan: kes kritikal jika di bengkel > ${S.kritikalHari} hari; eskalasi panel luar > ${S.eskalasiHari} hari; depoh lebihan jika standby >= ${S.lebihanStandby}; 0 standby = RED ALERT; kadar LAD RM${+S.kadarLAD || 0}/hari${+S.kadarLAD ? '' : ' (belum ditetapkan)'}. Jumlah armada MBSP ${S.fleetTotal} unit.`);
    L.push(`Bengkel dalaman: ${S.panels.filter(p => p.dalaman).map(p => p.name).join(', ')}. Panel luar: ${S.panels.filter(p => !p.dalaman).map(p => p.name).join(', ')}.`);
    L.push('', `RINGKASAN KOMPAKTOR (Jab. Perbandaran, laporan ${fmt(r.date)}): jumlah ${sm.tot.jum}, beroperasi ${sm.tot.operasi}, standby ${sm.tot.standby}, rosak ${sm.tot.rosak}.`);
    L.push('Ikut depoh — depoh | jumlah | rosak | standby | beroperasi:');
    sm.depot.forEach(d => L.push(`${d.name} | ${d.jum} | ${d.rosak} | ${d.standby} | ${d.operasi}`));
    L.push(`Jab. Perbandaran dalam pembaikan ikut jenis: ${['COMPACT', 'RORO', 'TIPPER', 'OPEN TRUCK', 'LAIN-LAIN'].map(j => `${j} ${sm.jenis[j]}`).join(', ')}; siap ${sm.jenis.SIAP}; jumlah ${sm.jenis.JUMLAH}.`);
    L.push(`Tempoh pembaikan (Jab. Perbandaran, belum siap): ≤3 hari ${sm.tem.le3}, 4-7 hari ${sm.tem.m47}, ≥8 hari ${sm.tem.ge8}.`);
    L.push(`Kompaktor rosak ikut panel: ${Object.entries(sm.panel).map(([p, n]) => `${p} ${n}`).join(', ')}.`);
    L.push(`Semua kenderaan (semua jabatan) masih dalam pembaikan: ${act.length}; kritikal: ${act.filter(x => hb(x, r) > S.kritikalHari).length}.`);
    const al = alertsFor(r);
    L.push('', 'AMARAN:', ...(al.length ? al.map(a => `- [${a.lvl === 'red' ? 'MERAH' : 'KUNING'}] ${a.text}`) : ['- tiada']));
    const sug = transferSuggestions(r);
    L.push('CADANGAN PINDAH STANDBY (dijana sistem, perlu kelulusan):', ...(sug.length ? sug.map(s => `- ${s.qty} unit ${s.from} -> ${s.to} (${s.km} km, ${s.reason})`) : ['- tiada']));
    const dec = TRANSFERS.filter(d => d.date === r.date);
    if (dec.length) L.push('Keputusan pindah yang telah dibuat:', ...dec.map(d => `- ${d.qty} unit ${d.from} -> ${d.to}: ${d.ok ? 'DILULUSKAN' : 'DITOLAK'} oleh ${d.user}`));
    L.push('', `SENARAI KENDERAAN DALAM LAPORAN ${fmt(r.date)} — no plat | jenis | jabatan/depoh | panel | tarikh masuk | jangkaan siap | tarikh siap | hari di bengkel | status | kerosakan:`);
    sortRows(r.rows).forEach(x => {
      const lewat = !isSiap(x) && x.jangkaan && r.date > x.jangkaan ? `, lewat ${days(x.jangkaan, r.date)} hari` : '';
      L.push(`${x.plat} | ${x.jenis} | ${x.depo} | ${x.panel || '-'} | ${fmt(x.masuk)} | ${fmt(x.jangkaan) || '-'} | ${fmt(x.siap) || '-'} | ${hb(x, r) ?? '-'} | ${isSiap(x) ? 'SIAP' : 'DALAM PEMBAIKAN' + lewat} | ${x.kerosakan}`);
    });
    L.push('BREAKDOWN:', ...((r.breakdown || []).length ? r.breakdown.map(b => `- ${b.plat} ${b.jenis} ${b.depo}: ${b.kerosakan}`) : ['- tiada']));
    L.push('LORI SEWA:', ...((r.sewa || []).length ? r.sewa.map(s => `- ${s.plat} ${s.depo} ${fmt(s.tarikh)}`) : ['- tiada']));
    if (prev) {
      const sp = summarize(prev);
      L.push('', `PERBANDINGAN ${fmt(prev.date)} -> ${fmt(r.date)}: kompaktor rosak ${sp.tot.rosak} -> ${sm.tot.rosak}; standby ${sp.tot.standby} -> ${sm.tot.standby}; dalam pembaikan ${active(prev).length} -> ${act.length}.`);
    }
    const byPlat = {};
    allCases().forEach(c => { byPlat[c.plat] = (byPlat[c.plat] || 0) + 1; });
    const again = Object.entries(byPlat).filter(([, n]) => n > 1);
    L.push('', `SEJARAH (${REPORTS.length} laporan dimuatkan): ${allCases().length} kes unik. Kenderaan masuk bengkel berulang: ${again.length ? again.map(([p, n]) => `${p} (${n}x)`).join(', ') : 'tiada'}.`);
    return L.join('\n');
  }

  // ---------- Otak: pemahaman soalan ----------
  const addr = () => { const a = pref('addr'); return a ? ', ' + esc(a) : ''; };
  const low = s => String(s || '').toLowerCase();
  const NAV_RE = /\b(buka|pergi|tunjuk|tunjukkan|papar|paparkan|open|show)\b.*\b(peta|map|dashboard|papan pemuka|laporan harian|isi laporan|borang|ringkasan|cetak|analisis|penalti|sejarah|data|audit|tetapan)\b/;
  const sapa = () => { const h = new Date().getHours(); return h < 12 ? 'Selamat pagi' : h < 14 ? 'Selamat tengah hari' : h < 19 ? 'Selamat petang' : 'Selamat malam'; };
  const rep = () => latest();
  const active = r => r.rows.filter(x => !isSiap(x));
  const hb = (x, r) => hariBengkel(x, r.date);
  const plate = x => `<b>${esc(x.plat)}</b>`;

  function aliasMap(names) {
    const first = {};
    names.forEach(n => { const w = n.split(' ')[0]; first[w] = (first[w] || 0) + 1; });
    return names.map(n => ({ name: n, keys: [low(n), ...(first[n.split(' ')[0]] === 1 && n.includes(' ') ? [low(n.split(' ')[0])] : []), ...(n === 'AF MUTIARA' ? ['mutiara'] : [])] }));
  }
  function findIn(text, names) {
    let best = null, len = 0;
    aliasMap(names).forEach(a => a.keys.forEach(k => { if (new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text) && k.length > len) { best = a.name; len = k.length; } }));
    return best;
  }
  const JENIS_ALIAS = [[/kompaktor|compactor|compact/, 'COMPACT'], [/\broro\b/, 'RORO'], [/tipper/, 'TIPPER'], [/open truck|lori terbuka/, 'OPEN TRUCK'],
    [/backhoe/, 'BACKHOE'], [/sweeper|penyapu/, 'ROAD SWEEPER'], [/skylift/, 'SKYLIFT'], [/crew cab/, 'CREW CAB'], [/\bkren\b|crane/, 'KREN']];
  const jenisIn = t => (JENIS_ALIAS.find(([re]) => re.test(t)) || [])[1];
  function plateIn(raw) {
    const t = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const all = new Set(); REPORTS.forEach(r => r.rows.forEach(x => all.add(x.plat))); (rep()?.breakdown || []).forEach(x => all.add(x.plat));
    return [...all].sort((a, b) => b.length - a.length).find(p => t.includes(p.replace(/\s/g, '')));
  }

  function answer(q) {
    const t = low(q).replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
    const r = rep();
    if (/^(hai|hi|helo|hello|hey|assalamualaikum|salam|selamat (pagi|petang|malam|tengah hari))\b/.test(t)) return greeting();
    if (/terima kasih|thanks|thank you|tq\b/.test(t)) return `Sama-sama${addr()}. Sentiasa bersedia.`;
    if (/siapa (kamu|awak|anda)|who are you|nama (kamu|awak)/.test(t)) return `Saya <b>${BOT}</b> — Asisten Respons Command Center. Saya memantau laporan pembaikan, standby depoh dan prestasi bengkel panel MBSP, dan menjawab berdasarkan data laporan harian yang disimpan.`;
    if (/tolong|bantuan|help|boleh buat apa|apa (yang )?(boleh|awak boleh)/.test(t)) return help();
    if (/pukul berapa|jam berapa|masa sekarang/.test(t)) return `Sekarang pukul <b>${new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' })}</b>${addr()}.`;
    if (/tarikh (hari ini|sekarang)|hari ini (hari|tarikh) apa/.test(t)) return `Hari ini ${new Date().toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;

    const nav = t.match(NAV_RE);
    if (nav) {
      const tab = { peta: 'dashboard', map: 'dashboard', dashboard: 'dashboard', 'papan pemuka': 'dashboard', 'laporan harian': 'harian', 'isi laporan': 'harian', borang: 'harian', ringkasan: 'ringkasan', cetak: 'ringkasan', analisis: 'analisis', penalti: 'analisis', sejarah: 'data', data: 'data', audit: 'data', tetapan: 'tetapan' }[nav[2]];
      showTab(tab);
      if (nav[2] === 'peta' || nav[2] === 'map') setTimeout(() => $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
      return `Baik${addr()}. Membuka <b>${nav[2]}</b>.`;
    }
    if (!r) return `Belum ada laporan harian dalam sistem${addr()}. Sila isi laporan pertama di tab Isi Laporan Harian.`;

    const p = plateIn(q);
    if (p) return plateInfo(p);
    const depot = findIn(t, depotNames());
    const panel = findIn(t, S.panels.map(x => x.name));
    const jenis = jenisIn(t);

    if (/red alert|amaran|alert|bahaya|kecemasan|krisis/.test(t)) return alerts();
    if (/pindah|transfer|mobiliti|agih|pinjam/.test(t)) return transfers();
    if (/penalti|\blad\b|denda|potongan/.test(t)) return penalty();
    if (/trend|banding|perbandingan|semalam|minggu|naik|turun/.test(t)) return trend();
    if (/kronik|berulang|kerap|selalu rosak/.test(t)) return chronic();
    if (panel || /\b(panel|bengkel|workshop)\b/.test(t)) return panel ? panelInfo(panel) : panelAll();
    if (depot) return depotInfo(depot);
    if (/kritikal|lewat|lama|tertunggak|delay|melebihi|paling lama/.test(t)) return critical();
    if (/standby|ganti|simpanan|spare/.test(t)) return standbyAll();
    if (/siap|selesai|complete|jangka|due/.test(t)) return siap();
    if (jenis) return jenisInfo(jenis);
    if (/rosak|breakdown|kerosakan|dalam pembaikan|berapa/.test(t)) return rosakAll();
    if (/ringkasan|summary|status|keadaan|laporan|hari ini|situasi|update|terkini/.test(t)) return summary();
    return `Maaf${addr()}, saya belum faham soalan itu. Cuba tanya seperti:<ul><li>"Standby Kepala Batas"</li><li>"Status PLP 4547"</li><li>"Kes kritikal"</li><li>"Beban FIXA AUTO"</li><li>"Buka peta"</li></ul>`;
  }

  // ---------- Jawapan ----------
  function greeting() {
    const r = rep();
    if (!r) return `${sapa()}${addr()}. ${BOT} dalam talian. Belum ada laporan harian untuk dianalisis.`;
    const sm = summarize(r), al = alertsFor(r).filter(a => a.lvl === 'red');
    return `${sapa()}${addr()}. ${BOT} dalam talian.<br>Laporan terkini <b>${fmt(r.date)}</b>: ${sm.tot.operasi} kompaktor beroperasi, ${sm.tot.standby} standby, <span class="red">${sm.tot.rosak} rosak</span>.` +
      (al.length ? ` Terdapat <span class="red">${al.length} red alert</span> yang memerlukan perhatian — tanya "red alert" untuk butiran.` : ' <span class="ok">Tiada red alert.</span>');
  }

  function help() {
    return `Saya boleh bantu${addr()}:<ul>
      <li><b>Ringkasan</b> — "ringkasan hari ini"</li><li><b>Red alert</b> — "ada amaran?"</li>
      <li><b>Depoh</b> — "standby Kepala Batas", "Jawi"</li><li><b>Kenderaan</b> — "status PLP 4547"</li>
      <li><b>Kes kritikal</b> — "kes paling lama"</li><li><b>Bengkel panel</b> — "beban FIXA AUTO", "bengkel"</li>
      <li><b>Penalti LAD</b>, <b>pindah standby</b>, <b>trend</b>, <b>kerosakan kronik</b></li>
      <li><b>Jenis</b> — "berapa RORO rosak"</li><li><b>Navigasi</b> — "buka peta", "buka laporan harian"</li></ul>
      Tekan 🎙 untuk bercakap (jika browser menyokong).`;
  }

  function summary() {
    const r = rep(), sm = summarize(r), act = active(r);
    const krit = act.filter(x => hb(x, r) > S.kritikalHari).length;
    return `Status armada${addr()}, laporan <b>${fmt(r.date)}</b>:<table>
      <tr><td>Kompaktor beroperasi</td><td><b>${sm.tot.operasi}</b> / ${sm.tot.jum}</td></tr>
      <tr><td>Kompaktor standby</td><td><b>${sm.tot.standby}</b></td></tr>
      <tr><td>Kompaktor rosak</td><td><span class="red">${sm.tot.rosak}</span></td></tr>
      <tr><td>Semua kenderaan dalam pembaikan</td><td><b>${act.length}</b></td></tr>
      <tr><td>Kes kritikal (&gt; ${S.kritikalHari} hari)</td><td><span class="${krit ? 'red' : 'ok'}">${krit}</span></td></tr>
      <tr><td>Siap dalam laporan ini</td><td><span class="ok">${r.rows.length - act.length}</span></td></tr></table>`;
  }

  function alerts() {
    const al = alertsFor(rep());
    if (!al.length) return `<span class="ok">Semua sistem normal${addr()}.</span> Tiada red alert dalam laporan ${fmt(rep().date)}.`;
    return `Saya kesan <b>${al.length}</b> amaran${addr()}:<ul>${al.map(a => `<li class="${a.lvl === 'red' ? 'red' : ''}">${esc(a.text)}</li>`).join('')}</ul>`;
  }

  function depotInfo(name) {
    const r = rep(), d = summarize(r).depot.find(x => x.name === name);
    const list = active(r).filter(x => norm(x.depo) === name).sort((a, b) => hb(b, r) - hb(a, r));
    const status = d.standby === 0 ? `<span class="red">RED ALERT — tiada unit standby.</span>` : d.rosak > d.standby ? `<span class="red">Defisit: rosak melebihi standby.</span>` : d.standby >= S.lebihanStandby ? `<span class="ok">Lebihan standby — boleh membantu depoh lain.</span>` : `<span class="ok">Normal.</span>`;
    return `Depoh <b>${name}</b>: ${status}<table>
      <tr><td>Jumlah kompaktor</td><td>${d.jum}</td></tr><tr><td>Beroperasi</td><td>${d.operasi}</td></tr>
      <tr><td>Standby</td><td><b>${d.standby}</b></td></tr><tr><td>Kompaktor rosak</td><td>${d.rosak}</td></tr></table>` +
      (list.length ? `Kenderaan dalam pembaikan (${list.length}):<ul>${list.slice(0, 8).map(x => `<li>${plate(x)} ${esc(x.jenis)} — ${esc(x.panel || '-')}, ${hb(x, r)} hari</li>`).join('')}${list.length > 8 ? `<li>…dan ${list.length - 8} lagi</li>` : ''}</ul>` : '');
  }

  function standbyAll() {
    const sm = summarize(rep());
    return `Standby kompaktor setiap depoh (${fmt(rep().date)}), jumlah <b>${sm.tot.standby}</b>:<table><tr><th>Depoh</th><th>Standby</th><th>Rosak</th></tr>${sm.depot.map(d =>
      `<tr><td>${d.name}</td><td class="${d.standby === 0 ? 'red' : d.standby >= S.lebihanStandby ? 'ok' : ''}">${d.standby}</td><td>${d.rosak}</td></tr>`).join('')}</table>`;
  }

  function rosakAll() {
    const r = rep(), sm = summarize(r), act = active(r);
    const byJ = {}; act.forEach(x => { byJ[x.jenis] = (byJ[x.jenis] || 0) + 1; });
    return `<b>${act.length}</b> kenderaan masih dalam pembaikan${addr()}, termasuk <span class="red">${sm.tot.rosak} kompaktor</span> Jabatan Perbandaran.<ul>${Object.entries(byJ).sort((a, b) => b[1] - a[1]).map(([j, n]) => `<li>${esc(j)}: ${n}</li>`).join('')}</ul>`;
  }

  function jenisInfo(j) {
    const r = rep(), list = active(r).filter(x => norm(x.jenis) === j).sort((a, b) => hb(b, r) - hb(a, r));
    if (!list.length) return `<span class="ok">Tiada ${j} dalam pembaikan</span> dalam laporan ${fmt(r.date)}.`;
    return `<b>${list.length}</b> ${j} dalam pembaikan:<ul>${list.slice(0, 10).map(x => `<li>${plate(x)} ${esc(x.depo)} — ${esc(x.panel || '-')}, ${hb(x, r)} hari</li>`).join('')}${list.length > 10 ? `<li>…dan ${list.length - 10} lagi</li>` : ''}</ul>`;
  }

  function critical() {
    const r = rep(), list = active(r).filter(x => hb(x, r) > S.kritikalHari).sort((a, b) => hb(b, r) - hb(a, r));
    if (!list.length) return `<span class="ok">Tiada kes melebihi ${S.kritikalHari} hari${addr()}.</span>`;
    return `<b>${list.length}</b> kes kritikal (&gt; ${S.kritikalHari} hari di bengkel). Paling lama:<ul>${list.slice(0, 8).map(x => {
      const lewat = x.jangkaan && r.date > x.jangkaan ? days(x.jangkaan, r.date) : 0;
      return `<li>${plate(x)} ${esc(x.jenis)}, ${esc(x.depo)} — ${esc(x.panel || '-')}: <span class="red">${hb(x, r)} hari</span>${lewat ? `, lewat ${lewat} hari dari jangkaan` : ''}</li>`;
    }).join('')}</ul>`;
  }

  function plateInfo(p) {
    const r = rep(), x = r.rows.find(y => y.plat === p);
    const hist = allCases().filter(c => c.plat === p);
    if (!x) {
      const b = (r.breakdown || []).find(y => y.plat === p);
      if (b) return `${plate(b)} disenaraikan sebagai <span class="red">BREAKDOWN</span> di ${esc(b.depo)}: ${esc(b.kerosakan)}.`;
      const last = hist.sort((a, b2) => (b2.lastSeen || '').localeCompare(a.lastSeen || ''))[0];
      return last ? `${plate({ plat: p })} tiada dalam laporan ${fmt(r.date)}. Rekod terakhir: masuk ${fmt(last.masuk)} di ${esc(last.panel || '-')}${last.siap ? `, <span class="ok">siap ${fmt(last.siap)}</span>` : ''}.` : `Tiada rekod untuk ${esc(p)}.`;
    }
    const lewat = !isSiap(x) && x.jangkaan && r.date > x.jangkaan ? days(x.jangkaan, r.date) : 0;
    return `${plate(x)} — ${esc(x.jenis)}, ${esc(x.depo)}<table>
      <tr><td>Status</td><td>${isSiap(x) ? `<span class="ok">SIAP ${fmt(x.siap)}</span>` : `<span class="red">DALAM PEMBAIKAN</span>`}</td></tr>
      <tr><td>Panel</td><td>${esc(x.panel || '-')}</td></tr><tr><td>Tarikh masuk</td><td>${fmt(x.masuk)}</td></tr>
      <tr><td>Jangkaan siap</td><td>${fmt(x.jangkaan) || '-'}${lewat ? ` <span class="red">(lewat ${lewat} hari)</span>` : ''}</td></tr>
      <tr><td>Hari di bengkel</td><td><b>${hb(x, r)}</b></td></tr></table>Kerosakan: ${esc(x.kerosakan)}` +
      (hist.length > 1 ? `<br>Kenderaan ini telah masuk bengkel <b>${hist.length} kali</b> dalam rekod.` : '');
  }

  function panelStats(r) {
    const st = {};
    active(r).forEach(x => { const p = norm(x.panel) || '(TIADA)'; st[p] = st[p] || { n: 0, krit: 0, sum: 0, max: 0 }; const h = hb(x, r); st[p].n++; st[p].sum += h; st[p].max = Math.max(st[p].max, h); if (h > S.kritikalHari) st[p].krit++; });
    return st;
  }
  function panelAll() {
    const r = rep(), st = panelStats(r);
    return `Beban bengkel panel (${fmt(r.date)}):<table><tr><th>Panel</th><th>Unit</th><th>Kritikal</th><th>Purata hari</th></tr>${Object.entries(st).sort((a, b) => b[1].n - a[1].n).map(([p, s]) =>
      `<tr><td>${esc(p)}</td><td>${s.n}</td><td class="${s.krit ? 'red' : ''}">${s.krit}</td><td>${(s.sum / s.n).toFixed(0)}</td></tr>`).join('')}</table>`;
  }
  function panelInfo(p) {
    const r = rep(), s = panelStats(r)[p];
    if (!s) return `<span class="ok">${esc(p)} tiada kenderaan dalam pembaikan</span> dalam laporan ${fmt(r.date)}.`;
    const list = active(r).filter(x => norm(x.panel) === p).sort((a, b) => hb(b, r) - hb(a, r));
    return `<b>${esc(p)}</b> ${isDalaman(p) ? '(bengkel dalaman)' : '(panel luar)'} sedang membaiki <b>${s.n}</b> kenderaan, ${s.krit ? `<span class="red">${s.krit} kritikal</span>` : 'tiada kritikal'}, purata ${(s.sum / s.n).toFixed(0)} hari.<ul>${list.slice(0, 8).map(x => `<li>${plate(x)} ${esc(x.jenis)}, ${esc(x.depo)} — ${hb(x, r)} hari</li>`).join('')}</ul>`;
  }

  function penalty() {
    const r = rep(), list = active(r).filter(x => x.panel && !isDalaman(x.panel) && hb(x, r) > S.kritikalHari).sort((a, b) => hb(b, r) - hb(a, r));
    if (!list.length) return `<span class="ok">Tiada kes panel luar melebihi ${S.kritikalHari} hari.</span>`;
    const over = list.reduce((a, x) => a + hb(x, r) - S.kritikalHari, 0);
    return `<b>${list.length}</b> kes panel luar melebihi SLA ${S.kritikalHari} hari, jumlah <span class="red">${over} hari</span> melebihi SLA.` +
      (+S.kadarLAD ? ` Anggaran LAD: <b>RM ${(over * S.kadarLAD).toLocaleString('ms-MY')}</b>.` : ' Kadar LAD belum ditetapkan di tab Tetapan.') +
      `<ul>${list.slice(0, 6).map(x => `<li>${esc(x.panel)} — ${plate(x)}: ${hb(x, r)} hari</li>`).join('')}</ul>Keputusan penalti di bawah kuasa Pengarah Kejuruteraan / Jabatan Kewangan.`;
  }

  function transfers() {
    const sug = transferSuggestions(rep());
    if (!sug.length) return `<span class="ok">Tiada depoh defisit${addr()}.</span> Tiada pemindahan diperlukan.`;
    return `Cadangan mobiliti silang:<ul>${sug.map(s => `<li><b>${s.qty}</b> unit dari ${s.from} → <span class="red">${s.to}</span> (${s.km} km, ${esc(s.reason)})</li>`).join('')}</ul>Kelulusan oleh Pengurus Fleet di Dashboard.`;
  }

  function trend() {
    if (REPORTS.length < 2) return `Saya perlukan sekurang-kurangnya dua laporan untuk membuat perbandingan${addr()}. Kini hanya ada ${REPORTS.length}.`;
    const [a, b] = REPORTS.slice(-2), sa = summarize(a), sb = summarize(b);
    const ka = active(a).filter(x => hb(x, a) > S.kritikalHari).length, kb = active(b).filter(x => hb(x, b) > S.kritikalHari).length;
    const d = (x, y, goodDown) => { const v = y - x; if (!v) return '<span>±0</span>'; const good = goodDown ? v < 0 : v > 0; return `<span class="${good ? 'ok' : 'red'}">${v > 0 ? '▲ +' : '▼ '}${v}</span>`; };
    return `Perbandingan ${fmt(a.date)} → <b>${fmt(b.date)}</b>:<table><tr><th></th><th>${fmt(a.date)}</th><th>${fmt(b.date)}</th><th></th></tr>
      <tr><td>Kompaktor rosak</td><td>${sa.tot.rosak}</td><td>${sb.tot.rosak}</td><td>${d(sa.tot.rosak, sb.tot.rosak, true)}</td></tr>
      <tr><td>Standby</td><td>${sa.tot.standby}</td><td>${sb.tot.standby}</td><td>${d(sa.tot.standby, sb.tot.standby, false)}</td></tr>
      <tr><td>Dalam pembaikan</td><td>${active(a).length}</td><td>${active(b).length}</td><td>${d(active(a).length, active(b).length, true)}</td></tr>
      <tr><td>Kes kritikal</td><td>${ka}</td><td>${kb}</td><td>${d(ka, kb, true)}</td></tr></table>`;
  }

  function siap() {
    const r = rep(), done = r.rows.filter(isSiap), act = active(r);
    const due = act.filter(x => x.jangkaan === r.date), over = act.filter(x => x.jangkaan && x.jangkaan < r.date);
    return `Dalam laporan ${fmt(r.date)}: <span class="ok">${done.length} siap</span>${done.length ? ' (' + done.map(x => esc(x.plat)).join(', ') + ')' : ''}.` +
      `<br>Dijangka siap hari laporan: <b>${due.length}</b>${due.length ? ' — ' + due.map(x => esc(x.plat)).join(', ') : ''}.` +
      `<br>Sudah melepasi tarikh jangkaan: <span class="${over.length ? 'red' : 'ok'}">${over.length}</span>.`;
  }

  function chronic() {
    const KEYS = ['PTO', 'CYLINDER', 'HOSE', 'BRAKE', 'BELTING', 'CLUTCH', 'GEAR BOX', 'POWER STEERING', 'CHASIS', 'REPUT', 'BINLIFT', 'CONTROL VALVE', 'ENGINE', 'PACKER', 'EJECTOR', 'CARRIER'];
    const c = {}; allCases().forEach(x => KEYS.forEach(k => { if (norm(x.kerosakan).includes(k)) c[k] = (c[k] || 0) + 1; }));
    const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const rpt = {}; allCases().forEach(x => { rpt[x.plat] = (rpt[x.plat] || 0) + 1; });
    const again = Object.entries(rpt).filter(([, n]) => n > 1);
    return `Komponen paling kerap rosak:<ul>${top.map(([k, n]) => `<li><b>${k}</b> — ${n} kes</li>`).join('')}</ul>` +
      (again.length ? `Kenderaan berulang: ${again.map(([p, n]) => `${esc(p)} (${n}x)`).join(', ')}.` : 'Belum ada kenderaan berulang — lebih banyak data sejarah diperlukan.');
  }

  window.ARC = { open, send, answer };
})();
