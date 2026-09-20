import { useEffect, useState } from 'react';
import { api, getToken, setToken } from '../api.js';

export default function Admin() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());
  const [password, setPassword] = useState('');
  const [list, setList] = useState([]);
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ full_name: '', entry_code: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => { try { return Number(localStorage.getItem('admin_page_size')) || 25; } catch { return 25; } });
  useEffect(() => { setPage(1); }, [filter, pageSize, list.length]);            // back to page 1 when the set changes
  useEffect(() => { try { localStorage.setItem('admin_page_size', String(pageSize)); } catch { /* ignore */ } }, [pageSize]);
  const [importing, setImporting] = useState(false);
  const [replaceOnImport, setReplaceOnImport] = useState(false);

  const refresh = async () => {
    try {
      const [l, s] = await Promise.all([api.participants(true), api.status()]);
      setList(l); setStatus(s);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { if (loggedIn) refresh(); }, [loggedIn]);

  const run = async (fn, okMsg) => {
    setError(''); setMsg('');
    try {
      const r = await fn();
      setMsg(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      await refresh();
    } catch (e) {
      setError(e.message);
      if (/admin session|admin login/i.test(e.message)) { setToken(null); setLoggedIn(false); }
    }
  };

  if (!loggedIn) {
    return (
      <div className="login">
        <h1>Admin Login</h1>
        <form onSubmit={(e) => {
          e.preventDefault();
          run(async () => { const r = await api.login(password); setToken(r.token); setLoggedIn(true); }, '');
        }}>
          <input type="password" placeholder="Admin password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <button className="btn-primary" type="submit">Log in</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const locked = status?.draw_started;
  const shown = list.filter((p) =>
    !filter || `${p.full_name} ${p.entry_code}`.toLowerCase().includes(filter.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = shown.slice((safePage - 1) * pageSize, safePage * pageSize);

  const importSummary = (r) => {
    // Everything in the file was already in the list → say so plainly instead of "Imported 0".
    if (r.inserted === 0 && r.duplicate_count > 0 && r.duplicate_count === r.detected) {
      return `Nothing new to add: all ${r.detected} name${r.detected === 1 ? ' in' : 's in'} ${r.file} ${r.detected === 1 ? 'is' : 'are'} already in the participant list. ` +
        'To start over with this file, tick "Replace current list" and import again (or use "Delete all names").';
    }
    let m = r.removed ? `Replaced the list: removed ${r.removed} old name${r.removed === 1 ? '' : 's'}, imported ${r.inserted} from ${r.file}.`
      : `Imported ${r.inserted} name${r.inserted === 1 ? '' : 's'} from ${r.file}.`;
    if (r.duplicate_count) m += ` ${r.duplicate_count} duplicate name${r.duplicate_count === 1 ? '' : 's'} skipped (one person = one ticket): ${r.duplicates.join(', ')}${r.duplicate_count > r.duplicates.length ? ', …' : ''}.`;
    else if (r.skipped) m += ` ${r.skipped} row${r.skipped === 1 ? '' : 's'} skipped.`;
    if (r.errors?.length) m += '\n' + r.errors.join('\n');
    return m;
  };

  return (
    <div>
      <div className="page-head">
        <h1>Admin</h1>
        <button className="btn-link" onClick={() => { setToken(null); setLoggedIn(false); }}>Log out</button>
      </div>

      <ProfileSection onLogout={() => { setToken(null); setLoggedIn(false); }} />

      <h2 className="admin-section-title">Participants</h2>

      {locked && (
        <div className="banner warn">
          The draw has started ({status.draws_done} drawn). The participant list is locked —
          adding, importing, and removing are no longer allowed (no manual override).
        </div>
      )}
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}

      <div className="admin-grid">
        <section className="card">
          <h3>Add participant</h3>
          <form onSubmit={(e) => {
            e.preventDefault();
            run(() => api.addParticipant(form), 'Participant added.').then(() => setForm({ full_name: '', entry_code: '' }));
          }}>
            <input placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} disabled={locked} required />
            <input placeholder="Entry code (optional — generated automatically)" value={form.entry_code} onChange={(e) => setForm({ ...form, entry_code: e.target.value })} disabled={locked} />
            <button className="btn-primary" type="submit" disabled={locked}>Add</button>
          </form>
        </section>

        <section className="card">
          <h3>Import names</h3>
          <p className="muted small">
            CSV, Excel (.xlsx / .xls), Word (.docx / .doc), PDF or TXT. Names are detected automatically — no specific
            header needed; numbered lists, blank rows and extra columns are fine. Entry codes are generated automatically.
          </p>
          <input
            type="file"
            accept=".csv,.txt,.xlsx,.xls,.docx,.doc,.pdf"
            disabled={locked || importing}
            onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              setImporting(true);
              await run(() => api.importFile(f, { replace: replaceOnImport }), importSummary);
              setImporting(false);
              setReplaceOnImport(false);
              e.target.value = '';
            }}
          />
          <label className="muted small import-replace">
            <input type="checkbox" checked={replaceOnImport} onChange={(e) => setReplaceOnImport(e.target.checked)} disabled={locked || importing} />
            Replace current list — delete all {list.length} existing name{list.length === 1 ? '' : 's'} first, then import this file
          </label>
          {importing && <p className="muted small">Reading file…</p>}
          <h3 style={{ marginTop: 16 }}>Export</h3>
          <a className="btn-secondary" href="/api/participants/export.csv" download>Download participants.csv</a>
          <p className="muted small">Print or publish this before the event so everyone can see the full pool.</p>
        </section>
      </div>

      <section className="card">
        <div className="page-head">
          <h3>Participants ({list.length})</h3>
          <div className="participants-tools">
            <input placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <DeleteAllButton count={list.length} disabled={locked} run={run} />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Name</th><th>Entry code</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td colSpan={5} className="muted">{list.length === 0 ? 'No participants yet — add names or import a file.' : 'No names match your search.'}</td></tr>
              )}
              {pageRows.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td><td>{p.full_name}</td><td><code>{p.entry_code}</code></td>
                  <td>{p.is_winner ? <b className="ok-text">WINNER</b> : 'in pool'}</td>
                  <td>
                    <button className="btn-danger" disabled={locked || p.is_winner}
                      onClick={() => run(() => api.removeParticipant(p.id), `Removed: ${p.full_name}`)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          total={shown.length}
          page={safePage}
          pageCount={pageCount}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={setPageSize}
        />
      </section>

      <ResetSection status={status} run={run} />
    </div>
  );
}

/** Table footer: "Showing a–b of N", rows-per-page, Prev / page numbers / Next. */
function Pagination({ total, page, pageCount, pageSize, onPage, onPageSize }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  // Page numbers: always 1 and last, current ±1, with "…" gaps
  const numbers = [];
  for (let n = 1; n <= pageCount; n++) {
    if (n === 1 || n === pageCount || Math.abs(n - page) <= 1) numbers.push(n);
    else if (numbers[numbers.length - 1] !== '…') numbers.push('…');
  }
  return (
    <div className="pager">
      <div className="pager-info">
        Showing <b>{from}–{to}</b> of <b>{total}</b>
        <label className="pager-size">
          Rows per page
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <nav className="pager-nav" aria-label="Participants pages">
        <button className="pager-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">‹ Prev</button>
        {numbers.map((n, i) => n === '…'
          ? <span key={`gap-${i}`} className="pager-gap">…</span>
          : <button key={n} className={`pager-btn num ${n === page ? 'active' : ''}`} onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}>{n}</button>)}
        <button className="pager-btn" onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Next page">Next ›</button>
      </nav>
    </div>
  );
}

/** Two-click "Delete all names": first click arms it for 5 s, second click deletes. */
function DeleteAllButton({ count, disabled, run }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  if (count === 0) return null;
  return (
    <button
      className={`btn-danger ${armed ? 'btn-solid' : ''}`}
      disabled={disabled}
      title={disabled ? 'Locked while a draw is in progress — Archive & Reset first' : 'Remove every name from the participant list'}
      onClick={() => {
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        run(() => api.removeAllParticipants(), (r) => `Deleted all ${r.deleted} participant${r.deleted === 1 ? '' : 's'}. The list is empty.`);
      }}
    >
      {armed ? `Click again to delete all ${count} names` : 'Delete all names'}
    </button>
  );
}

function ProfileSection({ onLogout }) {
  const [me, setMe] = useState(null);
  const [name, setName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => api.me().then((m) => { setMe(m); setName(m.display_name); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const minLen = me?.min_password_length ?? 8;
  const strength = (() => {
    const p = pw.new_password;
    if (!p) return null;
    let score = 0;
    if (p.length >= minLen) score++;
    if (p.length >= 12) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/\d/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    return score <= 1 ? 'weak' : score <= 3 ? 'fair' : 'strong';
  })();
  const canSubmit = pw.current_password && pw.new_password.length >= minLen && pw.new_password === pw.confirm_password && !saving;

  const submitPassword = async (e) => {
    e.preventDefault();
    setError(''); setMsg(''); setSaving(true);
    try {
      const r = await api.changePassword(pw);
      setPw({ current_password: '', new_password: '', confirm_password: '' });
      setMsg(r.message);
      // The old session is now invalid on the server — send the admin back to the login form.
      setTimeout(onLogout, 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveName = async () => {
    setError(''); setMsg('');
    try {
      await api.updateProfile(name);
      setEditingName(false);
      setMsg('Display name updated.');
      load();
    } catch (err) { setError(err.message); }
  };

  return (
    <section className="card profile">
      <div className="profile-head">
        <div className="profile-avatar" aria-hidden="true">{(me?.display_name || 'A').trim().charAt(0).toUpperCase()}</div>
        <div className="profile-id">
          {editingName ? (
            <div className="profile-name-edit">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
              <button className="btn-primary" onClick={saveName} disabled={!name.trim()}>Save</button>
              <button className="btn-link" onClick={() => { setEditingName(false); setName(me?.display_name || ''); }}>Cancel</button>
            </div>
          ) : (
            <div className="profile-name">
              {me?.display_name || 'Administrator'}
              <button className="btn-link small" onClick={() => setEditingName(true)}>edit</button>
            </div>
          )}
          <div className="muted small">
            Administrator account ·{' '}
            {me?.password_changed_at
              ? `password last changed ${new Date(me.password_changed_at).toLocaleString()}`
              : 'password never changed'}
          </div>
        </div>
      </div>

      {me?.using_default_password && (
        <div className="banner warn small">
          You are still using the initial password from the server configuration. Change it before the event.
        </div>
      )}
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}

      <form className="profile-pw" onSubmit={submitPassword} autoComplete="off">
        <h3>Change password</h3>
        <div className="profile-pw-grid">
          <label className="ld-field">
            <span>Current password</span>
            <input type={show ? 'text' : 'password'} value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} autoComplete="current-password" required />
          </label>
          <label className="ld-field">
            <span>New password</span>
            <input type={show ? 'text' : 'password'} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} autoComplete="new-password" minLength={minLen} required />
            {strength && <span className={`pw-strength ${strength}`}>{strength}</span>}
          </label>
          <label className="ld-field">
            <span>Confirm new password</span>
            <input type={show ? 'text' : 'password'} value={pw.confirm_password} onChange={(e) => setPw({ ...pw, confirm_password: e.target.value })} autoComplete="new-password" required />
            {pw.confirm_password && pw.confirm_password !== pw.new_password && <span className="pw-strength weak">does not match</span>}
          </label>
        </div>
        <div className="profile-pw-actions">
          <label className="muted small profile-show">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords
          </label>
          <span className="muted small">At least {minLen} characters.</span>
          <button className="btn-primary" type="submit" disabled={!canSubmit}>{saving ? 'Saving…' : 'Update password'}</button>
        </div>
      </form>
    </section>
  );
}

function ResetSection({ status, run }) {
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState('');
  const draws = status?.draws_done ?? 0;
  const ready = confirm.trim().toUpperCase() === 'RESET';

  return (
    <section className="card danger-zone">
      <h3>Reset raffle</h3>
      <p className="muted small">
        Archives the current session ({draws} draw{draws === 1 ? '' : 's'}) into the draw history, clears the
        winners list, and puts every participant back into the pool so the raffle can run again from a full pool.
        Nothing is permanently deleted — archived sessions stay visible and verifiable on the{' '}
        <a href="/audit">Audit / Verify</a> page.
        {status?.archived_sessions ? ` ${status.archived_sessions} archived session${status.archived_sessions === 1 ? '' : 's'} so far.` : ''}
      </p>
      <div className="reset-form">
        <input placeholder="Session note (optional), e.g. Morning session" value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} />
        <input placeholder='Type RESET to confirm' value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button
          className="btn-danger btn-solid"
          disabled={!ready}
          onClick={() => run(
            () => api.reset(note),
            (r) => r.archived_draws
              ? `Session archived (#${r.session_id}, ${r.archived_draws} draws). Pool reset — all participants are back in.`
              : 'Nothing to archive. Pool reset — all participants are back in.'
          ).then(() => { setNote(''); setConfirm(''); })}
        >
          Archive &amp; Reset
        </button>
      </div>

      <ClearArchive count={status?.archived_sessions ?? 0} run={run} />
    </section>
  );
}

function ClearArchive({ count, run }) {
  const [confirm, setConfirm] = useState('');
  const ready = confirm.trim().toUpperCase() === 'CLEAR';
  return (
    <div className="archive-clear">
      <h3>Clear archived sessions</h3>
      <p className="muted small">
        Permanently deletes all {count} archived session{count === 1 ? '' : 's'} and their draw logs from the
        Audit / Verify page. This cannot be undone — export or print the audit records first if they need to be kept.
        (Individual sessions can also be deleted on the Audit / Verify page while logged in.)
      </p>
      <div className="reset-form">
        <input placeholder="Type CLEAR to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={count === 0} />
        <button
          className="btn-danger btn-solid"
          disabled={!ready || count === 0}
          onClick={() => run(
            () => api.clearArchive(),
            (r) => `Cleared ${r.deleted_sessions} archived session${r.deleted_sessions === 1 ? '' : 's'} (${r.deleted_draws} draws).`
          ).then(() => setConfirm(''))}
        >
          Clear archive
        </button>
      </div>
    </div>
  );
}
