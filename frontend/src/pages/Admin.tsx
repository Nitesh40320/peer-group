/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGet } from '../components/shared';
import { ActionButton, Async, Card, Empty, Input, Modal, Notice, PageHead, Pagination, Select, StatusBadge, Textarea, useForm } from '../components/ui';
import { api, fileUrl, formatDateTime, fromNow, qs, titleCase } from '../lib/api';
import { useDebounced } from './People';

export function AdminDashboard() {
  const query = useGet(['admin', 'dashboard'], '/admin/dashboard');
  const Tile = ({ to, value, label }: { to: string; value: number; label: string }) => <Link to={to} className="card stat" style={{ textDecoration: 'none', color: 'inherit' }}><div className="stat-value">{value}</div><div className="stat-label">{label}</div></Link>;
  return (
    <>
      <PageHead title="Platform overview" />
      <Async query={query} lines={6}>
        {(d) => (
          <div className="stack-lg">
            <div className="grid-3">
              <Tile to="/admin/users" value={d.stats.totalUsers} label="Total users" />
              <Tile to="/admin/users" value={d.stats.activeStudents} label="Active students" />
              <Tile to="/admin/users" value={d.stats.activeTeachers} label="Active teachers" />
              <Tile to="/admin/verifications" value={d.stats.pendingVerifications} label="Pending teacher verification" />
              <Tile to="/admin/reports" value={d.stats.pendingReports} label="Pending reports" />
              <Tile to="/admin/support" value={d.stats.openSupport} label="Open support requests" />
            </div>
            <section className="card stat"><div className="stat-value">{d.stats.activeGroups}</div><div className="stat-label">Active study groups</div></section>
            <Card title="Recent platform activity">{d.activity.length === 0 ? <Empty title="No activity yet" /> : <ul className="list">{d.activity.map((a: any) => <li key={a.id}><span style={{ fontWeight: 550 }}>{a.action}</span> <span className="muted">by {a.actorName ?? 'System'}</span><div className="small muted">{fromNow(a.createdAt)}</div></li>)}</ul>}</Card>
          </div>
        )}
      </Async>
    </>
  );
}

export function AdminUsers() {
  const [search, setSearch] = useState(''); const [role, setRole] = useState(''); const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<any>(null);
  const q = useDebounced(search);
  useEffect(() => setPage(1), [q, role, status]);
  const filter = { q, role, status, page };
  const query = useGet(['admin', 'users', filter], `/admin/users${qs(filter)}`);
  return (
    <>
      <PageHead title="Users" />
      <div className="stack">
        <section className="card card-pad" aria-label="Filters"><div className="grid-3">
          <Input label="Search name or email" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)} options={[['', 'All roles'], ['student', 'Student'], ['teacher', 'Teacher'], ['admin', 'Administrator']]} />
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[['', 'Any status'], ['active', 'Active'], ['suspended', 'Suspended']]} />
        </div></section>
        <Async query={query}>
          {(d) => d.items.length === 0 ? <Empty title="No users found" /> : <>
            <section className="card table-wrap"><table className="table responsive">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{d.items.map((u: any) => (
                <tr key={u.id}>
                  <td data-label="Name">{u.role === 'admin' ? <span className="break">{u.fullName}</span> : <button className="btn btn-ghost btn-sm break" style={{ whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setTarget({ ...u, view: true })}>{u.fullName}</button>}</td>
                  <td data-label="Email" className="break">{u.email}</td>
                  <td data-label="Role">{titleCase(u.role)}{u.verificationStatus ? ` (${titleCase(u.verificationStatus).toLowerCase()})` : ''}</td>
                  <td data-label="Status"><StatusBadge status={u.status} /></td>
                  <td data-label="Joined">{fromNow(u.createdAt)}</td>
                  <td data-label="Actions">{u.role !== 'admin' && (u.status === 'active'
                    ? <button className="btn btn-secondary btn-sm" onClick={() => setTarget(u)}>Suspend</button>
                    : <ActionButton action={() => api.patch(`/admin/users/${u.id}/status`, { status: 'active' })} success="Account reactivated." invalidate={[['admin']]}>Reactivate</ActionButton>)}</td>
                </tr>))}
              </tbody></table></section>
            <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
          </>}
        </Async>
      </div>
      {target?.view && <UserDetail user={target} onClose={() => setTarget(null)} />}
      {target && !target.view && <Suspend user={target} onClose={() => setTarget(null)} />}
    </>
  );
}

function UserDetail({ user, onClose }: { user: any; onClose: () => void }) {
  const query = useGet(['admin', 'user', user.id], `/users/${user.id}`);
  return (
    <Modal title={user.fullName} onClose={onClose}>
      <Async query={query}>{(p) => (
        <div className="stack-sm">
          <p className="muted break">{user.email}</p>
          <p>{[p.designation, p.institution, p.department].filter(Boolean).join(', ') || 'No institution details'}</p>
          {p.bio && <p className="pre">{p.bio}</p>}
          {p.subjects?.length > 0 && <p className="small muted">Subjects: {p.subjects.join(', ')}</p>}
        </div>
      )}</Async>
    </Modal>
  );
}

function Suspend({ user, onClose }: { user: any; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const f = useForm(() => api.patch(`/admin/users/${user.id}/status`, { status: 'suspended', reason }), { success: 'Account suspended.', invalidate: [['admin']], onDone: onClose });
  return <Modal title={`Suspend ${user.fullName}`} onClose={onClose}><form className="stack" onSubmit={f.onSubmit}><p>They will be signed out immediately and unable to sign in.</p><Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} /><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={f.busy}>Suspend account</button></div></form></Modal>;
}

export function AdminVerifications() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const query = useGet(['admin', 'verifications', status, page], `/admin/verifications${qs({ status, page })}`);
  const [deciding, setDeciding] = useState<{ item: any; status: string } | null>(null);
  return (
    <>
      <PageHead title="Teacher verification" />
      <div className="stack">
        <div style={{ maxWidth: '16rem' }}><Select label="Show" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[['pending', 'Pending'], ['needs_info', 'Needs information'], ['approved', 'Approved'], ['rejected', 'Rejected']]} /></div>
        <Async query={query}>
          {(d) => d.items.length === 0 ? <Empty title="Nothing in this queue" /> : <>
            <ul className="stack">{d.items.map((v: any) => (
              <li key={v.teacherId} className="card card-pad stack-sm">
                <div className="row-between"><strong className="break">{v.fullName}</strong><StatusBadge status={v.verificationStatus} /></div>
                <div className="small muted break">{v.email} · {[v.designation, v.department, v.institution].filter(Boolean).join(', ')}</div>
                {v.statement && <p className="pre">{v.statement}</p>}
                {v.documentFileId && <a href={fileUrl(v.documentFileId)}>{v.documentName}</a>}
                {v.decisionNote && <p className="small"><strong>Note:</strong> {v.decisionNote}</p>}
                <div className="row">
                  {v.verificationStatus !== 'approved' && <button className="btn btn-primary btn-sm" onClick={() => setDeciding({ item: v, status: 'approved' })}>Approve</button>}
                  {v.verificationStatus !== 'needs_info' && <button className="btn btn-secondary btn-sm" onClick={() => setDeciding({ item: v, status: 'needs_info' })}>Request information</button>}
                  {v.verificationStatus !== 'rejected' && <button className="btn btn-secondary btn-sm" onClick={() => setDeciding({ item: v, status: 'rejected' })}>Reject</button>}
                </div>
              </li>))}
            </ul>
            <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
          </>}
        </Async>
      </div>
      {deciding && <Decide {...deciding} onClose={() => setDeciding(null)} />}
    </>
  );
}

function Decide({ item, status, onClose }: { item: any; status: string; onClose: () => void }) {
  const [note, setNote] = useState('');
  const f = useForm(() => api.patch(`/admin/teachers/${item.teacherId}/verification`, { status, note }), { success: 'Decision recorded.', invalidate: [['admin']], onDone: onClose });
  return <Modal title={`${titleCase(status)}: ${item.fullName}`} onClose={onClose}><form className="stack" onSubmit={f.onSubmit}><Textarea label={status === 'approved' ? 'Note (optional)' : 'Note to the teacher'} required={status !== 'approved'} value={note} onChange={(e) => setNote(e.target.value)} /><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.busy}>Confirm</button></div></form></Modal>;
}

export function AdminReports() {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState<any>(null);
  const query = useGet(['admin', 'reports', status, page], `/admin/reports${qs({ status, page })}`);
  return (
    <>
      <PageHead title="Reports" />
      <div className="stack">
        <div style={{ maxWidth: '16rem' }}><Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[['open', 'Open'], ['reviewing', 'Reviewing'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed']]} /></div>
        <Async query={query}>
          {(d) => d.items.length === 0 ? <Empty title="No reports here" /> : <>
            <ul className="stack">{d.items.map((r: any) => (
              <li key={r.id} className="card card-pad stack-sm">
                <div className="row-between"><strong className="break">{r.reason}</strong><StatusBadge status={r.status} /></div>
                <div className="small muted">{titleCase(r.targetType)} {r.targetId} · Reported by {r.reporterName ?? 'a removed user'} · {fromNow(r.createdAt)}</div>
                {r.details && <p className="pre">{r.details}</p>}
                {r.history.length > 0 && <ul className="list small">{r.history.map((h: any) => <li key={h.id}><strong>{titleCase(h.status)}</strong> by {h.admin ?? 'an administrator'}, {formatDateTime(h.createdAt)}{h.note && <div className="pre">{h.note}</div>}</li>)}</ul>}
                <div><button className="btn btn-secondary btn-sm" onClick={() => setReviewing(r)}>Review</button></div>
              </li>))}
            </ul>
            <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
          </>}
        </Async>
      </div>
      {reviewing && <ReviewReport report={reviewing} onClose={() => setReviewing(null)} />}
    </>
  );
}

function ReviewReport({ report, onClose }: { report: any; onClose: () => void }) {
  const [status, setStatus] = useState('resolved');
  const [note, setNote] = useState('');
  const f = useForm(() => api.patch(`/admin/reports/${report.id}`, { status, note }), { success: 'Report updated.', invalidate: [['admin']], onDone: onClose });
  return <Modal title="Review report" onClose={onClose}><form className="stack" onSubmit={f.onSubmit}><Select label="New status" value={status} onChange={(e) => setStatus(e.target.value)} options={[['reviewing', 'Reviewing'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['open', 'Open']]} /><Textarea label="Review note" value={note} onChange={(e) => setNote(e.target.value)} /><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.busy}>Save</button></div></form></Modal>;
}

export function AdminSupport() {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const query = useGet(['admin', 'support', status, page], `/admin/support${qs({ status, page })}`);
  return (
    <>
      <PageHead title="Support requests" />
      <div className="stack">
        <div style={{ maxWidth: '16rem' }}><Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[['open', 'Open'], ['closed', 'Closed']]} /></div>
        <Async query={query}>
          {(d) => d.items.length === 0 ? <Empty title="No requests here" /> : <>
            <ul className="stack">{d.items.map((r: any) => (
              <li key={r.id} className="card card-pad stack-sm">
                <div className="row-between"><strong className="break">{r.name}</strong><span className="badge">{titleCase(r.category)}</span></div>
                <div className="small muted"><a href={`mailto:${r.email}`}>{r.email}</a> · {fromNow(r.createdAt)}</div>
                <p className="pre">{r.message}</p>
                <div><ActionButton action={() => api.patch(`/admin/support/${r.id}`, { status: r.status === 'open' ? 'closed' : 'open' })} invalidate={[['admin']]}>{r.status === 'open' ? 'Close' : 'Reopen'}</ActionButton></div>
              </li>))}
            </ul>
            <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
          </>}
        </Async>
      </div>
    </>
  );
}

export function AdminAudit() {
  const [page, setPage] = useState(1);
  const query = useGet(['admin', 'audit', page], `/admin/audit${qs({ page, pageSize: 25 })}`);
  return (
    <>
      <PageHead title="Audit log" />
      <Async query={query}>
        {(d) => d.items.length === 0 ? <Empty title="No entries" /> : <div className="stack">
          <section className="card table-wrap"><table className="table responsive">
            <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th></tr></thead>
            <tbody>{d.items.map((a: any) => <tr key={a.id}><td data-label="When">{formatDateTime(a.createdAt)}</td><td data-label="Action">{a.action}</td><td data-label="Actor">{a.actorName ?? 'System'}</td><td data-label="Target" className="break">{a.targetType} {a.targetId}</td></tr>)}</tbody>
          </table></section>
          <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
        </div>}
      </Async>
    </>
  );
}

export function AdminSystem() {
  const query = useGet(['admin', 'system'], '/admin/system');
  return (
    <>
      <PageHead title="System" />
      <Async query={query}>{(d) => <SystemForms data={d} />}</Async>
    </>
  );
}

function SystemForms({ data }: { data: any }) {
  const [settings, setSettings] = useState({ registration_open: data.settings.registration_open, ai_enabled: data.settings.ai_enabled, announcement_banner: data.settings.announcement_banner });
  const f = useForm(() => api.patch('/admin/settings', settings), { success: 'Settings saved.', invalidate: [['admin'], ['meta']] });
  const [broadcast, setBroadcast] = useState({ audience: 'all', title: '', body: '' });
  const b = useForm(() => api.post('/admin/broadcast', broadcast), { success: 'Announcement sent.', onDone: () => setBroadcast({ audience: 'all', title: '', body: '' }) });
  const cell = (v: boolean | string) => (v === true ? 'Yes' : v === false ? 'No' : v);
  return (
    <div className="stack-lg">
      <Card title="Platform configuration">
        <form className="stack" onSubmit={f.onSubmit}>
          <label className="check"><input type="checkbox" checked={settings.registration_open} onChange={(e) => setSettings({ ...settings, registration_open: e.target.checked })} />Allow new registrations</label>
          <label className="check"><input type="checkbox" checked={settings.ai_enabled} onChange={(e) => setSettings({ ...settings, ai_enabled: e.target.checked })} />Enable AI assistant</label>
          <Input label="Banner shown to signed-in users" value={settings.announcement_banner} maxLength={300} onChange={(e) => setSettings({ ...settings, announcement_banner: e.target.value })} />
          <div><button className="btn btn-primary" disabled={f.busy}>Save settings</button></div>
        </form>
      </Card>
      <Card title="Send an in-app announcement">
        <form className="stack" onSubmit={b.onSubmit}>
          <Select label="Audience" value={broadcast.audience} onChange={(e) => setBroadcast({ ...broadcast, audience: e.target.value })} options={[['all', 'All students and teachers'], ['student', 'Students'], ['teacher', 'Teachers']]} />
          <Input label="Title" required value={broadcast.title} onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })} />
          <Textarea label="Message" value={broadcast.body} onChange={(e) => setBroadcast({ ...broadcast, body: e.target.value })} />
          <div><button className="btn btn-primary" disabled={b.busy}>Send</button></div>
        </form>
      </Card>
      <Card title="System health">
        <dl className="grid-3" style={{ margin: 0 }}>{Object.entries(data.health).map(([k, v]) => <div key={k}><dt className="small muted">{titleCase(k.replace(/([A-Z])/g, ' $1').toLowerCase())}</dt><dd style={{ margin: 0, fontWeight: 550 }}>{String(v)}</dd></div>)}</dl>
      </Card>
      <Card title="Roles and permissions" flush>
        <div className="card-body"><Notice>Roles are enforced in server code on every request, so this list is read-only.</Notice></div>
        <div className="table-wrap"><table className="table responsive"><thead><tr><th>Capability</th><th>Student</th><th>Teacher</th><th>Admin</th></tr></thead><tbody>{data.permissions.map((p: any) => <tr key={p.capability}><td data-label="Capability">{p.capability}</td><td data-label="Student">{cell(p.student)}</td><td data-label="Teacher">{cell(p.teacher)}</td><td data-label="Admin">{cell(p.admin)}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}
