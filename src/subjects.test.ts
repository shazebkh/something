import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestionSubject, pickQuestion } from "./subjects.ts";
const bank = [
 { id: "bio-1", tier: 1, trait_tag: "biology" },
 { id: "bio-2", tier: 2, trait_tag: "biology" },
 { id: "phys-1", tier: 1, trait_tag: "physics" },
];
test("subject parser only accepts configured question subjects", () => {
 assert.equal(parseQuestionSubject("biology"), "biology");
 assert.equal(parseQuestionSubject("all"), "all");
 assert.equal(parseQuestionSubject("unknown"), null);
});
test("question choice stays within the selected subject and prefers the requested tier", () => {
 assert.equal(pickQuestion(bank, 1, "biology", new Set(), () => 0)?.id, "bio-1");
 assert.equal(pickQuestion(bank, 5, "biology", new Set(), () => 0)?.id, "bio-1");
 assert.equal(pickQuestion(bank, 1, "all", new Set(), () => 0.99)?.id, "phys-1");
});
test("question choice never repeats a seen question and returns null when a subject is exhausted", () => {
 assert.equal(pickQuestion(bank, 1, "biology", new Set(["bio-1", "bio-2"])) , null);
 assert.equal(pickQuestion(bank, 1, "all", new Set(["bio-1", "bio-2", "phys-1"])), null);
});
