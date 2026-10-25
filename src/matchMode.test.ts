import assert from "node:assert/strict";
import test from "node:test";
import { maximumPlayers, openingPhase, parseMatchMode, requiredPlayers } from "./matchMode.ts";
test("single-player matches start immediately with one seat",()=>{
 assert.equal(parseMatchMode("single"),"single");
 assert.equal(requiredPlayers("single"),1);assert.equal(maximumPlayers("single"),1);assert.equal(openingPhase("single"),"LIVE");
});
test("multiplayer defaults retain the six-player calibration lobby",()=>{
 assert.equal(parseMatchMode(undefined),"multi");
 assert.equal(requiredPlayers("multi"),6);assert.equal(maximumPlayers("multi"),8);assert.equal(openingPhase("multi"),"CALIBRATION");
});
test("multiplayer lobby threshold remains configurable",()=>{
 assert.equal(requiredPlayers("multi",8),8);assert.equal(maximumPlayers("multi",8),8);
});
