export type ExitKind = "door" | "window" | "cupboard" | "drawer";
export type HintLevel = 1 | 2;
export interface PlayerRulesState {
  roomSize: number;
  strikes: number;
  correctStreak: number;
  score: number;
  crushed: boolean;
  exitedAt: number | null;
  selectedExitId: string | null;
  wrongOnExit: number;
  lockoutUntil: number;
  questionId: string | null;
  hintLevel: HintLevel | 0;
  hintsUsed: HintLevel[];
  hintPenalty: number;
  resolved: boolean;
}
export const RULES = {
  minRoomSize: 25, maxRoomSize: 100, startRoomSize: 100, maxStrikes: 5,
  wrongShrink: 8, correctGrowth: 4, hint1Shrink: 5, hint2Shrink: 10,
  lockoutsMs: [3_000, 6_000, 12_000] as const,
  hintPenalties: { 1: 0.2, 2: 0.5 } as const,
};
export function createPlayerRulesState(): PlayerRulesState {
  return { roomSize: RULES.startRoomSize, strikes: 0, correctStreak: 0, score: 0, crushed: false, exitedAt: null, selectedExitId: null, wrongOnExit: 0, lockoutUntil: 0, questionId: null, hintLevel: 0, hintsUsed: [], hintPenalty: 0, resolved: false };
}
function clampRoomSize(value: number): number { return Math.max(RULES.minRoomSize, Math.min(RULES.maxRoomSize, value)); }
function assertActive(state: PlayerRulesState): void {
  if (state.crushed) throw new Error("Player is crushed");
  if (state.exitedAt !== null) throw new Error("Player has already exited");
}
function assertTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative timestamp`);
}

/** Starts/selects an exit. Changing exits clears the escalating wrong-answer lockout. */
export function selectExit(state: PlayerRulesState, exitId: string): PlayerRulesState {
  assertActive(state);
  if (!exitId.trim()) throw new Error("exitId cannot be empty");
  const changed = state.selectedExitId !== exitId;
  return { ...state, selectedExitId: exitId, wrongOnExit: changed ? 0 : state.wrongOnExit, lockoutUntil: changed ? 0 : state.lockoutUntil, questionId: null, hintLevel: 0, hintsUsed: [], hintPenalty: 0, resolved: false };
}

/** Starts a fresh question on the selected exit after its lockout expires. */
export function beginQuestion(state: PlayerRulesState, questionId: string, now: number): PlayerRulesState {
  assertActive(state); assertTimestamp(now, "now");
  if (!state.selectedExitId) throw new Error("Select an exit before starting a question");
  if (!questionId.trim()) throw new Error("questionId cannot be empty");
  if (now < state.lockoutUntil) throw new Error("Exit is locked out");
  return { ...state, questionId, hintLevel: 0, hintsUsed: [], hintPenalty: 0, resolved: false };
}

/** Applies a hint's room cost, points penalty and (for hint 2) strike. One use of each hint per question. */
export function requestHint(state: PlayerRulesState, level: HintLevel): PlayerRulesState {
  assertActive(state);
  if (!state.questionId || state.resolved) throw new Error("No active question");
  if (level !== 1 && level !== 2) throw new RangeError("Hint level must be 1 or 2");
  if (state.hintsUsed.includes(level)) throw new Error(`Hint ${level} was already used for this question`);
  const roomCost = level === 1 ? RULES.hint1Shrink : RULES.hint2Shrink;
  const strikes = state.strikes + (level === 2 ? 1 : 0);
  return { ...state, roomSize: clampRoomSize(state.roomSize - roomCost), strikes, hintLevel: Math.max(state.hintLevel, level) as HintLevel, hintsUsed: [...state.hintsUsed, level], hintPenalty: Math.min(1, state.hintPenalty + RULES.hintPenalties[level]), crushed: strikes >= RULES.maxStrikes };
}

export interface AnswerTiming { tier: number; elapsedMs: number; timeLimitMs: number }
export interface AnswerResult { state: PlayerRulesState; correct: boolean; lockoutMs: number; pointsEarned: number }

/** Applies one deterministic graded answer. The caller supplies the correctness result and server timing. */
export function submitAnswer(state: PlayerRulesState, correct: boolean, now: number, timing: AnswerTiming): AnswerResult {
  assertActive(state); assertTimestamp(now, "now");
  if (!state.questionId || state.resolved) throw new Error("No unanswered question is active");
  if (now < state.lockoutUntil) throw new Error("Exit is locked out");
  if (!Number.isInteger(timing.tier) || timing.tier < 1 || timing.tier > 5) throw new RangeError("tier must be an integer from 1 to 5");
  if (!Number.isFinite(timing.elapsedMs) || timing.elapsedMs < 0 || !Number.isFinite(timing.timeLimitMs) || timing.timeLimitMs <= 0) throw new RangeError("Answer timing must be non-negative with a positive time limit");
  if (typeof correct !== "boolean") throw new TypeError("correct must be a boolean");
  if (correct) {
    const nextStreak = state.correctStreak + 1;
    const recovered = nextStreak % 3 === 0 && state.strikes > 0;
    const pointsEarned = calculatePoints(timing.tier, timing.elapsedMs, timing.timeLimitMs, state.hintPenalty);
    const next: PlayerRulesState = {
      ...state, roomSize: clampRoomSize(state.roomSize + RULES.correctGrowth),
      strikes: state.strikes - (recovered ? 1 : 0), correctStreak: nextStreak,
      score: state.score + pointsEarned, resolved: true,
    };
    return { state: next, correct: true, lockoutMs: 0, pointsEarned };
  }
  const wrongOnExit = state.wrongOnExit + 1;
  const lockoutMs = RULES.lockoutsMs[Math.min(wrongOnExit - 1, RULES.lockoutsMs.length - 1)]!;
  const strikes = state.strikes + 1;
  const next: PlayerRulesState = {
    ...state, roomSize: clampRoomSize(state.roomSize - RULES.wrongShrink), strikes,
    correctStreak: 0, wrongOnExit, lockoutUntil: now + lockoutMs,
    crushed: strikes >= RULES.maxStrikes, resolved: true,
  };
  return { state: next, correct: false, lockoutMs, pointsEarned: 0 };
}

/** Exit difficulties use stable MVP defaults; callers may tune non-door tiers within 1–2. */
export function difficultyTier(exit: ExitKind, distanceToFinish: number, teleportBaseTier?: 1 | 2): number {
  if (!Number.isInteger(distanceToFinish) || distanceToFinish < 0) throw new RangeError("distanceToFinish must be a non-negative integer");
  const base = exit === "door" ? 3 : teleportBaseTier ?? (exit === "window" ? 2 : 1);
  if (exit !== "door" && teleportBaseTier !== undefined && teleportBaseTier !== 1 && teleportBaseTier !== 2) throw new RangeError("teleportBaseTier must be 1 or 2");
  const bonus = exit === "door" ? (distanceToFinish <= 1 ? 2 : distanceToFinish === 2 ? 1 : 0) : 0;
  return Math.max(1, Math.min(5, base + bonus));
}

/** Defaults to 100 points per tier; supply another tier-points value when tuning. */
export function calculatePoints(tier: number, elapsedMs: number, timeLimitMs: number, hintPenalty = 0, tierPoints = tier * 100): number {
  if (!Number.isInteger(tier) || tier < 1 || tier > 5) throw new RangeError("tier must be an integer from 1 to 5");
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(timeLimitMs) || timeLimitMs <= 0) throw new RangeError("Invalid answer timing");
  if (!Number.isFinite(hintPenalty) || hintPenalty < 0 || hintPenalty > 1) throw new RangeError("hintPenalty must be between 0 and 1");
  if (!Number.isFinite(tierPoints) || tierPoints < 0) throw new RangeError("tierPoints must be non-negative");
  const speedFactor = Math.max(0.1, Math.min(1, 1 - elapsedMs / timeLimitMs));
  return tierPoints * speedFactor * (1 - hintPenalty);
}

export interface RankedPlayer {
  playerId: string; distanceToFinish: number; strikes: number; score: number; crushed?: boolean; exitedAt?: number | null;
}
/** If someone exited, earliest exit wins. Otherwise rank survivors by distance, strikes, then score. */
export function rankPlayers(players: readonly RankedPlayer[]): RankedPlayer[] {
  return [...players].sort((a, b) => {
    const ae = a.exitedAt ?? null, be = b.exitedAt ?? null;
    if (ae !== null || be !== null) {
      if (ae === null) return 1;
      if (be === null) return -1;
      if (ae !== be) return ae - be;
    }
    const ac = a.crushed === true, bc = b.crushed === true;
    if (ac !== bc) return ac ? 1 : -1;
    return a.distanceToFinish - b.distanceToFinish || a.strikes - b.strikes || b.score - a.score || a.playerId.localeCompare(b.playerId);
  });
}
export function markExited(state: PlayerRulesState, now: number): PlayerRulesState {
  assertActive(state); assertTimestamp(now, "now");
  return { ...state, exitedAt: now, questionId: null, resolved: true };
}



