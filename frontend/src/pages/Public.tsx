import { ChevronDown } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Input, Notice, Select, Textarea, useForm } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PublicFooter, PublicHeader } from './Landing';

const Frame = ({ title, children }: { title: string; children: ReactNode }) => {
  useEffect(() => { document.title = `${title} | PeerConnect`; }, [title]);
  return (
    <>
      <PublicHeader />
      <main id="main" className="section"><div className="wrap">{children}</div></main>
      <PublicFooter />
    </>
  );
};

const HELP: Array<[string, Array<[string, string]>]> = [
  ['Getting started', [
    ['I did not receive my verification email', 'Check your spam folder. You can request a new link from the sign-in page after entering your email.'],
    ['How do I reset my password?', 'Choose "Forgot password" on the sign-in page. The reset link works once and expires after one hour.'],
  ]],
  ['Groups and connections', [
    ['How do I join a private group?', 'Private groups are invitation only. Ask a group owner or leader to invite you.'],
    ['How do I stop someone contacting me?', "Open their profile and choose Block. They will no longer be able to find or message you."],
  ]],
  ['Teacher accounts', [
    ['When can I start teaching?', 'After an administrator approves your verification. You can check its status on the Verification page.'],
    ['Who can see my verification documents?', 'Only you and platform administrators. They are never public.'],
  ]],
];

export function Help() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: user?.fullName ?? '', email: user?.email ?? '', category: 'general', message: '' });
  const [sent, setSent] = useState(false);
  const f = useForm(() => api.post('/support', form), { onDone: () => setSent(true) });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Frame title="Help and support">
      <div className="split-section" style={{ alignItems: 'start' }}>
        <div className="faq">
          <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Help and support</h1>
          {HELP.map(([heading, items]) => (
            <div key={heading} style={{ marginBottom: '1.5rem' }}>
              <h2>{heading}</h2>
              {items.map(([q, a]) => <details key={q}><summary>{q}<ChevronDown size={18} aria-hidden="true" /></summary><p>{a}</p></details>)}
            </div>
          ))}
          <p className="muted">Read our <Link to="/terms">terms</Link> and <Link to="/privacy">privacy policy</Link>.</p>
        </div>
        <section className="card card-pad stack" aria-labelledby="contact-title">
          <h2 id="contact-title">Contact support</h2>
          {sent ? <Notice kind="success">Thanks. Your request has been sent and our team will reply by email.</Notice> : (
            <form className="stack" onSubmit={f.onSubmit}>
              <Input label="Your name" required value={form.name} onChange={set('name')} error={f.errors.name} autoComplete="name" />
              <Input label="Email" type="email" required value={form.email} onChange={set('email')} error={f.errors.email} autoComplete="email" />
              <Select label="How can we help?" value={form.category} onChange={set('category')} options={[['general', 'General question'], ['problem', 'Report a problem'], ['account', 'Account assistance']]} />
              <Textarea label="Message" required rows={5} value={form.message} onChange={set('message')} error={f.errors.message} />
              <button className="btn btn-primary" disabled={f.busy}>{f.busy ? 'Sending…' : 'Send request'}</button>
            </form>
          )}
        </section>
      </div>
    </Frame>
  );
}

export const Terms = () => (
  <Frame title="Terms of use">
    <article className="prose">
      <h1 style={{ fontSize: '2rem' }}>Terms of use</h1>
      <h2>Using PeerConnect</h2>
      <p>PeerConnect is for academic collaboration. Use your own identity, and only upload material you are allowed to share.</p>
      <h2>Conduct</h2>
      <p>Harassment, spam, impersonation and academic dishonesty are not allowed. Administrators may review reports and suspend accounts that break these rules.</p>
      <h2>Teacher accounts</h2>
      <p>Teacher features are available only after an administrator approves your verification.</p>
      <h2>AI assistance</h2>
      <p>AI-generated content is labelled and can be wrong. Check it before relying on it.</p>
    </article>
  </Frame>
);

export const Privacy = () => (
  <Frame title="Privacy policy">
    <article className="prose">
      <h1 style={{ fontSize: '2rem' }}>Privacy policy</h1>
      <h2>What we store</h2>
      <p>Your account details, the profile information you add, your groups, projects, messages, sessions and the files you upload.</p>
      <h2>Who can see it</h2>
      <p>Profile visibility is your choice. Group content is visible to group members. Messages are visible only to conversation participants. Administrators can review reported content and teacher verification documents.</p>
      <h2>AI features</h2>
      <p>Only text you type into the AI assistant is sent to the AI provider. Profiles, messages and files are not sent.</p>
      <h2>Passwords</h2>
      <p>Passwords are stored only as Argon2id hashes and cannot be read by anyone.</p>
    </article>
  </Frame>
);
