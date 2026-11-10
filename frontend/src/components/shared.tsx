// Feature components used by more than one page.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, Flag, Paperclip, Plus, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, fileUrl, formatDateTime, formatTime, isoToLocal, localToIso, qs, toForm } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ActionButton, Async, Chips, Empty, Input, Modal, Pagination, Select, Textarea, useForm, useToast } from './ui';

export const useGet = <T = any,>(key: unknown[], url: string, enabled = true) =>  // eslint-disable-line @typescript-eslint/no-explicit-any
  useQuery<T>({ queryKey: key, queryFn: () => api.get<T>(url), enabled });

export function useTopics(kind: 'subject' | 'skill' | 'interest') {
  const q = useGet<{ items: string[] }>(['topics', kind], `/topics?kind=${kind}`);
  return q.data?.items ?? [];
}

export function ReportButton({ targetType, targetId, compact }: { targetType: string; targetId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const f = useForm(() => api.post('/reports', { targetType, targetId, reason, details }), { success: 'Report sent to the moderation team.', onDone: () => setOpen(false) });
  return (
    <>
      {compact
        ? <button className="link-btn" type="button" aria-label={`Report this ${targetType}`} onClick={() => setOpen(true)}><Flag size={12} aria-hidden="true" /></button>
        : <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(true)}><Flag size={14} aria-hidden="true" />Report</button>}
      {open && (
        <Modal title="Report this" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={f.onSubmit}>
            <Input label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} error={f.errors.reason} />
            <Textarea label="Details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
            <div className="modal-actions"><button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-danger" disabled={f.busy}>Send report</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

// Chat -----------------------------------------------------------------------

interface Message { id: string; senderId: string; senderName: string; body: string; createdAt: string; fileId: string | null; fileName: string | null }

export function ChatPane({ conversationId }: { conversationId: string }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const query = useGet<{ items: Message[]; hasMore: boolean }>(['messages', conversationId], `/conversations/${conversationId}/messages`);
  const [older, setOlder] = useState<Message[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const latest = query.data?.items.at(-1)?.id;

  useEffect(() => { setOlder([]); setOlderMore(null); }, [conversationId]);

  useEffect(() => {
    if (!latest) return;
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    api.post(`/conversations/${conversationId}/read`).then(() => client.invalidateQueries({ queryKey: ['conversations'] })).catch(() => undefined);
  }, [latest, conversationId, client]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || (!text.trim() && !file)) return;
    setBusy(true);
    try {
      await api.post(`/conversations/${conversationId}/messages`, toForm({ body: text.trim() }, file));
      setText(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await client.invalidateQueries({ queryKey: ['messages', conversationId] });
    } catch (error) { toast(errorMessage(error), 'error'); } finally { setBusy(false); }
  };

  const loadOlder = async () => {
    const first = (older[0] ?? query.data?.items[0])?.createdAt;
    if (!first) return;
    try {
      const page = await api.get(`/conversations/${conversationId}/messages${qs({ before: first })}`);
      setOlder((o) => [...page.items, ...o]);
      setOlderMore(page.hasMore);
    } catch (error) { toast(errorMessage(error), 'error'); }
  };

  const hasMore = olderMore ?? query.data?.hasMore;
  return (
    <div className="chat-pane" style={{ height: '100%' }}>
      <div className="chat-log" ref={log} role="log" aria-label="Messages" aria-live="polite">
        <Async query={query}>
          {(data) => data.items.length === 0 ? <Empty title="No messages yet">Say hello to get the conversation started.</Empty> : <>
            {hasMore && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={loadOlder}>Load earlier messages</button>}
            {[...older, ...data.items].map((m) => {
              const mine = m.senderId === user?.id;
              return (
                <div key={m.id} className={`bubble ${mine ? 'mine' : ''}`}>
                  {!mine && <div className="meta" style={{ fontWeight: 600 }}>{m.senderName ?? 'Former member'}</div>}
                  {m.body && <div className="pre">{m.body}</div>}
                  {m.fileId && <a href={fileUrl(m.fileId)} className="row small" style={{ gap: '.25rem' }}><Download size={14} aria-hidden="true" />{m.fileName}</a>}
                  <div className="meta row" style={{ gap: '.25rem' }}><time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>{!mine && <ReportButton compact targetType="message" targetId={m.id} />}</div>
                </div>
              );
            })}
          </>}
        </Async>
      </div>
      {file && <div className="small muted" style={{ padding: '.25rem .75rem' }}>Attached: {file.name}</div>}
      <form className="chat-form" onSubmit={send}>
        <input ref={fileRef} type="file" className="sr-only" id={`attach-${conversationId}`} aria-label="Attach a file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <label className="icon-btn" htmlFor={`attach-${conversationId}`} title="Attach a file"><Paperclip size={20} aria-hidden="true" /></label>
        <label className="sr-only" htmlFor={`msg-${conversationId}`}>Message</label>
        <input className="input grow" id={`msg-${conversationId}`} placeholder="Write a message" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-primary" disabled={busy} aria-label="Send message"><Send size={18} aria-hidden="true" /></button>
      </form>
    </div>
  );
}

// Task board -----------------------------------------------------------------

export interface Task { id: string; title: string; description: string; status: string; assigneeId: string | null; assigneeName: string | null; dueAt: string | null; projectTitle?: string }
const COLUMNS: Array<[string, string]> = [['todo', 'To Do'], ['in_progress', 'In Progress'], ['review', 'Review'], ['completed', 'Completed']];

export function TaskBoard({ tasks, members, createUrl, canEdit, invalidate }: { tasks: Task[]; members: Array<{ id: string; fullName: string }>; createUrl: string; canEdit: boolean; invalidate: unknown[][] }) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', assigneeId: '', dueAt: '' });
  const client = useQueryClient();
  const toast = useToast();
  const refresh = () => invalidate.forEach((queryKey) => void client.invalidateQueries({ queryKey }));
  const f = useForm(() => api.post(createUrl, { title: form.title, description: form.description, assigneeId: form.assigneeId || null, dueAt: form.dueAt ? localToIso(form.dueAt) : null }), {
    success: 'Task added.', invalidate, onDone: () => { setCreating(false); setForm({ title: '', description: '', assigneeId: '', dueAt: '' }); },
  });
  const move = async (task: Task, status: string) => {
    try { await api.patch(`/tasks/${task.id}`, { status }); refresh(); } catch (error) { toast(errorMessage(error), 'error'); }
  };
  return (
    <div className="stack">
      {canEdit && <div><button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />Add task</button></div>}
      <div className="board" tabIndex={0} role="group" aria-label="Task board">
        {COLUMNS.map(([key, label]) => {
          const list = tasks.filter((t) => t.status === key);
          return (
            <section className="board-col" key={key} aria-label={label}>
              <h3 className="small">{label} <span className="muted">({list.length})</span></h3>
              {list.map((t) => (
                <article className="task" key={t.id}>
                  <div className="break" style={{ fontWeight: 550 }}>{t.title}</div>
                  {t.description && <div className="small muted break">{t.description}</div>}
                  {t.projectTitle && <div className="small muted">{t.projectTitle}</div>}
                  <div className="small muted">{t.assigneeName ?? 'Unassigned'}{t.dueAt ? ` · Due ${formatDateTime(t.dueAt)}` : ''}</div>
                  {canEdit && (
                    <div className="row" style={{ gap: '.25rem' }}>
                      <label className="sr-only" htmlFor={`status-${t.id}`}>Status of {t.title}</label>
                      <select id={`status-${t.id}`} className="input grow" value={t.status} onChange={(e) => void move(t, e.target.value)}>{COLUMNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                      <ActionButton className="icon-btn" label={`Delete ${t.title}`} action={() => api.delete(`/tasks/${t.id}`)} invalidate={invalidate} confirm={`Delete "${t.title}"?`}><Trash2 size={16} aria-hidden="true" /></ActionButton>
                    </div>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>
      {creating && (
        <Modal title="Add task" onClose={() => setCreating(false)}>
          <form className="stack" onSubmit={f.onSubmit}>
            <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={f.errors.title} />
            <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Select label="Assign to" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} options={[['', 'Unassigned'], ...members.map((m): [string, string] => [m.id, m.fullName])]} />
            <Input label="Due" type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
            <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="btn btn-primary" disabled={f.busy}>Add task</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// Resources ------------------------------------------------------------------

export function ResourceForm({ groupId, projectId, onClose, invalidate }: { groupId?: string; projectId?: string; onClose: () => void; invalidate: unknown[][] }) {
  const [kind, setKind] = useState<'file' | 'link'>('file');
  const [form, setForm] = useState({ title: '', description: '', url: '', subject: '', tags: '' });
  const [file, setFile] = useState<File | null>(null);
  const f = useForm(() => api.post('/resources', toForm({ ...form, url: kind === 'link' ? form.url : '', groupId, projectId }, kind === 'file' ? file : null)), { success: 'Resource shared.', invalidate, onDone: onClose });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal title="Share a resource" onClose={onClose}>
      <form className="stack" onSubmit={f.onSubmit}>
        <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value as 'file' | 'link')} options={[['file', 'Upload a file'], ['link', 'Share a link']]} />
        <Input label="Title" required value={form.title} onChange={set('title')} error={f.errors.title} />
        <Textarea label="Description" value={form.description} onChange={set('description')} />
        {kind === 'file'
          ? <Input label="File" type="file" required hint="PDF, Word, PowerPoint, Excel, text or image files." accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          : <Input label="Link" type="url" required placeholder="https://" value={form.url} onChange={set('url')} error={f.errors.url} />}
        <Input label="Subject" value={form.subject} onChange={set('subject')} />
        <Input label="Tags" hint="Separate with commas." value={form.tags} onChange={set('tags')} />
        <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={f.busy}>{f.busy ? 'Sharing…' : 'Share'}</button></div>
      </form>
    </Modal>
  );
}

export function ResourceList({ groupId, q, subject }: { groupId?: string; q?: string; subject?: string }) {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, subject]);
  const key = ['resources', groupId ?? 'all', q, subject, page];
  const query = useGet(key, `/resources${qs({ groupId, q, subject, page })}`);
  return (
    <Async query={query}>
      {(data) => data.items.length === 0 ? <Empty title="No resources found">Share notes, documents or links for others to use.</Empty> : (
        <div className="stack">
          <ul className="list">
            {data.items.map((r: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <li key={r.id} className="row-between">
                <div className="grow stack-sm" style={{ gap: '.125rem' }}>
                  <div style={{ fontWeight: 550 }} className="break">{r.title}</div>
                  {r.description && <div className="small muted break">{r.description}</div>}
                  <div className="small muted">{r.ownerName}{r.subject ? ` · ${r.subject}` : ''}{r.groupName ? ` · ${r.groupName}` : ''}</div>
                  <Chips items={r.tags} />
                </div>
                <div className="row">
                  {r.kind === 'file'
                    ? <a className="btn btn-secondary btn-sm" href={fileUrl(r.fileId)}><Download size={14} aria-hidden="true" />Download</a>
                    : <a className="btn btn-secondary btn-sm" href={r.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />Open</a>}
                  {r.ownerId !== user?.id && <ReportButton targetType="resource" targetId={r.id} />}
                  {r.ownerId === user?.id && <ActionButton className="icon-btn" label={`Delete ${r.title}`} action={() => api.delete(`/resources/${r.id}`)} invalidate={[['resources']]} confirm={`Delete "${r.title}"?`}><Trash2 size={16} aria-hidden="true" /></ActionButton>}
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </div>
      )}
    </Async>
  );
}

export { isoToLocal };
