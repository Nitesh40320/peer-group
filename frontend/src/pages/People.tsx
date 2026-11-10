/* eslint-disable @typescript-eslint/no-explicit-any */
import { BellOff, CalendarDays, ClipboardCheck, FolderKanban, GraduationCap, Mail, MessageSquare, Search, UserPlus, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ReportButton, useGet, useTopics } from '../components/shared';
import { ActionButton, Async, Avatar, Card, Chips, Empty, Input, Modal, Notice, PageHead, Pagination, Progress, Select, StatusBadge, TagInput, Textarea, useForm, useOptimisticToggle, useToast } from '../components/ui';
import { api, errorMessage, formatDateTime, fromNow, qs, titleCase, toForm } from '../lib/api';
import { useAuth } from '../lib/auth';

const Stat = ({ value, label }: { value: ReactNode; label: string }) => <div className="card stat"><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>;
const ActivityList = ({ items }: { items: any[] }) => items.length === 0 ? <Empty title="No recent activity" /> : (
  <ul className="list small">{items.map((a) => <li key={a.id}><strong>{a.actorName ?? 'Someone'}</strong> {a.verb}{a.detail ? `: ${a.detail}` : ''} in <Link to={`/app/groups/${a.groupId}`}>{a.groupName}</Link><div className="muted">{fromNow(a.createdAt)}</div></li>)}</ul>
);
const SessionList = ({ items }: { items: any[] }) => items.length === 0 ? <Empty title="No upcoming sessions" icon={<CalendarDays size={24} aria-hidden="true" />}><Link to="/app/sessions">Schedule one</Link></Empty> : (
  <ul className="list">{items.map((s) => <li key={s.id}><Link className="title break" to="/app/sessions">{s.title}</Link><div className="small muted">{formatDateTime(s.startsAt)}{s.groupName ? ` · ${s.groupName}` : ''}</div></li>)}</ul>
);

export function Dashboard() {
  const { user } = useAuth();
  if (user?.role === 'teacher') return <TeacherDashboard />;
  return <StudentDashboard />;
}

function ConnectButton({ userId }: { userId: string }) {
  return <ActionButton action={() => api.post('/connections', { userId })} success="Connection request sent." invalidate={[['dashboard'], ['matches'], ['students'], ['connections']]} className="btn btn-primary btn-sm"><UserPlus size={14} aria-hidden="true" />Connect</ActionButton>;
}

function StudentDashboard() {
  const { user } = useAuth();
  const query = useGet(['dashboard', 'student'], '/student/dashboard');
  return (
    <>
      <PageHead title={`Welcome, ${user?.fullName.split(' ')[0]}`} sub="Here is what is happening across your study groups." />
      <Async query={query} lines={8}>
        {(d) => (
          <div className="stack-lg">
            {d.completion.percent < 100 && (
              <section className="card card-pad stack-sm">
                <div className="row-between"><h2>Your profile is {d.completion.percent}% complete</h2><Link className="btn btn-primary btn-sm" to="/app/profile">Complete profile</Link></div>
                <Progress value={d.completion.percent} label="Profile completion" />
                <p className="small muted">Still needed: {d.completion.missing.join(', ')}. A fuller profile gives better matches.</p>
              </section>
            )}
            <div className="grid-4">
              <Stat value={d.progress.completedTasks} label="Tasks completed" />
              <Stat value={d.progress.activeProjects} label="Active projects" />
              <Stat value={d.progress.sessionsAttended} label="Sessions attended" />
              <Stat value={d.progress.milestonesReached} label="Milestones reached" />
            </div>
            <div className="grid-2">
              <Card title="Recommended study partners" action={<Link className="small" to="/app/discover">See all</Link>}>
                {d.partners.length === 0 ? <Empty title="No recommendations yet" icon={<Search size={24} aria-hidden="true" />}>Add subjects and availability to your <Link to="/app/profile">profile</Link>.</Empty> : (
                  <ul className="list">{d.partners.map((p: any) => (
                    <li key={p.id} className="stack-sm">
                      <div className="row-between"><div className="row grow"><Avatar name={p.fullName} fileId={p.avatarFileId} /><div className="grow"><Link className="title break" to={`/app/users/${p.id}`}>{p.fullName}</Link><div className="small muted">{p.score}% match</div></div></div><ConnectButton userId={p.id} /></div>
                      <p className="small muted">{p.explanation}</p>
                    </li>))}
                  </ul>
                )}
              </Card>
              <Card title="Recommended study groups" action={<Link className="small" to="/app/groups">Browse</Link>}>
                {d.groups.length === 0 ? <Empty title="No group recommendations yet" icon={<Users size={24} aria-hidden="true" />}>Add subjects to your profile, or <Link to="/app/groups">browse groups</Link>.</Empty> : (
                  <ul className="list">{d.groups.map((g: any) => <li key={g.id}><Link className="title break" to={`/app/groups/${g.id}`}>{g.name}</Link><div className="small muted">{g.memberCount} of {g.capacity} members · {g.sharedTopics} shared subject{g.sharedTopics === 1 ? '' : 's'}</div></li>)}</ul>
                )}
              </Card>
              <Card title="Upcoming study sessions"><SessionList items={d.sessions} /></Card>
              <Card title="Upcoming deadlines">
                {d.deadlines.length === 0 ? <Empty title="No deadlines" icon={<ClipboardCheck size={24} aria-hidden="true" />} /> : <ul className="list">{d.deadlines.map((t: any) => <li key={t.id}><Link className="title break" to={t.link}>{t.title}</Link><div className="small muted">{titleCase(t.type)} · Due {formatDateTime(t.dueAt)}</div></li>)}</ul>}
              </Card>
              <Card title="Group invitations">
                {d.invitations.length === 0 ? <Empty title="No pending invitations" /> : <ul className="list">{d.invitations.map((i: any) => (
                  <li key={i.id} className="row-between"><div className="grow"><div className="break" style={{ fontWeight: 550 }}>{i.groupName}</div><div className="small muted">From {i.inviterName}</div></div>
                    <div className="row"><ActionButton className="btn btn-primary btn-sm" action={() => api.patch(`/invitations/${i.id}`, { action: 'accept' })} success="You joined the group." invalidate={[['dashboard']]}>Accept</ActionButton><ActionButton action={() => api.patch(`/invitations/${i.id}`, { action: 'decline' })} invalidate={[['dashboard']]}>Decline</ActionButton></div></li>))}</ul>}
              </Card>
              <Card title="Recent messages" action={<Link className="small" to="/app/messages">Open</Link>}>
                {d.conversations.length === 0 ? <Empty title="No messages yet" icon={<MessageSquare size={24} aria-hidden="true" />} /> : <ul className="list">{d.conversations.map((c: any) => <li key={c.id} className="row-between"><div className="grow"><Link className="title break" to={`/app/messages/${c.id}`}>{c.title}</Link><div className="small muted break">{(c.lastMessage ?? '').slice(0, 80)}</div></div>{c.unreadCount > 0 && <span className="badge badge-brand">{c.unreadCount} new</span>}</li>)}</ul>}
              </Card>
              <Card title="Active projects" action={<Link className="small" to="/app/projects">All projects</Link>}>
                {d.projects.length === 0 ? <Empty title="No active projects" icon={<FolderKanban size={24} aria-hidden="true" />} /> : <ul className="list">{d.projects.map((p: any) => <li key={p.id} className="stack-sm"><div><Link className="title break" to={`/app/projects/${p.id}`}>{p.title}</Link><div className="small muted">{p.groupName} · {p.completedCount} of {p.taskCount} tasks</div></div><Progress value={p.taskCount ? Math.round(p.completedCount / p.taskCount * 100) : 0} label={`${p.title} progress`} /></li>)}</ul>}
              </Card>
              <Card title="Recent activity"><ActivityList items={d.activity} /></Card>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}

function TeacherDashboard() {
  const query = useGet(['dashboard', 'teacher'], '/teacher/dashboard');
  return (
    <>
      <PageHead title="Teacher dashboard" sub="Your communities, students and reviews." />
      <Async query={query} lines={8}>
        {(d) => !d.approved ? (
          <Notice kind="warning">Your teacher account is {titleCase(d.verificationStatus ?? 'pending').toLowerCase()}. Teaching features unlock once an administrator approves it. <Link to="/app/verification">View verification</Link></Notice>
        ) : (
          <div className="stack-lg">
            <div className="grid-3">
              <Stat value={d.stats.activeCommunities} label="Active communities and groups" />
              <Stat value={d.stats.groupStudents + d.stats.mentees} label="Students under guidance" />
              <Stat value={d.stats.pendingMentorship} label="Pending mentorship requests" />
              <Stat value={d.stats.activeAssignments} label="Active assignments" />
              <Stat value={d.stats.pendingReviews} label="Pending reviews" />
              <Stat value={d.stats.mentees} label="Active mentees" />
            </div>
            <div className="grid-2">
              <Card title="Mentorship requests" action={<Link className="small" to="/app/mentorship">Manage</Link>}>{d.requests.length === 0 ? <Empty title="No pending requests" icon={<GraduationCap size={24} aria-hidden="true" />} /> : <ul className="list">{d.requests.map((r: any) => <li key={r.id}><div style={{ fontWeight: 550 }}>{r.studentName}</div><div className="small muted break">{r.objective}</div></li>)}</ul>}</Card>
              <Card title="Upcoming sessions"><SessionList items={d.sessions} /></Card>
              <Card title="Your communities and groups" action={<Link className="small" to="/app/groups">All</Link>}>{d.groups.length === 0 ? <Empty title="No groups yet"><Link to="/app/groups">Create a community</Link></Empty> : <ul className="list">{d.groups.map((g: any) => <li key={g.id}><Link className="title break" to={`/app/groups/${g.id}`}>{g.name}</Link><div className="small muted">{titleCase(g.kind)} · {g.memberCount} members</div></li>)}</ul>}</Card>
              <Card title="Recent announcements">{d.announcements.length === 0 ? <Empty title="No announcements" /> : <ul className="list">{d.announcements.map((a: any) => <li key={a.id}><div className="break" style={{ fontWeight: 550 }}>{a.title}</div><div className="small muted">{a.groupName} · {fromNow(a.createdAt)}</div></li>)}</ul>}</Card>
              <Card title="Group activity"><ActivityList items={d.activity} /></Card>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const PERIODS = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']];
const METHODS: Array<[string, string]> = [['discussion', 'Discussion'], ['problem_solving', 'Problem solving'], ['teaching_others', 'Teaching others'], ['flashcards', 'Flashcards'], ['projects', 'Projects'], ['reading', 'Reading'], ['video', 'Video'], ['quiet_study', 'Quiet study']];

export function Profile() {
  const { user, refresh } = useAuth();
  const query = useGet(['me'], '/users/me');
  return (
    <>
      <PageHead title="Profile" sub="This is how others find and understand you." />
      <Async query={query} lines={8}>{(data) => <ProfileForm key={data.id} data={data} role={user!.role} onAvatar={refresh} />}</Async>
    </>
  );
}

function ProfileForm({ data, role, onAvatar }: { data: any; role: string; onAvatar: () => Promise<void> }) {
  const [form, setForm] = useState({ fullName: data.fullName ?? '', institution: data.institution ?? '', department: data.department ?? '', bio: data.bio ?? '', academicYear: data.academicYear ? String(data.academicYear) : '', learningGoals: data.learningGoals ?? '', visibility: data.visibility ?? 'everyone', designation: data.designation ?? '', experience: data.experience ?? '' });
  const [subjects, setSubjects] = useState<string[]>(data.subjects ?? []);
  const [skills, setSkills] = useState<string[]>(data.skills ?? []);
  const [interests, setInterests] = useState<string[]>(data.interests ?? []);
  const [methods, setMethods] = useState<string[]>(data.learningMethods ?? []);
  const [availability, setAvailability] = useState<string[]>(data.availability ?? []);
  const subjectOptions = useTopics('subject'); const skillOptions = useTopics('skill'); const interestOptions = useTopics('interest');
  const toast = useToast();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const toggle = (list: string[], setList: (v: string[]) => void, v: string) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const isStudent = role === 'student';
  const f = useForm(() => {
    const common = { fullName: form.fullName, institution: form.institution, department: form.department, bio: form.bio, subjects, skills, interests };
    return api.patch('/users/me', isStudent
      ? { ...common, academicYear: form.academicYear ? Number(form.academicYear) : null, learningGoals: form.learningGoals, learningMethods: methods, availability, visibility: form.visibility }
      : { ...common, designation: form.designation, experience: form.experience });
  }, { success: 'Profile saved.', invalidate: [['me'], ['dashboard']], onDone: () => void onAvatar() });

  const upload = async (file: File) => {
    try { await api.post('/users/me/avatar', toForm({}, file)); await onAvatar(); toast('Photo updated.'); } catch (e) { toast(errorMessage(e), 'error'); }
  };

  return (
    <form className="stack-lg" onSubmit={f.onSubmit}>
      {isStudent && data.completion && <section className="card card-pad stack-sm"><h2>{data.completion.percent}% complete</h2><Progress value={data.completion.percent} label="Profile completion" />{data.completion.missing.length > 0 && <p className="small muted">Missing: {data.completion.missing.join(', ')}</p>}</section>}
      {role === 'teacher' && <Notice>Verification status: <StatusBadge status={data.verificationStatus} /></Notice>}
      <Card title="About you">
        <div className="form-grid">
          <div className="span-2 row"><Avatar name={form.fullName || '?'} fileId={data.avatarFileId} size={64} /><Input label="Profile photo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} fieldClass="grow" /></div>
          <Input label="Full name" required value={form.fullName} onChange={set('fullName')} error={f.errors.fullName} />
          <Input label="College or institution" value={form.institution} onChange={set('institution')} />
          <Input label="Department" value={form.department} onChange={set('department')} />
          {isStudent
            ? <Select label="Academic year" value={form.academicYear} onChange={set('academicYear')} options={[['', 'Not set'], ...[1, 2, 3, 4, 5, 6, 7, 8].map((y): [string, string] => [String(y), `Year ${y}`])]} />
            : <Input label="Designation" value={form.designation} onChange={set('designation')} />}
          <Textarea label="Short biography" fieldClass="span-2" rows={3} value={form.bio} onChange={set('bio')} error={f.errors.bio} />
          {!isStudent && <Textarea label="Professional experience" fieldClass="span-2" rows={3} value={form.experience} onChange={set('experience')} />}
        </div>
      </Card>
      <Card title={isStudent ? 'What you study' : 'What you teach'}>
        <div className="stack">
          <TagInput label={isStudent ? 'Subjects' : 'Subjects taught'} value={subjects} onChange={setSubjects} suggestions={subjectOptions} hint="Press Enter after each one." />
          <TagInput label={isStudent ? 'Technical skills' : 'Areas of expertise'} value={skills} onChange={setSkills} suggestions={skillOptions} />
          <TagInput label="Interests" value={interests} onChange={setInterests} suggestions={interestOptions} />
          {isStudent && <Textarea label="Learning goals" rows={3} value={form.learningGoals} onChange={set('learningGoals')} />}
        </div>
      </Card>
      {isStudent && <>
        <Card title="How you like to learn">
          <fieldset><legend className="sr-only">Preferred learning methods</legend><div className="grid-2">{METHODS.map(([v, l]) => <label className="check" key={v}><input type="checkbox" checked={methods.includes(v)} onChange={() => toggle(methods, setMethods, v)} />{l}</label>)}</div></fieldset>
        </Card>
        <Card title="When you are available">
          <div className="slot-grid" role="group" aria-label="Weekly availability">
            <span />{PERIODS.map(([, l]) => <span key={l} style={{ textAlign: 'center', fontWeight: 550 }}>{l}</span>)}
            {DAYS.map(([d, label]) => (
              <div key={d} style={{ display: 'contents' }}>
                <span style={{ fontWeight: 550 }}>{label}</span>
                {PERIODS.map(([p, pl]) => <label className="slot" key={p}><input type="checkbox" aria-label={`${label} ${pl}`} checked={availability.includes(`${d}_${p}`)} onChange={() => toggle(availability, setAvailability, `${d}_${p}`)} /><span aria-hidden="true">{availability.includes(`${d}_${p}`) ? 'Free' : ''}</span></label>)}
              </div>
            ))}
          </div>
        </Card>
        <Card title="Privacy">
          <Select label="Who can see your profile?" value={form.visibility} onChange={set('visibility')} options={[['everyone', 'Everyone on PeerConnect'], ['connections', 'Only my connections'], ['hidden', 'Hidden from discovery']]} />
        </Card>
      </>}
      <div><button className="btn btn-primary" disabled={f.busy}>{f.busy ? 'Saving…' : 'Save profile'}</button></div>
    </form>
  );
}

export function Settings() {
  const query = useGet(['preferences'], '/users/me/preferences');
  const { user } = useAuth();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const f = useForm(() => api.post('/auth/change-password', pw), { success: 'Password changed.', onDone: () => setPw({ currentPassword: '', newPassword: '' }) });
  const blocks = useGet(['blocks'], '/blocks', user?.role !== 'admin' && !(user?.role === 'teacher' && user.teacherStatus !== 'approved'));
  return (
    <>
      <PageHead title="Settings" />
      <div className="stack-lg">
        <Card title="Notifications"><Async query={query}>{(d) => <Preferences data={d} />}</Async></Card>
        <Card title="Password">
          <form className="form-grid" onSubmit={f.onSubmit}>
            <Input label="Current password" type="password" required autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            <Input label="New password" type="password" required autoComplete="new-password" hint="At least 10 characters, with a letter and a number." value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} error={f.errors.newPassword} />
            <div className="span-2"><button className="btn btn-primary" disabled={f.busy}>Change password</button></div>
          </form>
        </Card>
        {blocks.data && <Card title="Blocked people">{blocks.data.items.length === 0 ? <Empty title="You have not blocked anyone" /> : <ul className="list">{blocks.data.items.map((b: any) => <li key={b.id} className="row-between"><span className="break">{b.fullName}</span><ActionButton action={() => api.delete(`/blocks/${b.id}`)} invalidate={[['blocks']]}>Unblock</ActionButton></li>)}</ul>}</Card>}
      </div>
    </>
  );
}

function Preferences({ data }: { data: any }) {
  const [muted, setMuted] = useState<string[]>(data.mutedTypes);
  const [email, setEmail] = useState<string[]>(data.emailTypes);
  const toggle = (list: string[], set: (v: string[]) => void, t: string) => set(list.includes(t) ? list.filter((x) => x !== t) : [...list, t]);
  const f = useForm(() => api.patch('/users/me/preferences', { mutedTypes: muted, emailTypes: email }), { success: 'Preferences saved.', invalidate: [['preferences']] });
  return (
    <form className="stack" onSubmit={f.onSubmit}>
      <div className="table-wrap">
        <table className="table"><thead><tr><th>Notification</th><th>In app</th><th>Email</th></tr></thead>
          <tbody>{data.types.map((t: string) => (
            <tr key={t}><td>{titleCase(t)}</td>
              <td><label className="check"><input type="checkbox" checked={!muted.includes(t)} onChange={() => toggle(muted, setMuted, t)} /><span className="sr-only">{titleCase(t)} in app</span></label></td>
              <td><label className="check"><input type="checkbox" checked={email.includes(t)} onChange={() => toggle(email, setEmail, t)} /><span className="sr-only">{titleCase(t)} by email</span></label></td></tr>))}
          </tbody></table>
      </div>
      <div><button className="btn btn-primary" disabled={f.busy}>Save preferences</button></div>
    </form>
  );
}

const useDebounced = (v: string, ms = 300) => {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
};
export { useDebounced };

export function Discover() {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';
  const [tab, setTab] = useState<'matches' | 'search' | 'teachers'>(isStudent ? 'matches' : 'search');
  return (
    <>
      <PageHead title={isStudent ? 'Discover' : 'Students'} sub={isStudent ? 'Find compatible study partners and verified teachers.' : 'Find students to invite to your groups.'} />
      <div className="stack">
        {isStudent && (
          <div className="tabs" role="tablist" aria-label="Discover">
            {([['matches', 'Recommended'], ['search', 'Search students'], ['teachers', 'Teachers']] as const).map(([k, l]) => <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </div>
        )}
        {tab === 'matches' && <Matches />}
        {tab === 'search' && <SearchStudents />}
        {tab === 'teachers' && <Teachers />}
      </div>
    </>
  );
}

function Matches() {
  const query = useGet(['matches'], '/matches');
  return (
    <Async query={query}>
      {(d) => d.items.length === 0 ? <Empty title="No recommendations yet">Add subjects, skills and availability to your <Link to="/app/profile">profile</Link>.</Empty> : (
        <div className="stack">
          <p className="small muted">Recommendations come from a weighted comparison of subjects, availability, interests, skills, learning methods and goals.</p>
          <ul className="grid-2">{d.items.map((m: any) => (
            <li key={m.id} className="card card-pad stack-sm">
              <div className="row-between"><div className="row grow"><Avatar name={m.fullName} fileId={m.avatarFileId} size={44} /><div className="grow"><Link className="break" style={{ fontWeight: 600 }} to={`/app/users/${m.id}`}>{m.fullName}</Link><div className="small muted">{[m.institution, m.academicYear && `Year ${m.academicYear}`].filter(Boolean).join(' · ')}</div></div></div><span className="badge badge-brand">{m.score}% match</span></div>
              <p className="small">{m.explanation}</p>
              <Chips items={m.subjects.slice(0, 4)} />
              <div><ConnectButton userId={m.id} /></div>
            </li>))}
          </ul>
        </div>
      )}
    </Async>
  );
}

function PersonAction({ person }: { person: any }) {
  const { user } = useAuth();
  const c = person.connection;
  if (!c) return <ConnectButton userId={person.id} />;
  if (c.status === 'accepted') return <span className="badge badge-success">Connected</span>;
  if (c.requesterId === user?.id) return <span className="badge">Request sent</span>;
  return <Link className="btn btn-secondary btn-sm" to="/app/connections">Respond</Link>;
}

function SearchStudents() {
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState(''); const [skill, setSkill] = useState(''); const [interest, setInterest] = useState('');
  const [year, setYear] = useState(''); const [slot, setSlot] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search); const sub = useDebounced(subject); const sk = useDebounced(skill); const int = useDebounced(interest);
  useEffect(() => setPage(1), [q, sub, sk, int, year, slot]);
  const params = { q, subjects: sub, skills: sk, interests: int, year, availability: slot, page };
  const query = useGet(['students', params], `/students${qs(params)}`);
  return (
    <div className="stack">
      <section className="card card-pad" aria-label="Filters">
        <div className="grid-3">
          <Input label="Name" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <Input label="Skill" value={skill} onChange={(e) => setSkill(e.target.value)} />
          <Input label="Interest" value={interest} onChange={(e) => setInterest(e.target.value)} />
          <Select label="Academic year" value={year} onChange={(e) => setYear(e.target.value)} options={[['', 'Any'], ...[1, 2, 3, 4, 5, 6].map((y): [string, string] => [String(y), `Year ${y}`])]} />
          <Select label="Available" value={slot} onChange={(e) => setSlot(e.target.value)} options={[['', 'Any time'], ...DAYS.flatMap(([d, l]) => PERIODS.map(([p, pl]): [string, string] => [`${d}_${p}`, `${l} ${pl.toLowerCase()}`]))]} />
        </div>
      </section>
      <Async query={query}>
        {(d) => d.items.length === 0 ? <Empty title="No students match those filters" /> : <>
          <ul className="grid-2">{d.items.map((s: any) => (
            <li key={s.id} className="card card-pad stack-sm">
              <div className="row-between"><div className="row grow"><Avatar name={s.fullName} fileId={s.avatarFileId} size={44} /><div className="grow"><Link className="break" style={{ fontWeight: 600 }} to={`/app/users/${s.id}`}>{s.fullName}</Link><div className="small muted">{[s.institution, s.department, s.academicYear && `Year ${s.academicYear}`].filter(Boolean).join(' · ')}</div></div></div><PersonAction person={s} /></div>
              <Chips items={[...s.subjects, ...s.skills].slice(0, 6)} />
            </li>))}
          </ul>
          <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
        </>}
      </Async>
    </div>
  );
}

function Teachers() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  useEffect(() => setPage(1), [q]);
  const query = useGet(['teachers', q, page], `/teachers${qs({ q, page })}`);
  const [requesting, setRequesting] = useState<any>(null);
  return (
    <div className="stack">
      <Input label="Search teachers" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Async query={query}>
        {(d) => d.items.length === 0 ? <Empty title="No verified teachers found" /> : <>
          <ul className="grid-2">{d.items.map((t: any) => (
            <li key={t.id} className="card card-pad stack-sm">
              <div className="row-between"><div className="row grow"><Avatar name={t.fullName} fileId={t.avatarFileId} size={44} /><div className="grow"><Link className="break" style={{ fontWeight: 600 }} to={`/app/users/${t.id}`}>{t.fullName}</Link><div className="small muted">{[t.designation, t.institution].filter(Boolean).join(', ')}</div></div></div>
                {t.mentorshipStatus ? <StatusBadge status={t.mentorshipStatus} /> : <button className="btn btn-primary btn-sm" onClick={() => setRequesting(t)}>Request mentorship</button>}</div>
              {t.bio && <p className="small muted break">{t.bio}</p>}
              <Chips items={t.subjects} />
            </li>))}
          </ul>
          <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
        </>}
      </Async>
      {requesting && <MentorshipRequest teacher={requesting} onClose={() => setRequesting(null)} />}
    </div>
  );
}

function MentorshipRequest({ teacher, onClose }: { teacher: any; onClose: () => void }) {
  const [objective, setObjective] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const f = useForm(() => api.post('/mentorship/requests', { teacherId: teacher.id, objective, topics }), { success: 'Mentorship request sent.', invalidate: [['teachers'], ['mentorship']], onDone: onClose });
  return (
    <Modal title={`Request mentorship from ${teacher.fullName}`} onClose={onClose}>
      <form className="stack" onSubmit={f.onSubmit}>
        <Textarea label="Your academic objective" required value={objective} onChange={(e) => setObjective(e.target.value)} error={f.errors.objective} />
        <TagInput label="Topics" value={topics} onChange={setTopics} />
        <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.busy}>Send request</button></div>
      </form>
    </Modal>
  );
}

export function Connections() {
  const query = useGet(['connections'], '/connections');
  const navigate = useNavigate();
  const toast = useToast();
  const message = async (userId: string) => {
    try { const c = await api.post('/conversations', { userId }); navigate(`/app/messages/${c.id}`); } catch (e) { toast(errorMessage(e), 'error'); }
  };
  const respond = (id: string, action: string) => () => api.patch(`/connections/${id}`, { action });
  const Person = ({ c, children }: { c: any; children: ReactNode }) => <li className="row-between"><div className="row grow"><Avatar name={c.otherName} fileId={c.otherAvatar} /><Link className="title break grow" to={`/app/users/${c.otherId}`}>{c.otherName}</Link></div><div className="row">{children}</div></li>;
  return (
    <>
      <PageHead title="Connections" actions={<Link className="btn btn-primary" to="/app/discover">Find people</Link>} />
      <Async query={query}>
        {(d) => (
          <div className="stack-lg">
            {d.incoming.length > 0 && <Card title="Requests for you"><ul className="list">{d.incoming.map((c: any) => <Person key={c.id} c={c}><ActionButton className="btn btn-primary btn-sm" action={respond(c.id, 'accept')} success="Connected." invalidate={[['connections']]}>Accept</ActionButton><ActionButton action={respond(c.id, 'reject')} invalidate={[['connections']]}>Reject</ActionButton></Person>)}</ul></Card>}
            <Card title={`Your connections (${d.connections.length})`}>{d.connections.length === 0 ? <Empty title="No connections yet"><Link to="/app/discover">Discover study partners</Link></Empty> : <ul className="list">{d.connections.map((c: any) => <Person key={c.id} c={c}><button className="btn btn-secondary btn-sm" onClick={() => void message(c.otherId)}><Mail size={14} aria-hidden="true" />Message</button><ActionButton action={() => api.delete(`/connections/${c.id}`)} invalidate={[['connections']]} confirm={`Remove ${c.otherName} from your connections?`}>Remove</ActionButton></Person>)}</ul>}</Card>
            {d.outgoing.length > 0 && <Card title="Sent requests"><ul className="list">{d.outgoing.map((c: any) => <Person key={c.id} c={c}><ActionButton action={() => api.delete(`/connections/${c.id}`)} invalidate={[['connections']]}>Cancel</ActionButton></Person>)}</ul></Card>}
          </div>
        )}
      </Async>
    </>
  );
}

export function UserView() {
  const { id } = useParams();
  const { user } = useAuth();
  const query = useGet(['user', id], `/users/${id}`);
  const navigate = useNavigate();
  const toast = useToast();
  const canCollab = user?.role === 'student' || (user?.role === 'teacher' && user.teacherStatus === 'approved');
  return (
    <Async query={query} lines={6}>
      {(p) => (
        <>
          <PageHead title={p.fullName} crumb={{ to: user?.role === 'admin' ? '/admin/users' : '/app/discover', label: 'Back' }} actions={p.id !== user?.id && canCollab ? <>
            {p.role !== 'teacher' && <PersonAction person={p} />}
            {p.connection?.status === 'accepted' && <button className="btn btn-secondary btn-sm" onClick={async () => { try { const c = await api.post('/conversations', { userId: p.id }); navigate(`/app/messages/${c.id}`); } catch (e) { toast(errorMessage(e), 'error'); } }}>Message</button>}
            <ActionButton action={() => api.post(`/blocks/${p.id}`)} success="Blocked." confirm={`Block ${p.fullName}? They will not be able to find or message you.`} onDone={() => navigate('/app/discover')}><BellOff size={14} aria-hidden="true" />Block</ActionButton>
            <ReportButton targetType="user" targetId={p.id} />
          </> : undefined} />
          {p.limited ? <Notice>This student shares their full profile only with connections.</Notice> : (
            <div className="grid-2">
              <Card title="About">
                <div className="stack-sm">
                  <div className="row"><Avatar name={p.fullName} fileId={p.avatarFileId} size={64} /><div><div className="muted">{[p.designation, p.institution, p.department].filter(Boolean).join(', ')}</div>{p.academicYear && <div className="muted">Year {p.academicYear}</div>}</div></div>
                  {p.bio && <p className="pre">{p.bio}</p>}
                  {p.experience && <p className="pre muted">{p.experience}</p>}
                </div>
              </Card>
              <Card title="Academic focus">
                <div className="stack-sm">
                  {p.subjects.length > 0 && <div><div className="label">Subjects</div><Chips items={p.subjects} /></div>}
                  {p.skills.length > 0 && <div><div className="label">Skills</div><Chips items={p.skills} /></div>}
                  {p.interests.length > 0 && <div><div className="label">Interests</div><Chips items={p.interests} /></div>}
                  {p.learningGoals && <div><div className="label">Learning goals</div><p className="pre">{p.learningGoals}</p></div>}
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </Async>
  );
}

export function ProgressPage() {
  const query = useGet(['progress'], '/student/progress');
  const [title, setTitle] = useState('');
  const f = useForm(() => api.post('/student/goals', { title }), { success: 'Goal added.', invalidate: [['progress']], onDone: () => setTitle('') });
  return (
    <>
      <PageHead title="Learning progress" sub="Based on the work you have actually completed." />
      <Async query={query}>
        {(d) => (
          <div className="stack-lg">
            <div className="grid-3">
              <Stat value={d.completedTasks} label="Tasks completed" /><Stat value={d.activeProjects} label="Active projects" /><Stat value={d.sessionsAttended} label="Sessions attended" />
              <Stat value={d.groupContributions} label="Group contributions" /><Stat value={d.milestonesReached} label="Milestones reached" /><Stat value={d.assignmentsCompleted} label="Assignments completed" />
            </div>
            <div className="grid-2">
              <Card title="Personal goals">
                <div className="stack">
                  <form className="row" onSubmit={f.onSubmit}><div className="grow"><Input label="New goal" required value={title} onChange={(e) => setTitle(e.target.value)} /></div><button className="btn btn-primary" style={{ alignSelf: 'end' }} disabled={f.busy}>Add</button></form>
                  {d.goals.length === 0 ? <Empty title="No goals yet" /> : <ul className="list">{d.goals.map((g: any) => (
                    <li key={g.id} className="row-between"><Goal goal={g} /><ActionButton action={() => api.delete(`/student/goals/${g.id}`)} invalidate={[['progress']]} className="btn btn-ghost btn-sm">Delete</ActionButton></li>))}</ul>}
                </div>
              </Card>
              <Card title="Milestones reached">{d.milestones.length === 0 ? <Empty title="No milestones reached yet" /> : <ul className="list">{d.milestones.map((m: any) => <li key={m.id}><div className="break" style={{ fontWeight: 550 }}>{m.title}</div><div className="small muted">{m.projectTitle}</div></li>)}</ul>}</Card>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}

function Goal({ goal }: { goal: any }) {
  const t = useOptimisticToggle(!!goal.completedAt, (completed) => api.patch(`/student/goals/${goal.id}`, { completed }), [['progress']]);
  return <label className="check grow"><input type="checkbox" checked={t.checked} onChange={t.toggle} /><span className="break" style={{ textDecoration: t.checked ? 'line-through' : undefined }}>{goal.title}</span></label>;
}

export function Notifications() {
  const [page, setPage] = useState(1);
  const query = useGet(['notifications', 'list', page], `/notifications${qs({ page, pageSize: 20 })}`);
  const navigate = useNavigate();
  const toast = useToast();
  const open = async (n: any) => {
    try { if (!n.readAt) await api.patch(`/notifications/${n.id}/read`); } catch (e) { toast(errorMessage(e), 'error'); }
    await query.refetch();
    if (n.link) navigate(n.link);
  };
  return (
    <>
      <PageHead title="Notifications" actions={<ActionButton action={() => api.post('/notifications/read-all')} invalidate={[['notifications']]}>Mark all as read</ActionButton>} />
      <section className="card">
        <div className="card-body">
          <Async query={query}>
            {(d) => d.items.length === 0 ? <Empty title="You are all caught up" /> : (
              <div className="stack">
                <ul className="list">{d.items.map((n: any) => (
                  <li key={n.id} className="row-between">
                    <button style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }} onClick={() => void open(n)}>
                      <div className="break" style={{ fontWeight: n.readAt ? 400 : 650 }}>{n.title}</div>
                      {n.body && <div className="small muted break">{n.body}</div>}
                      <div className="small muted">{fromNow(n.createdAt)}</div>
                    </button>
                    {!n.readAt && <span className="badge badge-brand">Unread</span>}
                  </li>))}
                </ul>
                <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
              </div>
            )}
          </Async>
        </div>
      </section>
    </>
  );
}
