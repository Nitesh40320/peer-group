// Pure business rules, kept free of I/O so they can be unit tested directly.

export type GroupRole = 'owner' | 'leader' | 'member';

export const canManageGroup = (role?: GroupRole | null) => role === 'owner' || role === 'leader';

export function canRemoveMember(actor: GroupRole | null | undefined, target: GroupRole) {
  if (target === 'owner') return false;
  if (actor === 'owner') return true;
  return actor === 'leader' && target === 'member';
}

export const canChangeMemberRole = (actor?: GroupRole | null) => actor === 'owner';
export const hasCapacity = (memberCount: number, capacity: number) => memberCount < capacity;

/** Group managers and the project's own members may change a project. */
export const canModifyProject = (groupRole: GroupRole | null | undefined, isProjectMember: boolean) =>
  isProjectMember || canManageGroup(groupRole);

export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'completed'] as const;

export function projectProgress(tasks: Array<{ status: string }>) {
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((t) => t.status === 'completed').length / tasks.length) * 100);
}

interface StudentCompletionInput {
  fullName: string; avatarFileId: string | null; institution: string; department: string; academicYear: number | null;
  bio: string; learningGoals: string; learningMethods: string[]; availability: string[];
  subjects: string[]; skills: string[]; interests: string[];
}

export function studentProfileCompletion(p: StudentCompletionInput) {
  const checks: Array<[string, boolean]> = [
    ['Full name', !!p.fullName], ['Profile photo', !!p.avatarFileId], ['Institution', !!p.institution],
    ['Department', !!p.department], ['Academic year', p.academicYear !== null], ['Biography', !!p.bio],
    ['Learning goals', !!p.learningGoals], ['Learning methods', p.learningMethods.length > 0],
    ['Availability', p.availability.length > 0], ['Subjects', p.subjects.length > 0],
    ['Skills', p.skills.length > 0], ['Interests', p.interests.length > 0],
  ];
  const done = checks.filter(([, ok]) => ok).length;
  return { percent: Math.round((done / checks.length) * 100), missing: checks.filter(([, ok]) => !ok).map(([label]) => label) };
}

export const AVAILABILITY_SLOTS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  .flatMap((d) => ['morning', 'afternoon', 'evening'].map((p) => `${d}_${p}`));
export const LEARNING_METHODS = ['discussion', 'problem_solving', 'teaching_others', 'flashcards', 'projects', 'reading', 'video', 'quiet_study'] as const;

/** Whether a session can be checked into: from 15 minutes before it starts until it ends. */
export function canCheckIn(startsAt: Date, durationMinutes: number, now = new Date()) {
  return now.getTime() >= startsAt.getTime() - 15 * 60000 && now.getTime() <= startsAt.getTime() + durationMinutes * 60000;
}

function icsStamp(d: Date) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Standard calendar file; times are UTC so every calendar app converts them correctly. */
export function sessionIcs(s: { id: string; title: string; description: string; startsAt: Date; durationMinutes: number }) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PeerConnect//Study Sessions//EN', 'BEGIN:VEVENT',
    `UID:${s.id}@peerconnect`, `DTSTAMP:${icsStamp(new Date())}`, `DTSTART:${icsStamp(s.startsAt)}`,
    `DTEND:${icsStamp(new Date(s.startsAt.getTime() + s.durationMinutes * 60000))}`,
    `SUMMARY:${icsEscape(s.title)}`, `DESCRIPTION:${icsEscape(s.description)}`, 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
