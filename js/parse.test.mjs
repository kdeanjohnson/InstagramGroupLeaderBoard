import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze, buildAwards, decodeName } from "./parse.js";

const sample = JSON.parse(readFileSync(new URL("../sample/message_1.json", import.meta.url), "utf8"));
const report = analyze([sample]);
const { awards, unanimous } = buildAwards(report);

assert.equal(report.participantCount, 5);
assert.equal(report.title, "tuesday night film club");
assert.ok(report.videos.length >= 8);

const universal = report.videos.filter((v) => v.hearts >= 4);
assert.ok(universal.length >= 2, "expected at least two unanimous videos");
assert.ok(unanimous.some((v) => v.owner === "hometownfails"));
assert.ok(unanimous.some((v) => v.owner === "animalcourt"));

const dog = report.videos.find((v) => v.owner === "animalcourt");
assert.equal(dog.hearts, 4);
assert.equal(dog.discoveredBy, "Maya Chen");

const pool = report.videos.find((v) => v.key === "ig:Dpoolleap88");
assert.equal(pool.shareCount, 2);
assert.ok(pool.sharers.includes("Sam Okonkwo"));
assert.ok(pool.sharers.includes("Maya Chen"));
assert.equal(pool.hearts, 4);

const priya = report.people.find((p) => p.name === "Priya Nair");
const jordan = report.people.find((p) => p.name === "Jordan Hale");
assert.ok(priya.heartsReceived > jordan.heartsReceived);

assert.ok(awards.some((a) => a.id === "universal"));
assert.ok(awards.some((a) => a.id === "beloved"));
assert.ok(awards.some((a) => a.id === "popular"));
assert.ok(awards.some((a) => a.id === "echo" || a.id === "fan"));

const self = analyze([{
  participants: [{ name: "A" }, { name: "B" }],
  title: "pair",
  messages: [{
    sender_name: "A",
    timestamp_ms: 1,
    share: { link: "https://www.instagram.com/reel/SELFONLY1/", original_content_owner: "me" },
    reactions: [{ reaction: "❤", actor: "A" }, { reaction: "❤", actor: "B" }],
  }],
}]);
assert.equal(self.videos[0].hearts, 1);
assert.equal(self.people.find((p) => p.name === "A").heartsReceived, 1);

assert.equal(decodeName("Jos\u00c3\u00a9"), "José");

const chunks = analyze([
  { participants: [{ name: "A" }], messages: [{ sender_name: "A", timestamp_ms: 2, content: "later" }] },
  {
    participants: [{ name: "A" }, { name: "B" }],
    title: "split thread",
    messages: [{
      sender_name: "B",
      timestamp_ms: 1,
      share: { link: "https://www.instagram.com/reel/SPLIT1/", original_content_owner: "zine" },
      reactions: [{ reaction: "❤️", actor: "A" }],
    }],
  },
]);
assert.equal(chunks.messageCount, 2);
assert.equal(chunks.videos.length, 1);
assert.equal(chunks.title, "split thread");

const shared = JSON.parse(readFileSync(new URL("../share/fisherthem.json", import.meta.url), "utf8"));
const fisher = analyze([shared]);
const fisherAwards = buildAwards(fisher);
assert.equal(fisher.title, "Fisherthem");
assert.equal(fisher.participantCount, 4);
assert.ok(fisher.videos.length > 1000);
assert.ok(fisher.videos.some((v) => v.link.startsWith("https://www.instagram.com/reel/")));
assert.ok(fisherAwards.awards.some((a) => a.id === "beloved" && a.headline === "Colton Smith"));
assert.ok(fisher.heartTotal > 800);

console.log("parse.test.mjs ok", {
  videos: report.videos.length,
  hearts: report.heartTotal,
  awards: awards.map((a) => a.id),
});
