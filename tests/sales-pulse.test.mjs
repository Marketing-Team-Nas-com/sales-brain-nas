import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSalesPulseUpdate,
  preserveAndParseMondayUpdates,
} from "../app/lib/sales-pulse.ts";
import {
  realQuestionnaireUpdate,
  salespersonNoteUpdate,
  systemUpdate,
} from "./fixtures/sales-pulse-update.mjs";

const allTrue = {
  decisionMaker: true,
  revenueAtLeast5m: true,
  marketingSpendAtLeast500k: true,
  interestedInNextStage: true,
  worthPursuing: true,
};

test("parses the exact emoji-prefixed questionnaire and its metadata", () => {
  const parsed = parseSalesPulseUpdate(realQuestionnaireUpdate);

  assert.equal(parsed.classification, "structured_questionnaire");
  assert.deepEqual(parsed.questionnaire, allTrue);
  assert.deepEqual(parsed.conflicts, []);
  assert.equal(parsed.updateId, "9876543210");
  assert.equal(parsed.authorId, "person-42");
  assert.equal(parsed.authorName, "Ari Sales");
  assert.equal(parsed.timestamp, "2026-07-29T09:42:17Z");
  assert.equal(parsed.body, realQuestionnaireUpdate.body);
  assert.equal(parsed.verdict, "Sales Qualified");
  assert.equal(parsed.notes, "Buyer requested a technical follow-up.");
  assert.equal(
    parsed.googleDocsUrl,
    "https://docs.google.com/document/d/1AbC_def-GhIJ23456789/edit?usp=sharing",
  );
  assert.equal(parsed.googleDocsDocumentId, "1AbC_def-GhIJ23456789");
});

test("accepts all supported emoji and written answer variations", () => {
  const parsed = parseQuestionnaire([
    "✅ Am I talking to the key decision-maker? Yes",
    "☑️ Is the person/company at least $5M in revenue? Y",
    "✔️ Are they spending at least $500K in marketing? True",
    "❌ Are they interested in continuing to the next stage? No",
    "✖️ Does the salesperson think they are worth pursuing? N",
  ]);

  assert.deepEqual(parsed.questionnaire, {
    decisionMaker: true,
    revenueAtLeast5m: true,
    marketingSpendAtLeast500k: true,
    interestedInNextStage: false,
    worthPursuing: false,
  });
});

test("uses null for missing and ambiguous answers", () => {
  const parsed = parseQuestionnaire([
    "Am I talking to the key decision-maker?",
    "Is the person/company at least $5M in revenue? Maybe",
    "Are they spending at least $500K in marketing? Yes or No",
  ]);

  assert.deepEqual(parsed.questionnaire, {
    decisionMaker: null,
    revenueAtLeast5m: null,
    marketingSpendAtLeast500k: null,
    interestedInNextStage: null,
    worthPursuing: null,
  });
});

test("handles malformed spacing, missing punctuation, and a single-line body", () => {
  const parsed = parseQuestionnaire([
    "✔ Am I   talking to the key decision maker Yes",
    "❌ Is the person / company at least 5m in revenue N",
    "Are they spending at least 500k in marketing: true",
  ].join(" "));

  assert.equal(parsed.questionnaire.decisionMaker, true);
  assert.equal(parsed.questionnaire.revenueAtLeast5m, false);
  assert.equal(parsed.questionnaire.marketingSpendAtLeast500k, true);
});

test("flags emoji and written-answer conflicts", () => {
  const parsed = parseQuestionnaire([
    "✅ Am I talking to the key decision-maker? No",
    "❌ Is the person/company at least $5M in revenue? True",
  ]);

  assert.equal(parsed.questionnaire.decisionMaker, null);
  assert.equal(parsed.questionnaire.revenueAtLeast5m, null);
  assert.deepEqual(parsed.conflicts, ["decisionMaker", "revenueAtLeast5m"]);
});

test("keeps a contradictory Sales Qualified verdict separate from answers", () => {
  const parsed = parseQuestionnaire([
    "✅ Am I talking to the key decision-maker? Yes",
    "✅ Is the person/company at least $5M in revenue? Yes",
    "✅ Are they spending at least $500K in marketing? Yes",
    "❌ Are they interested in continuing to the next stage? No",
    "❌ Does the salesperson think they are worth pursuing? False",
    "Verdict: Sales Qualified",
  ]);

  assert.equal(parsed.verdict, "Sales Qualified");
  assert.equal(parsed.questionnaire.interestedInNextStage, false);
  assert.equal(parsed.questionnaire.worthPursuing, false);
});

test("uses empty Google Docs fields when a questionnaire has no link", () => {
  const parsed = parseQuestionnaire([
    "✅ Am I talking to the key decision-maker? Yes",
  ]);

  assert.equal(parsed.googleDocsUrl, "");
  assert.equal(parsed.googleDocsDocumentId, "");
});

test("classifies and preserves a separate salesperson note", () => {
  const parsed = parseSalesPulseUpdate(salespersonNoteUpdate);

  assert.equal(parsed.classification, "salesperson_note");
  assert.equal(parsed.notes, "Procurement asked us to reconnect on Friday.");
  assert.equal(parsed.updateId, "note-100");
  assert.equal(parsed.authorId, "person-42");
  assert.equal(parsed.authorName, "Ari Sales");
  assert.equal(parsed.timestamp, "2026-07-29T10:15:00Z");
  assert.equal(parsed.body, salespersonNoteUpdate.body);
  assert.equal(parsed.googleDocsUrl, "https://docs.google.com/document/d/note_doc_456/edit");
});

test("preserves and separately parses multiple Monday updates", () => {
  const source = [
    realQuestionnaireUpdate,
    salespersonNoteUpdate,
    systemUpdate,
  ];
  const original = structuredClone(source);
  const result = preserveAndParseMondayUpdates(source);

  assert.deepEqual(source, original);
  assert.deepEqual(result.mondayUpdates, original);
  assert.notEqual(result.mondayUpdates, source);
  assert.deepEqual(
    result.salesPulseUpdates.map(({ classification }) => classification),
    [
      "structured_questionnaire",
      "salesperson_note",
      "unrelated_or_system_comment",
    ],
  );
});

test("classifies unrelated and system comments without treating them as notes", () => {
  const parsed = parseSalesPulseUpdate(systemUpdate);
  const unrelated = parseSalesPulseUpdate({
    id: "comment-300",
    created_at: "2026-07-29T11:00:00Z",
    creator: { id: "person-9", name: "Project Coordinator" },
    body: "<p>Thanks, received.</p>",
  });

  assert.equal(parsed.classification, "unrelated_or_system_comment");
  assert.equal(parsed.notes, "");
  assert.equal(unrelated.classification, "unrelated_or_system_comment");
});

function parseQuestionnaire(lines) {
  return parseSalesPulseUpdate({
    id: "fixture-update",
    created_at: "2026-07-30T00:00:00Z",
    creator: { id: "fixture-author", name: "Fixture Salesperson" },
    body: Array.isArray(lines) ? lines.join("\n") : lines,
  });
}
