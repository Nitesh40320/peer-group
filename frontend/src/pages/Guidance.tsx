/* eslint-disable @typescript-eslint/no-explicit-any */
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGet } from '../components/shared';
import { ActionButton, Async, Card, Chips, Empty, Input, Modal, Notice, PageHead, Pagination, Progress, Select, StatusBadge, Textarea, useForm } from '../components/ui';
import { api, fileUrl, formatDateTime, fromNow, localToIso, qs, toForm } from '../lib/api';
import { useAuth } from '../lib/auth';
import { SessionForm } from './Work';

export function Mentorship() {
  const { user } = useAuth();
  const query = useGet(['mentorship'], '/mentorship');
  const key = [['mentorship'], ['dashboard']];
  const isTeacher = user?.role === 'teacher';
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  return (
    <>
      <PageHead title="Mentorship" sub={isTeacher ? 'Requests from students and your ongoing mentorships.' : 'Your requests and mentors.'} actions={!isTeacher ? <Link className="btn btn-primary" to="/app/discover">Find a teacher</Link> : undefined} />
      <Async query={query}>
        {(d) => d.items.length === 0 ? <Empty title="No mentorships yet">{!isTeacher && <Link to="/app/discover">Browse verified teachers from Discover</Link>}</Empty> : (
          <ul className="stack">{d.items.map((m: any) => (
            <li key={m.id} className="card card-pad stack-sm">
              <div className="row-between"><Link className="break" style={{ fontWeight: 600 }} to={`/app/users/${m.otherId}`}>{m.otherName}</Link><StatusBadge status={m.status} /></div>
              <p className="pre">{m.objective}</p>
              <Chips items={m.topics} />
              {m.responseNote && <p className="small muted break">Note: {m.responseNote}</p>}
              {m.feedback.length > 0 && <div><div className="label">Feedback</div><ul className="list small">{m.feedback.map((f: any) => <li key={f.id}><p className="pre">{f.body}</p><div className="muted">{fromNow(f.createdAt)}</div></li>)}</ul></div>}
              <div className="row">
                {isTeacher && m.status === 'pending' && <>
                  <ActionButton className="btn btn-primary btn-sm" action={() => api.patch(`/mentorship/requests/${m.id}`, { action: 'accept' })} success="Mentorship accepted." invalidate={key}>Accept</ActionButton>
                  <ActionButton action={() => api.patch(`/mentorship/requests/${m.id}`, { action: 'reject' })} invalidate={key} confirm="Reject this mentorship request?">Reject</ActionButton>
                </>}
                {m.status === 'accepted' && <>
                  <button className="btn btn-primary btn-sm" onClick={() => setScheduling(m.id)}>Schedule session</button>
                  {isTeacher && <button className="btn btn-secondary btn-sm" onClick={() => setFeedbackFor(m.id)}>Give feedback</button>}
                  <ActionButton action={() => api.patch(`/mentorship/requests/${m.id}`, { action: 'end' })} invalidate={key} confirm="End this mentorship?">End mentorship</ActionButton>
                </>}
              </div>
            </li>))}
          </ul>
        )}
      </Async>
      {scheduling && <SessionForm session={{}} mentorshipId={scheduling} onClose={() => setScheduling(null)} invalidate={[['sessions'], ['dashboard']]} />}
      {feedbackFor && <Feedback id={feedbackFor} onClose={() => setFeedbackFor(null)} invalidate={key} />}
    </>
  );
}

function Feedback({ id, onClose, invalidate }: { id: string; onClose: () => void; invalidate: unknown[][] }) {
  const [body, setBody] = useState('');
  const f = useForm(() => api.post(`/mentorship/${id}/feedback`, { body }), { success: 'Feedback sent.', invalidate, onDone: onClose });
  return <Modal title="Give feedback" onClose={onClose}><form className="stack" onSubmit={f.onSubmit}><Textarea label="Feedback" required rows={5} value={body} onChange={(e) => setBody(e.target.value)} error={f.errors.body} /><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.busy}>Send</button></div></form></Modal>;
}

export function Assignments() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const query = useGet(['assignments', page], `/assignments${qs({ page })}`);
  const isTeacher = user?.role === 'teacher';
  return (
    <>
      <PageHead title="Assignments" actions={isTeacher ? <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={18} aria-hidden="true" />New assignment</button> : undefined} />
      <Async query={query}>
        {(d) => d.items.length === 0 ? <Empty title="No assignments" /> : (
          <div className="stack">
            <section className="card table-wrap">
              <table className="table responsive">
                <thead><tr><th>Title</th><th>Due</th>{isTeacher ? <><th>Submitted</th><th>To review</th></> : <th>Status</th>}</tr></thead>
                <tbody>{d.items.map((a: any) => (
                  <tr key={a.id}>
                    <td data-label="Title"><Link to={`/app/assignments/${a.id}`} className="break">{a.title}</Link></td>
                    <td data-label="Due">{formatDateTime(a.dueAt)}</td>
                    {isTeacher ? <><td data-label="Submitted">{a.submissionCount} of {a.recipientCount}</td><td data-label="To review">{a.pendingReview}</td></> : <td data-label="Status"><StatusBadge status={a.submissionStatus ?? (a.status === 'closed' ? 'closed' : 'pending')} /></td>}
                  </tr>))}
                </tbody>
              </table>
            </section>
            <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
          </div>
        )}
      </Async>
      {creating && <AssignmentForm onClose={() => setCreating(false)} />}
    </>
  );
}

function AssignmentForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', dueAt: '', groupId: '', resourceId: '' });
  const resources = useGet(['resources', 'picker'], '/resources?pageSize=50');
  const [students, setStudents] = useState<string[]>([]);
  const groups = useGet(['groups', 'mine-all'], '/groups?mine=true&pageSize=50');
  const mentees = useGet(['mentorship'], '/mentorship');
  const active = (mentees.data?.items ?? []).filter((m: any) => m.status === 'accepted');
  const f = useForm(() => api.post('/assignments', { title: form.title, description: form.description, dueAt: localToIso(form.dueAt), groupId: form.groupId || null, resourceId: form.resourceId || null, studentIds: students }), { success: 'Assignment created.', invalidate: [['assignments'], ['dashboard']], onDone: onClose });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal title="New assignment" onClose={onClose}>
      <form className="stack" onSubmit={f.onSubmit}>
        <Input label="Title" required value={form.title} onChange={set('title')} error={f.errors.title} />
        <Textarea label="Instructions" rows={4} value={form.description} onChange={set('description')} />
        <Input label="Deadline" type="datetime-local" required value={form.dueAt} onChange={set('dueAt')} error={f.errors.dueAt} />
        <Select label="Assign to group" value={form.groupId} onChange={set('groupId')} options={[['', 'No group'], ...(groups.data?.items ?? []).map((g: any): [string, string] => [g.id, g.name])]} />
        <Select label="Attach a resource" value={form.resourceId} onChange={set('resourceId')} options={[['', 'None'], ...(resources.data?.items ?? []).map((r: any): [string, string] => [r.id, r.title])]} />
        {active.length > 0 && <fieldset><legend className="label">Or to mentees</legend>{active.map((m: any) => <label className="check" key={m.id}><input type="checkbox" checked={students.includes(m.studentId)} onChange={() => setStudents(students.includes(m.studentId) ? students.filter((x) => x !== m.studentId) : [...students, m.studentId])} />{m.otherName}</label>)}</fieldset>}
        <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.busy}>Create</button></div>
      </form>
    </Modal>
  );
}

export function AssignmentDetail() {
  const { id } = useParams();
  const query = useGet(['assignment', id], `/assignments/${id}`);
  const key = [['assignment', id], ['assignments']];
  return (
    <Async query={query} lines={6}>
      {(a) => (
        <>
          <PageHead title={a.title} crumb={{ to: '/app/assignments', label: 'Assignments' }} sub={`Due ${formatDateTime(a.dueAt)}${a.groupName ? ` · ${a.groupName}` : ''}`} actions={a.isTeacher ? (
            a.status === 'active'
              ? <ActionButton action={() => api.patch(`/assignments/${id}`, { status: 'closed' })} invalidate={key} confirm="Close this assignment to new submissions?">Close assignment</ActionButton>
              : <ActionButton action={() => api.patch(`/assignments/${id}`, { status: 'active' })} invalidate={key}>Reopen</ActionButton>
          ) : undefined} />
          <div className="stack-lg">
            <Card title="Instructions">
              {a.description ? <p className="pre">{a.description}</p> : <p className="muted">No written instructions.</p>}
              {a.resourceTitle && <p style={{ marginTop: '.75rem' }}>Attached: {a.resourceKind === 'file' ? <a href={fileUrl(a.resourceFileId)}>{a.resourceTitle}</a> : <a href={a.resourceUrl} target="_blank" rel="noopener noreferrer">{a.resourceTitle}</a>}</p>}
            </Card>
            {a.isTeacher
              ? <Card title="Submissions">{a.submissions.length === 0 ? <Empty title="No submissions yet" /> : <ul className="list">{a.submissions.map((s: any) => <Review key={s.id} s={s} invalidate={key} />)}</ul>}</Card>
              : <StudentSubmission a={a} id={id!} invalidate={key} />}
          </div>
        </>
      )}
    </Async>
  );
}

function Review({ s, invalidate }: { s: any; invalidate: unknown[][] }) {
  const [feedback, setFeedback] = useState(s.feedback ?? '');
  const review = (status: string) => () => api.patch(`/submissions/${s.id}`, { status, feedback });
  return (
    <li className="stack-sm">
      <div className="row-between"><strong className="break">{s.studentName}</strong><StatusBadge status={s.status} /></div>
      <div className="small muted">Submitted {formatDateTime(s.submittedAt)}</div>
      {s.body && <p className="pre">{s.body}</p>}
      {s.fileId && <a href={fileUrl(s.fileId)}>{s.fileName}</a>}
      <Textarea label={`Feedback for ${s.studentName}`} rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      <div className="row"><ActionButton className="btn btn-primary btn-sm" action={review('completed')} success="Marked complete." invalidate={invalidate}>Mark complete</ActionButton><ActionButton action={review('needs_changes')} success="Returned for changes." invalidate={invalidate}>Request changes</ActionButton></div>
    </li>
  );
}

function StudentSubmission({ a, id, invalidate }: { a: any; id: string; invalidate: unknown[][] }) {
  const mine = a.submissions[0];
  const [body, setBody] = useState(mine?.body ?? '');
  const [file, setFile] = useState<File | null>(null);
  const f = useForm(() => api.post(`/assignments/${id}/submission`, toForm({ body }, file)), { success: 'Work submitted.', invalidate });
  const locked = mine?.status === 'completed' || a.status === 'closed';
  return (
    <Card title="Your submission" action={mine ? <StatusBadge status={mine.status} /> : undefined}>
      <div className="stack">
        {mine?.feedback && <Notice kind={mine.status === 'completed' ? 'success' : 'warning'}><strong>Teacher feedback:</strong> {mine.feedback}</Notice>}
        {mine?.fileId && <p>Attached: <a href={fileUrl(mine.fileId)}>{mine.fileName}</a></p>}
        {locked ? (mine?.body ? <p className="pre">{mine.body}</p> : a.status === 'closed' && !mine ? <Notice>This assignment is closed.</Notice> : null) : (
          <form className="stack" onSubmit={f.onSubmit}>
            <Textarea label="Your response" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
            <Input label="Attach a file" type="file" accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div><button className="btn btn-primary" disabled={f.busy}>{mine ? 'Resubmit' : 'Submit work'}</button></div>
          </form>
        )}
      </div>
    </Card>
  );
}

export function Verification() {
  const { user, refresh } = useAuth();
  const query = useGet(['verification'], '/teacher/verification');
  const [statement, setStatement] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const f = useForm(() => api.post('/teacher/verification', toForm({ statement }, file)), { success: 'Verification submitted.', invalidate: [['verification']], onDone: () => { setStatement(''); setFile(null); void refresh(); } });
  return (
    <>
      <PageHead title="Teacher verification" sub="An administrator reviews this before teaching features unlock." />
      <Async query={query}>
        {(d) => (
          <div className="stack-lg">
            <section className="card card-pad row-between"><strong>Current status</strong><StatusBadge status={user?.teacherStatus ?? d.status} /></section>
            {d.status !== 'approved' && (
              <Card title="Submit details">
                <form className="stack" onSubmit={f.onSubmit}>
                  <Textarea label="Statement" required rows={4} hint="Describe your position and how we can confirm it." value={statement} onChange={(e) => setStatement(e.target.value)} error={f.errors.statement} />
                  <Input label="Supporting document (optional)" type="file" hint="Visible only to you and administrators." accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <div><button className="btn btn-primary" disabled={f.busy}>Submit</button></div>
                </form>
              </Card>
            )}
            <Card title="History">{d.history.length === 0 ? <Empty title="Nothing submitted yet" /> : <ul className="list">{d.history.map((h: any) => <li key={h.id} className="stack-sm"><div className="row-between"><span className="small muted">{formatDateTime(h.createdAt)}</span><StatusBadge status={h.status} /></div>{h.statement && <p className="pre">{h.statement}</p>}{h.documentName && <p className="small muted">Document: {h.documentName}</p>}{h.decisionNote && <p className="small"><strong>Reviewer note:</strong> {h.decisionNote}</p>}</li>)}</ul>}</Card>
          </div>
        )}
      </Async>
    </>
  );
}

export function Analytics() {
  const query = useGet(['analytics'], '/teacher/analytics');
  return (
    <>
      <PageHead title="Analytics" sub="Engagement indicators across your groups. These are not academic grades." />
      <Async query={query}>
        {(d) => (
          <div className="stack-lg">
            <section className="card card-pad"><strong>{d.pendingMentorship}</strong> pending mentorship request{d.pendingMentorship === 1 ? '' : 's'}</section>
            <Card title="Group engagement" flush>
              {d.groups.length === 0 ? <div className="card-body"><Empty title="Join or create a group to see engagement" /></div> : (
                <div className="table-wrap"><table className="table responsive">
                  <thead><tr><th>Group</th><th>Members</th><th>Task completion</th><th>Sessions</th><th>Attendances</th><th>Activity (30 days)</th></tr></thead>
                  <tbody>{d.groups.map((g: any) => {
                    const pct = g.tasksTotal ? Math.round(g.tasksCompleted / g.tasksTotal * 100) : 0;
                    return <tr key={g.id}><td data-label="Group"><Link to={`/app/groups/${g.id}`} className="break">{g.name}</Link></td><td data-label="Members">{g.members}</td><td data-label="Task completion"><div style={{ minWidth: '6rem' }}><div className="small">{g.tasksCompleted} of {g.tasksTotal}</div><Progress value={pct} label={`${g.name} task completion`} /></div></td><td data-label="Sessions">{g.sessionsTotal}</td><td data-label="Attendances">{g.attendance}</td><td data-label="Activity (30 days)">{g.activity30d}</td></tr>;
                  })}</tbody></table></div>
              )}
            </Card>
            <Card title="Participation trend (events per week)">
              {d.trend.length === 0 ? <Empty title="No activity in the last 8 weeks" /> : (() => {
                const max = Math.max(...d.trend.map((t: any) => t.events));
                return <ul className="stack-sm">{d.trend.map((t: any) => <li key={t.week} className="row" style={{ flexWrap: 'nowrap' }}><span className="small muted" style={{ width: '6rem', flexShrink: 0 }}>{t.week}</span><div className="grow"><Progress value={Math.round(t.events / max * 100)} label={`Week of ${t.week}`} /></div><span className="small" style={{ width: '2.5rem', textAlign: 'right' }}>{t.events}</span></li>)}</ul>;
              })()}
            </Card>
            <Card title="Student progress" flush>
              {d.students.length === 0 ? <div className="card-body"><Empty title="No students yet" /></div> : <div className="table-wrap"><table className="table responsive"><thead><tr><th>Student</th><th>Tasks completed</th><th>Tasks open</th></tr></thead><tbody>{d.students.map((s: any) => <tr key={s.id}><td data-label="Student"><Link to={`/app/users/${s.id}`} className="break">{s.fullName}</Link></td><td data-label="Tasks completed">{s.completedTasks}</td><td data-label="Tasks open">{s.openTasks}</td></tr>)}</tbody></table></div>}
            </Card>
          </div>
        )}
      </Async>
    </>
  );
}
