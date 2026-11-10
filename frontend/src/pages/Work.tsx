/* eslint-disable @typescript-eslint/no-explicit-any */
import { CalendarPlus, MessageSquare, Plus, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChatPane, ResourceForm, ResourceList, TaskBoard, useGet } from '../components/shared';
import { ActionButton, Async, Avatar, Card, Empty, Input, Modal, Notice, PageHead, Pagination, Progress, Select, StatusBadge, Tabs, Textarea, useForm, useOptimisticToggle } from '../components/ui';
import { api, formatDate, formatDateTime, fromNow, isoToLocal, localToIso, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounced } from './People';

export function Projects() {
  const [page, setPage] = useState(1);
  const query = useGet(['projects', page], `/projects${qs({ page })}`);
  return (
    <>
      <PageHead title="Projects" sub="Academic projects across your study groups. Create one from a group's Projects tab." />
      <Async query={query}>
        {(d) => d.items.length === 0 ? <Empty title="No projects yet"><Link to="/app/groups">Open a study group to start one</Link></Empty> : <>
          <ul className="grid-3">{d.items.map((p: any) => (
            <li key={p.id} className="card card-pad stack-sm">
              <div className="row-between"><Link className="break grow" style={{ fontWeight: 600 }} to={`/app/projects/${p.id}`}>{p.title}</Link><StatusBadge status={p.status} /></div>
              <p className="small muted">{p.groupName} · {p.memberCount} members</p>
              <p className="small">{p.completedCount} of {p.taskCount} tasks done</p>
              <Progress value={p.taskCount ? Math.round(p.completedCount / p.taskCount * 100) : 0} label={`${p.title} progress`} />
            </li>))}
          </ul>
          <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
        </>}
      </Async>
    </>
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const query = useGet(['project', id], `/projects/${id}`);
  const key = [['project', id], ['projects']];
  const [tab, setTab] = useState<'board' | 'plan' | 'documents' | 'discussion'>('board');
  const [adding, setAdding] = useState(false);
  const [milestone, setMilestone] = useState({ title: '', dueAt: '' });
  const m = useForm(() => api.post(`/projects/${id}/milestones`, { title: milestone.title, dueAt: milestone.dueAt ? localToIso(milestone.dueAt) : null }), { success: 'Milestone added.', invalidate: key, onDone: () => setMilestone({ title: '', dueAt: '' }) });
  return (
    <Async query={query} lines={8}>
      {(p) => (
        <>
          <PageHead title={p.title} crumb={{ to: `/app/groups/${p.groupId}?tab=projects`, label: p.groupName }} actions={p.canModify ? (
            p.status === 'active'
              ? <ActionButton action={() => api.patch(`/projects/${id}`, { status: 'completed' })} success="Project completed." invalidate={key} confirm="Mark this project as completed?">Mark completed</ActionButton>
              : <ActionButton action={() => api.patch(`/projects/${id}`, { status: 'active' })} invalidate={key}>Reopen</ActionButton>
          ) : undefined} />
          <div className="stack">
            <section className="card card-pad stack-sm">
              <div className="row-between"><strong>{p.progress}% complete</strong><StatusBadge status={p.status} /></div>
              <Progress value={p.progress} label="Project completion" />
              {p.description && <p className="pre">{p.description}</p>}
              {p.objectives && <div><div className="label">Objectives</div><p className="pre muted">{p.objectives}</p></div>}
              <div className="row" style={{ gap: '.25rem' }}>{p.members.map((u: any) => <span key={u.id} title={u.fullName}><Avatar name={u.fullName} fileId={u.avatarFileId} size={30} /></span>)}<span className="small muted" style={{ marginLeft: '.25rem' }}>{p.members.map((u: any) => u.fullName).join(', ')}</span></div>
              {!p.canModify && <Notice>You can view this project. Only its team members and group managers can change it.</Notice>}
            </section>
            <Tabs label="Project" value={tab} onChange={setTab} tabs={[['board', 'Task board'], ['plan', 'Milestones'], ['documents', 'Documents'], ['discussion', 'Discussion']]} />
            {tab === 'board' && <TaskBoard tasks={p.tasks} members={p.groupMembers} createUrl={`/projects/${id}/tasks`} canEdit={p.canModify} invalidate={key} />}
            {tab === 'plan' && (
              <Card title="Milestones"><div className="stack">
                {p.canModify && <form className="form-grid" onSubmit={m.onSubmit}><Input label="Milestone" required value={milestone.title} onChange={(e) => setMilestone({ ...milestone, title: e.target.value })} error={m.errors.title} /><Input label="Due" type="datetime-local" value={milestone.dueAt} onChange={(e) => setMilestone({ ...milestone, dueAt: e.target.value })} /><div className="span-2"><button className="btn btn-primary btn-sm" disabled={m.busy}>Add milestone</button></div></form>}
                {p.milestones.length === 0 ? <Empty title="No milestones yet" /> : <ul className="list">{p.milestones.map((x: any) => <Milestone key={x.id} item={x} canEdit={p.canModify} invalidate={key} />)}</ul>}
              </div></Card>
            )}
            {tab === 'documents' && (
              <Card title="Shared documents" action={p.canModify ? <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" />Add</button> : undefined}>
                {p.resources.length === 0 ? <Empty title="No documents yet" /> : <ul className="list">{p.resources.map((r: any) => <li key={r.id} className="row-between"><span className="break grow">{r.title}</span>{r.kind === 'file' ? <a className="btn btn-secondary btn-sm" href={`/api/files/${r.fileId}`}>Download</a> : <a className="btn btn-secondary btn-sm" href={r.url} target="_blank" rel="noopener noreferrer">Open</a>}</li>)}</ul>}
                {adding && <ResourceForm projectId={id} onClose={() => setAdding(false)} invalidate={key} />}
              </Card>
            )}
            {tab === 'discussion' && (p.conversationId ? <Card flush><div style={{ height: '30rem' }}><ChatPane conversationId={p.conversationId} /></div></Card> : <Notice>Only project team members can see this discussion.</Notice>)}
          </div>
        </>
      )}
    </Async>
  );
}

function Milestone({ item, canEdit, invalidate }: { item: any; canEdit: boolean; invalidate: unknown[][] }) {
  const t = useOptimisticToggle(!!item.completedAt, (completed) => api.patch(`/milestones/${item.id}`, { completed }), invalidate);
  return <li><label className="check"><input type="checkbox" disabled={!canEdit} checked={t.checked} onChange={t.toggle} /><span className="break">{item.title}{item.dueAt && <span className="small muted"> · Due {formatDate(item.dueAt)}</span>}</span></label></li>;
}

export function Messages() {
  const { id } = useParams();
  const query = useGet(['conversations'], '/conversations');
  useEffect(() => { document.title = 'Messages | PeerConnect'; }, []);
  return (
    <section className={`card chat ${id ? 'has-active' : ''}`} aria-label="Messages">
      <nav className="chat-list" aria-label="Conversations">
        <h1 style={{ padding: '1rem', borderBottom: '1px solid var(--border)', fontSize: '1.125rem' }}>Messages</h1>
        <Async query={query}>
          {(d) => d.items.length === 0 ? <Empty title="No conversations yet"><Link to="/app/connections">Message a connection</Link></Empty> : (
            <ul>{d.items.map((c: any) => (
              <li key={c.id}><Link className={`chat-item ${c.id === id ? 'active' : ''}`} to={`/app/messages/${c.id}`} aria-current={c.id === id ? 'page' : undefined}>
                <Avatar name={c.title ?? '?'} fileId={c.otherAvatar} />
                <div className="grow"><div className="row-between" style={{ flexWrap: 'nowrap' }}><span className="break" style={{ fontWeight: c.unreadCount ? 650 : 500 }}>{c.title}</span>{c.lastMessageAt && <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{fromNow(c.lastMessageAt)}</span>}</div><div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.lastMessage || `${c.type === 'direct' ? 'Direct' : c.type === 'group' ? 'Group' : 'Project'} conversation`}</div></div>
                {c.unreadCount > 0 && <span className="badge badge-brand" aria-label={`${c.unreadCount} unread`}>{c.unreadCount}</span>}
              </Link></li>))}
            </ul>
          )}
        </Async>
      </nav>
      {id ? <div className="stack-sm" style={{ gridTemplateRows: 'auto minmax(0,1fr)', gap: 0, minHeight: 0 }}>
        <div className="row" style={{ padding: '.5rem 1rem', borderBottom: '1px solid var(--border)' }}><Link to="/app/messages" className="small">All conversations</Link><strong className="break">{query.data?.items.find((c: any) => c.id === id)?.title}</strong></div>
        <ChatPane key={id} conversationId={id} />
      </div> : <div className="chat-pane"><Empty title="Select a conversation" icon={<MessageSquare size={28} aria-hidden="true" />} /></div>}
    </section>
  );
}

export function Sessions() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any>(params.get('group') ? { groupId: params.get('group') } : null);
  useEffect(() => setPage(1), [tab]);
  const query = useGet(['sessions', tab, page], `/sessions${qs({ scope: tab, page })}`);
  const key = [['sessions'], ['dashboard']];
  return (
    <>
      <PageHead title="Study sessions" sub="Times are shown in your local time zone." actions={<button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={18} aria-hidden="true" />Schedule session</button>} />
      <div className="stack">
        <Tabs label="Sessions" value={tab} onChange={setTab} tabs={[['upcoming', 'Upcoming'], ['past', 'Past']]} />
        <Async query={query}>
          {(d) => d.items.length === 0 ? <Empty title={`No ${tab} sessions`} /> : <>
            <ul className="stack">{d.items.map((s: any) => {
              const live = Date.now() >= new Date(s.startsAt).getTime() - 900000 && Date.now() <= new Date(s.startsAt).getTime() + s.durationMinutes * 60000;
              const mine = s.organizerId === user?.id;
              return (
                <li key={s.id} className="card card-pad row-between">
                  <div className="grow stack-sm" style={{ gap: '.125rem' }}>
                    <div className="row"><strong className="break">{s.title}</strong>{s.status === 'cancelled' && <StatusBadge status="cancelled" />}{s.attendedAt && <span className="badge badge-success">Attended</span>}</div>
                    <div className="small muted">{formatDateTime(s.startsAt)} · {s.durationMinutes} min</div>
                    <div className="small muted">{s.groupName ? `${s.groupName} · ` : ''}Organized by {s.organizerName} · {s.participantCount} joined</div>
                    {s.description && <div className="small break">{s.description}</div>}
                  </div>
                  <div className="row">
                    {s.status === 'scheduled' && tab === 'upcoming' && <>
                      {!s.joined && <ActionButton className="btn btn-primary btn-sm" action={() => api.post(`/sessions/${s.id}/join`)} success="You joined this session." invalidate={key}>Join</ActionButton>}
                      {s.joined && !mine && <ActionButton action={() => api.post(`/sessions/${s.id}/leave`)} invalidate={key}>Leave</ActionButton>}
                      {s.joined && live && !s.attendedAt && <ActionButton className="btn btn-primary btn-sm" action={() => api.post(`/sessions/${s.id}/check-in`)} success="Attendance recorded." invalidate={key}>Check in</ActionButton>}
                      {mine && <button className="btn btn-secondary btn-sm" onClick={() => setEditing(s)}>Reschedule</button>}
                      {mine && <ActionButton className="btn btn-ghost btn-sm" action={() => api.patch(`/sessions/${s.id}`, { status: 'cancelled' })} success="Session cancelled." invalidate={key} confirm={`Cancel "${s.title}"? Participants will be notified.`}>Cancel</ActionButton>}
                      <a className="btn btn-ghost btn-sm" href={`/api/sessions/${s.id}/calendar.ics`}><CalendarPlus size={14} aria-hidden="true" />Calendar</a>
                    </>}
                  </div>
                </li>
              );
            })}</ul>
            <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
          </>}
        </Async>
      </div>
      {editing && <SessionForm session={editing} onClose={() => setEditing(null)} invalidate={key} />}
    </>
  );
}

export function SessionForm({ session, onClose, invalidate, mentorshipId }: { session: any; onClose: () => void; invalidate: unknown[][]; mentorshipId?: string }) {
  const existing = !!session.id;
  const [form, setForm] = useState({ title: session.title ?? '', description: session.description ?? '', startsAt: session.startsAt ? isoToLocal(session.startsAt) : '', durationMinutes: String(session.durationMinutes ?? 60), groupId: session.groupId ?? '' });
  const groups = useGet(['groups', 'mine-all'], '/groups?mine=true&pageSize=50', !existing && !mentorshipId);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const f = useForm(() => {
    const body = { title: form.title, description: form.description, startsAt: localToIso(form.startsAt), durationMinutes: Number(form.durationMinutes) };
    return existing ? api.patch(`/sessions/${session.id}`, body) : api.post('/sessions', { ...body, groupId: form.groupId || null, mentorshipId: mentorshipId ?? null });
  }, { success: existing ? 'Session updated.' : 'Session scheduled.', invalidate, onDone: onClose });
  return (
    <Modal title={existing ? 'Reschedule session' : 'Schedule a session'} onClose={onClose}>
      <form className="stack" onSubmit={f.onSubmit}>
        <Input label="Title" required value={form.title} onChange={set('title')} error={f.errors.title} />
        <Textarea label="Description" value={form.description} onChange={set('description')} />
        <div className="form-grid">
          <Input label="Date and time" type="datetime-local" required value={form.startsAt} onChange={set('startsAt')} error={f.errors.startsAt} />
          <Input label="Duration (minutes)" type="number" min={5} max={600} required value={form.durationMinutes} onChange={set('durationMinutes')} />
        </div>
        {!existing && !mentorshipId && <Select label="Study group" value={form.groupId} onChange={set('groupId')} options={[['', 'No group (personal session)'], ...(groups.data?.items ?? []).map((g: any): [string, string] => [g.id, g.name])]} />}
        <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.busy}>{existing ? 'Save' : 'Schedule'}</button></div>
      </form>
    </Modal>
  );
}

export function Resources() {
  const [search, setSearch] = useState(''); const [subject, setSubject] = useState('');
  const [adding, setAdding] = useState(false);
  const q = useDebounced(search); const s = useDebounced(subject);
  return (
    <>
      <PageHead title="Learning resources" sub="Notes, documents and links you have access to." actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={18} aria-hidden="true" />Share resource</button>} />
      <div className="stack">
        <section className="card card-pad" aria-label="Filters"><div className="grid-2"><Input label="Search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /><Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></div></section>
        <Card><ResourceList q={q} subject={s} /></Card>
      </div>
      {adding && <ResourceForm onClose={() => setAdding(false)} invalidate={[['resources']]} />}
    </>
  );
}

const AI_FEATURES: Array<[string, string, string]> = [
  ['study_plan', 'Study plan', 'What do you need to learn, and by when?'],
  ['summarize', 'Summarize material', 'Paste the text to summarize. Do not include confidential documents.'],
  ['question', 'Academic question', 'What would you like explained?'],
  ['project_plan', 'Project plan', 'Describe your project.'],
  ['group_ideas', 'Study group ideas', 'What subject and goals do you have?'],
  ['resource_topics', 'What to study next', 'Which subject are you working on?'],
];

export function Assistant() {
  const status = useGet(['ai-status'], '/ai/status');
  const [feature, setFeature] = useState('study_plan');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<{ output: string; truncated: boolean } | null>(null);
  const f = useForm(() => api.post('/ai/assist', { feature, input }), { invalidate: [['ai-status']], onDone: setResult });
  const prompt = AI_FEATURES.find(([k]) => k === feature)![2];
  return (
    <>
      <PageHead title="AI assistant" sub="Optional help with planning and understanding." />
      <Async query={status}>
        {(s) => !s.available ? <Notice>AI assistance is not available on this installation. Everything else in PeerConnect works without it.</Notice> : (
          <div className="stack">
            <Notice>Only the text you type below is sent to the AI provider. Your profile, messages and files are not. {s.used} of {s.dailyLimit} requests used today.</Notice>
            <Card>
              <form className="stack" onSubmit={f.onSubmit}>
                <Select label="What do you need?" value={feature} onChange={(e) => setFeature(e.target.value)} options={AI_FEATURES.map(([k, l]): [string, string] => [k, l])} />
                <Textarea label={prompt} required rows={6} maxLength={12000} value={input} onChange={(e) => setInput(e.target.value)} error={f.errors.input} />
                <div><button className="btn btn-primary" disabled={f.busy}><Sparkles size={16} aria-hidden="true" />{f.busy ? 'Working…' : 'Generate'}</button></div>
              </form>
            </Card>
            {result && <Card title="AI-generated response" action={<span className="badge badge-brand"><Sparkles size={12} aria-hidden="true" />AI-generated</span>}><div className="stack-sm"><p className="pre">{result.output}</p>{result.truncated && <Notice kind="warning">This response was cut off because it reached the length limit.</Notice>}<p className="small muted">AI can be wrong. Check important facts with your teacher or course material.</p></div></Card>}
          </div>
        )}
      </Async>
    </>
  );
}
