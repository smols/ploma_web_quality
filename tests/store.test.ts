import assert from "node:assert/strict";
import test from "node:test";
import { sessionFilePath, safeSegment } from "@/lib/store";
import { createReviewSession } from "@/lib/session";
import { parseReviewInput } from "@/lib/importers";

test("versioned local storage uses dataset/version/run/session folders and sanitizes path segments", () => {
    const imported = parseReviewInput("pairs.csv", [
      "version,dataset_id,run_id,story_id_a,story_id_b",
      "2.3.10,seish-october-ds,raw-run,s1,s2",
    ].join("\n"));
    const session = createReviewSession(imported, "Reviewer");
    const file = sessionFilePath(session, "/tmp/story-review");
    assert.ok(file.includes("/seish-october-ds/2.3.10/raw-run/"));
    assert.ok(file.endsWith(`${session.sessionId}.json`));
    assert.ok(!safeSegment("../../outside", "fallback").includes(".."));
});
