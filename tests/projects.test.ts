import assert from "node:assert/strict";
import test from "node:test";
import { listReviewProjects, loadReviewProject } from "@/lib/projects";

test("project catalog discovers the 2.3.10 raw classification pair export", async () => {
  const projects = await listReviewProjects();
  const project = projects.find((candidate) => candidate.id === "seish-october-2.3.10-raw-story-classification");
  assert.ok(project);
  assert.equal(project.version, "2.3.10");
  assert.equal(project.counts?.pairs, 400);

  const loaded = await loadReviewProject(project.id);
  assert.ok(loaded);
  assert.ok(loaded.imported);
  assert.equal(loaded.imported.groups.length, 400);
  assert.equal(loaded.imported.groups.filter((group) => group.aiLabel === "same").length, 200);
  assert.equal(loaded.imported.groups.filter((group) => group.aiLabel === "different").length, 200);
});

test("project loader rejects path-like IDs", async () => {
  assert.equal(await loadReviewProject("../outside"), null);
});

test("quality catalog loads the 50-story sample and all attached publications", async () => {
  const projects = await listReviewProjects();
  const project = projects.find((candidate) => candidate.id === "seish-october-2.3.10-raw-quality-50");
  assert.ok(project);
  assert.equal(project.counts?.stories, 50);
  assert.equal(project.counts?.publications, 111);

  const loaded = await loadReviewProject(project.id);
  assert.ok(loaded?.qualityData);
  assert.equal(loaded.qualityData.stories.length, 50);
  assert.equal(Object.keys(loaded.qualityData.items).length, 111);
  assert.equal(loaded.project.evaluationType, "quality");
});

test("quality catalog loads the 200-story sample filtered to multiple publications", async () => {
  const projects = await listReviewProjects();
  const project = projects.find((candidate) => candidate.id === "seish-october-2.3.10-raw-quality-200-multipub");
  assert.ok(project);
  assert.equal(project.counts?.stories, 200);
  assert.equal(project.counts?.minimumPublicationsPerStory, 2);

  const loaded = await loadReviewProject(project.id);
  assert.ok(loaded?.qualityData);
  assert.equal(loaded.qualityData.stories.length, 200);
  assert.equal(Object.keys(loaded.qualityData.items).length, project.counts?.publications);
  assert.ok(loaded.qualityData.stories.every((story) => story.publicationKeys.length >= 2));
});

test("quality catalog loads the 100-story sample filtered to multiple publications", async () => {
  const projects = await listReviewProjects();
  const project = projects.find((candidate) => candidate.id === "seish-october-2.3.10-raw-quality-100-multipub");
  assert.ok(project);
  assert.equal(project.counts?.stories, 100);
  assert.equal(project.counts?.publications, 721);
  assert.equal(project.counts?.minimumPublicationsPerStory, 2);

  const loaded = await loadReviewProject(project.id);
  assert.ok(loaded?.qualityData);
  assert.equal(loaded.qualityData.stories.length, 100);
  assert.equal(Object.keys(loaded.qualityData.items).length, 721);
  assert.ok(loaded.qualityData.stories.every((story) => story.publicationKeys.length >= 2));
});
