import assert from "node:assert/strict";
import test from "node:test";
import { qualitySessionSchema } from "@/lib/quality-session-schema";
import { calculateQualityMetrics } from "@/lib/quality-metrics";
import { applyQualitySessionPatch, createQualitySession, qualityJudgmentKey, setQualityLabel, setQualityNote, touchQualitySession } from "@/lib/quality-session";
import type { ImportedQualityCollection } from "@/lib/types";

const imported: ImportedQualityCollection = {
  source: {
    datasetIds: ["dataset"],
    versions: ["2.3.10"],
    runIds: ["run"],
    systemName: "gpt-6-luna",
    sourceFiles: ["quality.json"],
    sourceFormat: "json",
    evaluationType: "quality",
  },
  stories: [{ storyId: "story-1", title: "Story", description: "Description", publicationKeys: ["pub-1", "pub-2"] }],
  items: {
    "pub-1": { key: "pub-1", sourceId: "pub-1", entityType: "publication", title: "One", text: "Text one", metadata: {} },
    "pub-2": { key: "pub-2", sourceId: "pub-2", entityType: "publication", title: "Two", text: "Text two", metadata: {} },
  },
};

test("quality sessions validate, track publication membership and calculate assignment precision", () => {
  let session = createQualitySession(imported, "Reviewer");
  const first = qualityJudgmentKey("story-1", "pub-1");
  const second = qualityJudgmentKey("story-1", "pub-2");
  session = setQualityLabel(session, first, "belongs");
  session = setQualityLabel(session, second, "not_belongs");
  session = setQualityNote(session, second, "Different event");

  assert.equal(qualitySessionSchema.safeParse(session).success, true);
  assert.equal(session.judgments[second].note, "Different event");
  assert.deepEqual(calculateQualityMetrics(session), {
    stories: 1,
    assignments: 2,
    reviewed: 2,
    pending: 0,
    belongs: 1,
    notBelongs: 1,
    uncertain: 0,
    determined: 2,
    assignmentPrecision: 0.5,
    fullyReviewedStories: 1,
  });
});

test("uncertain quality labels count toward coverage but are excluded from assignment precision", () => {
  let session = createQualitySession(imported, "Reviewer");
  session = setQualityLabel(session, qualityJudgmentKey("story-1", "pub-1"), "belongs");
  session = setQualityLabel(session, qualityJudgmentKey("story-1", "pub-2"), "uncertain");
  const metrics = calculateQualityMetrics(session);
  assert.equal(metrics.reviewed, 2);
  assert.equal(metrics.uncertain, 1);
  assert.equal(metrics.assignmentPrecision, 1);
});

test("touching a quality session updates its timestamp without changing annotations", () => {
  const session = {
    ...createQualitySession(imported, "Reviewer"),
    updatedAt: "2000-01-01T00:00:00.000Z",
  };
  const touched = touchQualitySession(session, "story-1");

  assert.ok(Date.parse(touched.updatedAt) > Date.parse(session.updatedAt));
  assert.equal(touched.currentStoryId, "story-1");
  assert.deepEqual(touched.judgments, session.judgments);
  assert.equal(touched.sessionId, session.sessionId);
});

test("compact quality patches update annotations and the active story without replacing source data", () => {
  const session = createQualitySession(imported, "Reviewer");
  const judgmentKey = qualityJudgmentKey("story-1", "pub-1");
  const patched = applyQualitySessionPatch(session, {
    sessionId: session.sessionId,
    currentStoryId: "story-1",
    judgments: [{ key: judgmentKey, humanLabel: "belongs", note: "Confirmed" }],
  });

  assert.equal(qualitySessionSchema.safeParse(patched).success, true);
  assert.equal(patched.currentStoryId, "story-1");
  assert.equal(patched.judgments[judgmentKey].humanLabel, "belongs");
  assert.equal(patched.judgments[judgmentKey].note, "Confirmed");
  assert.deepEqual(patched.items, session.items);
  assert.deepEqual(patched.stories, session.stories);
});

test("compact quality patches reject judgments outside the saved session", () => {
  const session = createQualitySession(imported, "Reviewer");
  assert.throws(() => applyQualitySessionPatch(session, {
    sessionId: session.sessionId,
    judgments: [{ key: "missing-judgment", humanLabel: "belongs" }],
  }), /Оценка публикации отсутствует/);
});

test("quality session schema still accepts sessions created before story position tracking", () => {
  const session = createQualitySession(imported, "Reviewer");
  const legacySession = { ...session };
  delete legacySession.currentStoryId;
  assert.equal(qualitySessionSchema.safeParse(legacySession).success, true);
});
