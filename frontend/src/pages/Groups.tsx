/* eslint-disable @typescript-eslint/no-explicit-any */
import { Crown, Plus, UserMinus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChatPane, ReportButton, ResourceForm, ResourceList, TaskBoard, useGet, useTopics } from '../components/shared';
import { ActionButton, Async, Avatar, Card, Chips, Empty, Input, Modal, Notice, PageHead, Pagination, Progress, Select, StatusBadge, TagInput, Tabs, Textarea, useForm, useUrlTab } from '../components/ui';
import { api, formatDateTime, fromNow, qs, titleCase } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounced } from './People';

const DIFFICULTY: Array<[string, string]> = [['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']];

export function GroupForm({ group, onClose }: { group?: any; onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const subjectOptions = useTopics('subject');
  const [form, setForm] = useState({ name: group?.name ?? '', description: group?.description ?? '', objectives: group?.objectives ?? '', difficulty: group?.difficulty ?? 'intermediate', capacity: String(group?.capacity ?? 10), visibility: group?.visibility ?? 'public', kind: group?.kind ?? 'study' });
  const [subjects, setSubjects] = useState<string[]>(group?.topics ?? []);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const f = useForm(() => {
    const body = { ...form, capacity: Number(form.capacity), subjects };
    if (group) { const { kind: _k, ...rest } = body; return api.patch(`/groups/${group.id}`, rest); }
    return api.post('/groups', body);
  }, { success: group ? 'Group updated.' : 'Group created.', invalidate: [['groups'], ['group']], onDone: (r: any) => { onClose(); if (!group) navigate(`/app/groups/${r.id}`); } });
  return (
    <Modal title={group ? 'Group settings' : 'Create a group'} onClose={onClose}>
      <form className="stack" onSubmit={f.onSubmit}>
        {!group && user?.role === 'teacher' && <Select label="Type" value={form.kind} onChange={set('kind')} options={[['study', 'Study group'], ['community', 'Academic community']]} />}
        <Input label="Group name" required value={form.name} onChange={set('name')} error={f.errors.name} />
        <Textarea label="Description" rows={3} value={form.description} onChange={set('description')} />
        <Textarea label="Objectives" rows={3} value={form.objectives} onChange={set('objectives')} />
        <TagInput label="Subjects and tags" value={subjects} onChange={setSubjects} suggestions={subjectOptions} />
        <div className="form-grid">
          <Select label="Difficulty" value={form.difficulty} onChange={set('difficulty')} options={DIFFICULTY} />
          <Input label="Capacity" type="number" min={2} max={200} required value={form.capacity} onChange={set('capacity')} error={f.errors.capacity} />
          <Select label="Visibility" fieldClass="span-2" value={form.visibility} onChange={set('visibility')} options={[['public', 'Public: anyone can find it and request to join'], ['private', 'Private: invitation only']]} />
        </div>
        <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.busy}>{group ? 'Save changes' : 'Create group'}</button></div>
      </form>
    </Modal>
  );
}

export function GroupsPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useUrlTab(['browse', 'mine', 'invitations'] as const, params, setParams);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(''); const [subject, setSubject] = useState(''); const [difficulty, setDifficulty] = useState(''); const [maxSize, setMaxSize] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search); const s = useDebounced(subject);
  useEffect(() => setPage(1), [q, s, difficulty, maxSize, tab]);
  const filter = { q, subjects: s, difficulty, maxSize, page, mine: tab === 'mine' ? 'true' : undefined };
  const query = useGet(['groups', filter], `/groups${qs(filter)}`, tab !== 'invitations');
  const invites = useGet(['invitations'], '/invitations');
  return (
    <>
      <PageHead title="Study groups" sub="Find a group or start your own." actions={<button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={18} aria-hidden="true" />Create group</button>} />
      <div className="stack">
        <Tabs label="Groups" value={tab} onChange={setTab} tabs={[['browse', 'Browse'], ['mine', 'My groups'], ['invitations', `Invitations${invites.data?.items.length ? ` (${invites.data.items.length})` : ''}`]]} />
        {tab === 'invitations' ? (
          <Card><Async query={invites}>{(d) => d.items.length === 0 ? <Empty title="No pending invitations" /> : (
            <ul className="list">{d.items.map((i: any) => <li key={i.id} className="row-between"><div className="grow"><div className="break" style={{ fontWeight: 550 }}>{i.groupName}</div><div className="small muted">Invited by {i.inviterName}</div></div><div className="row"><ActionButton className="btn btn-primary btn-sm" action={() => api.patch(`/invitations/${i.id}`, { action: 'accept' })} success="You joined the group." invalidate={[['invitations'], ['groups']]}>Accept</ActionButton><ActionButton action={() => api.patch(`/invitations/${i.id}`, { action: 'decline' })} invalidate={[['invitations']]}>Decline</ActionButton></div></li>)}</ul>
          )}</Async></Card>
        ) : <>
          <section className="card card-pad" aria-label="Filters">
            <div className="grid-4">
              <Input label="Search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <Select label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} options={[['', 'Any'], ...DIFFICULTY]} />
              <Select label="Group size" value={maxSize} onChange={(e) => setMaxSize(e.target.value)} options={[['', 'Any size'], ['5', 'Up to 5'], ['10', 'Up to 10'], ['25', 'Up to 25']]} />
            </div>
          </section>
          <Async query={query}>
            {(d) => d.items.length === 0 ? <Empty title={tab === 'mine' ? 'You have not joined a group yet' : 'No groups match those filters'}><button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>Create a group</button></Empty> : <>
              <ul className="grid-3">{d.items.map((g: any) => (
                <li key={g.id} className="card card-pad stack-sm">
                  <div className="row-between"><Link className="break grow" style={{ fontWeight: 600 }} to={`/app/groups/${g.id}`}>{g.name}</Link>{g.visibility === 'private' && <span className="badge">Private</span>}{g.kind === 'community' && <span className="badge badge-brand">Community</span>}</div>
                  {g.description && <p className="small muted break">{g.description.slice(0, 120)}</p>}
                  <Chips items={g.topics.slice(0, 4)} />
                  <p className="small muted">{titleCase(g.difficulty)} · {g.memberCount} of {g.capacity} members</p>
                  {g.myRole ? <span className="badge badge-success" style={{ justifySelf: 'start' }}>{titleCase(g.myRole)}</span> : g.hasPendingRequest ? <span className="badge badge-warning" style={{ justifySelf: 'start' }}>Request pending</span> : null}
                </li>))}
              </ul>
              <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
            </>}
          </Async>
        </>}
      </div>
      {creating && <GroupForm onClose={() => setCreating(false)} />}
    </>
  );
}

const TABS = ['overview', 'discussion', 'tasks', 'projects', 'resources', 'schedule', 'members'] as const;

export function Workspace() {
  const { id } = useParams();
  const query = useGet(['group', id], `/groups/${id}`);
  return <Async query={query} lines={6}>{(g) => g.myRole ? <Member group={g} /> : <Outsider group={g} />}</Async>;
}

function Outsider({ group }: { group: any }) {
  const [message, setMessage] = useState('');
  const f = useForm(() => api.post(`/groups/${group.id}/join`, { message }), { success: 'Request sent to the group managers.', invalidate: [['group'], ['groups']] });
  return (
    <>
      <PageHead title={group.name} crumb={{ to: '/app/groups', label: 'Study groups' }} actions={<ReportButton targetType="group" targetId={group.id} />} />
      <div className="grid-2">
        <Card title="About this group"><div className="stack-sm">
          {group.description && <p className="pre">{group.description}</p>}
          {group.objectives && <div><div className="label">Objectives</div><p className="pre muted">{group.objectives}</p></div>}
          <Chips items={group.topics} />
          <p className="small muted">{titleCase(group.difficulty)} · {group.memberCount} of {group.capacity} members · Led by {group.ownerName}</p>
        </div></Card>
        <Card title="Join">
          {group.pendingInvitationId ? <div className="stack-sm"><p>You have been invited to this group.</p><ActionButton className="btn btn-primary" action={() => api.patch(`/invitations/${group.pendingInvitationId}`, { action: 'accept' })} success="You joined the group." invalidate={[['group'], ['groups'], ['invitations']]}>Accept invitation</ActionButton></div>
            : group.hasPendingRequest ? <Notice>Your request is waiting for a group manager to review it.</Notice>
              : group.memberCount >= group.capacity ? <Notice kind="warning">This group is full.</Notice>
                : <form className="stack" onSubmit={f.onSubmit}><Textarea label="Message to the group (optional)" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /><button className="btn btn-primary" disabled={f.busy}>Request to join</button></form>}
        </Card>
      </div>
    </>
  );
}

function Member({ group }: { group: any }) {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useUrlTab(TABS, params, setParams);
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const manager = group.myRole === 'owner' || group.myRole === 'leader';
  const workspace = useGet(['workspace', group.id], `/groups/${group.id}/workspace`);
  return (
    <>
      <PageHead title={group.name} crumb={{ to: '/app/groups', label: 'Study groups' }} sub={`${titleCase(group.difficulty)} · ${group.memberCount} of ${group.capacity} members`} actions={<>
        {manager && <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Settings</button>}
        {group.myRole === 'owner' && <ActionButton action={() => api.delete(`/groups/${group.id}`)} className="btn btn-ghost btn-sm" success="Group deleted." invalidate={[['groups']]} confirm={`Delete ${group.name}? Members will lose access to its workspace.`} onDone={() => navigate('/app/groups')}>Delete</ActionButton>}
        <ReportButton targetType="group" targetId={group.id} />
        {group.myRole !== 'owner' && <ActionButton action={() => api.post(`/groups/${group.id}/leave`)} className="btn btn-ghost btn-sm" success="You left the group." invalidate={[['groups']]} confirm={`Leave ${group.name}?`} onDone={() => navigate('/app/groups')}>Leave</ActionButton>}
      </>} />
      <div className="stack">
        <Tabs label="Workspace" value={tab} onChange={setTab} tabs={TABS.map((t) => [t, titleCase(t)])} />
        {tab === 'overview' && <Overview group={group} query={workspace} manager={manager} />}
        {tab === 'discussion' && <Card flush><div style={{ height: '32rem' }}><Async query={workspace}>{(w) => <ChatPane conversationId={w.conversationId} />}</Async></div></Card>}
        {tab === 'tasks' && <GroupTasks group={group} />}
        {tab === 'projects' && <GroupProjects group={group} />}
        {tab === 'resources' && <GroupResources groupId={group.id} />}
        {tab === 'schedule' && <GroupSchedule group={group} />}
        {tab === 'members' && <Members group={group} manager={manager} />}
      </div>
      {editing && <GroupForm group={group} onClose={() => setEditing(false)} />}
    </>
  );
}

function Overview({ group, query, manager }: { group: any; query: any; manager: boolean }) {
  const [form, setForm] = useState({ title: '', body: '' });
  const f = useForm(() => api.post(`/groups/${group.id}/announcements`, form), { success: 'Announcement posted.', invalidate: [['workspace', group.id]], onDone: () => setForm({ title: '', body: '' }) });
  return (
    <Async query={query}>
      {(w: any) => {
        const percent = w.progress.total ? Math.round(w.progress.completed / w.progress.total * 100) : 0;
        return (
          <div className="grid-2">
            <Card title="Overview"><div className="stack-sm">
              {group.description ? <p className="pre">{group.description}</p> : <p className="muted">No description yet.</p>}
              {group.objectives && <div><div className="label">Objectives</div><p className="pre muted">{group.objectives}</p></div>}
              <Chips items={group.topics} />
            </div></Card>
            <Card title="Progress"><div className="stack-sm"><p>{w.progress.completed} of {w.progress.total} tasks completed</p><Progress value={percent} label="Group task progress" /></div>
              {w.deadlines.length > 0 && <div style={{ marginTop: '1rem' }}><div className="label">Upcoming deadlines</div><ul className="list small">{w.deadlines.map((t: any) => <li key={t.id}>{t.title}<div className="muted">{formatDateTime(t.dueAt)}</div></li>)}</ul></div>}
            </Card>
            <Card title="Announcements"><div className="stack">
              {manager && <form className="stack-sm" onSubmit={f.onSubmit}><Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /><Textarea label="Message" required rows={2} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /><div><button className="btn btn-primary btn-sm" disabled={f.busy}>Post</button></div></form>}
              {w.announcements.length === 0 ? <Empty title="No announcements yet" /> : <ul className="list">{w.announcements.map((a: any) => <li key={a.id}><div className="break" style={{ fontWeight: 600 }}>{a.title}</div><p className="small pre">{a.body}</p><div className="small muted">{a.authorName} · {fromNow(a.createdAt)}</div></li>)}</ul>}
            </div></Card>
            <Card title="Activity">{w.activity.length === 0 ? <Empty title="No activity yet" /> : <ul className="list small">{w.activity.map((a: any) => <li key={a.id}><strong>{a.actorName ?? 'Someone'}</strong> {a.verb}{a.detail ? `: ${a.detail}` : ''}<div className="muted">{fromNow(a.createdAt)}</div></li>)}</ul>}</Card>
          </div>
        );
      }}
    </Async>
  );
}

function GroupTasks({ group }: { group: any }) {
  const tasks = useGet(['tasks', group.id], `/groups/${group.id}/tasks`);
  const members = useGet(['members', group.id], `/groups/${group.id}/members`);
  return <Async query={tasks}>{(d) => <TaskBoard tasks={d.items} members={members.data?.items ?? []} createUrl={`/groups/${group.id}/tasks`} canEdit invalidate={[['tasks', group.id], ['workspace', group.id]]} />}</Async>;
}

function GroupProjects({ group }: { group: any }) {
  const query = useGet(['projects', { groupId: group.id }], `/projects${qs({ groupId: group.id })}`);
  const members = useGet(['members', group.id], `/groups/${group.id}/members`);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', objectives: '' });
  const [chosen, setChosen] = useState<string[]>([]);
  const navigate = useNavigate();
  const f = useForm(() => api.post('/projects', { ...form, groupId: group.id, memberIds: chosen }), { success: 'Project created.', invalidate: [['projects']], onDone: (r: any) => navigate(`/app/projects/${r.id}`) });
  return (
    <div className="stack">
      <div><button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />New project</button></div>
      <Async query={query}>{(d) => d.items.length === 0 ? <Empty title="No projects in this group yet" /> : (
        <ul className="grid-2">{d.items.map((p: any) => <li key={p.id} className="card card-pad stack-sm"><div className="row-between"><Link className="break grow" style={{ fontWeight: 600 }} to={`/app/projects/${p.id}`}>{p.title}</Link><StatusBadge status={p.status} /></div><p className="small muted">{p.completedCount} of {p.taskCount} tasks · {p.memberCount} members</p><Progress value={p.taskCount ? Math.round(p.completedCount / p.taskCount * 100) : 0} label={`${p.title} progress`} /></li>)}</ul>
      )}</Async>
      {creating && (
        <Modal title="New project" onClose={() => setCreating(false)}>
          <form className="stack" onSubmit={f.onSubmit}>
            <Input label="Project title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={f.errors.title} />
            <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Textarea label="Objectives" value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} />
            <fieldset><legend className="label">Team members</legend>{(members.data?.items ?? []).map((m: any) => <label key={m.id} className="check"><input type="checkbox" checked={chosen.includes(m.id)} onChange={() => setChosen(chosen.includes(m.id) ? chosen.filter((x) => x !== m.id) : [...chosen, m.id])} />{m.fullName}</label>)}</fieldset>
            <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="btn btn-primary" disabled={f.busy}>Create project</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function GroupResources({ groupId }: { groupId: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <Card title="Shared resources" action={<button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" />Share</button>}>
      <ResourceList groupId={groupId} />
      {adding && <ResourceForm groupId={groupId} onClose={() => setAdding(false)} invalidate={[['resources'], ['workspace', groupId]]} />}
    </Card>
  );
}

function GroupSchedule({ group }: { group: any }) {
  const query = useGet(['sessions', 'upcoming'], '/sessions?scope=upcoming&pageSize=50');
  return (
    <Card title="Study schedule" action={<Link className="btn btn-primary btn-sm" to={`/app/sessions?group=${group.id}`}>Schedule session</Link>}>
      <Async query={query}>{(d) => {
        const items = d.items.filter((s: any) => s.groupId === group.id);
        return items.length === 0 ? <Empty title="No sessions scheduled" /> : <ul className="list">{items.map((s: any) => <li key={s.id} className="row-between"><div className="grow"><div className="break" style={{ fontWeight: 550 }}>{s.title}</div><div className="small muted">{formatDateTime(s.startsAt)} · {s.durationMinutes} min · {s.participantCount} joined</div></div><StatusBadge status={s.status} /></li>)}</ul>;
      }}</Async>
    </Card>
  );
}

function Members({ group, manager }: { group: any; manager: boolean }) {
  const { user } = useAuth();
  const members = useGet(['members', group.id], `/groups/${group.id}/members`);
  const requests = useGet(['requests', group.id], `/groups/${group.id}/requests`, manager);
  const connections = useGet(['connections'], '/connections');
  const [invitee, setInvitee] = useState('');
  const refresh = [['members', group.id], ['requests', group.id], ['group', group.id], ['workspace', group.id]];
  const invite = useForm(() => api.post(`/groups/${group.id}/invitations`, { userId: invitee }), { success: 'Invitation sent.', onDone: () => setInvitee('') });
  const isOwner = group.myRole === 'owner';
  const present = new Set((members.data?.items ?? []).map((m: any) => m.id));
  const mentees = useGet(['mentorship'], '/mentorship', user?.role === 'teacher');
  const people = new Map<string, string>([
    ...(connections.data?.connections ?? []).map((c: any): [string, string] => [c.otherId, c.otherName]),
    ...(mentees.data?.items ?? []).filter((m: any) => m.status === 'accepted').map((m: any): [string, string] => [m.otherId, m.otherName]),
  ]);
  const invitable = [...people].filter(([personId]) => !present.has(personId));
  const canInvite = group.visibility === 'public' || manager;
  return (
    <div className="grid-2">
      <Card title="Members"><Async query={members}>{(d) => (
        <ul className="list">{d.items.map((m: any) => (
          <li key={m.id} className="row-between">
            <div className="row grow"><Avatar name={m.fullName} fileId={m.avatarFileId} /><div className="grow"><Link className="title break" to={`/app/users/${m.id}`}>{m.fullName}</Link><div className="small muted">{titleCase(m.role)}{m.accountRole === 'teacher' ? ' · Teacher' : ''}</div></div></div>
            {m.id !== user?.id && m.role !== 'owner' && (
              <div className="row" style={{ gap: '.25rem' }}>
                {isOwner && <ActionButton className="btn btn-ghost btn-sm" action={() => api.patch(`/groups/${group.id}/members/${m.id}`, { role: m.role === 'leader' ? 'member' : 'leader' })} success="Role updated." invalidate={refresh}>{m.role === 'leader' ? 'Remove leader' : 'Make leader'}</ActionButton>}
                {isOwner && <ActionButton className="icon-btn" label={`Transfer ownership to ${m.fullName}`} action={() => api.patch(`/groups/${group.id}/members/${m.id}`, { role: 'owner' })} success="Ownership transferred." invalidate={refresh} confirm={`Make ${m.fullName} the owner? You will become a leader.`}><Crown size={16} aria-hidden="true" /></ActionButton>}
                {manager && (isOwner || m.role === 'member') && <ActionButton className="icon-btn" label={`Remove ${m.fullName}`} action={() => api.delete(`/groups/${group.id}/members/${m.id}`)} success="Member removed." invalidate={refresh} confirm={`Remove ${m.fullName} from this group?`}><UserMinus size={16} aria-hidden="true" /></ActionButton>}
              </div>
            )}
          </li>))}
        </ul>
      )}</Async></Card>
      <div className="stack">
        {manager && <Card title="Join requests"><Async query={requests}>{(d) => d.items.length === 0 ? <Empty title="No pending requests" /> : (
          <ul className="list">{d.items.map((r: any) => <li key={r.id} className="stack-sm"><div className="row-between"><Link className="title break grow" to={`/app/users/${r.userId}`}>{r.fullName}</Link><div className="row"><ActionButton className="btn btn-primary btn-sm" action={() => api.patch(`/groups/${group.id}/requests/${r.id}`, { action: 'approve' })} success="Member added." invalidate={refresh}>Approve</ActionButton><ActionButton action={() => api.patch(`/groups/${group.id}/requests/${r.id}`, { action: 'reject' })} invalidate={refresh}>Reject</ActionButton></div></div>{r.message && <p className="small muted break">{r.message}</p>}</li>)}</ul>
        )}</Async></Card>}
        {canInvite && <Card title={user?.role === 'teacher' ? 'Invite a student' : 'Invite a connection'}>
          {invitable.length === 0 ? <Empty title="No connections to invite"><Link to="/app/discover">Find people</Link></Empty> : (
            <form className="stack-sm" onSubmit={invite.onSubmit}><Select label="Connection" required value={invitee} onChange={(e) => setInvitee(e.target.value)} options={[['', 'Choose someone'], ...invitable]} /><div><button className="btn btn-primary btn-sm" disabled={invite.busy || !invitee}>Send invitation</button></div></form>
          )}
        </Card>}
      </div>
    </div>
  );
}
