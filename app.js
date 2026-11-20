/* ============================================================
   DompetKu – Aplikasi (frontend)
   Vanilla JS, tanpa library eksternal.
   ============================================================ */
'use strict';
(() => {
  const VERSION = '1.1.0';
  const LS = { cfg: 'dk_cfg', cache: 'dk_cache', queue: 'dk_queue', demo: 'dk_demo', cats: 'dk_custom_cats', installHide: 'dk_install_hide', startDay: 'dk_start_day' };
  // Warna kategori (urutan tetap, divalidasi untuk buta warna). Kategori ke-9 dst. → abu-abu "Lainnya".
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const OTHER_COLOR = '#aab3c5';
  const C_INC = '#1baf7a';
  const C_EXP = '#e34948';
  const PAGE_SIZE = 60;

  /* ---------------- Utilitas ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* penuh */ } };
  const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  const rp = (n) => (n < 0 ? '−' : '') + 'Rp ' + nf.format(Math.abs(Math.round(n || 0)));
  const rpShort = (n) => {
    const a = Math.abs(n), sign = n < 0 ? '−' : '';
    const f = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');
    if (a >= 1e9) return sign + f(a / 1e9) + ' M';
    if (a >= 1e6) return sign + f(a / 1e6) + ' jt';
    if (a >= 1e3) return sign + Math.round(a / 1e3) + ' rb';
    return sign + Math.round(a);
  };
  const pct = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',') + '%';

  const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
  const fmtDate = (s) => { const d = parseYmd(s); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); };
  const fmtShort = (s) => { const d = parseYmd(s); return d.getDate() + ' ' + MON[d.getMonth()]; };
  const fmtDay = (s) => {
    const t = today();
    if (s === t) return 'Hari ini';
    if (s === addDays(t, -1)) return 'Kemarin';
    return DAYS[parseYmd(s).getDay()] + ', ' + fmtDate(s);
  };
  const initials = (s) => (String(s || '?').trim().match(/[A-Za-z0-9]/g) || ['?']).slice(0, 2).join('').toUpperCase();
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  /* ---------------- State ---------------- */
  const S = {
    cfg: load(LS.cfg, { url: '', token: '', demo: false }),
    tx: [],
    categories: { income: [], expense: [] },
    accounts: [],
    meta: null,
    view: 'home',
    period: { key: 'month' },
    catType: 'expense',
    hist: { q: '', type: 'all', cat: '', from: '', to: '', limit: PAGE_SIZE },
    queue: load(LS.queue, []),
    syncing: false,
    lastSync: null,
    offline: false,
    hasData: false,
    catColor: {},
    installEvt: null,
    seq: 0,
    startDay: Math.min(28, Math.max(1, Number(load('dk_start_day', 25)) || 25)),
  };
  const isConfigured = () => S.cfg.demo || (S.cfg.url && S.cfg.token);

  /* ---------------- API ---------------- */
  async function api(action, payload = {}) {
    if (S.cfg.demo) return demoApi(action, payload);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      res = await fetch(S.cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ token: S.cfg.token, action }, payload)),
        redirect: 'follow',
        signal: ctrl.signal,
      });
    } catch (e) {
      const err = new Error(navigator.onLine ? 'Tidak bisa terhubung ke server. Coba lagi.' : 'Kamu sedang offline.');
      err.network = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }
    let data;
    try { data = await res.json(); } catch (e) {
      const err = new Error('Respons server tidak terbaca. Pastikan Web App di-deploy dengan akses "Siapa saja".');
      err.network = !res.ok;
      throw err;
    }
    if (!data.ok) { const err = new Error(data.error || 'Terjadi kesalahan.'); err.code = data.code; throw err; }
    S.offline = false;
    return data;
  }

  /* ---------------- Data ---------------- */
  function sortTx(list) {
    return list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b._seq - a._seq));
  }

  function applyData(d, fromCache) {
    S.tx = (d.transactions || []).map((t) => Object.assign({}, t, { _seq: S.seq++ }));
    S.queue.forEach((q) => S.tx.push(Object.assign({}, q.tx, { id: q.tempId, pending: true, _seq: S.seq++ })));
    const custom = load(LS.cats, { income: [], expense: [] });
    S.categories = {
      income: mergeUnique(d.categories && d.categories.income, custom.income),
      expense: mergeUnique(d.categories && d.categories.expense, custom.expense),
    };
    S.accounts = d.accounts || [];
    S.meta = d.meta || null;
    S.hasData = true;
    computeColors();
    if (!fromCache && !S.cfg.demo) {
      save(LS.cache, { transactions: d.transactions, categories: d.categories, accounts: d.accounts, meta: d.meta, at: Date.now() });
    }
  }
  const mergeUnique = (a, b) => Array.from(new Set([].concat(a || [], b || []).filter(Boolean)));

  /** Warna mengikuti kategori (bukan peringkat per periode) agar konsisten di semua grafik. */
  function computeColors() {
    const totals = {};
    S.tx.forEach((t) => { if (t.type === 'expense') totals[t.category] = (totals[t.category] || 0) + t.amount; });
    S.catColor = {};
    Object.keys(totals).sort((a, b) => totals[b] - totals[a]).forEach((c, i) => { S.catColor[c] = i < PALETTE.length ? PALETTE[i] : OTHER_COLOR; });
    const inc = {};
    S.tx.forEach((t) => { if (t.type === 'income') inc[t.category] = (inc[t.category] || 0) + t.amount; });
    S.incColor = {};
    Object.keys(inc).sort((a, b) => inc[b] - inc[a]).forEach((c, i) => { S.incColor[c] = i < PALETTE.length ? PALETTE[i] : OTHER_COLOR; });
  }
  const colorOf = (type, cat) => ((type === 'income' ? S.incColor : S.catColor) || {})[cat] || OTHER_COLOR;

  async function sync(opts = {}) {
    if (!isConfigured() || S.syncing) return;
    S.syncing = true;
    updateSyncStatus();
    try {
      await flushQueue();
      const d = await api('list');
      applyData(d);
      S.lastSync = Date.now();
      if (opts.toast) toast('Data terbaru sudah dimuat', 'success');
    } catch (e) {
      if (e.network) S.offline = true;
      if (e.code === 'AUTH') toast(e.message, 'error', 6000);
      else if (opts.toast || !S.hasData) toast(e.message, e.network ? 'warn' : 'error', 4500);
    } finally {
      S.syncing = false;
      updateSyncStatus();
      refreshView();
    }
  }

  async function flushQueue() {
    if (!S.queue.length) return;
    const items = S.queue.slice();
    let sent = 0;
    for (const q of items) {
      try {
        const r = await api('add', { tx: q.tx });
        S.queue = S.queue.filter((x) => x.tempId !== q.tempId);
        const i = S.tx.findIndex((t) => t.id === q.tempId);
        if (i >= 0) S.tx[i] = Object.assign({}, r.tx, { _seq: S.tx[i]._seq });
        sent++;
      } catch (e) {
        if (e.network) break;
        S.queue = S.queue.filter((x) => x.tempId !== q.tempId);
        S.tx = S.tx.filter((t) => t.id !== q.tempId);
        toast('1 transaksi offline gagal dikirim: ' + e.message, 'error', 5000);
      }
    }
    save(LS.queue, S.queue);
    if (sent) toast(sent + ' transaksi offline berhasil dikirim ke spreadsheet', 'success');
  }

  /* ---------------- Periode & perhitungan ---------------- */
  /* Periode bulanan (siklus gajian): mulai tanggal S.startDay sampai sehari sebelum tanggal itu bulan berikutnya. */
  const isPayCycle = () => S.startDay !== 1;
  function cycleOf(dateStr, shift = 0) {
    const d = parseYmd(dateStr);
    const sd = S.startDay;
    let y = d.getFullYear(), m = d.getMonth();
    if (d.getDate() < sd) m -= 1;
    m += shift;
    const start = new Date(y, m, sd);
    const end = new Date(y, m + 1, sd - 1);
    return { start: ymd(start), end: ymd(end), endMonth: end.getMonth(), endYear: end.getFullYear() };
  }
  const rangeLabel = (a, b) => fmtShort(a) + ' – ' + fmtShort(b);

  function periodRange(p = S.period) {
    const t = today();
    if (p.key === 'today') {
      return { start: t, end: t, label: 'Hari ini', prevLabel: 'kemarin', prev: { start: addDays(t, -1), end: addDays(t, -1) } };
    }
    if (p.key === 'week') {
      const off = (parseYmd(t).getDay() + 6) % 7;
      const s = addDays(t, -off);
      return { start: s, end: t, label: 'Minggu ini', prevLabel: 'minggu lalu', prev: { start: addDays(s, -7), end: addDays(t, -7) } };
    }
    if (p.key === 'custom' && p.start && p.end) {
      const len = diffDays(p.start, p.end) + 1;
      return {
        start: p.start, end: p.end, label: fmtShort(p.start) + ' – ' + fmtShort(p.end), prevLabel: 'periode sebelumnya',
        prev: { start: addDays(p.start, -len), end: addDays(p.start, -1) },
      };
    }
    // Bulan ini / periode gajian (sampai hari ini), dibanding jumlah hari yang sama di periode sebelumnya.
    const cur = cycleOf(t), prv = cycleOf(t, -1);
    const elapsed = diffDays(cur.start, t);
    const prevEnd = addDays(prv.start, elapsed) < prv.end ? addDays(prv.start, elapsed) : prv.end;
    return {
      start: cur.start, end: t, cycleEnd: cur.end,
      label: isPayCycle() ? 'Periode ' + rangeLabel(cur.start, cur.end) : 'Bulan ini',
      prevLabel: isPayCycle() ? 'periode gajian lalu' : 'periode yang sama bulan lalu',
      prev: { start: prv.start, end: prevEnd },
    };
  }
  const inRange = (r) => (t) => t.date >= r.start && t.date <= r.end;
  function summarize(list) {
    let inc = 0, exp = 0;
    list.forEach((t) => { if (t.type === 'income') inc += t.amount; else exp += t.amount; });
    return { inc, exp, net: inc - exp };
  }
  function byCategory(list, type) {
    const m = {};
    list.forEach((t) => { if (t.type === type) m[t.category] = (m[t.category] || 0) + t.amount; });
    return Object.keys(m).map((k) => ({ name: k, amount: m[k] })).sort((a, b) => b.amount - a.amount);
  }
  const change = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
  const daysElapsed = (r) => Math.max(1, diffDays(r.start, r.end < today() ? r.end : today()) + 1);

  function analyze(r = periodRange()) {
    const cur = S.tx.filter(inRange(r));
    const prev = S.tx.filter(inRange(r.prev));
    const s = summarize(cur), ps = summarize(prev);
    const cats = byCategory(cur, 'expense');
    const prevCats = byCategory(prev, 'expense');
    const days = daysElapsed(r);
    const perDay = {};
    cur.forEach((t) => { if (t.type === 'expense') perDay[t.date] = (perDay[t.date] || 0) + t.amount; });
    const topDay = Object.keys(perDay).sort((a, b) => perDay[b] - perDay[a])[0];
    let riser = null;
    cats.forEach((c) => {
      const p = (prevCats.find((x) => x.name === c.name) || { amount: 0 }).amount;
      const diff = c.amount - p;
      if (diff > 0 && (!riser || diff > riser.diff)) riser = { name: c.name, diff, prev: p };
    });
    return { r, cur, prev, s, ps, cats, days, avg: s.exp / days, topDay, topDayAmt: topDay ? perDay[topDay] : 0, riser };
  }

  function insightItems(a, full) {
    const items = [];
    if (S.period.key === 'month' && a.r.cycleEnd) {
      const left = diffDays(today(), a.r.cycleEnd) + 1;
      const nextDay = addDays(a.r.cycleEnd, 1);
      const what = isPayCycle() ? 'gajian (' + fmtShort(nextDay) + ')' : 'akhir bulan';
      items.push({
        ic: '⏳', t: left + ' hari lagi menuju ' + what,
        d: a.s.net > 0 ? 'Sisa saldo ' + rp(a.s.net) + ' ≈ <b class="num">' + rp(a.s.net / left) + '</b>/hari'
          : '<span class="up">Saldo periode ini sudah minus ' + rp(-a.s.net) + '</span>',
      });
    }
    const top = a.cats[0];
    if (full) {
      items.push({ ic: '🏆', t: 'Kategori pengeluaran terbesar', d: top ? esc(top.name) + ' · ' + rp(top.amount) + ' <span class="muted">(' + pct((top.amount / a.s.exp) * 100) + ')</span>' : 'Belum ada pengeluaran' });
      items.push({ ic: '📅', t: 'Rata-rata pengeluaran harian', d: rp(a.avg) + ' <span class="muted">· ' + a.days + ' hari</span>' });
    }
    const ce = change(a.s.exp, a.ps.exp);
    items.push({
      ic: '📊', t: 'Pengeluaran vs ' + a.r.prevLabel,
      d: ce === null ? '<span class="muted">Belum ada data pembanding</span>'
        : (ce > 0 ? '<span class="up">▲ Naik ' + pct(ce) + '</span>' : ce < 0 ? '<span class="down">▼ Turun ' + pct(-ce) + '</span>' : 'Sama') + ' <span class="muted">(' + rp(a.ps.exp) + ')</span>',
    });
    const ci = change(a.s.inc, a.ps.inc);
    items.push({
      ic: '💼', t: 'Pemasukan vs ' + a.r.prevLabel,
      d: ci === null ? '<span class="muted">Belum ada data pembanding</span>'
        : (ci > 0 ? '<span class="down">▲ Naik ' + pct(ci) + '</span>' : ci < 0 ? '<span class="up">▼ Turun ' + pct(-ci) + '</span>' : 'Sama') + ' <span class="muted">(' + rp(a.ps.inc) + ')</span>',
    });
    if (a.s.inc > 0) {
      const rate = (a.s.net / a.s.inc) * 100;
      items.push({ ic: rate >= 0 ? '💰' : '⚠️', t: 'Porsi pemasukan yang tersisa', d: rate >= 0 ? pct(rate) + ' dari pemasukan' : '<span class="up">Pengeluaran melebihi pemasukan ' + rp(-a.s.net) + '</span>' });
    }
    if (full && a.topDay) items.push({ ic: '🔥', t: 'Hari paling boros', d: fmtDay(a.topDay) + ' · ' + rp(a.topDayAmt) });
    if (full && a.riser && a.ps.exp > 0) items.push({ ic: '📈', t: 'Kenaikan terbesar vs ' + a.r.prevLabel, d: esc(a.riser.name) + ' <span class="up">+' + rp(a.riser.diff) + '</span>' });
    return items;
  }
  const insightHtml = (items) => '<div class="card insights">' + items.map((i) =>
    '<div class="insight"><div class="ic">' + i.ic + '</div><div><div class="t">' + i.t + '</div><div class="d">' + i.d + '</div></div></div>').join('') + '</div>';

  /* ---------------- Komponen ---------------- */
  function periodChips() {
    const opts = [['today', 'Hari ini'], ['week', 'Minggu ini'], ['month', isPayCycle() ? 'Periode gaji' : 'Bulan ini'], ['custom', S.period.key === 'custom' ? periodRange().label : 'Pilih tanggal…']];
    return '<div class="chips" role="tablist">' + opts.map(([k, l]) =>
      '<button class="chip ' + (S.period.key === k ? 'active' : '') + '" data-period="' + k + '">' + (k === 'custom' ? '📆 ' : '') + esc(l) + '</button>').join('') + '</div>';
  }
  function bindPeriodChips(root) {
    $$('[data-period]', root).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.period;
      if (k === 'custom') return openCustomPeriod();
      S.period = { key: k };
      render();
    }));
  }

  function txRow(t) {
    const col = colorOf(t.type, t.category);
    const sub = [t.note, t.account].filter(Boolean).join(' · ') || (t.type === 'income' ? 'Pemasukan' : 'Pengeluaran');
    return '<button class="tx" data-tx="' + esc(t.id) + '">' +
      '<div class="tx-ic ' + t.type + '" style="' + (t.type === 'expense' ? 'color:' + col : '') + '">' + esc(initials(t.category)) + '</div>' +
      '<div class="tx-main"><div class="tx-cat">' + esc(t.category) + (t.pending ? '<span class="pending-badge">⏳ antre</span>' : '') + '</div>' +
      '<div class="tx-sub">' + esc(sub) + '</div></div>' +
      '<div class="tx-amt num ' + t.type + '">' + (t.type === 'income' ? '+' : '−') + rp(t.amount).replace('Rp ', 'Rp ') + '</div></button>';
  }
  function bindTxRows(root) {
    $$('[data-tx]', root).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.tx)));
  }

  function emptyState(icon, title, text, btn) {
    return '<div class="empty"><div class="art">' + icon + '</div><h4>' + title + '</h4><p>' + text + '</p>' +
      (btn ? '<button class="btn btn-primary" data-act="' + btn.act + '">' + btn.label + '</button>' : '') + '</div>';
  }

  /* ---------------- Grafik (SVG) ---------------- */
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function barPath(x, y, w, h, r) {
    if (h <= 0.5) return '';
    r = Math.min(r, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }

  /** buckets: [{label, tip, values:[..]}]; series: [{name,color}] */
  function barChart(id, buckets, series, opts = {}) {
    const H = 180, top = 12, bottom = 24, left = 40, right = 6;
    const avail = Math.max(280, Math.min(window.innerWidth || 390, 560) - 66);
    let groupW = opts.groupW || (series.length > 1 ? 34 : 22);
    if (opts.fit && buckets.length <= 31) groupW = Math.max(9, (avail - left - right) / buckets.length);
    const W = Math.max(opts.groupW ? avail : 280, left + right + buckets.length * groupW);
    // Nilai ekstrem (mis. bayar sewa) dipotong agar batang lain tetap terbaca.
    const all = buckets.map((b) => Math.max(...b.values)).filter((v) => v > 0).sort((a, b) => a - b);
    const rawMax = all.length ? all[all.length - 1] : 1;
    const p85 = all.length ? all[Math.floor((all.length - 1) * 0.85)] : 1;
    const clip = opts.clip && all.length >= 5 && rawMax > p85 * 4;
    const max = niceMax(clip ? p85 * 1.6 : rawMax);
    chartClipped = clip;
    const ph = H - top - bottom;
    const y = (v) => top + ph - (v / max) * ph;
    const gap = 2;
    const bw = Math.max(4, Math.min(series.length > 1 ? 11 : 14, (groupW - 8 - gap * (series.length - 1)) / series.length));
    let svg = '<svg class="bars" id="' + id + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    [0, 0.5, 1].forEach((f) => {
      const yy = y(max * f);
      svg += '<line class="grid" x1="' + left + '" x2="' + (W - right) + '" y1="' + yy + '" y2="' + yy + '"/>';
      svg += '<text x="' + (left - 6) + '" y="' + (yy + 3) + '" text-anchor="end">' + rpShort(max * f) + '</text>';
    });
    const every = Math.max(1, Math.ceil(buckets.length / Math.floor((W - left) / 34)));
    buckets.forEach((b, i) => {
      const gx = left + i * groupW;
      const totalW = series.length * bw + (series.length - 1) * gap;
      let x = gx + (groupW - totalW) / 2;
      svg += '<rect class="hit" data-i="' + i + '" x="' + gx + '" y="' + top + '" width="' + groupW + '" height="' + (ph + bottom) + '" rx="8"/>';
      b.values.forEach((v, si) => {
        const over = v > max;
        const h = (Math.min(v, max) / max) * ph;
        svg += '<path pointer-events="none" d="' + barPath(x, top + ph - h, bw, h, 4) + '" fill="' + series[si].color + '"/>';
        if (over) {
          // Tanda "terpotong": celah putih miring di dekat puncak batang.
          svg += '<path pointer-events="none" d="M' + (x - 1) + ',' + (top + 14) + 'L' + (x + bw + 1) + ',' + (top + 9) + '" stroke="#fff" stroke-width="3"/>';
        }
        x += bw + gap;
      });
      if (i % every === 0 || (i === buckets.length - 1 && i % every >= every / 2)) {
        svg += '<text x="' + (gx + groupW / 2) + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(b.label) + '</text>';
      }
    });
    if (opts.avg > 0 && opts.avg <= max) {
      const ya = y(opts.avg);
      svg += '<line x1="' + left + '" x2="' + (W - right) + '" y1="' + ya + '" y2="' + ya + '" stroke="#475569" stroke-width="1.2" stroke-dasharray="4 4" opacity=".55"/>';
    }
    svg += '</svg>';
    return '<div class="bar-scroll" data-scroll-end="' + (opts.scrollEnd ? 1 : 0) + '">' + svg + '</div>' +
      '<div class="chart-tip" id="' + id + '-tip">' + (opts.hint || 'Ketuk batang untuk melihat detail') + '</div>';
  }
  function bindBarChart(id, buckets) {
    const svg = document.getElementById(id);
    if (!svg) return;
    const tip = document.getElementById(id + '-tip');
    const wrap = svg.parentElement;
    if (wrap.dataset.scrollEnd === '1') wrap.scrollLeft = wrap.scrollWidth;
    $$('.hit', svg).forEach((h) => h.addEventListener('click', () => {
      $$('.hit', svg).forEach((x) => x.classList.remove('on'));
      h.classList.add('on');
      tip.innerHTML = buckets[+h.dataset.i].tip;
    }));
  }

  function donutChart(items, total, type) {
    const R = 70, SW = 24, C = 2 * Math.PI * R;
    const gapLen = items.length > 1 ? 2.5 : 0;
    let off = 0, segs = '';
    items.forEach((it, i) => {
      const len = (it.amount / total) * C;
      const dash = Math.max(0.01, len - gapLen);
      segs += '<circle class="seg" data-i="' + i + '" cx="95" cy="95" r="' + R + '" fill="none" stroke="' + it.color + '" stroke-width="' + SW + '" ' +
        'stroke-dasharray="' + dash + ' ' + (C - dash) + '" stroke-dashoffset="' + -off + '" transform="rotate(-90 95 95)"/>';
      off += len;
    });
    const legend = items.map((it, i) =>
      '<button data-i="' + i + '"><span class="sw" style="background:' + it.color + '"></span><span class="nm">' + esc(it.name) + '</span>' +
      '<span class="pc">' + pct((it.amount / total) * 100) + '</span><span class="am num">' + rp(it.amount) + '</span></button>').join('');
    return '<div class="donut-wrap"><svg class="donut" viewBox="0 0 190 190" role="img" aria-label="Komposisi per kategori">' + segs +
      '<text class="c-lbl" x="95" y="86" text-anchor="middle" id="donut-lbl">Total ' + (type === 'income' ? 'pemasukan' : 'pengeluaran') + '</text>' +
      '<text class="c-total" x="95" y="106" text-anchor="middle" id="donut-val">Rp ' + rpShort(total) + '</text></svg>' +
      '<div class="legend">' + legend + '</div></div>';
  }
  function bindDonut(items, total, type) {
    const svg = $('.donut');
    if (!svg) return;
    let active = -1;
    const lbl = $('#donut-lbl'), val = $('#donut-val');
    const set = (i) => {
      active = active === i ? -1 : i;
      svg.classList.toggle('focus', active >= 0);
      $$('circle.seg', svg).forEach((c) => c.classList.toggle('on', +c.dataset.i === active));
      if (active < 0) { lbl.textContent = 'Total ' + (type === 'income' ? 'pemasukan' : 'pengeluaran'); val.textContent = 'Rp ' + rpShort(total); }
      else {
        const it = items[active];
        lbl.textContent = it.name.length > 22 ? it.name.slice(0, 21) + '…' : it.name;
        val.textContent = 'Rp ' + rpShort(it.amount) + ' · ' + pct((it.amount / total) * 100);
      }
    };
    $$('circle.seg', svg).forEach((c) => c.addEventListener('click', () => set(+c.dataset.i)));
    $$('.legend button').forEach((b) => b.addEventListener('click', () => set(+b.dataset.i)));
  }

  /* ---------------- Render ---------------- */
  const TITLES = { home: 'DompetKu', history: 'Riwayat', analysis: 'Analisis', settings: 'Pengaturan' };

  function render() {
    const view = $('#view');
    const configured = isConfigured();
    $('#bottomnav').style.display = configured ? '' : 'none';
    $('#btn-refresh').style.visibility = configured ? '' : 'hidden';
    if (!configured) { view.innerHTML = renderOnboarding(); bindOnboarding(view); animate(view); updateSyncStatus(); return; }
    $$('#bottomnav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
    $('#page-title').textContent = TITLES[S.view];
    if (S.view === 'home') { view.innerHTML = renderHome(); bindHome(view); }
    else if (S.view === 'history') { view.innerHTML = renderHistoryShell(); bindHistory(view); }
    else if (S.view === 'analysis') { view.innerHTML = renderAnalysis(); bindAnalysis(view); }
    else { view.innerHTML = renderSettings(); bindSettings(view); }
    $$('[data-act="add"]', view).forEach((b) => b.addEventListener('click', () => openForm()));
    animate(view);
    updateSyncStatus();
  }
  function animate(el) { el.classList.remove('view-enter'); void el.offsetWidth; el.classList.add('view-enter'); }

  /** Memperbarui tampilan setelah data berubah tanpa mengganggu ketikan di Riwayat. */
  function refreshView() {
    if (isConfigured() && S.view === 'history' && $('#hist-list')) { renderHistoryList(); return; }
    render();
  }

  function updateSyncStatus() {
    const el = $('#sync-status');
    const btn = $('#btn-refresh');
    btn.classList.toggle('spin', S.syncing);
    if (!isConfigured()) { el.innerHTML = ''; return; }
    if (S.cfg.demo) { el.innerHTML = '<span class="dot"></span>Mode demo'; return; }
    if (S.syncing) { el.innerHTML = 'Menyinkronkan…'; return; }
    if (S.offline) { el.innerHTML = '<span class="dot off"></span>Offline' + (S.queue.length ? ' · ' + S.queue.length + ' antre' : ''); return; }
    if (S.lastSync) {
      const t = new Date(S.lastSync).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      el.innerHTML = '<span class="dot"></span>Tersinkron ' + t;
    } else el.innerHTML = '';
  }

  /* ----- Beranda ----- */
  function skeletonHome() {
    return '<div class="skel" style="height:44px;margin-top:6px"></div><div class="skel" style="height:190px;margin-top:10px;border-radius:26px"></div>' +
      '<div class="stat-grid" style="margin-top:12px"><div class="skel" style="height:84px"></div><div class="skel" style="height:84px"></div></div>' +
      '<div class="skel" style="height:240px;margin-top:22px"></div>';
  }

  function renderHome() {
    if (!S.hasData) return skeletonHome();
    const a = analyze();
    const cmp = change(a.s.exp, a.ps.exp);
    const cmpText = cmp === null ? 'Belum ada data pembanding dari ' + a.r.prevLabel
      : 'Pengeluaran ' + (cmp > 0 ? 'naik ' + pct(cmp) : cmp < 0 ? 'turun ' + pct(-cmp) : 'sama') + ' dibanding ' + a.r.prevLabel;
    const recent = sortTx(S.tx).slice(0, 6);
    let h = periodChips();
    h += banners();
    h += '<section class="hero" aria-label="Ringkasan">' +
      '<div class="hero-label">Saldo bersih · ' + esc(a.r.label) + '</div>' +
      '<div class="hero-amount num">' + rp(a.s.net) + '</div>' +
      '<div class="hero-row">' +
      '<div class="glass"><div class="k"><span class="arrow-ic">↓</span>Pemasukan</div><div class="v num">' + rp(a.s.inc) + '</div></div>' +
      '<div class="glass"><div class="k"><span class="arrow-ic">↑</span>Pengeluaran</div><div class="v num">' + rp(a.s.exp) + '</div></div>' +
      '</div><div class="hero-cmp">' + cmpText + '</div></section>';
    const top = a.cats[0];
    h += '<div class="stat-grid" style="margin-top:12px">' +
      '<div class="card stat"><div class="k">Rata-rata harian</div><div class="v num">' + rp(a.avg) + '</div><div class="s">pengeluaran / hari</div></div>' +
      '<div class="card stat"><div class="k">Kategori terbesar</div><div class="v" style="font-size:15.5px">' + (top ? esc(top.name) : '—') + '</div>' +
      '<div class="s num">' + (top ? rp(top.amount) + ' · ' + pct((top.amount / a.s.exp) * 100) : 'Belum ada pengeluaran') + '</div></div></div>';
    h += '<div class="section-title"><h2>Insight</h2><button class="link-btn" data-go="analysis">Lihat grafik →</button></div>';
    h += insightHtml(insightItems(a, false));
    h += '<div class="section-title"><h2>Transaksi terbaru</h2>' + (S.tx.length ? '<button class="link-btn" data-go="history">Lihat semua →</button>' : '') + '</div>';
    if (!S.tx.length) {
      h += '<div class="card">' + emptyState('🧾', 'Belum ada transaksi', 'Catat pemasukan atau pengeluaran pertamamu. Hanya butuh beberapa detik.', { act: 'add', label: '+ Tambah transaksi' }) + '</div>';
    } else {
      h += '<div class="card tx-list">' + recent.map(txRow).join('') + '</div>';
    }
    return h;
  }

  function banners() {
    let h = '';
    if (S.cfg.demo) h += '<div class="banner demo">🧪 Mode demo — data contoh, tidak tersimpan ke spreadsheet.<button data-act="exit-demo">Keluar</button></div>';
    if (S.queue.length) h += '<div class="banner warn">⏳ ' + S.queue.length + ' transaksi menunggu dikirim.<button data-act="flush">Kirim</button></div>';
    if (!isStandalone() && !load(LS.installHide, false) && !S.cfg.demo) h += '<div class="banner demo">📲 Pasang DompetKu di layar utama HP.<button data-act="install">Caranya</button></div>';
    return h;
  }
  function bindBanners(root) {
    $$('[data-act="exit-demo"]', root).forEach((b) => b.addEventListener('click', exitDemo));
    $$('[data-act="flush"]', root).forEach((b) => b.addEventListener('click', () => sync({ toast: true })));
    $$('[data-act="install"]', root).forEach((b) => b.addEventListener('click', openInstallHelp));
  }

  function bindHome(root) {
    bindPeriodChips(root);
    bindBanners(root);
    bindTxRows(root);
    $$('[data-go]', root).forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  }

  /* ----- Riwayat ----- */
  function renderHistoryShell() {
    if (!S.hasData) return skeletonHome();
    const f = S.hist;
    const cats = mergeUnique(S.categories.expense, S.categories.income).concat(S.tx.map((t) => t.category));
    const catOpts = Array.from(new Set(cats)).sort((a, b) => a.localeCompare(b, 'id'));
    return '<label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
      '<input id="h-q" type="search" placeholder="Cari catatan, kategori, nominal…" value="' + esc(f.q) + '" enterkeyhint="search" autocomplete="off"></label>' +
      '<div class="filters">' +
      '<div class="seg full" id="h-type">' + [['all', 'Semua'], ['expense', 'Pengeluaran'], ['income', 'Pemasukan']].map(([v, l]) =>
        '<button data-v="' + v + '" class="' + (f.type === v ? 'active' : '') + '">' + l + '</button>').join('') + '</div>' +
      '<label class="field full"><span>Kategori</span><select class="input" id="h-cat"><option value="">Semua kategori</option>' +
      catOpts.map((c) => '<option ' + (f.cat === c ? 'selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Dari tanggal</span><input class="input" type="date" id="h-from" value="' + esc(f.from) + '"></label>' +
      '<label class="field"><span>Sampai tanggal</span><input class="input" type="date" id="h-to" value="' + esc(f.to) + '"></label>' +
      '</div><div id="hist-list"></div>';
  }

  function filteredHistory() {
    const f = S.hist;
    const q = f.q.trim().toLowerCase();
    const qNum = q.replace(/[^0-9]/g, '');
    return sortTx(S.tx).filter((t) => {
      if (f.type !== 'all' && t.type !== f.type) return false;
      if (f.cat && t.category !== f.cat) return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (q) {
        const hay = (t.category + ' ' + t.note + ' ' + t.account + ' ' + fmtDate(t.date)).toLowerCase();
        if (!hay.includes(q) && !(qNum && String(Math.round(t.amount)).includes(qNum))) return false;
      }
      return true;
    });
  }

  function renderHistoryList() {
    const box = $('#hist-list');
    if (!box) return;
    const list = filteredHistory();
    const f = S.hist;
    const active = f.q || f.type !== 'all' || f.cat || f.from || f.to;
    const s = summarize(list);
    let h = '<div class="result-meta"><span>' + list.length + ' transaksi · <b class="num" style="color:var(--ink)">' + rp(s.net) + '</b></span>' +
      (active ? '<button class="link-btn" id="h-reset">Reset filter</button>' : '') + '</div>';
    if (!S.tx.length) {
      h += '<div class="card" style="margin-top:10px">' + emptyState('🗂️', 'Riwayat masih kosong', 'Transaksi yang kamu catat akan muncul di sini.', { act: 'add', label: '+ Tambah transaksi' }) + '</div>';
    } else if (!list.length) {
      h += '<div class="card" style="margin-top:10px">' + emptyState('🔍', 'Tidak ada yang cocok', 'Coba kata kunci lain atau longgarkan filternya.') + '</div>';
    } else {
      const shown = list.slice(0, f.limit);
      const groups = [];
      shown.forEach((t) => {
        const g = groups[groups.length - 1];
        if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] });
      });
      h += '<div class="card tx-list" style="margin-top:10px;padding-top:0">' + groups.map((g) => {
        const gs = summarize(list.filter((t) => t.date === g.date));
        return '<div class="day-head"><span>' + fmtDay(g.date) + '</span><span class="num">' + rp(gs.net) + '</span></div>' + g.items.map(txRow).join('');
      }).join('') + '</div>';
      if (list.length > shown.length) h += '<button class="btn btn-ghost btn-block" id="h-more" style="margin-top:12px">Muat lebih banyak (' + (list.length - shown.length) + ' lagi)</button>';
    }
    box.innerHTML = h;
    bindTxRows(box);
    $$('[data-act="add"]', box).forEach((b) => b.addEventListener('click', () => openForm()));
    const more = $('#h-more');
    if (more) more.addEventListener('click', () => { S.hist.limit += PAGE_SIZE; renderHistoryList(); });
    const reset = $('#h-reset');
    if (reset) reset.addEventListener('click', () => { S.hist = { q: '', type: 'all', cat: '', from: '', to: '', limit: PAGE_SIZE }; render(); });
  }

  function bindHistory(root) {
    if (!S.hasData) return;
    const upd = () => { S.hist.limit = PAGE_SIZE; renderHistoryList(); };
    $('#h-q', root).addEventListener('input', debounce((e) => { S.hist.q = e.target.value; upd(); }, 180));
    $$('#h-type button', root).forEach((b) => b.addEventListener('click', () => {
      S.hist.type = b.dataset.v;
      $$('#h-type button', root).forEach((x) => x.classList.toggle('active', x === b));
      upd();
    }));
    $('#h-cat', root).addEventListener('change', (e) => { S.hist.cat = e.target.value; upd(); });
    $('#h-from', root).addEventListener('change', (e) => { S.hist.from = e.target.value; upd(); });
    $('#h-to', root).addEventListener('change', (e) => { S.hist.to = e.target.value; upd(); });
    renderHistoryList();
  }

  /* ----- Analisis ----- */
  let chartData = {};
  let chartClipped = false;
  function renderAnalysis() {
    if (!S.hasData) return skeletonHome();
    const a = analyze();
    let h = periodChips();
    if (!a.cur.length) {
      h += '<div class="card" style="margin-top:10px">' + emptyState('📉', 'Belum ada data di periode ini', 'Pilih periode lain atau tambahkan transaksi untuk melihat grafik.', { act: 'add', label: '+ Tambah transaksi' }) + '</div>';
    } else {
      // 1. Perbandingan
      const mx = Math.max(a.s.inc, a.s.exp, 1);
      h += '<div class="card chart-card" style="margin-top:10px"><h3>Pemasukan vs Pengeluaran</h3><div class="sub">' + esc(a.r.label) + '</div>' +
        '<div class="compare-row"><div class="top"><span>Pemasukan</span><b class="num">' + rp(a.s.inc) + '</b></div><div class="track"><div style="width:' + (a.s.inc / mx) * 100 + '%;background:' + C_INC + '"></div></div></div>' +
        '<div class="compare-row"><div class="top"><span>Pengeluaran</span><b class="num">' + rp(a.s.exp) + '</b></div><div class="track"><div style="width:' + (a.s.exp / mx) * 100 + '%;background:' + C_EXP + '"></div></div></div>' +
        '<div class="kv" style="border-top:1px solid var(--line);margin-top:6px"><span class="k">Saldo bersih</span><span class="v num ' + (a.s.net < 0 ? 'up' : '') + '">' + rp(a.s.net) + '</span></div></div>';

      // 2. Per kategori
      const type = S.catType;
      const cats = byCategory(a.cur, type);
      const total = cats.reduce((s, c) => s + c.amount, 0);
      h += '<div class="card chart-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px">' +
        '<div><h3>Per kategori</h3><div class="sub" style="margin:0">' + esc(a.r.label) + '</div></div>' +
        '<div class="seg type" id="cat-type" style="min-width:190px">' + [['expense', 'Keluar'], ['income', 'Masuk']].map(([v, l]) =>
          '<button data-v="' + v + '" class="' + (type === v ? 'active' : '') + '">' + l + '</button>').join('') + '</div></div>';
      if (!total) {
        h += emptyState(type === 'expense' ? '🛍️' : '💼', 'Belum ada ' + (type === 'expense' ? 'pengeluaran' : 'pemasukan'), 'Tidak ada transaksi jenis ini pada periode terpilih.');
        chartData.donut = null;
      } else {
        // Kategori di luar 8 warna digabung menjadi "Lainnya".
        const items = [], other = { name: 'Lainnya (gabungan)', amount: 0, color: OTHER_COLOR };
        cats.forEach((c) => {
          const col = colorOf(type, c.name);
          if (col === OTHER_COLOR) other.amount += c.amount; else items.push({ name: c.name, amount: c.amount, color: col });
        });
        if (other.amount) items.push(other);
        chartData.donut = { items, total, type };
        h += donutChart(items, total, type);
      }
      h += '</div>';

      // 3. Tren harian pengeluaran
      let ds = a.r.start;
      const de = a.r.end;
      if (diffDays(ds, de) < 6) ds = addDays(de, -6);
      const dayBuckets = [];
      const expByDay = {};
      S.tx.forEach((t) => { if (t.type === 'expense' && t.date >= ds && t.date <= de) expByDay[t.date] = (expByDay[t.date] || 0) + t.amount; });
      for (let d = ds; d <= de; d = addDays(d, 1)) {
        const v = expByDay[d] || 0;
        dayBuckets.push({ label: String(parseYmd(d).getDate()), values: [v], tip: '<b>' + fmtDay(d) + '</b> · Pengeluaran <b class="num">' + rp(v) + '</b>' });
        if (dayBuckets.length > 400) break;
      }
      const dayAvg = dayBuckets.reduce((s, b) => s + b.values[0], 0) / dayBuckets.length;
      chartData.daily = dayBuckets;
      const dailySvg = barChart('chart-daily', dayBuckets, [{ name: 'Pengeluaran', color: C_EXP }], { scrollEnd: true, avg: dayAvg, fit: true, clip: true });
      h += '<div class="card chart-card"><h3>Tren pengeluaran harian</h3><div class="sub">' + fmtShort(ds) + ' – ' + fmtShort(de) + ' · garis putus-putus = rata-rata ' + rp(dayAvg) + '/hari' +
        (chartClipped ? '<br>Batang bertanda celah putih = nilai sangat besar, dipotong agar hari lain terbaca' : '') + '</div>' + dailySvg + '</div>';

      // 4. Tren bulanan 6 bulan
      const monthBuckets = [];
      for (let i = 5; i >= 0; i--) {
        const c = cycleOf(today(), -i);
        const s = summarize(S.tx.filter(inRange(c)));
        const title = isPayCycle() ? rangeLabel(c.start, c.end) + ' ' + c.endYear : MON[c.endMonth] + ' ' + c.endYear;
        monthBuckets.push({
          label: MON[c.endMonth], values: [s.inc, s.exp],
          tip: '<b>' + title + '</b> · Masuk <b class="num">' + rp(s.inc) + '</b> · Keluar <b class="num">' + rp(s.exp) + '</b> · Saldo <b class="num">' + rp(s.net) + '</b>',
        });
      }
      chartData.monthly = monthBuckets;
      h += '<div class="card chart-card"><h3>Tren bulanan</h3><div class="sub">' + (isPayCycle() ? '6 periode gajian terakhir (mulai tgl ' + S.startDay + ') · label = bulan berakhirnya periode' : '6 bulan terakhir') + '</div>' +
        '<div class="legend-inline"><span><i style="background:' + C_INC + '"></i>Pemasukan</span><span><i style="background:' + C_EXP + '"></i>Pengeluaran</span></div>' +
        barChart('chart-monthly', monthBuckets, [{ name: 'Pemasukan', color: C_INC }, { name: 'Pengeluaran', color: C_EXP }], { groupW: 50 }) + '</div>';
    }
    h += '<div class="section-title"><h2>Insight</h2></div>' + insightHtml(insightItems(a, true));
    return h;
  }
  function bindAnalysis(root) {
    if (!S.hasData) return;
    bindPeriodChips(root);
    $$('#cat-type button', root).forEach((b) => b.addEventListener('click', () => { S.catType = b.dataset.v; render(); }));
    if (chartData.donut) bindDonut(chartData.donut.items, chartData.donut.total, chartData.donut.type);
    if (chartData.daily) bindBarChart('chart-daily', chartData.daily);
    if (chartData.monthly) bindBarChart('chart-monthly', chartData.monthly);
  }

  /* ----- Pengaturan ----- */
  function renderSettings() {
    const c = S.cfg;
    let h = '<div class="stack" style="margin-top:6px">';
    h += '<div class="card"><h3 style="margin:0 0 4px;font-size:15px">Koneksi spreadsheet</h3>';
    if (c.demo) {
      h += '<p class="small muted" style="margin:0 0 12px">Kamu sedang di mode demo. Data contoh tidak tersimpan ke spreadsheet.</p>' +
        '<button class="btn btn-primary btn-block" data-act="exit-demo">Keluar dari mode demo & hubungkan</button>';
    } else {
      h += '<p class="small" style="margin:0 0 6px">' + (S.offline ? '<span class="up">● Tidak terhubung</span>' : S.lastSync ? '<span class="ok">● Terhubung</span>' : '<span class="muted">● Belum dicek</span>') + '</p>' +
        '<div class="mono muted" style="margin-bottom:12px">' + esc(c.url.replace(/(\/s\/.{6}).+(.{6}\/exec)$/, '$1…$2')) + '</div>' +
        '<div class="btn-row"><button class="btn btn-ghost" id="s-test">Tes koneksi</button><button class="btn btn-ghost" id="s-reload">Muat ulang</button></div>';
    }
    h += '</div>';

    if (S.meta && !c.demo) {
      const lbl = { date: 'Tanggal', amount: 'Nominal', category: 'Kategori', note: 'Catatan', account: 'Akun/Metode', id: 'ID' };
      h += '<div class="card"><h3 style="margin:0 0 4px;font-size:15px">Kolom yang terbaca</h3><p class="small muted" style="margin:0 0 10px">Aplikasi menyesuaikan diri dengan header di sheet-mu.</p>';
      ['expense', 'income'].forEach((t) => {
        const m = S.meta[t];
        if (!m) return;
        h += '<div class="col-map" style="margin-bottom:10px"><b>Sheet “' + esc(m.sheet) + '”</b> <span class="muted small">(header baris ' + m.headerRow + ')</span>' +
          Object.keys(lbl).map((f) => '<div class="row"><span class="muted">' + lbl[f] + '</span><span>' + (m.columns[f] ? '“' + esc(m.columns[f]) + '”' : '<span class="muted">—</span>') + '</span></div>').join('') +
          (m.skipped ? '<div class="banner warn" style="margin-top:8px">⚠️ ' + m.skipped + ' baris dilewati karena tanggal/nominal tidak terbaca.</div>' : '') + '</div>';
      });
      h += '</div>';
    }

    const sel = Array.from({ length: 28 }, (_, i) => i + 1).map((n) =>
      '<option value="' + n + '" ' + (n === S.startDay ? 'selected' : '') + '>Tanggal ' + n + (n === 1 ? ' (bulan kalender)' : '') + '</option>').join('');
    const ex = cycleOf(today());
    h += '<div class="card"><h3 style="margin:0 0 4px;font-size:15px">📅 Awal periode bulanan</h3>' +
      '<p class="small muted" style="margin:0 0 10px">Pilih tanggal gajian. Filter "Periode gaji", grafik bulanan, dan insight akan mengikuti tanggal ini.</p>' +
      '<select class="input" id="s-startday">' + sel + '</select>' +
      '<p class="small" style="margin:8px 0 0">Periode sekarang: <b>' + fmtDate(ex.start) + ' – ' + fmtDate(ex.end) + '</b></p></div>';

    h += '<div class="card"><h3 style="margin:0 0 4px;font-size:15px">Pasang di layar utama</h3><p class="small muted" style="margin:0 0 12px">' +
      (isStandalone() ? '✅ DompetKu sudah terpasang.' : 'Buka DompetKu seperti aplikasi biasa, langsung dari layar utama HP.') + '</p>' +
      (isStandalone() ? '' : '<button class="btn btn-ghost btn-block" data-act="install">📲 Cara memasang</button>') + '</div>';

    h += '<div class="card"><h3 style="margin:0 0 4px;font-size:15px">Data di HP ini</h3>' +
      '<p class="small muted" style="margin:0 0 12px">' + S.tx.length + ' transaksi dimuat' + (S.queue.length ? ' · ' + S.queue.length + ' menunggu dikirim' : '') + '.</p>' +
      (S.queue.length ? '<button class="btn btn-ghost btn-block" data-act="flush" style="margin-bottom:10px">Kirim antrean sekarang</button>' : '') +
      '<button class="btn btn-danger btn-block" id="s-logout">' + (c.demo ? 'Hapus data demo' : 'Putuskan koneksi di HP ini') + '</button></div>';
    h += '<p class="small muted" style="text-align:center;margin:18px 0 0">DompetKu v' + VERSION + ' · Data tersimpan di Google Sheets milikmu</p></div>';
    return h;
  }
  function bindSettings(root) {
    bindBanners(root);
    $('#s-startday', root).addEventListener('change', (e) => {
      S.startDay = Number(e.target.value);
      save(LS.startDay, S.startDay);
      toast(S.startDay === 1 ? 'Periode bulanan: per bulan kalender' : 'Periode bulanan: mulai tanggal ' + S.startDay, 'success');
      render();
    });
    const test = $('#s-test', root);
    if (test) test.addEventListener('click', async () => {
      test.disabled = true; test.innerHTML = '<span class="spinner" style="border-color:#c7cde0;border-top-color:var(--brand-1)"></span>';
      try { await api('ping'); S.offline = false; S.lastSync = S.lastSync || Date.now(); toast('Koneksi berhasil ✓', 'success'); }
      catch (e) { if (e.network) S.offline = true; toast(e.message, 'error', 5000); }
      render();
    });
    const rl = $('#s-reload', root);
    if (rl) rl.addEventListener('click', () => sync({ toast: true }));
    $('#s-logout', root).addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: S.cfg.demo ? 'Hapus data demo?' : 'Putuskan koneksi?',
        text: S.cfg.demo ? 'Data contoh akan dihapus dari HP ini.' : 'Data di spreadsheet TIDAK terhapus. Kamu perlu membuka link setup lagi untuk menghubungkan.' + (S.queue.length ? ' <b>' + S.queue.length + ' transaksi yang belum terkirim akan hilang.</b>' : ''),
        ok: S.cfg.demo ? 'Hapus' : 'Putuskan', danger: true,
      });
      if (!ok) return;
      localStorage.removeItem(LS.cache); localStorage.removeItem(LS.queue); localStorage.removeItem(LS.demo);
      S.cfg = { url: '', token: '', demo: false }; save(LS.cfg, S.cfg);
      S.queue = []; S.tx = []; S.hasData = false; S.meta = null; S.lastSync = null;
      render();
    });
  }

  /* ----- Onboarding ----- */
  function renderOnboarding() {
    return '<div class="onb"><div class="onb-hero"><img class="logo" src="icons/icon-v2.svg" alt=""><h1>Selamat datang 👋</h1>' +
      '<p>Catat pemasukan & pengeluaran dari HP, langsung tersimpan ke Google Sheets milikmu.</p></div>' +
      '<div class="card" style="margin-top:14px"><h3 style="margin:0 0 4px;font-size:15px">🔗 Tempel link setup</h3>' +
      '<p class="small muted" style="margin:0 0 10px">Salin link dari WhatsApp/email (tekan lama link → Salin), lalu tempel di sini.</p>' +
      '<textarea class="input" id="o-link" rows="3" placeholder="https://…/dompetku/#setup=…" autocomplete="off" autocapitalize="off" spellcheck="false" style="resize:none;font-size:13px"></textarea>' +
      '<button class="btn btn-primary btn-block" id="o-link-go" style="margin-top:10px">Hubungkan</button></div>' +
      '<div class="card" style="margin-top:12px"><h3 style="margin:0 0 12px;font-size:15px">Belum punya link?</h3><ol class="steps">' +
      '<li>Di spreadsheet (laptop), buka menu <b>📱 DompetKu → 2. Buat link untuk HP</b>.</li>' +
      '<li>Kirim link itu ke dirimu sendiri (mis. WhatsApp “chat ke diri sendiri”).</li>' +
      '<li>Buka link di HP. Selesai — aplikasi langsung terhubung.</li></ol></div>' +
      '<details class="card" style="margin-top:12px"><summary style="font-weight:700;cursor:pointer">Hubungkan manual</summary><div class="stack" style="margin-top:12px">' +
      '<label class="field"><span>URL Web App</span><input class="input" id="o-url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>' +
      '<label class="field"><span>Kunci akses</span><input class="input" id="o-token" type="password" autocomplete="off"></label>' +
      '<button class="btn btn-primary btn-block" id="o-connect">Hubungkan</button></div></details>' +
      '<button class="btn btn-ghost btn-block" id="o-demo" style="margin-top:14px">🧪 Coba dulu dengan data contoh</button></div>';
  }
  function bindOnboarding(root) {
    $('#o-demo', root).addEventListener('click', startDemo);
    const linkBtn = $('#o-link-go', root);
    linkBtn.addEventListener('click', async () => {
      const j = decodeSetup($('#o-link', root).value);
      if (!j) return toast('Link tidak dikenali. Pastikan seluruh link tersalin (ada tulisan #setup=).', 'error', 5000);
      linkBtn.disabled = true; linkBtn.innerHTML = '<span class="spinner"></span> Menghubungkan…';
      const ok = await connect(j.u, j.t);
      if (!ok) { linkBtn.disabled = false; linkBtn.textContent = 'Hubungkan'; }
    });
    $('#o-connect', root).addEventListener('click', async () => {
      const url = $('#o-url', root).value.trim(), token = $('#o-token', root).value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) return toast('URL Web App harus berakhiran /exec', 'error');
      if (token.length < 20) return toast('Kunci akses tidak valid', 'error');
      const btn = $('#o-connect', root);
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Menghubungkan…';
      await connect(url, token);
      btn.disabled = false; btn.textContent = 'Hubungkan';
    });
  }
  async function connect(url, token) {
    const prev = S.cfg;
    S.cfg = { url, token, demo: false };
    try {
      await api('ping');
      save(LS.cfg, S.cfg);
      localStorage.removeItem(LS.cache);
      S.hasData = false; S.view = 'home';
      toast('Berhasil terhubung ke spreadsheet ✓', 'success');
      render();
      sync();
      return true;
    } catch (e) {
      S.cfg = prev;
      toast(e.message, 'error', 6000);
      if (isConfigured() && !S.hasData) {
        const cache = !S.cfg.demo && load(LS.cache, null);
        if (cache) applyData(cache, true);
        render();
        sync();
      }
      return false;
    }
  }

  /* ---------------- Modal ---------------- */
  const modalStack = [];
  function openModal(html, opts = {}) {
    const ov = document.createElement('div');
    ov.className = 'overlay' + (opts.center ? ' center' : '');
    ov.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + (opts.center ? '' : '<div class="grabber"></div>') + html + '</div>';
    const m = { el: ov.querySelector('.sheet'), ov, onClose: opts.onClose };
    m.close = () => {
      if (m.closed) return;
      if (modalStack[modalStack.length - 1] === m) history.back(); else reallyClose(m);
    };
    ov.addEventListener('click', (e) => { if (e.target === ov) m.close(); });
    $('#modal-root').appendChild(ov);
    modalStack.push(m);
    history.pushState({ modal: modalStack.length }, '');
    $$('[data-close]', ov).forEach((b) => b.addEventListener('click', m.close));
    return m;
  }
  function reallyClose(m) {
    if (m.closed) return;
    m.closed = true;
    const i = modalStack.indexOf(m);
    if (i >= 0) modalStack.splice(i, 1);
    m.ov.classList.add('closing');
    setTimeout(() => m.ov.remove(), 210);
    if (m.onClose) m.onClose();
  }
  window.addEventListener('popstate', () => { const m = modalStack[modalStack.length - 1]; if (m) reallyClose(m); });

  function confirmDialog({ title, text, ok = 'Ya', cancel = 'Batal', danger }) {
    return new Promise((resolve) => {
      let result = false;
      const m = openModal('<h3 style="margin:0 0 8px;font-size:18px">' + title + '</h3><p style="margin:0 0 18px;color:var(--ink-2);font-size:14.5px">' + text + '</p>' +
        '<div class="btn-row"><button class="btn btn-ghost" data-close>' + cancel + '</button><button class="btn ' + (danger ? 'btn-danger-solid' : 'btn-primary') + '" id="c-ok">' + ok + '</button></div>',
      { center: true, onClose: () => resolve(result) });
      $('#c-ok', m.el).addEventListener('click', () => { result = true; m.close(); });
    });
  }

  function toast(msg, type = 'success', ms = 2800) {
    const icons = { success: '✓', error: '!', warn: '⏳', info: 'i' };
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = '<span class="ti">' + icons[type] + '</span><span>' + esc(msg) + '</span>';
    const root = $('#toast-root');
    while (root.children.length > 2) root.firstChild.remove();
    root.appendChild(el);
    const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
    el.addEventListener('click', kill);
    setTimeout(kill, ms);
  }

  /* ---------------- Form tambah / edit ---------------- */
  function categoriesFor(type) {
    const used = {};
    S.tx.forEach((t) => { if (t.type === type) used[t.category] = (used[t.category] || 0) + 1; });
    const base = mergeUnique(S.categories[type], Object.keys(used)).filter((c) => c !== 'Tanpa Kategori');
    // Urutkan berdasar seberapa sering dipakai agar yang favorit selalu di depan; "Lainnya" di akhir.
    return base.sort((a, b) => (a === 'Lainnya') - (b === 'Lainnya') || (used[b] || 0) - (used[a] || 0));
  }
  const hasAccountCol = (type) => S.cfg.demo || !!(S.meta && S.meta[type] && S.meta[type].columns.account);

  function openForm(existing) {
    const edit = !!existing;
    const st = {
      type: existing ? existing.type : 'expense',
      amount: existing ? Math.round(existing.amount) : 0,
      category: existing ? existing.category : '',
      date: existing ? existing.date : today(),
      note: existing ? existing.note : '',
      account: existing ? existing.account : '',
    };
    const m = openModal(
      '<div class="sheet-head"><h3>' + (edit ? 'Edit transaksi' : 'Tambah transaksi') + '</h3><button class="close-x" data-close aria-label="Tutup">×</button></div>' +
      '<div class="seg type" id="f-type">' +
      '<button data-v="expense">↑ Pengeluaran</button><button data-v="income">↓ Pemasukan</button></div>' +
      '<div class="amount-box" id="f-amount-box"><label for="f-amount">Nominal</label><div class="amount-row"><span class="rp">Rp</span>' +
      '<input id="f-amount" inputmode="numeric" autocomplete="off" placeholder="0" enterkeyhint="done" aria-describedby="f-amount-err"></div></div>' +
      '<div class="err-text" id="f-amount-err"></div>' +
      '<div class="form-block"><span class="lbl">Kategori</span><div class="cat-grid" id="f-cats"></div><div class="err-text" id="f-cat-err"></div></div>' +
      '<div class="form-block"><span class="lbl">Tanggal</span><div class="date-row">' +
      '<button class="chip" data-d="0">Hari ini</button><button class="chip" data-d="-1">Kemarin</button>' +
      '<input class="input" type="date" id="f-date" required></div></div>' +
      '<div class="form-block" id="f-acc-block"><span class="lbl">Akun / metode <span class="muted">(opsional)</span></span><div class="cat-grid" id="f-accs"></div></div>' +
      '<div class="form-block"><label class="field"><span>Catatan <span class="muted">(opsional)</span></span>' +
      '<input class="input" id="f-note" maxlength="500" placeholder="mis. Makan siang bareng tim" enterkeyhint="done" autocomplete="off"></label></div>' +
      '<div class="save-bar"><button class="btn btn-primary btn-block" id="f-save">' + (edit ? 'Simpan perubahan' : 'Simpan') + '</button></div>');
    const el = m.el;
    const amt = $('#f-amount', el);
    amt.value = st.amount ? nf.format(st.amount) : '';
    $('#f-note', el).value = st.note || '';

    const renderType = () => {
      $$('#f-type button', el).forEach((b) => b.classList.toggle('active', b.dataset.v === st.type));
      renderCats();
      $('#f-acc-block', el).style.display = hasAccountCol(st.type) ? '' : 'none';
      renderAccs();
    };
    const renderCats = (adding) => {
      const cats = categoriesFor(st.type);
      if (st.category && !cats.includes(st.category)) cats.unshift(st.category);
      $('#f-cats', el).innerHTML = cats.map((c) =>
        '<button class="cat-chip ' + (c === st.category ? 'active' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('') +
        (adding ? '<span style="display:flex;gap:6px;width:100%"><input class="input" id="f-newcat" maxlength="60" placeholder="Nama kategori baru" style="flex:1">' +
          '<button class="btn btn-primary" id="f-newcat-ok" style="min-height:46px;padding:0 16px">OK</button></span>'
          : '<button class="cat-chip add" id="f-addcat">+ Baru</button>');
      $$('[data-c]', el).forEach((b) => b.addEventListener('click', () => {
        st.category = b.dataset.c;
        $('#f-cat-err', el).textContent = '';
        $('#f-cats', el).classList.remove('err');
        $$('[data-c]', el).forEach((x) => x.classList.toggle('active', x === b));
      }));
      const add = $('#f-addcat', el);
      if (add) add.addEventListener('click', () => { renderCats(true); $('#f-newcat', el).focus(); });
      const ok = $('#f-newcat-ok', el);
      if (ok) {
        const commit = () => {
          const v = $('#f-newcat', el).value.trim();
          if (v) {
            const custom = load(LS.cats, { income: [], expense: [] });
            if (!custom[st.type].includes(v)) custom[st.type].push(v);
            save(LS.cats, custom);
            S.categories[st.type] = mergeUnique(S.categories[st.type], [v]);
            st.category = v;
            $('#f-cat-err', el).textContent = '';
          }
          renderCats();
        };
        ok.addEventListener('click', commit);
        $('#f-newcat', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
      }
    };
    const renderAccs = () => {
      if (!hasAccountCol(st.type)) return;
      const accs = mergeUnique(S.accounts, st.account ? [st.account] : []);
      $('#f-accs', el).innerHTML = accs.map((a) => '<button class="cat-chip ' + (a === st.account ? 'active' : '') + '" data-a="' + esc(a) + '">' + esc(a) + '</button>').join('');
      $$('[data-a]', el).forEach((b) => b.addEventListener('click', () => {
        st.account = st.account === b.dataset.a ? '' : b.dataset.a;
        renderAccs();
      }));
    };
    const renderDate = () => {
      $('#f-date', el).value = st.date;
      $$('[data-d]', el).forEach((b) => b.classList.toggle('active', addDays(today(), +b.dataset.d) === st.date));
    };

    $$('#f-type button', el).forEach((b) => b.addEventListener('click', () => {
      if (st.type === b.dataset.v) return;
      st.type = b.dataset.v;
      if (!categoriesFor(st.type).includes(st.category)) st.category = '';
      renderType();
    }));
    amt.addEventListener('input', () => {
      const digits = amt.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13);
      st.amount = digits ? Number(digits) : 0;
      amt.value = digits ? nf.format(st.amount) : '';
      $('#f-amount-box', el).classList.remove('err');
      $('#f-amount-err', el).textContent = '';
    });
    amt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); amt.blur(); } });
    $$('[data-d]', el).forEach((b) => b.addEventListener('click', () => { st.date = addDays(today(), +b.dataset.d); renderDate(); }));
    $('#f-date', el).addEventListener('change', (e) => { st.date = e.target.value; renderDate(); });
    $('#f-note', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#f-save', el).click(); } });

    renderType();
    renderDate();
    if (!edit) amt.focus();

    $('#f-save', el).addEventListener('click', async () => {
      // Validasi
      let bad = false;
      if (!st.amount || st.amount <= 0) {
        $('#f-amount-box', el).classList.remove('err'); void el.offsetWidth;
        $('#f-amount-box', el).classList.add('err');
        $('#f-amount-err', el).textContent = 'Nominal wajib diisi dan harus lebih dari 0';
        bad = true;
      }
      if (!st.category) {
        $('#f-cat-err', el).textContent = 'Pilih salah satu kategori';
        $('#f-cats', el).classList.add('err');
        bad = true;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(st.date || '')) { toast('Tanggal belum diisi', 'error'); bad = true; }
      if (bad) { if (!st.amount) amt.focus(); return; }

      st.note = $('#f-note', el).value.trim();
      const tx = { type: st.type, amount: st.amount, category: st.category, date: st.date, note: st.note, account: st.account };
      const btn = $('#f-save', el);
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Menyimpan…';
      try {
        if (edit) {
          const r = await api('update', { tx: Object.assign({ id: existing.id, prevType: existing.type }, tx) });
          const i = S.tx.findIndex((t) => t.id === existing.id);
          if (i >= 0) S.tx[i] = Object.assign({}, r.tx, { _seq: S.tx[i]._seq });
          toast('Perubahan tersimpan ke spreadsheet', 'success');
        } else {
          const r = await api('add', { tx });
          S.tx.push(Object.assign({}, r.tx, { _seq: S.seq++ }));
          toast((st.type === 'income' ? 'Pemasukan ' : 'Pengeluaran ') + rp(st.amount) + ' tersimpan ✓', 'success');
        }
        afterLocalChange();
        m.close();
      } catch (e) {
        if (e.network && !edit) {
          const tempId = 'local-' + Date.now();
          S.queue.push({ tempId, tx });
          save(LS.queue, S.queue);
          S.tx.push(Object.assign({}, tx, { id: tempId, pending: true, _seq: S.seq++ }));
          S.offline = true;
          toast('Sedang offline — disimpan di HP & dikirim otomatis saat online', 'warn', 4500);
          afterLocalChange();
          m.close();
        } else {
          toast('Gagal menyimpan: ' + e.message, 'error', 5000);
          btn.disabled = false;
          btn.textContent = edit ? 'Simpan perubahan' : 'Simpan';
        }
      }
    });
  }

  function afterLocalChange() {
    computeColors();
    if (!S.cfg.demo) {
      const cache = load(LS.cache, null);
      if (cache) { cache.transactions = S.tx.filter((t) => !t.pending).map(stripLocal); save(LS.cache, cache); }
    }
    updateSyncStatus();
    refreshView();
  }
  const stripLocal = (t) => ({ id: t.id, type: t.type, date: t.date, amount: t.amount, category: t.category, note: t.note || '', account: t.account || '' });

  /* ---------------- Detail ---------------- */
  function openDetail(id) {
    const t = S.tx.find((x) => x.id === id);
    if (!t) return;
    const m = openModal(
      '<div class="sheet-head"><h3>Detail transaksi</h3><button class="close-x" data-close aria-label="Tutup">×</button></div>' +
      '<div class="detail-amt"><span class="badge ' + t.type + '">' + (t.type === 'income' ? 'Pemasukan' : 'Pengeluaran') + '</span>' +
      '<div class="v num" style="color:' + (t.type === 'income' ? 'var(--income)' : 'var(--ink)') + '">' + (t.type === 'income' ? '+' : '−') + rp(t.amount) + '</div></div>' +
      '<div class="kv"><span class="k">Kategori</span><span class="v">' + esc(t.category) + '</span></div>' +
      '<div class="kv"><span class="k">Tanggal</span><span class="v">' + fmtDay(t.date) + '</span></div>' +
      (t.account ? '<div class="kv"><span class="k">Akun / metode</span><span class="v">' + esc(t.account) + '</span></div>' : '') +
      '<div class="kv"><span class="k">Catatan</span><span class="v">' + (t.note ? esc(t.note) : '<span class="muted">—</span>') + '</span></div>' +
      (t.pending ? '<div class="banner warn" style="margin-top:12px">⏳ Belum terkirim ke spreadsheet. Akan dikirim otomatis saat online.</div>' : '') +
      '<div class="btn-row" style="margin-top:18px">' +
      '<button class="btn btn-danger" id="d-del">Hapus</button>' +
      (t.pending ? '<button class="btn btn-ghost" data-close>Tutup</button>' : '<button class="btn btn-primary" id="d-edit">Edit</button>') + '</div>');
    const ed = $('#d-edit', m.el);
    if (ed) ed.addEventListener('click', () => { m.close(); setTimeout(() => openForm(t), 260); });
    $('#d-del', m.el).addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Hapus transaksi ini?',
        text: '<b>' + esc(t.category) + ' · ' + rp(t.amount) + '</b> (' + fmtDate(t.date) + ')<br>' +
          (t.pending ? 'Transaksi ini belum terkirim, hanya akan dihapus dari HP.' : 'Baris ini juga akan dihapus dari spreadsheet dan tidak bisa dikembalikan.'),
        ok: 'Hapus', danger: true,
      });
      if (!ok) return;
      if (t.pending) {
        S.queue = S.queue.filter((q) => q.tempId !== t.id);
        save(LS.queue, S.queue);
        S.tx = S.tx.filter((x) => x.id !== t.id);
        toast('Transaksi dihapus', 'success');
        m.close();
        afterLocalChange();
        return;
      }
      const btn = $('#d-del', m.el);
      btn.disabled = true; btn.innerHTML = '<span class="spinner" style="border-color:rgba(226,70,108,.3);border-top-color:var(--expense)"></span>';
      try {
        await api('delete', { tx: { id: t.id, type: t.type } });
        S.tx = S.tx.filter((x) => x.id !== t.id);
        toast('Transaksi dihapus dari spreadsheet', 'success');
        m.close();
        afterLocalChange();
      } catch (e) {
        toast('Gagal menghapus: ' + e.message, 'error', 5000);
        btn.disabled = false; btn.textContent = 'Hapus';
      }
    });
  }

  /* ---------------- Periode custom ---------------- */
  function openCustomPeriod() {
    const r = S.period.key === 'custom' ? periodRange() : { start: addDays(today(), -29), end: today() };
    const m = openModal('<div class="sheet-head"><h3>Pilih periode</h3><button class="close-x" data-close aria-label="Tutup">×</button></div>' +
      '<div class="chips" style="margin-bottom:12px">' +
      [['7 hari', 6], ['30 hari', 29], ['90 hari', 89], ['1 tahun', 364]].map(([l, n]) => '<button class="chip" data-n="' + n + '">' + l + ' terakhir</button>').join('') + '</div>' +
      '<div class="filters" style="margin-top:0"><label class="field"><span>Dari</span><input class="input" type="date" id="p-from" value="' + r.start + '"></label>' +
      '<label class="field"><span>Sampai</span><input class="input" type="date" id="p-to" value="' + r.end + '"></label></div>' +
      '<div class="err-text" id="p-err" style="margin-top:6px"></div>' +
      '<button class="btn btn-primary btn-block" id="p-ok" style="margin-top:8px">Terapkan</button>');
    $$('[data-n]', m.el).forEach((b) => b.addEventListener('click', () => {
      $('#p-from', m.el).value = addDays(today(), -b.dataset.n);
      $('#p-to', m.el).value = today();
    }));
    $('#p-ok', m.el).addEventListener('click', () => {
      const s = $('#p-from', m.el).value, e = $('#p-to', m.el).value;
      if (!s || !e) { $('#p-err', m.el).textContent = 'Isi kedua tanggal'; return; }
      if (s > e) { $('#p-err', m.el).textContent = 'Tanggal awal harus sebelum tanggal akhir'; return; }
      S.period = { key: 'custom', start: s, end: e };
      m.close();
      render();
    });
  }

  /* ---------------- Pasang di layar utama ---------------- */
  function openInstallHelp() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const m = openModal('<div class="sheet-head"><h3>Pasang di layar utama</h3><button class="close-x" data-close aria-label="Tutup">×</button></div>' +
      (S.installEvt ? '<button class="btn btn-primary btn-block" id="i-go" style="margin-bottom:16px">📲 Pasang sekarang</button>' : '') +
      '<div class="card" style="box-shadow:none"><b>' + (ios ? 'iPhone (Safari)' : 'Android (Chrome)') + '</b><ol class="steps" style="margin-top:12px">' +
      (ios
        ? '<li>Buka DompetKu di <b>Safari</b>.</li><li>Ketuk tombol <b>Bagikan</b> (kotak dengan panah ke atas).</li><li>Pilih <b>Tambah ke Layar Utama</b>, lalu <b>Tambah</b>.</li>'
        : '<li>Buka DompetKu di <b>Chrome</b>.</li><li>Ketuk menu <b>⋮</b> di kanan atas.</li><li>Pilih <b>Instal aplikasi</b> / <b>Tambahkan ke layar utama</b>.</li>') +
      '</ol></div><button class="btn btn-ghost btn-block" id="i-hide" style="margin-top:14px">Jangan tampilkan pengingat lagi</button>');
    const go = $('#i-go', m.el);
    if (go) go.addEventListener('click', async () => {
      S.installEvt.prompt();
      try { await S.installEvt.userChoice; } catch (e) { /* abaikan */ }
      S.installEvt = null; m.close();
    });
    $('#i-hide', m.el).addEventListener('click', () => { save(LS.installHide, true); m.close(); render(); });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });

  /* ---------------- Mode demo ---------------- */
  function demoDb() {
    let db = load(LS.demo, null);
    if (db) return db;
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const round = (v, s = 1000) => Math.round(v / s) * s;
    const tx = [];
    const exp = [
      ['Makan & Minum', 15000, 85000, ['Makan siang', 'Kopi', 'Sarapan', 'Makan malam', 'GoFood']],
      ['Transportasi', 10000, 60000, ['Ojol ke kantor', 'Bensin', 'KRL', 'Parkir']],
      ['Belanja', 40000, 400000, ['Belanja bulanan', 'Shopee', 'Baju', 'Sabun & sampo']],
      ['Hiburan', 30000, 200000, ['Nonton', 'Langganan streaming', 'Nongkrong']],
      ['Kesehatan', 25000, 250000, ['Apotek', 'Vitamin']],
      ['Sosial & Donasi', 20000, 150000, ['Kondangan', 'Sedekah']],
    ];
    const accs = ['Tunai', 'Transfer Bank', 'E-Wallet'];
    const t0 = today();
    let n = 0;
    const id = () => 'DEMO' + (++n);
    for (let i = 150; i >= 0; i--) {
      const d = addDays(t0, -i);
      const day = parseYmd(d).getDate();
      if (day === 1) {
        tx.push({ id: id(), type: 'expense', date: d, amount: 2500000, category: 'Tagihan & Utilitas', note: 'Sewa kos', account: 'Transfer Bank' });
        tx.push({ id: id(), type: 'expense', date: d, amount: round(350000 + rnd() * 200000), category: 'Tagihan & Utilitas', note: 'Listrik & internet', account: 'E-Wallet' });
      }
      if (day === 25) tx.push({ id: id(), type: 'income', date: d, amount: 9500000, category: 'Gaji', note: 'Gaji bulanan', account: 'Transfer Bank' });
      if (rnd() < 0.06) tx.push({ id: id(), type: 'income', date: d, amount: round(500000 + rnd() * 2500000, 50000), category: 'Usaha / Freelance', note: 'Proyek desain', account: 'Transfer Bank' });
      const k = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) {
        const c = rnd() < 0.5 ? exp[0] : rnd() < 0.55 ? exp[1] : pick(exp);
        tx.push({ id: id(), type: 'expense', date: d, amount: round(c[1] + rnd() * rnd() * (c[2] - c[1]), 500), category: c[0], note: pick(c[3]), account: pick(accs) });
      }
    }
    db = { tx, n };
    save(LS.demo, db);
    return db;
  }
  function demoApi(action, p) {
    return new Promise((resolve, reject) => setTimeout(() => {
      const db = demoDb();
      if (action === 'ping') return resolve({ ok: true });
      if (action === 'list') {
        return resolve({
          ok: true, transactions: db.tx,
          categories: {
            income: ['Gaji', 'Usaha / Freelance', 'Bonus', 'Investasi', 'Hadiah', 'Lainnya'],
            expense: ['Makan & Minum', 'Transportasi', 'Belanja', 'Tagihan & Utilitas', 'Hiburan', 'Kesehatan', 'Sosial & Donasi', 'Pendidikan', 'Rumah Tangga', 'Lainnya'],
          },
          accounts: ['Tunai', 'Transfer Bank', 'E-Wallet'], meta: null,
        });
      }
      if ((action === 'add' || action === 'update') && !(p.tx && p.tx.amount > 0)) return reject(new Error('Nominal harus lebih dari 0.'));
      if (action === 'add') { const tx = Object.assign({}, p.tx, { id: 'DEMO' + (++db.n) }); db.tx.push(tx); save(LS.demo, db); return resolve({ ok: true, tx }); }
      if (action === 'update') {
        const i = db.tx.findIndex((t) => t.id === p.tx.id);
        const tx = { id: p.tx.id, type: p.tx.type, date: p.tx.date, amount: p.tx.amount, category: p.tx.category, note: p.tx.note, account: p.tx.account };
        if (i >= 0) db.tx[i] = tx; save(LS.demo, db); return resolve({ ok: true, tx });
      }
      if (action === 'delete') { db.tx = db.tx.filter((t) => t.id !== p.tx.id); save(LS.demo, db); return resolve({ ok: true }); }
      reject(new Error('Aksi tidak dikenal'));
    }, action === 'list' ? 250 : 450));
  }
  function startDemo() {
    S.cfg = { url: '', token: '', demo: true };
    save(LS.cfg, S.cfg);
    S.hasData = false; S.view = 'home'; S.queue = []; save(LS.queue, []);
    render();
    sync();
  }
  function exitDemo() {
    localStorage.removeItem(LS.demo);
    S.cfg = { url: '', token: '', demo: false };
    save(LS.cfg, S.cfg);
    S.tx = []; S.hasData = false;
    render();
  }

  /* ---------------- Navigasi & start ---------------- */
  function go(view) {
    if (S.view === view) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    S.view = view;
    window.scrollTo(0, 0);
    render();
  }

  /** Mengambil URL & kunci dari teks link setup (".../#setup=xxxx"). */
  function decodeSetup(text) {
    const m = String(text || '').match(/setup=([A-Za-z0-9_\-=]+)/);
    if (!m) return null;
    try {
      let b = m[1].replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
      while (b.length % 4) b += '=';
      const j = JSON.parse(atob(b));
      if (j.u && j.t) return j;
    } catch (e) { /* abaikan */ }
    return null;
  }

  function handleSetupLink() {
    if (!/#setup=/.test(location.hash)) return null;
    const j = decodeSetup(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (j) return j;
    toast('Link setup tidak valid. Buat ulang dari spreadsheet.', 'error', 5000);
    return null;
  }

  function init() {
    $$('#bottomnav [data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
    $('#fab').addEventListener('click', () => openForm());
    $('#btn-refresh').addEventListener('click', () => sync({ toast: true }));
    window.addEventListener('online', () => { S.offline = false; sync(); });
    window.addEventListener('offline', () => { S.offline = true; updateSyncStatus(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isConfigured() && (!S.lastSync || Date.now() - S.lastSync > 120000)) sync();
    });

    const link = handleSetupLink();
    if (link) {
      render();
      toast('Menghubungkan ke spreadsheet…', 'info', 2500);
      connect(link.u, link.t);
      return;
    }

    if (isConfigured() && !S.cfg.demo) {
      const cache = load(LS.cache, null);
      if (cache) { applyData(cache, true); S.lastSync = null; }
    }
    render();
    if (isConfigured()) sync();
    // Pintasan "Tambah transaksi" dari ikon aplikasi (tekan lama ikon di Android).
    if (isConfigured() && new URLSearchParams(location.search).has('add')) {
      history.replaceState(null, '', location.pathname);
      openForm();
    }
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  init();
})();
