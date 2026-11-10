import { GraduationCap, Presentation } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Brand, Input, Notice, Textarea, useForm } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { homeFor, useAuth } from '../lib/auth';

function AuthFrame({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  useEffect(() => { document.title = `${title} | PeerConnect`; }, [title]);
  return (
    <div className="auth-page">
      <aside className="auth-side on-dark">
        <Brand light />
        <p className="big">Learn Together. Build Together. Grow Together.</p>
        <img className="hero-photo" src="/images/students-collaborating.jpg" alt="" width="1200" height="900" />
      </aside>
      <main className="auth-main" id="main">
        <div className="auth-card">
          <div className="auth-mobile-brand"><Brand /></div>
          <div className="stack-sm"><h1>{title}</h1>{intro && <p className="muted">{intro}</p>}</div>
          {children}
        </div>
      </main>
    </div>
  );
}

function RolePicker({ role, onChange, label }: { role: 'student' | 'teacher'; onChange: (r: 'student' | 'teacher') => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      <button type="button" role="radio" aria-checked={role === 'student'} onClick={() => onChange('student')}><GraduationCap size={18} aria-hidden="true" />Student</button>
      <button type="button" role="radio" aria-checked={role === 'teacher'} onClick={() => onChange('teacher')}><Presentation size={18} aria-hidden="true" />Teacher</button>
    </div>
  );
}

export function Login() {
  const [params] = useSearchParams();
  const [role, setRole] = useState<'student' | 'teacher'>(params.get('role') === 'teacher' ? 'teacher' : 'student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resent, setResent] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const f = useForm(() => login(email, password), {
    onDone: (user) => navigate((location.state as { from?: string } | null)?.from ?? homeFor(user), { replace: true }),
    quiet: true,
  });
  const notVerified = f.error instanceof ApiError && f.error.code === 'EMAIL_NOT_VERIFIED';
  return (
    <AuthFrame title="Sign in to PeerConnect">
      {/* This choice only adapts the screen. Permissions always come from the account on the server. */}
      <RolePicker role={role} onChange={setRole} label="I am signing in as" />
      {f.error && !notVerified && <Notice kind="danger">{f.error.message}</Notice>}
      {notVerified && (
        <Notice kind="warning">
          Verify your email before signing in.{' '}
          {resent ? 'A new link is on its way.' : <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void api.post('/auth/resend-verification', { email }); setResent(true); }}>Send a new link</button>}
        </Notice>
      )}
      <form className="stack" onSubmit={f.onSubmit}>
        <Input label={role === 'teacher' ? 'Teacher email' : 'Student email'} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn btn-primary btn-block" disabled={f.busy}>{f.busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <div className="stack-sm" style={{ textAlign: 'center' }}>
        <Link to="/forgot-password">Forgot password?</Link>
        <p>New here? <Link to={`/register?role=${role}`}>Create an account</Link></p>
      </div>
    </AuthFrame>
  );
}

export function Register() {
  const [params] = useSearchParams();
  const [role, setRole] = useState<'student' | 'teacher'>(params.get('role') === 'teacher' ? 'teacher' : 'student');
  const [form, setForm] = useState({ fullName: '', email: '', password: '', institution: '', department: '', designation: '', statement: '' });
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [done, setDone] = useState(false);
  const f = useForm(() => api.post('/auth/register', { ...form, role }), { onDone: () => setDone(true) });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  if (done) {
    return (
      <AuthFrame title="Check your email">
        <Notice kind="success">If this address can be registered, we have sent a verification link to <strong>{form.email}</strong>.</Notice>
        {role === 'teacher' && <Notice>After you verify your email, an administrator will review your teacher account.</Notice>}
        <Link className="btn btn-secondary btn-block" to="/login">Back to sign in</Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Create your account">
      <RolePicker role={role} onChange={setRole} label="I am joining as" />
      <form className="stack" onSubmit={(e) => {
        if (form.password !== confirm) { e.preventDefault(); setMismatch(true); return; }
        setMismatch(false);
        f.onSubmit(e);
      }}>
        <Input label="Full name" required autoComplete="name" value={form.fullName} onChange={set('fullName')} error={f.errors.fullName} />
        <Input label="Email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} error={f.errors.email} />
        <Input label="Password" type="password" required autoComplete="new-password" hint="At least 10 characters, with a letter and a number." value={form.password} onChange={set('password')} error={f.errors.password} />
        <Input label="Confirm password" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? 'The passwords do not match.' : undefined} />
        {role === 'teacher' && <>
          <Input label="Institution" required value={form.institution} onChange={set('institution')} error={f.errors.institution} />
          <Input label="Department" required value={form.department} onChange={set('department')} error={f.errors.department} />
          <Input label="Designation" required value={form.designation} onChange={set('designation')} error={f.errors.designation} />
          <Textarea label="Tell us about your teaching role" rows={3} hint="An administrator reads this when reviewing your account." value={form.statement} onChange={set('statement')} error={f.errors.statement} />
        </>}
        <button className="btn btn-primary btn-block" disabled={f.busy}>{f.busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p style={{ textAlign: 'center' }}>Already registered? <Link to="/login">Sign in</Link></p>
    </AuthFrame>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const f = useForm(() => api.post('/auth/forgot-password', { email }), { onDone: () => setSent(true) });
  return (
    <AuthFrame title="Reset your password" intro="Enter your email and we will send you a secure link.">
      {sent ? <Notice kind="success">If that account exists, a reset link is on its way. It expires in one hour.</Notice> : (
        <form className="stack" onSubmit={f.onSubmit}>
          <Input label="Email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={f.errors.email} />
          <button className="btn btn-primary btn-block" disabled={f.busy}>{f.busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
      <p style={{ textAlign: 'center' }}><Link to="/login">Back to sign in</Link></p>
    </AuthFrame>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const token = params.get('token') ?? '';
  const f = useForm(() => api.post('/auth/reset-password', { token, password }), { onDone: () => setDone(true), quiet: true });
  if (!token) return <AuthFrame title="Invalid link"><Notice kind="danger">This reset link is incomplete.</Notice><Link to="/forgot-password">Request a new link</Link></AuthFrame>;
  return (
    <AuthFrame title="Choose a new password">
      {done ? <><Notice kind="success">Your password has been updated.</Notice><Link className="btn btn-primary btn-block" to="/login">Sign in</Link></> : (
        <form className="stack" onSubmit={f.onSubmit}>
          {f.error && !Object.keys(f.errors).length && <Notice kind="danger">{f.error.message}</Notice>}
          <Input label="New password" type="password" required autoComplete="new-password" hint="At least 10 characters, with a letter and a number." value={password} onChange={(e) => setPassword(e.target.value)} error={f.errors.password} />
          <button className="btn btn-primary btn-block" disabled={f.busy}>Update password</button>
        </form>
      )}
    </AuthFrame>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  // Tokens are single-use, and React StrictMode runs effects twice in development.
  const started = useRef(false);
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api.post('/auth/verify-email', { token }).then(() => setState('done')).catch(() => setState('failed'));
  }, [token]);
  return (
    <AuthFrame title="Email verification">
      {state === 'working' && <Notice>Confirming your email…</Notice>}
      {state === 'done' && <><Notice kind="success">Your email is verified.</Notice><Link className="btn btn-primary btn-block" to="/login">Sign in</Link></>}
      {state === 'failed' && <><Notice kind="danger">This link is invalid or has expired. Sign in to request a new one.</Notice><Link className="btn btn-secondary btn-block" to="/login">Go to sign in</Link></>}
    </AuthFrame>
  );
}
