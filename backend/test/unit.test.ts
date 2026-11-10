import { describe, expect, it } from 'vitest';
import { isAllowed } from '../src/lib/route.js';
import { safeFilename, shouldDeliverInApp, shouldEmail, sniffFile } from '../src/lib/services.js';
import { emailSchema, passwordSchema, registerSchema } from '../src/modules/auth.js';
import { weightedMatcher, type MatchProfile } from '@peerconnect/model';
import { canChangeMemberRole, canCheckIn, canManageGroup, canModifyProject, canRemoveMember, hasCapacity, projectProgress, sessionIcs, studentProfileCompletion } from '../src/modules/rules.js';

const profile = (over: Partial<MatchProfile> = {}): MatchProfile => ({ subjects: [], skills: [], interests: [], learningGoals: '', learningMethods: [], availability: [], ...over });

describe('authentication validation', () => {
  it('requires length, a letter and a number in passwords', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('onlyletterslong').success).toBe(false);
    expect(passwordSchema.safeParse('1234567890123').success).toBe(false);
    expect(passwordSchema.safeParse('longenough123').success).toBe(true);
  });

  it('normalizes email case and rejects malformed addresses', () => {
    expect(emailSchema.parse('  Student@Example.COM ')).toBe('student@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('only allows public registration as student or teacher', () => {
    const base = { fullName: 'A', email: 'a@b.co', password: 'longenough123' };
    expect(registerSchema.safeParse({ ...base, role: 'admin' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, role: 'student' }).success).toBe(true);
  });

  it('requires institution details from teachers', () => {
    const base = { fullName: 'A', email: 'a@b.co', password: 'longenough123', role: 'teacher' };
    expect(registerSchema.safeParse(base).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, institution: 'X', department: 'Y', designation: 'Z' }).success).toBe(true);
  });
});

describe('role checks', () => {
  it('separates pending and approved teachers', () => {
    expect(isAllowed({ role: 'teacher', teacherStatus: 'pending' }, ['approved_teacher'])).toBe(false);
    expect(isAllowed({ role: 'teacher', teacherStatus: 'approved' }, ['approved_teacher'])).toBe(true);
    expect(isAllowed({ role: 'teacher', teacherStatus: 'pending' }, ['teacher'])).toBe(true);
  });

  it('keeps students out of teacher and admin access lists', () => {
    expect(isAllowed({ role: 'student', teacherStatus: null }, ['approved_teacher'])).toBe(false);
    expect(isAllowed({ role: 'student', teacherStatus: null }, ['admin'])).toBe(false);
    expect(isAllowed({ role: 'teacher', teacherStatus: 'approved' }, ['admin'])).toBe(false);
  });
});

describe('profile validation', () => {
  it('reports what is missing from a profile', () => {
    const result = studentProfileCompletion({ fullName: 'A', avatarFileId: null, institution: 'X', department: '', academicYear: null, bio: '', learningGoals: '', learningMethods: [], availability: [], subjects: [], skills: [], interests: [] });
    expect(result.percent).toBe(17);
    expect(result.missing).toContain('Subjects');
    expect(result.missing).not.toContain('Full name');
  });
});

describe('matching algorithm', () => {
  it('scores no overlap as zero and explains why', () => {
    const r = weightedMatcher.score(profile(), profile());
    expect(r.score).toBe(0);
    expect(r.explanation).toMatch(/Add more to your profile/);
  });

  it('explains shared subjects, interests and schedules', () => {
    const r = weightedMatcher.score(
      profile({ subjects: ['Data Structures'], interests: ['Competitive Programming'], availability: ['mon_evening'] }),
      profile({ subjects: ['data structures'], interests: ['Competitive Programming'], availability: ['mon_evening'] }),
    );
    expect(r.score).toBe(70);
    expect(r.explanation).toBe('Recommended because you both study Data Structures, share an interest in Competitive Programming and have compatible study schedules.');
  });

  it('rewards complementary skills rather than identical ones', () => {
    const same = weightedMatcher.score(profile({ skills: ['Python'] }), profile({ skills: ['Python'] }));
    const complementary = weightedMatcher.score(profile({ skills: ['Python'] }), profile({ skills: ['SQL'] }));
    expect(complementary.score).toBeGreaterThan(same.score);
    expect(complementary.reasons[0]).toContain('complementary');
  });

  it('never exceeds 100', () => {
    const p = profile({ subjects: ['A'], interests: ['B'], availability: ['mon_morning'], learningMethods: ['projects'], learningGoals: 'master compilers', skills: ['X'] });
    expect(weightedMatcher.score(p, { ...p, skills: ['Y'] }).score).toBeLessThanOrEqual(100);
  });
});

describe('group membership rules', () => {
  it('limits management to owners and leaders', () => {
    expect(canManageGroup('owner')).toBe(true);
    expect(canManageGroup('leader')).toBe(true);
    expect(canManageGroup('member')).toBe(false);
    expect(canManageGroup(null)).toBe(false);
  });

  it('never allows removing an owner; leaders can only remove members', () => {
    expect(canRemoveMember('owner', 'owner')).toBe(false);
    expect(canRemoveMember('leader', 'leader')).toBe(false);
    expect(canRemoveMember('leader', 'member')).toBe(true);
    expect(canRemoveMember('member', 'member')).toBe(false);
    expect(canRemoveMember('owner', 'leader')).toBe(true);
  });

  it('lets only owners change roles and enforces capacity', () => {
    expect(canChangeMemberRole('leader')).toBe(false);
    expect(canChangeMemberRole('owner')).toBe(true);
    expect(hasCapacity(9, 10)).toBe(true);
    expect(hasCapacity(10, 10)).toBe(false);
  });
});

describe('project and session rules', () => {
  it('computes completion across task statuses', () => {
    expect(projectProgress([])).toBe(0);
    expect(projectProgress([{ status: 'completed' }, { status: 'todo' }, { status: 'review' }, { status: 'completed' }])).toBe(50);
  });

  it('allows project members and group managers to modify a project', () => {
    expect(canModifyProject('member', true)).toBe(true);
    expect(canModifyProject('leader', false)).toBe(true);
    expect(canModifyProject('member', false)).toBe(false);
  });

  it('opens check-in 15 minutes before start and closes at the end', () => {
    const start = new Date('2026-01-01T10:00:00Z');
    expect(canCheckIn(start, 60, new Date('2026-01-01T09:44:00Z'))).toBe(false);
    expect(canCheckIn(start, 60, new Date('2026-01-01T09:46:00Z'))).toBe(true);
    expect(canCheckIn(start, 60, new Date('2026-01-01T11:01:00Z'))).toBe(false);
  });

  it('writes calendar times in UTC and escapes text', () => {
    const ics = sessionIcs({ id: 'x', title: 'A, B; C', description: '', startsAt: new Date('2026-01-01T10:00:00+05:30'), durationMinutes: 90 });
    expect(ics).toContain('DTSTART:20260101T043000Z');
    expect(ics).toContain('DTEND:20260101T060000Z');
    expect(ics).toContain('SUMMARY:A\\, B\\; C');
  });
});

describe('notification logic', () => {
  const prefs = { mutedTypes: ['message'], emailTypes: ['announcement'] };
  it('respects muted types and only emails when opted in', () => {
    expect(shouldDeliverInApp(prefs, 'message')).toBe(false);
    expect(shouldDeliverInApp(prefs, 'task_update')).toBe(true);
    expect(shouldEmail(prefs, 'announcement')).toBe(true);
    expect(shouldEmail(prefs, 'task_update')).toBe(false);
  });
});

describe('file validation', () => {
  const pdf = Buffer.from('%PDF-1.7 content');
  it('identifies files by content, not by their name', () => {
    expect(sniffFile(pdf, 'renamed.exe')?.mime).toBe('application/pdf');
    expect(sniffFile(Buffer.from('MZ\x90\x00binary'), 'notes.pdf')).toBeNull();
    expect(sniffFile(Buffer.from('<html><script>alert(1)</script>'), 'page.html')).toBeNull();
  });

  it('accepts text only for text extensions', () => {
    expect(sniffFile(Buffer.from('plain notes'), 'notes.txt')?.ext).toBe('.txt');
    expect(sniffFile(Buffer.from('plain notes'), 'notes.js')).toBeNull();
  });

  it('removes path traversal from filenames', () => {
    expect(safeFilename('../../etc/passwd.pdf', '.pdf')).toBe('passwd.pdf');
    expect(safeFilename('..\\..\\evil.pdf', '.pdf')).toBe('evil.pdf');
  });
});
