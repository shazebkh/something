export type MatchMode = "single" | "multi";
export type OpeningPhase = "LIVE" | "CALIBRATION";
export function parseMatchMode(value: unknown): MatchMode {
  return value === "single" ? "single" : "multi";
}
export function requiredPlayers(mode: MatchMode, multiplayerMinimum = 6): number {
  return mode === "single" ? 1 : multiplayerMinimum;
}
export function maximumPlayers(mode: MatchMode, multiplayerMaximum = 8): number {
  return mode === "single" ? 1 : multiplayerMaximum;
}
export function openingPhase(mode: MatchMode): OpeningPhase {
  return mode === "single" ? "LIVE" : "CALIBRATION";
}
