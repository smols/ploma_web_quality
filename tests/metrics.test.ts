import assert from "node:assert/strict";
import test from "node:test";
import { parseReviewInput } from "@/lib/importers";
import { calculateCandidateMetrics } from "@/lib/metrics";
import { setGroupPairsLabel, setPairLabel, groupPairs, createReviewSession } from "@/lib/session";

test("candidate metrics track pair labels and do not claim complete F1 for candidate-only groups", () => {
    const imported = parseReviewInput("groups.json", JSON.stringify({
      datasetId: "ds",
      version: "2.1.0",
      groups: [{ groupId: "g", members: ["a", "b", "c"] }],
    }));
    let session = createReviewSession(imported, "Reviewer");
    const group = session.groups[0];
    session = setGroupPairsLabel(session, group.id, "same");
    const firstPair = groupPairs(group)[0];
    session = setPairLabel(session, firstPair.key, "different");

    const metrics = calculateCandidateMetrics(session);
    assert.equal(metrics.candidatePairs, 3);
    assert.equal(metrics.same, 2);
    assert.equal(metrics.different, 1);
    assert.ok(Math.abs((metrics.precision ?? 0) - 2 / 3) < 1e-10);
    assert.equal(metrics.f1, null);
    assert.match(metrics.f1Message, /AI-меток same\/different/);
});

test("pairwise F1 compares AI predictions with human labels and excludes uncertain pairs", () => {
  const csv = [
    "version,dataset_id,run_id,entity_type,group_id,ai_label,raw_id_a,raw_id_b,text_a,text_b",
    "2.3.10,october,raw-run,publication,tp,same,a,b,A,B",
    "2.3.10,october,raw-run,publication,fp,same,c,d,C,D",
    "2.3.10,october,raw-run,publication,fn,different,e,f,E,F",
    "2.3.10,october,raw-run,publication,tn,different,g,h,G,H",
    "2.3.10,october,raw-run,publication,uncertain,same,i,j,I,J",
  ].join("\n");
  const imported = parseReviewInput("ai-human-pairs.csv", csv);
  let session = createReviewSession(imported, "Reviewer");
  const humanLabels = ["same", "different", "same", "different", "uncertain"] as const;
  for (const [index, group] of session.groups.entries()) {
    const pair = groupPairs(group)[0];
    session = setPairLabel(session, pair.key, humanLabels[index]);
  }

  const metrics = calculateCandidateMetrics(session);
  assert.equal(metrics.truePositive, 1);
  assert.equal(metrics.falsePositive, 1);
  assert.equal(metrics.falseNegative, 1);
  assert.equal(metrics.trueNegative, 1);
  assert.equal(metrics.aiLabeledPairs, 5);
  assert.equal(metrics.evaluatedPairs, 4);
  assert.equal(metrics.precision, 0.5);
  assert.equal(metrics.recall, 0.5);
  assert.equal(metrics.f1, 0.5);
  assert.equal(metrics.accuracy, 0.5);
});
