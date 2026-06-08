/* ============================================================
   休日当番 Roster — アプリ本体
   ============================================================
   - Firebase Firestore でチーム全体のデータ共有
   - Google OAuth + Calendar API でカレンダー同期
   - JSX で書かれているが、index.html の Babel Standalone が
     ブラウザ内でリアルタイムにトランスパイルする
   ============================================================ */

const { useState, useEffect, useMemo, useRef, Fragment } = React;
const CONFIG = window.APP_CONFIG;

/* ───────── Firebase init ───────── */
firebase.initializeApp(CONFIG.firebase);
const db = firebase.firestore();

/* Firestore helpers */
const staffCol       = () => db.collection('staff');
const submissionsCol = () => db.collection('submissions');
const assignmentsCol = () => db.collection('assignments');
const confirmedCol   = () => db.collection('confirmed');
const metaDoc        = () => db.collection('meta').doc('app');

/* ───────── Date helpers ───────── */
const pad2 = (n) => String(n).padStart(2, '0');
const monthKey = (y, m) => `${y}-${pad2(m + 1)}`;
const subKey = (y, m, sid) => `${monthKey(y, m)}_${sid}`;
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const dowJP = ['日', '月', '火', '水', '木', '金', '土'];

/* ───────── Japanese holidays ───────── */
const _hCache = {};
function getHolidays(year) {
  if (_hCache[year]) return _hCache[year];
  const h = {};
  h[`${year}-01-01`] = '元日';
  h[`${year}-02-11`] = '建国記念の日';
  h[`${year}-02-23`] = '天皇誕生日';
  h[`${year}-04-29`] = '昭和の日';
  h[`${year}-05-03`] = '憲法記念日';
  h[`${year}-05-04`] = 'みどりの日';
  h[`${year}-05-05`] = 'こどもの日';
  h[`${year}-08-11`] = '山の日';
  h[`${year}-11-03`] = '文化の日';
  h[`${year}-11-23`] = '勤労感謝の日';
  const nthMon = (m, n) => {
    const first = new Date(year, m - 1, 1).getDay();
    return ((8 - first) % 7) + 1 + (n - 1) * 7;
  };
  h[`${year}-01-${pad2(nthMon(1, 2))}`]  = '成人の日';
  h[`${year}-07-${pad2(nthMon(7, 3))}`]  = '海の日';
  h[`${year}-09-${pad2(nthMon(9, 3))}`]  = '敬老の日';
  h[`${year}-10-${pad2(nthMon(10, 2))}`] = 'スポーツの日';
  const shun = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const shu  = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  h[`${year}-03-${pad2(shun)}`] = '春分の日';
  h[`${year}-09-${pad2(shu)}`]  = '秋分の日';
  // Substitute holidays (振替休日)
  Object.keys(h).slice().forEach(k => {
    const [y, m, d] = k.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (date.getDay() === 0) {
      let next = new Date(date); next.setDate(d + 1);
      while (h[`${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`]) {
        next.setDate(next.getDate() + 1);
      }
      h[`${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`] = '振替休日';
    }
  });
  _hCache[year] = h;
  return h;
}
const holidayName = (y, m, d) => getHolidays(y)[`${y}-${pad2(m + 1)}-${pad2(d)}`] || null;
const isHoliday   = (y, m, d) => !!holidayName(y, m, d);
const isDutyDay   = (y, m, d) => {
  const dow = new Date(y, m, d).getDay();
  return dow === 0 || dow === 6 || isHoliday(y, m, d);
};
const dutyDaysOf = (y, m) => {
  const out = []; const dim = daysInMonth(y, m);
  for (let d = 1; d <= dim; d++) if (isDutyDay(y, m, d)) out.push(d);
  return out;
};

/* ───────── Color palette ───────── */
const COLORS = [
  { name: 'フォレスト', hex: '#3E7C5A', bg: '#E4EFE8', text: '#234E37' },
  { name: 'コーラル',   hex: '#DB6B4A', bg: '#FAE8E1', text: '#9A3C22' },
  { name: 'インディゴ', hex: '#4A5FA5', bg: '#E7EAF4', text: '#2C3B6E' },
  { name: 'マスタード', hex: '#C2962B', bg: '#F6EFD4', text: '#7F6217' },
  { name: 'ティール',   hex: '#2F8A90', bg: '#DEF0F1', text: '#1E595D' },
  { name: 'プラム',     hex: '#965488', bg: '#F1E5EE', text: '#653558' },
  { name: 'ブリック',   hex: '#AE4E3D', bg: '#F4E2DE', text: '#763127' },
  { name: 'スレート',   hex: '#566F89', bg: '#E7ECF1', text: '#374A5C' },
  { name: 'オリーブ',   hex: '#76863C', bg: '#EEF1DE', text: '#4D5926' },
  { name: 'ローズ',     hex: '#C2647C', bg: '#F6E5E9', text: '#853E4F' },
  { name: 'シアン',     hex: '#3578A0', bg: '#E1EDF4', text: '#234E69' },
  { name: 'ラベンダー', hex: '#7766A4', bg: '#EBE7F2', text: '#4E4275' },
];
const colorOf = (s) => COLORS[((s?.colorIndex ?? 0) % COLORS.length + COLORS.length) % COLORS.length];

/* ───────── Auto-assign algorithm (guarantee everyone ≥1 day) ───────── */
function autoAssign(year, month, staff, submissions, allAssignments) {
  const yearTotals = Object.fromEntries(staff.map(s => [s.id, 0]));
  Object.entries(allAssignments).forEach(([k, m]) => {
    if (!k.startsWith(`${year}-`) || k === monthKey(year, month)) return;
    Object.values(m || {}).forEach(sid => { if (yearTotals[sid] !== undefined) yearTotals[sid]++; });
  });
  const prefs = {};
  staff.forEach(s => {
    const sub = submissions[subKey(year, month, s.id)];
    prefs[s.id] = {
      preferred:   new Set(sub?.preferred   || []),
      available:   new Set(sub?.available   || []),
      unavailable: new Set(sub?.unavailable || []),
      submitted:   !!sub?.submitted,
    };
  });
  const duty = dutyDaysOf(year, month);
  const assignments = {};
  const monthCount = Object.fromEntries(staff.map(s => [s.id, 0]));
  const submitted = staff.filter(s => prefs[s.id].submitted);
  const tier = (sid, d) => prefs[sid].preferred.has(d) ? 0 : prefs[sid].available.has(d) ? 1 : 2;
  const feasible = (sid, d) => !prefs[sid].unavailable.has(d);
  const openDays = () => duty.filter(d => assignments[d] === undefined);

  // Phase 1: guarantee everyone at least 1 day
  const placedOnce = new Set();
  const unplaced = [];
  while (true) {
    const open = openDays();
    const remaining = submitted.filter(s => !placedOnce.has(s.id));
    if (remaining.length === 0 || open.length === 0) break;
    const optionsOf = {};
    remaining.forEach(s => { optionsOf[s.id] = open.filter(d => feasible(s.id, d)); });
    remaining.sort((a, b) => {
      const d1 = optionsOf[a.id].length - optionsOf[b.id].length;
      if (d1 !== 0) return d1;
      const d2 = yearTotals[a.id] - yearTotals[b.id];
      return d2 !== 0 ? d2 : Math.random() - 0.5;
    });
    const s = remaining[0];
    const opts = optionsOf[s.id];
    if (opts.length === 0) { placedOnce.add(s.id); unplaced.push(s.id); continue; }
    const best = [...opts].sort((d1, d2) => {
      const t = tier(s.id, d1) - tier(s.id, d2);
      if (t !== 0) return t;
      return d1 - d2;
    })[0];
    assignments[best] = s.id;
    placedOnce.add(s.id);
    monthCount[s.id]++;
    yearTotals[s.id]++;
  }

  // Phase 2: fill remaining
  for (const d of openDays()) {
    const eligible = submitted.filter(s => feasible(s.id, d));
    let pool = eligible.length ? eligible : submitted;
    if (pool.length === 0) continue;
    const want = pool.filter(s => prefs[s.id].preferred.has(d));
    const avail = pool.filter(s => prefs[s.id].available.has(d));
    const finalPool = want.length ? want : avail.length ? avail : pool;
    const sorted = [...finalPool].sort((a, b) => {
      const m = monthCount[a.id] - monthCount[b.id];
      if (m !== 0) return m;
      const y = yearTotals[a.id] - yearTotals[b.id];
      return y !== 0 ? y : Math.random() - 0.5;
    });
    assignments[d] = sorted[0].id;
    monthCount[sorted[0].id]++;
    yearTotals[sorted[0].id]++;
  }
  return { assignments, unplaced };
}

/* ───────── Toast ───────── */
function useToast() {
  const [toasts, setToasts] = useState([]);
  const push = (msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  };
  const Host = () => (
    <div className="fixed top-6 right-6 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div key={t.id} className={`anim-slideIn px-4 py-3 border-l-4 bg-white shadow-lg text-sm ${
          t.type === 'success' ? 'border-emerald-700 text-emerald-900' :
          t.type === 'error'   ? 'border-red-700 text-red-900' :
          t.type === 'warn'    ? 'border-amber-700 text-amber-900' :
                                 'border-stone-700 text-stone-900'
        }`}>{t.msg}</div>
      ))}
    </div>
  );
  return { push, Host };
}

/* ───────── Google Calendar Sync ───────── */
let _gcInited = false;
let _tokenClient = null;
let _accessToken = null;

function initGoogleClient() {
  return new Promise((resolve, reject) => {
    if (_gcInited) return resolve();
    if (typeof window.gapi === 'undefined' || typeof window.google === 'undefined') {
      return reject(new Error('Google API がまだ読み込まれていません。少し待ってから再試行してください。'));
    }
    window.gapi.load('client', async () => {
      try {
        await window.gapi.client.init({
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
        });
        _tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.google.clientId,
          scope: 'https://www.googleapis.com/auth/calendar.events',
          callback: '', // set per-request
        });
        _gcInited = true;
        resolve();
      } catch (e) { reject(e); }
    });
  });
}

function requestAccessToken() {
  return new Promise((resolve, reject) => {
    if (!_tokenClient) return reject(new Error('OAuth クライアントが未初期化です'));
    _tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error));
      _accessToken = resp.access_token;
      resolve(resp.access_token);
    };
    _tokenClient.requestAccessToken({ prompt: _accessToken ? '' : 'consent' });
  });
}

async function syncToCalendar(year, month, monthAssignments, staffById, onProgress) {
  await initGoogleClient();
  await requestAccessToken();
  window.gapi.client.setToken({ access_token: _accessToken });
  const calId = CONFIG.google.calendarId;
  const days = Object.keys(monthAssignments).map(Number).sort((a, b) => a - b);
  let done = 0, created = 0, updated = 0, errors = [];

  // Fetch existing events tagged with our extendedProperties (so we can update or skip)
  const timeMin = new Date(year, month, 1).toISOString();
  const timeMax = new Date(year, month + 1, 1).toISOString();
  let existingByDay = {};
  try {
    const res = await window.gapi.client.calendar.events.list({
      calendarId: calId, timeMin, timeMax, singleEvents: true,
      privateExtendedProperty: 'app=duty-roster',
      maxResults: 250,
    });
    (res.result.items || []).forEach(ev => {
      const d = ev.extendedProperties?.private?.day;
      if (d) existingByDay[Number(d)] = ev;
    });
  } catch (e) {
    // If listing fails, we'll just create events (may produce duplicates)
    console.warn('Existing events fetch failed:', e);
  }

  for (const d of days) {
    const sid = monthAssignments[d];
    const s = staffById[sid];
    if (!s) { done++; continue; }
    const startDate = `${year}-${pad2(month + 1)}-${pad2(d)}`;
    const end = new Date(year, month, d + 1);
    const endDate = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
    const ev = {
      summary: `【当番】${s.name}`,
      description: `${CONFIG.org.name} 休日当番\n担当: ${s.name} (${s.email})`,
      start: { date: startDate },
      end:   { date: endDate },
      colorId: String((s.colorIndex % 11) + 1),
      extendedProperties: { private: { app: 'duty-roster', day: String(d), staffId: sid, month: monthKey(year, month) } },
    };
    try {
      if (existingByDay[d]) {
        await window.gapi.client.calendar.events.update({
          calendarId: calId, eventId: existingByDay[d].id, resource: ev,
        });
        updated++;
      } else {
        await window.gapi.client.calendar.events.insert({ calendarId: calId, resource: ev });
        created++;
      }
    } catch (e) {
      errors.push({ day: d, error: e?.result?.error?.message || e.message });
    }
    done++;
    onProgress && onProgress(done, days.length);
  }
  return { created, updated, errors };
}

/* ───────── Main App ───────── */
function App() {
  const [hydrated, setHydrated] = useState(false);
  const [staff, setStaff] = useState([]);
  const [submissions, setSubmissions] = useState({});
  const [assignments, setAssignments] = useState({});
  const [confirmed, setConfirmed] = useState({});
  const [view, setView] = useState('login');
  const [adminMode, setAdminMode] = useState('admin');
  const [currentUser, setCurrentUser] = useState(null);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const { push, Host: ToastHost } = useToast();

  /* Initial seed (first-run): write SEED_STAFF to Firestore if empty */
  useEffect(() => {
    (async () => {
      try {
        const snap = await staffCol().get();
        if (snap.empty) {
          const batch = db.batch();
          CONFIG.seedStaff.forEach(s => {
            batch.set(staffCol().doc(s.id), { ...s, invitedAt: Date.now(), acceptedAt: Date.now() });
          });
          await batch.commit();
        }
      } catch (e) {
        console.error('Seed write failed', e);
      }
    })();
  }, []);

  /* Realtime subscriptions */
  useEffect(() => {
    const u1 = staffCol().onSnapshot(snap => {
      const arr = []; snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      arr.sort((a, b) => (a.colorIndex ?? 0) - (b.colorIndex ?? 0));
      setStaff(arr); setHydrated(true);
    });
    const u2 = submissionsCol().onSnapshot(snap => {
      const o = {}; snap.forEach(d => { o[d.id] = d.data(); });
      setSubmissions(o);
    });
    const u3 = assignmentsCol().onSnapshot(snap => {
      const o = {}; snap.forEach(d => { o[d.id] = d.data().days || {}; });
      setAssignments(o);
    });
    const u4 = confirmedCol().onSnapshot(snap => {
      const o = {}; snap.forEach(d => { o[d.id] = d.data().confirmed === true; });
      setConfirmed(o);
    });
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  const mk = monthKey(year, month);
  const monthAssignments = assignments[mk] || {};
  const isConfirmed = !!confirmed[mk];
  const activeStaff = useMemo(() => staff.filter(s => s.status === 'active'), [staff]);
  const staffById = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s])), [staff]);

  const submissionStatus = useMemo(() => {
    return activeStaff.reduce((acc, s) => {
      const sub = submissions[subKey(year, month, s.id)];
      acc[s.id] = sub?.submitted ? 'submitted' : sub ? 'draft' : 'pending';
      return acc;
    }, {});
  }, [activeStaff, submissions, year, month]);
  const submittedCount = Object.values(submissionStatus).filter(s => s === 'submitted').length;

  /* Handlers */
  const saveSubmission = async (sid, data) => {
    const key = subKey(year, month, sid);
    await submissionsCol().doc(key).set({ ...data, year, month, staffId: sid, timestamp: Date.now() });
  };

  const doAutoAssign = async () => {
    if (submittedCount === 0) { push('提出済みのスタッフがいません', 'warn'); return; }
    const { assignments: result, unplaced } = autoAssign(year, month, activeStaff, submissions, assignments);
    await assignmentsCol().doc(mk).set({ days: result, year, month, updatedAt: Date.now() });
    const dayCount = Object.keys(result).length;
    if (unplaced.length === 0) {
      push(`${month + 1}月の自動振分が完了。提出者全員に最低1回ずつ割当てました（${dayCount}日分）`, 'success');
    } else {
      const names = unplaced.map(id => staffById[id]?.name).filter(Boolean).join('、');
      push(`${month + 1}月を振分けました（${dayCount}日分）。${names} は不可日が多く割当てできませんでした`, 'warn');
    }
  };

  const reassignDay = async (day, sid) => {
    const next = { ...(assignments[mk] || {}), [day]: sid };
    await assignmentsCol().doc(mk).set({ days: next, year, month, updatedAt: Date.now() });
  };
  const clearDay = async (day) => {
    const next = { ...(assignments[mk] || {}) }; delete next[day];
    await assignmentsCol().doc(mk).set({ days: next, year, month, updatedAt: Date.now() });
  };

  const confirmMonth = async () => {
    await confirmedCol().doc(mk).set({ confirmed: true, year, month, confirmedAt: Date.now() });
  };
  const unconfirmMonth = async () => {
    await confirmedCol().doc(mk).set({ confirmed: false, year, month });
  };

  const promoteToAdmin = async (id) => {
    await staffCol().doc(id).update({ role: 'admin' });
    push('管理者に昇格しました', 'success');
  };
  const demoteFromAdmin = async (id) => {
    const admins = staff.filter(s => s.role === 'admin' && s.status === 'active').length;
    if (admins <= 1) { push('最後の管理者は降格できません', 'error'); return; }
    if (!confirm('管理者権限を解除しますか？')) return;
    await staffCol().doc(id).update({ role: 'staff' });
    push('管理者権限を解除しました', 'info');
    if (currentUser?.id === id) setAdminMode('staff');
  };
  const transferAdminTo = async (id) => {
    if (!currentUser) return;
    const target = staffById[id];
    if (!confirm(`管理者権限を ${target.name} さんに完全委譲しますか？\nあなたは通常スタッフになります。`)) return;
    const batch = db.batch();
    batch.update(staffCol().doc(id), { role: 'admin' });
    batch.update(staffCol().doc(currentUser.id), { role: 'staff' });
    await batch.commit();
    push(`管理者権限を ${target.name} さんに委譲しました`, 'success');
    setAdminMode('staff');
  };

  const resetAll = async () => {
    if (!confirm('全データをリセットして初期スタッフに戻しますか？\n（希望提出・割当・確定もすべて消去されます）')) return;
    const collections = ['staff', 'submissions', 'assignments', 'confirmed'];
    for (const col of collections) {
      const snap = await db.collection(col).get();
      const batch = db.batch();
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    const batch2 = db.batch();
    CONFIG.seedStaff.forEach(s => {
      batch2.set(staffCol().doc(s.id), { ...s, invitedAt: Date.now(), acceptedAt: Date.now() });
    });
    await batch2.commit();
    push('データをリセットしました', 'info');
    setView('login'); setCurrentUser(null);
  };

  if (!hydrated) {
    return <div className="min-h-screen flex items-center justify-center text-emerald-900 jp-serif">読み込み中...</div>;
  }

  return (
    <Fragment>
      <ToastHost />
      {view === 'login' && (
        <LoginScreen
          staff={staff}
          onLogin={(s) => {
            if (s.status === 'invited') {
              staffCol().doc(s.id).update({ status: 'active', acceptedAt: Date.now() });
              s = { ...s, status: 'active' };
            }
            setView(s.role === 'admin' ? 'admin' : 'staff');
            setAdminMode('admin');
            setCurrentUser(s);
          }}
          onReset={resetAll}
        />
      )}
      {view === 'staff' && currentUser && (() => {
        const live = staffById[currentUser.id] || currentUser;
        return <StaffView user={live} year={year} month={month} setYear={setYear} setMonth={setMonth}
          submissions={submissions} saveSubmission={saveSubmission}
          monthAssignments={monthAssignments} isConfirmed={isConfirmed} assignments={assignments}
          onLogout={() => { setView('login'); setCurrentUser(null); }} push={push} />;
      })()}
      {view === 'admin' && currentUser && (() => {
        const live = staffById[currentUser.id];
        if (!live || live.role !== 'admin') {
          return <StaffView user={live || currentUser} year={year} month={month} setYear={setYear} setMonth={setMonth}
            submissions={submissions} saveSubmission={saveSubmission}
            monthAssignments={monthAssignments} isConfirmed={isConfirmed} assignments={assignments}
            onLogout={() => { setView('login'); setCurrentUser(null); }} push={push} />;
        }
        if (adminMode === 'staff') {
          return <StaffView user={live} year={year} month={month} setYear={setYear} setMonth={setMonth}
            submissions={submissions} saveSubmission={saveSubmission}
            monthAssignments={monthAssignments} isConfirmed={isConfirmed} assignments={assignments}
            onLogout={() => { setView('login'); setCurrentUser(null); }} push={push}
            adminBacklink={() => setAdminMode('admin')} />;
        }
        return <AdminView currentUser={live} year={year} month={month} setYear={setYear} setMonth={setMonth}
          staff={activeStaff} allStaff={staff} staffById={staffById}
          submissions={submissions} assignments={assignments}
          monthAssignments={monthAssignments} submissionStatus={submissionStatus}
          submittedCount={submittedCount} isConfirmed={isConfirmed}
          onAutoAssign={doAutoAssign} onReassign={reassignDay} onClearDay={clearDay}
          onConfirm={confirmMonth} onUnconfirm={unconfirmMonth}
          onPromote={promoteToAdmin} onDemote={demoteFromAdmin} onTransfer={transferAdminTo}
          onSwitchToStaff={() => setAdminMode('staff')}
          onLogout={() => { setView('login'); setCurrentUser(null); }} push={push} />;
      })()}
    </Fragment>
  );
}

/* ───────── Login Screen ───────── */
function LoginScreen({ staff, onLogin, onReset }) {
  const sorted = [...staff].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return (a.colorIndex ?? 0) - (b.colorIndex ?? 0);
  });
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ background: 'linear-gradient(180deg, #F4F1EA 0%, #EDE7DB 100%)' }}>
      <div className="max-w-xl w-full">
        <div className="text-center mb-8 anim-fadeUp">
          <div className="inline-flex items-center gap-2 text-emerald-900 mb-3">
            <div className="h-px w-12 bg-emerald-900/40" />
            <span className="jp-sans text-xs tracking-[0.3em]">{CONFIG.org.nameRomaji}</span>
            <div className="h-px w-12 bg-emerald-900/40" />
          </div>
          <h1 className="display text-5xl md:text-6xl font-medium text-emerald-950">休日当番 <span className="italic">Roster</span></h1>
          <p className="jp-serif text-stone-600 mt-3 text-sm">{CONFIG.org.name} スタッフ予定管理システム</p>
        </div>
        <div className="bg-white border border-stone-200 shadow-sm anim-fadeUp">
          <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center">
            <h2 className="jp-serif text-base text-stone-800">ログイン</h2>
            <span className="jp-sans text-xs text-stone-500 ml-auto">{staff.length} 名</span>
          </div>
          <div className="divide-y divide-stone-100 max-h-[60vh] overflow-y-auto">
            {sorted.map(s => {
              const c = colorOf(s);
              return (
                <button key={s.id} onClick={() => onLogin(s)}
                  className="w-full text-left px-5 py-3.5 hover:bg-amber-50/40 flex items-center gap-3 group">
                  <div className="w-10 h-10 flex items-center justify-center jp-serif text-white shrink-0 relative" style={{ backgroundColor: c.hex }}>
                    {s.name.slice(0, 1)}
                    {s.role === 'admin' && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-950 text-amber-50 flex items-center justify-center text-[8px]">🛡</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="jp-serif text-stone-900 flex items-center gap-2 flex-wrap">
                      {s.name}
                      {s.role === 'admin' && <span className="jp-sans text-[10px] tracking-wider px-2 py-0.5 bg-emerald-900 text-amber-50">管理者</span>}
                      {s.status === 'invited' && <span className="jp-sans text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300">招待中</span>}
                    </div>
                    <div className="jp-sans text-xs text-stone-500 truncate">{s.email}</div>
                  </div>
                  <span className="text-emerald-900 opacity-0 group-hover:opacity-100 text-sm">→</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-between items-center mt-6">
          <p className="jp-sans text-xs text-stone-500">クリックで即ログイン</p>
          <button onClick={onReset} className="jp-sans text-[11px] text-stone-400 hover:text-red-600">データをリセット</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── Common: Header, MonthNav ───────── */
function Header({ user, onLogout, subtitle, onSwitchToStaff, adminBacklink }) {
  const c = user ? colorOf(user) : null;
  return (
    <header className="bg-emerald-950 text-amber-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="display text-2xl">休日当番 <span className="italic opacity-70">Roster</span></div>
          <span className="hidden md:inline jp-sans text-xs opacity-60 tracking-wider">{subtitle}</span>
        </div>
        <div className="flex items-center gap-3">
          {onSwitchToStaff && (
            <button onClick={onSwitchToStaff} className="jp-sans text-xs px-3 py-1.5 border border-amber-50/30 hover:bg-emerald-900">スタッフ画面へ</button>
          )}
          {adminBacklink && (
            <button onClick={adminBacklink} className="jp-sans text-xs px-3 py-1.5 border border-amber-50/30 hover:bg-emerald-900">管理者画面へ</button>
          )}
          {user && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 flex items-center justify-center jp-serif text-xs text-white" style={{ backgroundColor: c.hex }}>{user.name.slice(0, 1)}</div>
              <div className="text-right">
                <div className="jp-serif text-sm flex items-center gap-1.5">
                  {user.name}
                  {user.role === 'admin' && <span className="jp-sans text-[9px] px-1.5 py-0.5 bg-amber-50/10 border border-amber-50/30">管理者</span>}
                </div>
              </div>
            </div>
          )}
          <button onClick={onLogout} className="jp-sans text-xs px-3 py-1.5 hover:bg-emerald-900">ログアウト</button>
        </div>
      </div>
    </header>
  );
}

function MonthNav({ year, month, setYear, setMonth }) {
  const prev = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };
  return (
    <div className="flex items-center gap-4">
      <button onClick={prev} className="p-1.5 hover:bg-stone-100 text-stone-600 text-xl">‹</button>
      <div className="text-center min-w-[140px]">
        <div className="display text-3xl text-emerald-950 leading-none">{month + 1}<span className="text-lg opacity-60 ml-1">月</span></div>
        <div className="jp-sans text-xs text-stone-500 mt-1">{year}年</div>
      </div>
      <button onClick={next} className="p-1.5 hover:bg-stone-100 text-stone-600 text-xl">›</button>
    </div>
  );
}

/* ───────── Staff View ───────── */
function StaffView({ user, year, month, setYear, setMonth, submissions, saveSubmission, monthAssignments, isConfirmed, assignments, onLogout, push, adminBacklink }) {
  const c = colorOf(user);
  const key = subKey(year, month, user.id);
  const current = submissions[key] || { preferred: [], available: [], unavailable: [], submitted: false };
  const [preferred, setPreferred]     = useState(current.preferred || []);
  const [available, setAvailable]     = useState(current.available || []);
  const [unavailable, setUnavailable] = useState(current.unavailable || []);
  const [submitted, setSubmitted]     = useState(current.submitted || false);

  useEffect(() => {
    const c = submissions[key] || { preferred: [], available: [], unavailable: [], submitted: false };
    setPreferred(c.preferred || []); setAvailable(c.available || []);
    setUnavailable(c.unavailable || []); setSubmitted(c.submitted || false);
  }, [key, JSON.stringify(submissions[key] || {})]);

  const cycle = (d) => {
    if (isConfirmed) return;
    const isPref = preferred.includes(d), isAv = available.includes(d), isUn = unavailable.includes(d);
    if (!isPref && !isAv && !isUn) setAvailable(a => [...a, d]);
    else if (isAv) { setAvailable(a => a.filter(x => x !== d)); setPreferred(p => [...p, d]); }
    else if (isPref) { setPreferred(p => p.filter(x => x !== d)); setUnavailable(u => [...u, d]); }
    else setUnavailable(u => u.filter(x => x !== d));
    setSubmitted(false);
  };

  const saveDraft = () => { saveSubmission(user.id, { preferred, available, unavailable, submitted: false }); push('下書きを保存しました', 'info'); };
  const submit    = () => { saveSubmission(user.id, { preferred, available, unavailable, submitted: true }); setSubmitted(true); push(`${month + 1}月の希望を提出しました`, 'success'); };

  const days = daysInMonth(year, month);
  const firstDow = new Date(year, month, 1).getDay();
  const dutyD = dutyDaysOf(year, month);
  const unenteredCount = dutyD.filter(d => !preferred.includes(d) && !available.includes(d) && !unavailable.includes(d)).length;

  const myDays = Object.entries(monthAssignments).filter(([_, sid]) => sid === user.id).map(([d]) => Number(d));
  const myYearTotal = Object.entries(assignments).reduce((acc, [k, m]) => {
    if (!k.startsWith(`${year}-`)) return acc;
    return acc + Object.values(m || {}).filter(s => s === user.id).length;
  }, 0);

  return (
    <div className="min-h-screen">
      <Header user={user} onLogout={onLogout} subtitle="スタッフ画面" adminBacklink={adminBacklink} />
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 flex items-center justify-center jp-serif text-2xl text-white shrink-0" style={{ backgroundColor: c.hex }}>{user.name.slice(0, 1)}</div>
            <div>
              <p className="jp-sans text-xs tracking-widest text-stone-500 mb-1">SUBMIT YOUR PREFERENCE</p>
              <h2 className="display text-3xl text-emerald-950">{user.name} さんの希望提出</h2>
              <p className="jp-sans text-xs text-stone-500 mt-1 flex items-center gap-1.5">
                あなたの色: <span className="inline-block w-3 h-3" style={{ backgroundColor: c.hex }} />
                <span style={{ color: c.text }}>{c.name}</span>
              </p>
            </div>
          </div>
          <MonthNav year={year} month={month} setYear={setYear} setMonth={setMonth} />
        </div>

        {isConfirmed && (
          <div className="mb-6 px-5 py-3 bg-emerald-50 border-l-4 border-emerald-700 flex items-center gap-3">
            <span className="text-emerald-700">🔒</span>
            <span className="jp-sans text-sm text-emerald-900">この月の予定は確定済みです。</span>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-stone-200 p-6">
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <h3 className="jp-serif text-lg text-stone-800">当番日の希望を入力</h3>
              <div className="flex items-center gap-2.5 text-xs jp-sans flex-wrap">
                <span className="flex items-center gap-1.5"><span className="w-4 h-4 border-2 border-stone-300 bg-white" />未入力</span>
                <span className="flex items-center gap-1.5"><span className="w-4 h-4 border-2 border-emerald-600 bg-emerald-50 flex items-center justify-center text-emerald-700 text-[10px] font-bold">○</span>可能</span>
                <span className="flex items-center gap-1.5"><span className="w-4 h-4 border-2 border-amber-600 bg-amber-100 flex items-center justify-center text-amber-700 text-[10px] font-bold">◎</span>是非やりたい</span>
                <span className="flex items-center gap-1.5"><span className="w-4 h-4 border-2 border-red-700 bg-red-700 flex items-center justify-center text-amber-50 text-[10px] font-bold">×</span>不可能</span>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1.5 mb-2">
              {dowJP.map((d, i) => (
                <div key={d} className={`text-center jp-sans text-xs py-2 ${i === 0 ? 'text-red-700' : i === 6 ? 'text-blue-700' : 'text-stone-500'}`}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: firstDow }).map((_, i) => <div key={'b' + i} />)}
              {Array.from({ length: days }, (_, i) => i + 1).map(d => (
                <PreferenceCell key={d} day={d} dow={new Date(year, month, d).getDay()}
                  duty={isDutyDay(year, month, d)} holiday={holidayName(year, month, d)}
                  pref={preferred.includes(d)} avail={available.includes(d)} una={unavailable.includes(d)}
                  locked={isConfirmed} onCycle={() => cycle(d)} />
              ))}
            </div>

            {!isConfirmed && (
              <div className="mt-6 pt-5 border-t border-stone-200 flex flex-wrap items-center gap-3 justify-between">
                <div className="jp-sans text-xs text-stone-600">クリックで「未入力 → 可能 → 是非やりたい → 不可能」と切替</div>
                <div className="flex gap-2">
                  <button onClick={saveDraft} className="jp-sans text-sm px-4 py-2 border border-stone-300 text-stone-700 hover:bg-stone-50">下書き保存</button>
                  <button onClick={submit} className="jp-sans text-sm px-5 py-2 bg-emerald-900 text-amber-50 hover:bg-emerald-800">提出する</button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-white border border-stone-200 p-5">
              <p className="jp-sans text-xs tracking-widest text-stone-500 mb-2">STATUS</p>
              <div className="flex items-center gap-2">
                <span className={submitted ? 'text-emerald-700' : preferred.length || available.length || unavailable.length ? 'text-amber-600' : 'text-stone-400'}>
                  {submitted ? '✓' : preferred.length || available.length || unavailable.length ? '◔' : '○'}
                </span>
                <span className="jp-serif text-stone-800">{submitted ? '提出済' : (preferred.length || available.length || unavailable.length) ? '下書き' : '未入力'}</span>
              </div>
              <div className="mt-4 space-y-1.5 text-sm jp-sans">
                <div className="flex justify-between"><span className="text-stone-600">◎ 是非やりたい</span><span className="text-amber-700 font-medium">{preferred.length} 日</span></div>
                <div className="flex justify-between"><span className="text-stone-600">○ 可能</span><span className="text-emerald-700 font-medium">{available.length} 日</span></div>
                <div className="flex justify-between"><span className="text-stone-600">× 不可能</span><span className="text-red-800 font-medium">{unavailable.length} 日</span></div>
                <div className="flex justify-between border-t border-stone-100 pt-1.5 mt-1.5"><span className="text-stone-400">未入力</span><span className="text-stone-400 font-medium">{unenteredCount} 日</span></div>
              </div>
            </div>

            <div className="bg-white border border-stone-200 p-5">
              <p className="jp-sans text-xs tracking-widest text-stone-500 mb-2">MY DUTY THIS MONTH</p>
              {myDays.length === 0 ? <p className="jp-sans text-sm text-stone-500">まだ割当てがありません</p>
                : <div className="flex flex-wrap gap-1.5 mt-2">
                    {myDays.sort((a,b)=>a-b).map(d => (
                      <span key={d} className="inline-flex items-center justify-center w-9 h-9 text-sm jp-serif" style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.hex}` }}>{d}</span>
                    ))}
                  </div>}
            </div>

            <div className="bg-emerald-950 text-amber-50 p-5">
              <p className="jp-sans text-xs tracking-widest opacity-70 mb-1">{year} 年度累計</p>
              <div className="flex items-baseline gap-2">
                <span className="display text-5xl">{myYearTotal}</span>
                <span className="jp-serif opacity-80">回</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreferenceCell({ day, dow, duty, holiday, pref, avail, una, locked, onCycle }) {
  if (!duty) {
    const faded = dow === 0 ? 'text-red-300' : dow === 6 ? 'text-blue-300' : 'text-stone-300';
    return <div className={`aspect-square flex items-start p-1.5 jp-serif text-sm ${faded}`}>{day}</div>;
  }
  const dowClr = dow === 0 ? 'text-red-700' : dow === 6 ? 'text-blue-700' : 'text-stone-700';
  let cls = 'relative aspect-square flex flex-col p-1.5 jp-serif border-2 transition-all select-none ';
  let badge = null, badgeCls = '';
  if (pref)       { cls += 'bg-amber-100 border-amber-600 text-amber-900 '; badge = '◎'; badgeCls = 'text-amber-700'; }
  else if (avail) { cls += 'bg-emerald-50 border-emerald-500 text-emerald-800 '; badge = '○'; badgeCls = 'text-emerald-600'; }
  else if (una)   { cls += 'bg-red-700 border-red-700 text-amber-50 '; badge = '×'; badgeCls = 'text-amber-50'; }
  else            { cls += `bg-white border-stone-300 ${dowClr} hover:border-stone-400 `; }
  cls += locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer';
  return (
    <button disabled={locked} onClick={onCycle} className={cls}>
      <div className="flex items-start justify-between w-full leading-none">
        <span className="text-sm font-medium">{day}</span>
        {holiday && <span className={`text-[8px] px-1 leading-tight ${pref ? 'bg-amber-200 text-amber-800' : avail ? 'bg-emerald-100 text-emerald-700' : una ? 'bg-white/20 text-amber-50' : 'bg-red-50 text-red-700'}`}>祝</span>}
      </div>
      {holiday && <span className={`text-[9px] leading-tight truncate mt-0.5 ${pref ? 'text-amber-700' : avail ? 'text-emerald-700' : una ? 'opacity-80' : 'text-red-600'}`}>{holiday}</span>}
      {badge && <div className={`text-center text-lg leading-none font-bold mt-auto ${badgeCls}`}>{badge}</div>}
    </button>
  );
}

/* ───────── Admin View ───────── */
function AdminView(props) {
  const [tab, setTab] = useState('month');
  const { currentUser, onSwitchToStaff } = props;
  return (
    <div className="min-h-screen">
      <Header user={currentUser} onLogout={props.onLogout} subtitle="管理者画面" onSwitchToStaff={onSwitchToStaff} />
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="jp-sans text-xs tracking-widest text-stone-500 mb-1">ADMIN DASHBOARD</p>
            <h2 className="display text-3xl text-emerald-950">当番管理ダッシュボード</h2>
          </div>
          <div className="flex gap-1 border border-stone-300 bg-white">
            {[{id:'month',label:'月間管理'},{id:'staff',label:'スタッフ管理'}].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`jp-sans text-sm px-4 py-2 ${tab===t.id ? 'bg-emerald-900 text-amber-50' : 'text-stone-600 hover:bg-stone-50'}`}>{t.label}</button>
            ))}
          </div>
        </div>
        {tab === 'month' && <MonthTab {...props} />}
        {tab === 'staff' && <StaffTab {...props} />}
      </div>
    </div>
  );
}

/* ───────── Month Tab ───────── */
function MonthTab({ year, month, setYear, setMonth, staff, staffById, monthAssignments, submissionStatus, submittedCount, isConfirmed, onAutoAssign, onReassign, onClearDay, onConfirm, onUnconfirm, submissions, push, assignments }) {
  const days = daysInMonth(year, month);
  const firstDow = new Date(year, month, 1).getDay();
  const [editing, setEditing] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProg, setSyncProg] = useState({ done: 0, total: 0 });
  const dutyD = useMemo(() => dutyDaysOf(year, month), [year, month]);
  const assignedCount = dutyD.filter(d => monthAssignments[d]).length;
  const monthCounts = staff.reduce((a, s) => { a[s.id] = Object.values(monthAssignments).filter(x => x === s.id).length; return a; }, {});
  const pct = staff.length ? Math.round((submittedCount / staff.length) * 100) : 0;

  const doConfirmAndSync = async () => {
    if (!confirm(`${month + 1}月の予定を確定し、Googleカレンダー (${CONFIG.org.name}スタッフ予定表) に同期します。\nよろしいですか？`)) return;
    try {
      setSyncing(true); setSyncProg({ done: 0, total: Object.keys(monthAssignments).length });
      const result = await syncToCalendar(year, month, monthAssignments, staffById, (done, total) => setSyncProg({ done, total }));
      await onConfirm();
      const msg = `カレンダー同期完了: 新規${result.created}件・更新${result.updated}件${result.errors.length ? `・エラー${result.errors.length}件` : ''}`;
      push(msg, result.errors.length ? 'warn' : 'success');
      if (result.errors.length) console.warn('Sync errors:', result.errors);
    } catch (e) {
      console.error(e);
      push(`同期失敗: ${e.message || e}`, 'error');
    } finally { setSyncing(false); }
  };

  return (
    <Fragment>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-3 bg-white border border-stone-200 px-5 py-3">
        <MonthNav year={year} month={month} setYear={setYear} setMonth={setMonth} />
        <div className="flex items-center gap-2">
          {isConfirmed ? (
            <Fragment>
              <span className="jp-sans text-xs text-amber-700 flex items-center gap-1.5">🔒 確定済</span>
              <button onClick={onUnconfirm} className="jp-sans text-xs px-3 py-1.5 border border-stone-300 text-stone-600 hover:bg-stone-50">確定取消</button>
              <button onClick={doConfirmAndSync} disabled={syncing} className="jp-sans text-sm px-4 py-2 bg-blue-700 text-amber-50 hover:bg-blue-800 disabled:opacity-50">
                {syncing ? `同期中 ${syncProg.done}/${syncProg.total}` : '🔄 カレンダー再同期'}
              </button>
            </Fragment>
          ) : (
            <Fragment>
              <button onClick={onAutoAssign} disabled={submittedCount === 0}
                className="jp-sans text-sm px-4 py-2 bg-emerald-900 text-amber-50 hover:bg-emerald-800 disabled:opacity-40">✨ 自動振分</button>
              <button onClick={doConfirmAndSync} disabled={assignedCount === 0 || syncing}
                className="jp-sans text-sm px-4 py-2 bg-amber-700 text-amber-50 hover:bg-amber-600 disabled:opacity-40">
                {syncing ? `同期中 ${syncProg.done}/${syncProg.total}` : '📤 確定 & カレンダー転送'}
              </button>
            </Fragment>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4 bg-stone-50 border border-stone-200 px-5 py-2.5 text-xs jp-sans">
        <span className="flex items-baseline gap-1.5"><span className="text-stone-500">提出</span><span className="display text-lg text-stone-800">{submittedCount}/{staff.length}</span><span className="text-stone-400 text-[11px]">{pct}%</span></span>
        <span className="h-4 w-px bg-stone-300" />
        <span className="flex items-baseline gap-1.5"><span className="text-stone-500">割当</span><span className="display text-lg text-stone-800">{assignedCount}/{dutyD.length}</span></span>
        <span className="h-4 w-px bg-stone-300" />
        <span className="flex items-baseline gap-1.5"><span className="text-stone-500">未提出</span><span className={`display text-lg ${staff.length-submittedCount > 0 ? 'text-amber-700' : 'text-emerald-800'}`}>{staff.length - submittedCount}</span></span>
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 border-2 border-dashed border-red-400" />未割当</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 border-l-[3px]" style={{ borderLeftColor: '#3E7C5A', borderTop: '1px solid #ccc', borderRight: '1px solid #ccc', borderBottom: '1px solid #ccc' }} />担当者色</span>
        </div>
      </div>

      <div className="flex gap-4 items-start">
        <div className="bg-white border border-stone-200 p-4 md:p-5 flex-1 min-w-0">
          <div className="grid grid-cols-7 gap-1.5 mb-2">
            {dowJP.map((d, i) => (
              <div key={d} className={`text-center jp-serif text-sm py-2 font-medium ${i === 0 ? 'text-red-700' : i === 6 ? 'text-blue-700' : 'text-stone-500'}`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: firstDow }).map((_, i) => <div key={'b' + i} className="aspect-[5/4]" />)}
            {Array.from({ length: days }, (_, i) => i + 1).map(d => (
              <DutyCell key={d} day={d} dow={new Date(year, month, d).getDay()}
                duty={isDutyDay(year, month, d)} holiday={holidayName(year, month, d)}
                staff={staffById[monthAssignments[d]]} confirmed={isConfirmed}
                onClick={() => isDutyDay(year, month, d) && !isConfirmed && setEditing(d)} />
            ))}
          </div>
          <p className="jp-sans text-xs text-stone-500 mt-4">※ 当番日は土日・祝祭日のみ。日付クリックで担当者を変更</p>
        </div>

        <SubmissionPanel staff={staff} submissionStatus={submissionStatus} submissions={submissions}
          year={year} month={month} monthCounts={monthCounts} submittedCount={submittedCount} />
      </div>

      {editing !== null && (
        <ReassignModal day={editing} year={year} month={month} staff={staff} submissions={submissions}
          monthAssignments={monthAssignments} currentSid={monthAssignments[editing]}
          onSelect={(sid) => { onReassign(editing, sid); setEditing(null); }}
          onClear={() => { onClearDay(editing); setEditing(null); }}
          onClose={() => setEditing(null)} />
      )}
    </Fragment>
  );
}

function DutyCell({ day, dow, duty, holiday, staff, confirmed, onClick }) {
  if (!duty) {
    const dowClr = dow === 0 ? 'text-red-300' : dow === 6 ? 'text-blue-300' : 'text-stone-300';
    return <div className={`aspect-[5/4] p-1.5 ${dowClr}`}><div className="jp-serif text-sm">{day}</div></div>;
  }
  const dowClr = dow === 0 ? 'text-red-700' : dow === 6 ? 'text-blue-700' : 'text-stone-700';
  const c = staff ? colorOf(staff) : null;
  const cellStyle = staff ? { backgroundColor: c.bg, borderColor: c.hex, borderLeftWidth: '5px' } : {};
  const cellCls = staff ? 'border-2' : 'border-2 border-dashed border-red-400 bg-red-50/30';
  return (
    <button onClick={onClick} disabled={confirmed}
      className={`relative aspect-[5/4] p-2 text-left transition-all ${cellCls} ${!confirmed ? 'hover:shadow-md cursor-pointer' : 'cursor-default'}`} style={cellStyle}>
      <div className="flex items-start justify-between">
        <span className={`jp-serif font-medium ${dowClr}`}>{day}</span>
        <div className="flex items-center gap-1">
          {holiday && <span className="jp-sans text-[9px] text-red-700 bg-red-50 px-1 py-0.5 leading-none">祝</span>}
          {confirmed && staff && <span style={{ color: c.text }} className="text-[9px]">🔒</span>}
        </div>
      </div>
      {holiday && <div className="jp-sans text-[9px] text-red-600 mt-0.5 leading-tight truncate" title={holiday}>{holiday}</div>}
      <div className="absolute bottom-1.5 left-2 right-2">
        {staff ? (
          <div className="flex items-center gap-1 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.hex }} />
            <span className="jp-sans text-xs font-medium truncate" style={{ color: c.text }}>{staff.name.split(' ')[1] || staff.name}</span>
          </div>
        ) : <div className="jp-sans text-[10px] text-red-600 font-medium">未割当</div>}
      </div>
    </button>
  );
}

function SubmissionPanel({ staff, submissionStatus, submissions, year, month, monthCounts, submittedCount }) {
  const pending = staff.filter(s => submissionStatus[s.id] === 'pending');
  const draft   = staff.filter(s => submissionStatus[s.id] === 'draft');
  const done    = staff.filter(s => submissionStatus[s.id] === 'submitted');
  const sorted = [...pending, ...draft, ...done];
  const total = staff.length;
  const pct = total ? Math.round((submittedCount / total) * 100) : 0;
  const gauge = pct === 100 ? '#047857' : pct >= 60 ? '#d97706' : '#dc2626';
  const r = 30, circ = 2 * Math.PI * r, dash = (circ * pct) / 100;
  const meta = {
    pending:   { label: '未提出', dot: 'bg-red-600',     lb: 'border-l-red-500' },
    draft:     { label: '下書き', dot: 'bg-amber-500',   lb: 'border-l-amber-400' },
    submitted: { label: '提出済', dot: 'bg-emerald-700', lb: 'border-l-emerald-500' },
  };
  return (
    <div className="w-[260px] shrink-0 bg-white border border-stone-200 flex flex-col" style={{ position: 'sticky', top: '12px', maxHeight: 'calc(100vh - 180px)' }}>
      <div className="px-4 py-4 border-b border-stone-200 bg-stone-50">
        <div className="flex items-center gap-3 mb-3">
          <div className="relative w-[68px] h-[68px] shrink-0">
            <svg viewBox="0 0 72 72" className="w-full h-full -rotate-90">
              <circle cx="36" cy="36" r={r} fill="none" stroke="#e7e5e4" strokeWidth="8" />
              <circle cx="36" cy="36" r={r} fill="none" stroke={gauge} strokeWidth="8" strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
              <span className="display text-xl font-medium" style={{ color: gauge }}>{pct}</span>
              <span className="jp-sans text-[9px] text-stone-500">%</span>
            </div>
          </div>
          <div>
            <p className="jp-sans text-[10px] tracking-widest text-stone-500 mb-1">提出状況</p>
            <p><span className="display text-4xl" style={{ color: gauge }}>{submittedCount}</span><span className="text-stone-400 text-sm jp-sans"> / {total} 名</span></p>
          </div>
        </div>
        <div className="flex gap-1.5 jp-sans text-[10px]">
          <span className={`flex-1 text-center py-1 text-amber-50 ${pending.length > 0 ? 'bg-red-600' : 'bg-stone-300'}`}>未提出 {pending.length}</span>
          <span className={`flex-1 text-center py-1 text-amber-50 ${draft.length > 0 ? 'bg-amber-500' : 'bg-stone-300'}`}>下書き {draft.length}</span>
          <span className={`flex-1 text-center py-1 text-amber-50 ${done.length > 0 ? 'bg-emerald-700' : 'bg-stone-300'}`}>提出済 {done.length}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sorted.map((s) => {
          const status = submissionStatus[s.id]; const m = meta[status];
          const sub = submissions[subKey(year, month, s.id)];
          const c = colorOf(s);
          return (
            <div key={s.id} className={`border-l-4 ${m.lb} px-3 py-2.5 border-b border-stone-100`}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 shrink-0 flex items-center justify-center jp-serif text-sm text-white" style={{ backgroundColor: c.hex }}>{s.name.slice(0,1)}</div>
                <div className="flex-1 min-w-0">
                  <div className="jp-serif text-sm text-stone-900 truncate">{s.name}</div>
                  <div className="jp-sans text-[10px] text-stone-500 mt-0.5">
                    {sub ? (
                      <span className="flex gap-1.5 flex-wrap">
                        <span className="text-amber-700">◎{sub.preferred?.length||0}</span>
                        <span className="text-emerald-700">○{sub.available?.length||0}</span>
                        <span className="text-red-700">×{sub.unavailable?.length||0}</span>
                        <span className={monthCounts[s.id] === 0 ? 'text-red-600 font-bold' : 'text-stone-400'}>·当番{monthCounts[s.id]}日{monthCounts[s.id] === 0 ? '⚠' : ''}</span>
                      </span>
                    ) : <span className="text-red-600">未入力</span>}
                  </div>
                </div>
                <span className={`jp-sans text-[9px] px-1.5 py-0.5 text-amber-50 ${m.dot} shrink-0`}>{m.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReassignModal({ day, year, month, staff, submissions, monthAssignments, currentSid, onSelect, onClear, onClose }) {
  const monthCounts = staff.reduce((a, s) => { a[s.id] = Object.values(monthAssignments).filter(x => x === s.id).length; return a; }, {});
  return (
    <div className="fixed inset-0 z-50 bg-stone-900/50 flex items-center justify-center px-4">
      <div className="bg-white max-w-md w-full max-h-[80vh] overflow-y-auto anim-fadeUp">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 className="jp-serif text-lg text-emerald-950">{month + 1}月{day}日 の担当変更</h3>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-800 text-xl">×</button>
        </div>
        <div className="divide-y divide-stone-100">
          {staff.map(s => {
            const sub = submissions[subKey(year, month, s.id)];
            const isUna = sub?.unavailable?.includes(day);
            const isPref = sub?.preferred?.includes(day);
            const isCurrent = currentSid === s.id;
            const c = colorOf(s);
            return (
              <button key={s.id} onClick={() => onSelect(s.id)}
                className={`w-full text-left px-5 py-3 hover:bg-emerald-50/40 flex items-center justify-between ${isCurrent ? 'bg-emerald-50' : ''}`}>
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3" style={{ backgroundColor: c.hex }} />
                  <div>
                    <div className="jp-serif text-stone-900 flex items-center gap-1.5">{s.name}{isCurrent && <span className="text-emerald-700">✓</span>}</div>
                    <div className="jp-sans text-xs text-stone-500">
                      {isPref && <span className="text-amber-700 mr-2">◎希望</span>}
                      {isUna && <span className="text-red-700 mr-2">×不可</span>}
                    </div>
                  </div>
                </div>
                <div className="jp-sans text-xs text-stone-600">当月 {monthCounts[s.id]} 日</div>
              </button>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-stone-200 flex justify-between">
          <button onClick={onClear} className="jp-sans text-sm text-red-700 hover:underline">担当を解除</button>
          <button onClick={onClose} className="jp-sans text-sm text-stone-600">キャンセル</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── Staff Management Tab ───────── */
function StaffTab({ allStaff: stf, currentUser, onPromote, onDemote, onTransfer }) {
  const [permFor, setPermFor] = useState(null);
  const adminCount = stf.filter(s => s.role === 'admin' && s.status === 'active').length;
  const active = stf.filter(s => s.status === 'active');
  return (
    <Fragment>
      <div className="bg-white border border-stone-200">
        <div className="px-5 py-3 border-b border-stone-200 flex items-center">
          <h3 className="jp-serif text-base text-stone-800">スタッフ一覧 <span className="jp-sans text-xs text-stone-500 ml-2">{active.length} 名 (管理者 {adminCount} 名)</span></h3>
        </div>
        <div className="divide-y divide-stone-100">
          {active.map(s => {
            const c = colorOf(s);
            return (
              <div key={s.id} className="px-5 py-3 flex items-center justify-between hover:bg-stone-50/40">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 flex items-center justify-center jp-serif text-white shrink-0" style={{ backgroundColor: c.hex }}>{s.name.slice(0,1)}</div>
                  <div className="min-w-0">
                    <div className="jp-serif text-stone-900 flex items-center gap-2">
                      {s.name}
                      {s.role === 'admin' && <span className="jp-sans text-[10px] px-1.5 py-0.5 bg-emerald-900 text-amber-50">🛡 管理者</span>}
                      {currentUser?.id === s.id && <span className="jp-sans text-[10px] px-1.5 py-0.5 border border-stone-300 text-stone-500">本人</span>}
                    </div>
                    <div className="jp-sans text-xs text-stone-500 mt-0.5 truncate">{s.email} · {c.name}</div>
                  </div>
                </div>
                <button onClick={() => setPermFor(s.id)} className="jp-sans text-xs px-3 py-1.5 text-stone-600 hover:bg-stone-100">🛡 権限</button>
              </div>
            );
          })}
        </div>
      </div>
      <p className="jp-sans text-xs text-stone-500 mt-4">
        ※ スタッフの追加・削除や招待は、現状 Firestore コンソールから直接行ってください。<br/>
        　将来的にこの画面から招待できるよう拡張可能です。
      </p>

      {permFor && (
        <PermModal target={stf.find(s => s.id === permFor)} currentUser={currentUser} adminCount={adminCount}
          onPromote={() => { onPromote(permFor); setPermFor(null); }}
          onDemote={() => { onDemote(permFor); setPermFor(null); }}
          onTransfer={() => { onTransfer(permFor); setPermFor(null); }}
          onClose={() => setPermFor(null)} />
      )}
    </Fragment>
  );
}

function PermModal({ target, currentUser, adminCount, onPromote, onDemote, onTransfer, onClose }) {
  if (!target) return null;
  const isSelf = currentUser?.id === target.id;
  const isAdmin = target.role === 'admin';
  const lastAdmin = isAdmin && adminCount <= 1;
  return (
    <div className="fixed inset-0 z-50 bg-stone-900/50 flex items-center justify-center px-4">
      <div className="bg-white max-w-md w-full anim-fadeUp">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 className="jp-serif text-lg text-emerald-950">{target.name} の権限管理</h3>
          <button onClick={onClose} className="text-stone-500 text-xl">×</button>
        </div>
        <div className="px-6 py-5 space-y-3">
          {!isAdmin && (
            <div className="border border-emerald-200 bg-emerald-50/40 p-4">
              <h4 className="jp-serif text-stone-800 mb-2">🛡 管理者に昇格</h4>
              <p className="jp-sans text-xs text-stone-600 mb-3">複数管理者を設定できます。</p>
              <button onClick={onPromote} className="jp-sans text-sm px-4 py-2 bg-emerald-900 text-amber-50 hover:bg-emerald-800">管理者に昇格</button>
            </div>
          )}
          {isAdmin && (
            <div className="border border-stone-200 p-4">
              <h4 className="jp-serif text-stone-800 mb-2">管理者権限を解除</h4>
              <p className="jp-sans text-xs text-stone-600 mb-3">{lastAdmin ? '最後の管理者のため解除できません。先に他のスタッフを管理者に昇格してください。' : '通常スタッフに戻します。'}</p>
              <button onClick={onDemote} disabled={lastAdmin} className="jp-sans text-sm px-4 py-2 border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-40">管理者権限を解除</button>
            </div>
          )}
          {!isAdmin && currentUser?.role === 'admin' && (
            <div className="border border-amber-200 bg-amber-50/40 p-4">
              <h4 className="jp-serif text-stone-800 mb-2">📤 管理者権限を完全委譲</h4>
              <p className="jp-sans text-xs text-stone-600 mb-3"><strong>{target.name}</strong> さんを管理者にし、<strong>あなた</strong>は通常スタッフになります。</p>
              <button onClick={onTransfer} className="jp-sans text-sm px-4 py-2 border border-amber-700 text-amber-800 hover:bg-amber-100">権限を委譲</button>
            </div>
          )}
        </div>
        <div className="px-6 py-3 border-t border-stone-200 flex justify-end">
          <button onClick={onClose} className="jp-sans text-sm text-stone-600">閉じる</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── Mount ───────── */
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
