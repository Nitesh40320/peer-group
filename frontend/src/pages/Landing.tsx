import '../tailwind.css';
import PerspectiveTunnelHero from '@/components/ui/perspective-tunnel-hero';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CalendarDays, Check, ChevronDown, ClipboardCheck, FolderKanban, Menu, MessagesSquare, Search, ShieldCheck, Target, Users, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Brand, Chips } from '../components/ui';
import { api, titleCase } from '../lib/api';
import { useAuth, homeFor } from '../lib/auth';

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  return (
    <header className="pub-header">
      <div className="wrap">
        <Brand />
        <button className="icon-btn pub-menu" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
        <nav className={`pub-nav ${open ? 'open' : ''}`} aria-label="Main" onClick={() => setOpen(false)}>
          <a href="/#how-it-works">How it works</a>
          <a href="/#groups">Study groups</a>
          <a href="/#teachers">For teachers</a>
          <a href="/#faq">FAQ</a>
          <Link to="/help" style={{ display: 'inline-flex', alignItems: 'center', minHeight: '2.75rem', padding: '0 .75rem' }}>Help</Link>
          {user ? <Link className="btn btn-primary" to={homeFor(user)}>Open app</Link> : <>
            <Link className="btn btn-secondary" to="/login">Sign in</Link>
            <Link className="btn btn-primary" to="/register">Get Started</Link>
          </>}
        </nav>
      </div>
    </header>
  );
}

export const PublicFooter = () => (
  <footer className="site-footer">
    <div className="wrap">
      <div><Brand /><p className="small muted">Learn Together. Build Together. Grow Together.</p></div>
      <ul>
        <li><Link to="/help">Help and support</Link></li>
        <li><Link to="/terms">Terms</Link></li>
        <li><Link to="/privacy">Privacy</Link></li>
      </ul>
    </div>
  </footer>
);

const Feature = ({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) => (
  <li className="feature card card-pad">{icon}<h3>{title}</h3><p>{children}</p></li>
);

const FAQS: Array<[string, string]> = [
  ['Who can use PeerConnect?', 'Students can register and start right after confirming their email. Teachers register too, and an administrator reviews each teacher account before teaching features are switched on.'],
  ['How are study partners recommended?', 'A transparent set of weighted rules compares subjects, skills, interests, goals, learning methods and availability. Every recommendation tells you why it was made.'],
  ['Who can see my profile?', 'You decide: everyone, only your connections, or nobody in discovery. Your email address is never shown on your profile.'],
  ['Can teachers read private messages?', 'No. Teachers only see conversations they are part of, and being a teacher grants no access to private student conversations.'],
  ['Do I have to use the AI assistant?', 'No. It is optional, and only sends the text you type into it. Your profile, messages and files are never sent to the AI provider.'],
];

export function Landing() {
  const preview = useQuery({ queryKey: ['public-groups'], queryFn: () => api.get('/public/groups') });
  const groups: Array<{ id: string; name: string; difficulty: string; capacity: number; memberCount: number; topics: string[] }> = preview.data?.items ?? [];
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <PublicHeader />
      <main id="main">
        <section>
          <PerspectiveTunnelHero
            title={<>Learn Together.<br />Build Together.<br />Grow Together.</>}
            description="PeerConnect matches you with compatible students, gives every study group a shared workspace, and connects you with verified teachers."
            actions={<>
              <Link className="btn btn-primary" to="/register">Get Started</Link>
              <a className="btn btn-secondary" href="#how-it-works">Explore How It Works</a>
            </>}
          />
        </section>

        <section className="section" id="how-it-works">
          <div className="wrap">
            <div className="section-head"><h2>How PeerConnect works</h2><p className="lead">From finding the right people to finishing the work, in one place.</p></div>
            <ol className="steps">
              <li><h3>Build your profile</h3><p>Add your subjects, skills, goals and when you are free to study.</p></li>
              <li><h3>Meet compatible peers</h3><p>See who matches and exactly why, then send a connection request.</p></li>
              <li><h3>Form a study group</h3><p>Create or join a group with a clear objective and a shared workspace.</p></li>
              <li><h3>Work and track progress</h3><p>Plan sessions, split tasks, share resources and see what is done.</p></li>
            </ol>
          </div>
        </section>

        <section className="section section-alt" id="groups">
          <div className="wrap">
            <div className="section-head"><h2>Discover study groups</h2><p className="lead">Browse by subject, difficulty and size. Public groups welcome requests; private groups are invitation only.</p></div>
            {groups.length > 0 ? (
              <ul className="grid-3">
                {groups.map((g) => (
                  <li key={g.id} className="card card-pad stack-sm">
                    <h3 className="break">{g.name}</h3>
                    <Chips items={g.topics.slice(0, 3)} />
                    <p className="small muted">{titleCase(g.difficulty)} · {g.memberCount} of {g.capacity} members</p>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">The first study groups will appear here as soon as students create them.</p>}
            <div style={{ marginTop: '1.5rem' }}><Link className="btn btn-primary" to="/register">Create or join a group</Link></div>
          </div>
        </section>

        <section className="section" id="benefits">
          <div className="wrap">
            <div className="section-head"><h2>Built for collaboration</h2><p className="lead">Every tool supports learning with others. No feeds, no follower counts.</p></div>
            <ul className="grid-3">
              <Feature icon={<Target size={24} aria-hidden="true" />} title="Explainable matching">Find like-minded peers and see the shared subjects and schedules behind every suggestion.</Feature>
              <Feature icon={<Users size={24} aria-hidden="true" />} title="Group workspaces">Discussion, resources, tasks, deadlines and activity for every group.</Feature>
              <Feature icon={<FolderKanban size={24} aria-hidden="true" />} title="Project boards">Assign tasks, set milestones and move work from To Do to Completed.</Feature>
              <Feature icon={<MessagesSquare size={24} aria-hidden="true" />} title="Messaging">One-to-one and group conversations with file sharing and unread tracking.</Feature>
              <Feature icon={<CalendarDays size={24} aria-hidden="true" />} title="Study sessions">Schedule together, get reminders and add sessions to your calendar.</Feature>
              <Feature icon={<BookOpen size={24} aria-hidden="true" />} title="Shared resources">Keep notes, documents and links organized by subject.</Feature>
            </ul>
          </div>
        </section>

        <section className="section section-alt" id="teachers">
          <div className="wrap split-section">
            <div>
              <h2>Guidance from verified teachers</h2>
              <p className="lead">Teachers are reviewed before they can guide students, so students know who they are working with.</p>
              <ul className="tick-list">
                {['Run academic communities and study groups', 'Accept mentorship requests and schedule sessions', 'Set assignments, review work and give feedback', 'See group engagement without reading private conversations'].map((t) => <li key={t}><Check size={18} aria-hidden="true" />{t}</li>)}
              </ul>
            </div>
            <ul className="grid-2">
              <Feature icon={<ShieldCheck size={24} aria-hidden="true" />} title="Verified accounts">An administrator approves every teacher.</Feature>
              <Feature icon={<ClipboardCheck size={24} aria-hidden="true" />} title="Assignments">Set work, collect it and return feedback.</Feature>
              <Feature icon={<Search size={24} aria-hidden="true" />} title="Find a mentor">Students browse teachers by subject.</Feature>
              <Feature icon={<Users size={24} aria-hidden="true" />} title="Communities">Bring a whole class together.</Feature>
            </ul>
          </div>
        </section>

        <section className="section" id="faq">
          <div className="wrap faq">
            <div className="section-head"><h2>Frequently asked questions</h2></div>
            {FAQS.map(([q, a]) => <details key={q}><summary>{q}<ChevronDown size={18} aria-hidden="true" /></summary><p>{a}</p></details>)}
          </div>
        </section>

        <section className="cta on-dark">
          <div className="wrap">
            <div><h2>Learn Together. Build Together. Grow Together.</h2></div>
            <Link className="btn btn-white" to="/register">Get Started</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
