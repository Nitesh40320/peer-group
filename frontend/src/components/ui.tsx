// Reusable interface components shared by every page.
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, Inbox, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, fieldErrors, fileUrl } from '../lib/api';

function Logo({ light = false }: { light?: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill={light ? '#fff' : '#2563eb'} />
      <path d="M10.5 21.5 21.5 10.5" stroke={light ? '#2563eb' : '#fff'} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="10" cy="22" r="4.5" fill={light ? '#2563eb' : '#fff'} /><circle cx="22" cy="10" r="4.5" fill="#f59e0b" />
    </svg>
  );
}

export const Brand = ({ to = '/', light = false }: { to?: string; light?: boolean }) => <Link className="brand" to={to}><Logo light={light} />PeerConnect</Link>;

export function Avatar({ name, fileId, size = 36 }: { name: string; fileId?: string | null; size?: number }) {
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {fileId ? <img src={fileUrl(fileId)} alt="" loading="lazy" width={size} height={size} /> : initials}
    </span>
  );
}

export function PageHead({ title, sub, actions, crumb }: { title: string; sub?: string; actions?: ReactNode; crumb?: { to: string; label: string } }) {
  useEffect(() => { document.title = `${title} | PeerConnect`; }, [title]);
  return (
    <div className="page-head">
      <div className="grow">
        {crumb && <div className="breadcrumb"><Link to={crumb.to}>{crumb.label}</Link></div>}
        <h1 className="break">{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export const Card = ({ title, action, children, flush }: { title?: string; action?: ReactNode; children: ReactNode; flush?: boolean }) => (
  <section className="card">
    {title && <div className="card-head"><h2>{title}</h2>{action}</div>}
    {flush ? children : <div className="card-body">{children}</div>}
  </section>
);

export const Empty = ({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) => (
  <div className="empty">{icon ?? <Inbox size={28} aria-hidden="true" />}<strong>{title}</strong>{children && <div>{children}</div>}</div>
);

export const Notice = ({ kind = 'info', children }: { kind?: 'info' | 'success' | 'warning' | 'danger'; children: ReactNode }) => {
  const Icon = kind === 'success' ? CheckCircle2 : kind === 'info' ? Info : AlertCircle;
  return <div className={`notice notice-${kind}`} role={kind === 'danger' ? 'alert' : 'status'}><Icon size={18} aria-hidden="true" /><div>{children}</div></div>;
};

export const Skeleton = ({ lines = 3 }: { lines?: number }) => (
  <div className="stack-sm" role="status" aria-label="Loading">
    {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ height: 18, width: `${100 - i * 12}%` }} />)}
  </div>
);

/** Renders the loading, error and empty states so each page only handles data. */
export function Async<T>({ query, children, empty, lines }: { query: UseQueryResult<T>; children: (data: T) => ReactNode; empty?: (data: T) => boolean; lines?: number }) {
  if (query.isPending) return <Skeleton lines={lines} />;
  if (query.isError) {
    return (
      <div className="stack-sm">
        <Notice kind="danger">{errorMessage(query.error)}</Notice>
        <div><button className="btn btn-secondary btn-sm" onClick={() => void query.refetch()}>Try again</button></div>
      </div>
    );
  }
  if (empty?.(query.data)) return <Empty title="Nothing here yet" />;
  return <>{children(query.data)}</>;
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" />Previous</button>
      <span className="small muted">Page {page} of {totalPages}</span>
      <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></button>
    </nav>
  );
}

export const Progress = ({ value, label }: { value: number; label: string }) => (
  <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}><span style={{ width: `${value}%` }} /></div>
);

const BADGES: Record<string, string> = {
  approved: 'success', accepted: 'success', completed: 'success', active: 'success', resolved: 'success', scheduled: 'brand', submitted: 'brand', in_progress: 'brand', open: 'brand', reviewing: 'brand',
  pending: 'warning', needs_info: 'warning', needs_changes: 'warning', review: 'warning', rejected: 'danger', suspended: 'danger', cancelled: 'danger',
};
export const StatusBadge = ({ status }: { status: string }) => <span className={`badge badge-${BADGES[status] ?? 'neutral'}`}>{status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</span>;

export const Chips = ({ items }: { items: string[] }) => (items.length ? <div className="chips">{items.map((t) => <span className="chip" key={t}>{t}</span>)}</div> : null);

// Forms ----------------------------------------------------------------------

function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; className?: string; children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode }) {
  const id = useId();
  const describe = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describe })}
      {hint && !error && <div className="hint" id={`${id}-h`}>{hint}</div>}
      {error && <div className="error" id={`${id}-e`}>{error}</div>}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; fieldClass?: string };
export const Input = ({ label, error, hint, fieldClass, ...rest }: InputProps) => <Field label={label} error={error} hint={hint} className={fieldClass}>{(p) => <input className="input" {...p} {...rest} />}</Field>;

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string; fieldClass?: string };
export const Textarea = ({ label, error, hint, fieldClass, ...rest }: TextareaProps) => <Field label={label} error={error} hint={hint} className={fieldClass}>{(p) => <textarea className="input" {...p} {...rest} />}</Field>;

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; fieldClass?: string; options: Array<[string, string]> };
export const Select = ({ label, error, fieldClass, options, ...rest }: SelectProps) => (
  <Field label={label} error={error} className={fieldClass}>{(p) => <select className="input" {...p} {...rest}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</Field>
);

export function TagInput({ label, value, onChange, hint, suggestions = [] }: { label: string; value: string[]; onChange: (v: string[]) => void; hint?: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState('');
  const id = useId();
  const add = (raw: string) => {
    const v = raw.trim();
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setDraft('');
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="tag-input">
        {value.map((t) => <span className="chip" key={t}>{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}><X size={12} aria-hidden="true" /></button></span>)}
        <input id={id} list={`${id}-l`} value={draft} autoComplete="off" onChange={(e) => {
          // Choosing a datalist suggestion arrives as a change matching the option exactly.
          if (suggestions.includes(e.target.value)) add(e.target.value); else setDraft(e.target.value);
        }} onBlur={() => add(draft)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }} />
        <datalist id={`${id}-l`}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Wraps a form: submits once, shows a toast, maps server validation to fields. */
export function useForm<T = unknown>(fn: () => Promise<T>, options: { success?: string; invalidate?: unknown[][]; onDone?: (r: T) => void; quiet?: boolean } = {}) {
  const client = useQueryClient();
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      setErrors({});
      if (options.success) toast(options.success);
      options.invalidate?.forEach((queryKey) => void client.invalidateQueries({ queryKey }));
      options.onDone?.(r);
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      if (!options.quiet) toast(errorMessage(e), 'error');
    },
  });
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (!mutation.isPending) mutation.mutate(); };
  return { onSubmit, errors, busy: mutation.isPending, error: mutation.error, run: mutation.mutate };
}

/** A checkbox that responds immediately and reverts if the server rejects the change. */
export function useOptimisticToggle(serverValue: boolean, save: (next: boolean) => Promise<unknown>, invalidate: unknown[][]) {
  const [checked, setChecked] = useState(serverValue);
  const next = useRef(serverValue);
  const form = useForm(() => save(next.current), { invalidate });
  useEffect(() => setChecked(serverValue), [serverValue]);
  useEffect(() => { if (form.error) setChecked(serverValue); }, [form.error, serverValue]);
  const toggle = () => { next.current = !checked; setChecked(next.current); form.run(); };
  return { checked, toggle, busy: form.busy };
}

/** A button that runs one server action with feedback. */
export function ActionButton({ action, success, invalidate, confirm: confirmText, className = 'btn btn-secondary btn-sm', children, onDone, label }: { action: () => Promise<unknown>; success?: string; invalidate?: unknown[][]; confirm?: string; className?: string; children: ReactNode; onDone?: () => void; label?: string }) {
  const confirmDialog = useConfirm();
  const form = useForm(action, { success, invalidate, onDone });
  return (
    <button className={className} disabled={form.busy} aria-label={label} type="button" onClick={async () => {
      if (confirmText && !(await confirmDialog(confirmText))) return;
      form.run();
    }}>{children}</button>
  );
}

// Toasts and dialogs ---------------------------------------------------------

type ToastFn = (message: string, kind?: 'success' | 'error') => void;
const ToastContext = createContext<ToastFn>(() => undefined);
export const useToast = () => useContext(ToastContext);

const ConfirmContext = createContext<(message: string) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; kind: string }>>([]);
  const [question, setQuestion] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);
  const counter = useRef(0);
  const toast = useCallback<ToastFn>((message, kind = 'success') => {
    const id = ++counter.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  const confirm = useCallback((message: string) => new Promise<boolean>((resolve) => setQuestion({ message, resolve })), []);
  const answer = (v: boolean) => { question?.resolve(v); setQuestion(null); };
  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast-error' : ''}`}>{t.message}</div>)}
        </div>
        {question && (
          <Modal title="Please confirm" onClose={() => answer(false)}>
            <p>{question.message}</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => answer(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => answer(true)}>Confirm</button>
            </div>
          </Modal>
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

/** Native dialog: the browser supplies focus trapping, Escape and the inert background. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-btn" type="button" aria-label="Close" onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export function useUrlTab<T extends string>(tabs: readonly T[], params: URLSearchParams, setParams: (p: URLSearchParams, o?: { replace: boolean }) => void) {
  const current = (tabs as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as T) : tabs[0];
  const set = (tab: T) => { const next = new URLSearchParams(params); next.set('tab', tab); setParams(next, { replace: true }); };
  return [current, set] as const;
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<[T, string]>; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(([key, text]) => <button key={key} role="tab" type="button" className="tab" aria-selected={key === value} onClick={() => onChange(key)}>{text}</button>)}
    </div>
  );
}
