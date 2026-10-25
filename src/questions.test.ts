import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
type Question={id:string;type:string;tier:number;trait_tag:string;text:string;options:string[];answer:string;hint1:string;hint2:string};
const questions=JSON.parse(readFileSync(resolve(import.meta.dirname,"../data/questions.json"),"utf8")) as Question[];
test("question bank has 110 valid, tiered deterministic questions",()=>{
 assert.equal(questions.length,110);assert.equal(new Set(questions.map(q=>q.id)).size,110);
 const counts=[0,0,0,0,0];
 for(const q of questions){assert.ok(q.id&&q.text&&q.trait_tag&&q.answer&&q.hint1&&q.hint2);assert.ok(q.tier>=1&&q.tier<=5);counts[q.tier-1]!++;
  assert.ok(q.type==="mcq"||q.type==="fill_blank");
  if(q.type==="mcq"){assert.ok(q.options.length>=2);assert.equal(new Set(q.options).size,q.options.length);assert.equal(q.options.filter(o=>o===q.answer).length,1);}
  else{assert.match(q.text,/____/);assert.deepEqual(q.options,[]);}
  assert.ok(!q.hint2.includes(q.answer),`${q.id} hint 2 discloses the key`);
 }
 assert.deepEqual(counts,[22,22,22,22,22]);
});
