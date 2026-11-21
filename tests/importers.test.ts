import assert from "node:assert/strict";
import test from "node:test";
import { parseReviewInput, selectImportedVersion } from "@/lib/importers";
import { createReviewSession, groupPairs } from "@/lib/session";

test("parseReviewInput imports a pair-cases CSV and preserves descriptions and version", () => {
    const csv = [
      "version,dataset_id,story_id_a,story_id_b,description_a,description_b,category_a",
      '2.2.0,october,story-a,story-b,"Water issue in Anse Royale, Seychelles.","Water interruption in Anse Royale.",Water & Electricity',
    ].join("\n");
    const imported = parseReviewInput("story_duplicate_cases.csv", csv);
    assert.equal(imported.groups.length, 1);
    assert.equal(imported.groups[0].memberKeys.length, 2);
    assert.equal(imported.groups[0].version, "2.2.0");
    assert.deepEqual(imported.source.runIds, ["2.2.0"]);
    assert.ok(Object.values(imported.items).some((item) => item.text.includes("Anse Royale, Seychelles")));
});

test("pair exports preserve AI labels and support raw publication IDs", () => {
  const csv = [
    "version,dataset_id,run_id,model,entity_type,group_id,ai_label,raw_id_a,raw_id_b,title_a,text_a,title_b,text_b,ai_story_id_a,ai_story_id_b",
    "2.3.10,october,raw-run,gpt-6-luna,publication,pair-1,same,101,102,Title A,Text A,Title B,Text B,story-1,story-1",
  ].join("\n");
  const imported = parseReviewInput("pairs.csv", csv);
  assert.equal(imported.groups[0].entityType, "publication");
  assert.equal(imported.groups[0].aiLabel, "same");
  assert.equal(imported.groups[0].runId, "raw-run");
  assert.deepEqual(Object.values(imported.items).map((item) => item.sourceId).sort(), ["101", "102"]);
  assert.ok(Object.values(imported.items).some((item) => item.text === "Text A" && item.title === "Title A"));
});

test("parseReviewInput groups group-members CSV rows and supports publication IDs", () => {
    const csv = [
      "group_id,group_type,publication_id,publication_title,post_text,dataset_id,version",
      "grp-1,maximal,pub-1,One,First text,october,2.3.10",
      "grp-1,maximal,pub-2,Two,Second text,october,2.3.10",
      "grp-1,maximal,pub-3,Three,Third text,october,2.3.10",
    ].join("\n");
    const imported = parseReviewInput("publication_groups.csv", csv);
    assert.equal(imported.groups.length, 1);
    assert.equal(imported.groups[0].entityType, "publication");
    assert.equal(groupPairs(imported.groups[0]).length, 3);
});

test("parseReviewInput imports generic JSON groups with three members", () => {
    const json = JSON.stringify({
      datasetId: "ds-1",
      version: "2.3.10",
      groups: [{ groupId: "triplet", entityType: "story", members: ["s1", "s2", "s3"] }],
    });
    const imported = parseReviewInput("groups.json", json);
    const session = createReviewSession(imported, "Reviewer One");
    assert.equal(session.annotatorName, "Reviewer One");
    assert.equal(Object.keys(session.judgments).length, 3);
});

test("parseReviewInput rejects malformed CSV without recognized grouping columns", () => {
  assert.throws(() => parseReviewInput("bad.csv", "id,text\n1,hello"), /Неизвестный CSV/);
});

test("selectImportedVersion separates versions into independently saveable sessions", () => {
    const csv = [
      "version,dataset_id,story_id_a,story_id_b,description_a,description_b",
      "2.1.0,ds,old-a,old-b,Old A,Old B",
      "2.2.0,ds,new-a,new-b,New A,New B",
    ].join("\n");
    const imported = parseReviewInput("multi-version-pairs.csv", csv);
    const selected = selectImportedVersion(imported, "2.2.0");
    assert.deepEqual(selected.source.versions, ["2.2.0"]);
    assert.equal(selected.groups.length, 1);
    assert.deepEqual(Object.values(selected.items).map((item) => item.sourceId).sort(), ["new-a", "new-b"]);
});
