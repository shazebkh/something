import assert from "node:assert/strict";
import test from "node:test";
import { beginQuestion, calculatePoints, createPlayerRulesState, difficultyTier, rankPlayers, requestHint, selectExit, submitAnswer } from "./rules.ts";

function ready(exit = "door-a", question = "q1", now = 0) {
  return beginQuestion(selectExit(createPlayerRulesState(), exit), question, now);
}

test("wrong answers shrink to the floor, add strikes, and reset the correct streak", () => {
  let state = { ...ready(), roomSize: 30, correctStreak: 2 };
  const result = submitAnswer(state, false, 0, { tier: 2, elapsedMs: 100, timeLimitMs: 10_000 });
  assert.equal(result.state.roomSize, 25);
  assert.equal(result.state.strikes, 1);
  assert.equal(result.state.correctStreak, 0);
  assert.equal(result.state.crushed, false);
  assert.equal(result.pointsEarned, 0);
});

test("five strikes crush the player", () => {
  let state = selectExit(createPlayerRulesState(), "door");
  for (let i = 0; i < 5; i++) {
    state = beginQuestion(state, `q${i}`, i * 15_000);
    state = submitAnswer(state, false, i * 15_000, { tier: 1, elapsedMs: 100, timeLimitMs: 5_000 }).state;
    if (i < 4) assert.equal(state.crushed, false);
  }
  assert.equal(state.strikes, 5);
  assert.equal(state.crushed, true);
});

test("each third consecutive correct answer removes one strike and room size regrows", () => {
  let state = { ...ready(), strikes: 2, roomSize: 25 };
  for (let i = 1; i <= 3; i++) {
    state = beginQuestion(state, `correct-${i}`, 0);
    state = submitAnswer(state, true, 0, { tier: 1, elapsedMs: 0, timeLimitMs: 10_000 }).state;
    assert.equal(state.roomSize, Math.min(25 + 4 * i, 100));
    assert.equal(state.strikes, i === 3 ? 1 : 2);
  }
  assert.equal(state.correctStreak, 3);
});

test("hints apply room, points, and strike costs", () => {
  let state = ready();
  state = requestHint(state, 1);
  assert.equal(state.roomSize, 95);
  assert.equal(state.hintPenalty, 0.2);
  state = requestHint(state, 2);
  assert.equal(state.roomSize, 85);
  assert.equal(state.strikes, 1);
  assert.equal(state.hintPenalty, 0.7);
  assert.throws(() => requestHint(state, 2), /already used/);
  const scored = submitAnswer(state, true, 100, { tier: 2, elapsedMs: 5_000, timeLimitMs: 10_000 });
  assert.ok(Math.abs(scored.pointsEarned - 30) < 1e-9);
});

test("wrong answers escalate same-exit lockouts and switching exits clears them", () => {
  let state = createPlayerRulesState();
  const expected = [3_000, 6_000, 12_000, 12_000];
  for (let i = 0; i < expected.length; i++) {
    state = beginQuestion(selectExit(state, "same-exit"), `wrong-${i}`, i * 20_000);
    const result = submitAnswer(state, false, i * 20_000, { tier: 2, elapsedMs: 2_000, timeLimitMs: 10_000 });
    assert.equal(result.lockoutMs, expected[i]);
    state = result.state;
  }
  assert.throws(() => beginQuestion(state, "too-soon", 70_000), /locked out/);
  state = beginQuestion(selectExit(state, "other-exit"), "new-exit", 70_000);
  assert.equal(state.wrongOnExit, 0);
  assert.equal(state.lockoutUntil, 0);
});

test("scoring clamps speed factor and applies hint penalty", () => {
  assert.equal(calculatePoints(3, 0, 10_000), 300);
  assert.equal(calculatePoints(3, 5_000, 10_000, 0.2), 120);
  assert.equal(calculatePoints(3, 20_000, 10_000), 30);
});

test("difficulty uses door proximity bonus and teleport tiers 1–2", () => {
  assert.deepEqual([difficultyTier("door", 9), difficultyTier("door", 2), difficultyTier("door", 1)], [3, 4, 5]);
  assert.equal(difficultyTier("window", 1), 2);
  assert.equal(difficultyTier("drawer", 8), 1);
});

test("ranking uses earliest exit, then distance, strikes, score", () => {
  const ranked = rankPlayers([
    { playerId: "score", distanceToFinish: 1, strikes: 1, score: 500 },
    { playerId: "winner-later", distanceToFinish: 0, strikes: 4, score: 0, exitedAt: 20 },
    { playerId: "winner", distanceToFinish: 0, strikes: 4, score: 0, exitedAt: 10 },
    { playerId: "strikes", distanceToFinish: 2, strikes: 0, score: 50 },
    { playerId: "crushed", distanceToFinish: 0, strikes: 5, score: 999, crushed: true },
  ]);
  assert.deepEqual(ranked.map(p => p.playerId), ["winner", "winner-later", "score", "strikes", "crushed"]);
  const tieBreak = rankPlayers([
    { playerId: "low-score", distanceToFinish: 1, strikes: 1, score: 10 },
    { playerId: "high-score", distanceToFinish: 1, strikes: 1, score: 20 },
    { playerId: "low-strikes", distanceToFinish: 1, strikes: 0, score: 0 },
  ]);
  assert.deepEqual(tieBreak.map(p => p.playerId), ["low-strikes", "high-score", "low-score"]);
});


test("hint 2 and hint 1 may be requested in either order", () => {
  let state = ready("other", "reverse-hints");
  state = requestHint(state, 2);
  state = requestHint(state, 1);
  assert.equal(state.hintPenalty, 0.7);
  assert.equal(state.hintsUsed.length, 2);
});
