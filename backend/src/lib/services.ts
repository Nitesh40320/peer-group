// Cross-cutting services: email, file storage, notifications, audit logging, real-time delivery.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import type { Request } from 'express';
import nodemailer from 'nodemailer';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config.js';
import { one, q } from '../db.js';
import { badRequest, log, reportError } from './core.js';
import { loadSession } from './route.js';

// Email ---------------------------------------------------------------------

interface OutboxMail { to: string; subject: string; text: string; sentAt: string }

/** Filled only when SMTP is not configured, which production refuses to start without. */
export const devOutbox: OutboxMail[] = [];

const transport = config.smtp
  ? nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    })
  : null;

export const emailConfigured = () => transport !== null;

export async function sendEmail(to: string, subject: string, text: string) {
  if (transport) {
    await transport.sendMail({ from: config.emailFrom, to, subject, text });
    return;
  }
  devOutbox.push({ to, subject, text, sentAt: new Date().toISOString() });
  if (devOutbox.length > 500) devOutbox.shift();
  if (!config.isTest) console.log(`\n[dev email, SMTP not configured]\nTo: ${to}\nSubject: ${subject}\n${text}\n`);
}

// File storage --------------------------------------------------------------

interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

/** Local disk storage. To use cloud storage, implement FileStorage and swap this instance. */
class LocalDiskStorage implements FileStorage {
  private resolve(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid storage key');
    return path.join(config.storageDir, key.slice(0, 2), key);
  }
  async put(key: string, data: Buffer) {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { flag: 'wx', mode: 0o600 });
  }
  get(key: string) { return fs.readFile(this.resolve(key)); }
  async remove(key: string) { await fs.rm(this.resolve(key), { force: true }); }
}

export const storage: FileStorage = new LocalDiskStorage();

const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

function isProbablyText(b: Buffer) {
  const sample = b.subarray(0, 4096);
  if (sample.includes(0)) return false;
  return new TextDecoder('utf-8', { fatal: false }).decode(sample).indexOf('�') === -1;
}

/** Decides a file's type from its bytes. Declared MIME types and filenames are not trusted. */
export function sniffFile(b: Buffer, filename: string): { mime: string; ext: string } | null {
  const ext = path.extname(filename).toLowerCase();
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', ext: '.pdf' };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: '.png' };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: '.jpg' };
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp', ext: '.webp' };
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    const office: Record<string, string> = {
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    return office[ext] ? { mime: office[ext], ext } : null;
  }
  if (['.txt', '.md', '.csv'].includes(ext) && isProbablyText(b)) return { mime: 'text/plain; charset=utf-8', ext };
  return null;
}

export const safeFilename = (name: string, ext: string) => {
  const base = path.basename(name.replace(/\\/g, '/'), path.extname(name)).replace(/[^\p{L}\p{N} ._-]/gu, '_').trim().slice(0, 100) || 'file';
  return base + ext;
};

type FilePurpose = 'avatar' | 'verification' | 'resource' | 'message' | 'submission';
const IMAGE_ONLY = new Set<FilePurpose>(['avatar']);

export async function saveUpload(ownerId: string, file: Express.Multer.File, purpose: FilePurpose) {
  if (!file.size) throw badRequest('That file is empty.', 'EMPTY_FILE');
  const detected = sniffFile(file.buffer, file.originalname);
  if (!detected || (IMAGE_ONLY.has(purpose) && !detected.mime.startsWith('image/'))) {
    throw badRequest(IMAGE_ONLY.has(purpose)
      ? 'Upload a PNG, JPEG or WebP image.'
      : 'Unsupported file. Upload a PDF, Word, PowerPoint, Excel, text or image file.', 'UNSUPPORTED_FILE');
  }
  const key = crypto.randomBytes(32).toString('hex');
  await storage.put(key, file.buffer);
  return (await one(
    `INSERT INTO files (owner_id, storage_key, original_name, mime_type, size_bytes, purpose)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, original_name, mime_type, size_bytes`,
    [ownerId, key, safeFilename(file.originalname, detected.ext), detected.mime, file.size, purpose],
  ))!;
}

// Audit log -----------------------------------------------------------------

export async function audit(req: Request | null, actorId: string | null, action: string, targetType = '', targetId = '', metadata: object = {}) {
  await q('INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata, ip) VALUES ($1, $2, $3, $4, $5, $6)',
    [actorId, action, targetType, targetId, JSON.stringify(metadata), req?.ip ?? '']);
}

// Real-time -----------------------------------------------------------------

const sockets = new Map<string, Set<WebSocket>>();

export function pushToUser(userId: string, event: object) {
  const payload = JSON.stringify(event);
  for (const socket of sockets.get(userId) ?? []) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

export function disconnectUser(userId: string) {
  for (const socket of sockets.get(userId) ?? []) socket.close(4001, 'Session ended');
}

function readCookie(header: string | undefined, name: string) {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function attachRealtime(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });
  const allowed = new Set([config.appOrigin, ...config.corsOrigins]);

  server.on('upgrade', (req, socket, head) => {
    const reject = (line: string) => { socket.write(`HTTP/1.1 ${line}\r\n\r\n`); socket.destroy(); };
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return reject('404 Not Found');
    // The browser sets Origin, and a cookie alone must not let another site open this socket.
    if (!allowed.has(req.headers.origin ?? '')) return reject('403 Forbidden');
    loadSession(readCookie(req.headers.cookie, config.cookieName)).then((auth) => {
      if (!auth) return reject('401 Unauthorized');
      wss.handleUpgrade(req, socket, head, (ws) => {
        const userId = auth.user.id;
        if (!sockets.has(userId)) sockets.set(userId, new Set());
        sockets.get(userId)!.add(ws);
        ws.on('close', () => {
          const set = sockets.get(userId);
          set?.delete(ws);
          if (set?.size === 0) sockets.delete(userId);
        });
        ws.on('error', () => ws.terminate());
      });
    }).catch((error) => { reportError(error, { where: 'ws upgrade' }); reject('500 Internal Server Error'); });
  });

  const heartbeat = setInterval(() => wss.clients.forEach((c) => c.ping()), 30000);
  heartbeat.unref();
  return wss;
}

// Notifications -------------------------------------------------------------

export const NOTIFICATION_TYPES = [
  'connection_request', 'connection_accepted', 'group_invitation', 'group_join', 'message', 'session_reminder',
  'assignment_deadline', 'mentorship', 'announcement', 'task_update', 'teacher_verification',
] as const;
type NotificationType = (typeof NOTIFICATION_TYPES)[number];

interface Prefs { mutedTypes: string[]; emailTypes: string[] }

export const shouldDeliverInApp = (p: Prefs, type: string) => !p.mutedTypes.includes(type);
export const shouldEmail = (p: Prefs, type: string) => p.emailTypes.includes(type);

export async function notify(userId: string, type: NotificationType, content: { title: string; body?: string; link?: string }) {
  const row = await one(
    `SELECT u.email, COALESCE(p.muted_types, '{}') AS muted_types, COALESCE(p.email_types, '{}') AS email_types
       FROM users u LEFT JOIN notification_preferences p ON p.user_id = u.id WHERE u.id = $1`, [userId]);
  if (!row) return;
  if (shouldDeliverInApp(row, type)) {
    const created = await one(
      'INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, type, content.title, content.body ?? '', content.link ?? '']);
    pushToUser(userId, { type: 'notification', notification: created });
  }
  if (shouldEmail(row, type)) {
    const link = content.link ? `\n\n${config.appOrigin}${content.link}` : '';
    sendEmail(row.email, content.title, `${content.body ?? content.title}${link}`)
      .catch((error) => log.warn('Notification email failed', { message: String(error) }));
  }
}

export const notifyMany = (userIds: string[], type: NotificationType, content: { title: string; body?: string; link?: string }) =>
  Promise.all(userIds.map((id) => notify(id, type, content)));
