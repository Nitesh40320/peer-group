// Study partner recommendations. This is a transparent weighted rule set, not machine learning.
// To introduce a learned model later, implement Matcher and change activeMatcher.

export interface MatchProfile {
  subjects: string[]; skills: string[]; interests: string[];
  learningGoals: string; learningMethods: string[]; availability: string[];
}

export interface MatchResult { score: number; reasons: string[]; explanation: string }
export interface Matcher { score(me: MatchProfile, other: MatchProfile): MatchResult }

const WEIGHTS = { subjects: 35, availability: 20, interests: 15, skills: 15, methods: 10, goals: 5 } as const;

const STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'my', 'i', 'want', 'learn', 'improve', 'get', 'better', 'at', 'be', 'by']);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w)));
const lower = (a: string[]) => new Map(a.map((v) => [v.toLowerCase(), v]));

function shared(a: string[], b: string[]) {
  const other = lower(b);
  return a.filter((v) => other.has(v.toLowerCase()));
}

/** Overlap relative to the smaller list, so a short profile is not penalized for being short. */
const overlapRatio = (count: number, a: unknown[], b: unknown[]) => (Math.min(a.length, b.length) ? count / Math.min(a.length, b.length) : 0);

function list(items: string[], limit = 2) {
  const shown = items.slice(0, limit);
  if (shown.length < 2) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

export const weightedMatcher: Matcher = {
  score(me, other) {
    const subjects = shared(me.subjects, other.subjects);
    const interests = shared(me.interests, other.interests);
    const availability = shared(me.availability, other.availability);
    const methods = shared(me.learningMethods, other.learningMethods);
    const mySkills = lower(me.skills);
    const theirSkills = lower(other.skills);
    const theyOffer = other.skills.filter((s) => !mySkills.has(s.toLowerCase()));
    const iOffer = me.skills.filter((s) => !theirSkills.has(s.toLowerCase()));
    const myGoals = words(me.learningGoals);
    const theirGoals = [...words(other.learningGoals)];
    const sharedGoals = theirGoals.filter((w) => myGoals.has(w));

    // Complementary means each side can teach the other something.
    const complementary = theyOffer.length && iOffer.length ? 1 : theyOffer.length || iOffer.length ? 0.5 : 0;

    const score = Math.round(
      WEIGHTS.subjects * overlapRatio(subjects.length, me.subjects, other.subjects)
      + WEIGHTS.availability * overlapRatio(availability.length, me.availability, other.availability)
      + WEIGHTS.interests * overlapRatio(interests.length, me.interests, other.interests)
      + WEIGHTS.skills * complementary
      + WEIGHTS.methods * overlapRatio(methods.length, me.learningMethods, other.learningMethods)
      + WEIGHTS.goals * overlapRatio(sharedGoals.length, [...myGoals], theirGoals),
    );

    const reasons: string[] = [];
    if (subjects.length) reasons.push(`you both study ${list(subjects)}`);
    if (interests.length) reasons.push(`share an interest in ${list(interests)}`);
    if (theyOffer.length && iOffer.length) reasons.push(`have complementary skills (they know ${list(theyOffer, 1)}, you know ${list(iOffer, 1)})`);
    if (sharedGoals.length) reasons.push('have similar learning goals');
    if (methods.length) reasons.push('prefer similar ways of learning');
    if (availability.length) reasons.push('have compatible study schedules');

    const explanation = reasons.length
      ? `Recommended because ${reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}`}.`
      : 'Add more to your profile to get specific recommendations.';
    return { score, reasons, explanation };
  },
};

export const activeMatcher: Matcher = weightedMatcher;
