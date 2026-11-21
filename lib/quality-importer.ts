import { itemKey } from "@/lib/importers";
import type { ImportedQualityCollection, ReviewItem, SessionSource } from "@/lib/types";

interface QualityProjectDefaults {
  datasetId: string;
  version: string;
  runId: string;
  systemName: string;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function textValue(value: unknown): string {
  return value == null ? "" : String(value);
}

export function parseQualityExport(
  fileName: string,
  text: string,
  defaults: QualityProjectDefaults,
): ImportedQualityCollection {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Quality-выгрузка должна быть корректным JSON.");
  }
  const input = asObject(raw);
  if (input.schemaVersion !== 1 || input.evaluationType !== "quality" || !Array.isArray(input.stories)) {
    throw new Error("В quality-выгрузке ожидаются schemaVersion=1, evaluationType=quality и массив stories.");
  }
  const datasetId = stringValue(input.datasetId) || defaults.datasetId;
  const version = stringValue(input.version) || defaults.version;
  const runId = stringValue(input.runId) || defaults.runId;
  const systemName = stringValue(input.systemName) || defaults.systemName;
  const items: Record<string, ReviewItem> = {};
  const stories: ImportedQualityCollection["stories"] = [];
  const seenStories = new Set<string>();

  for (const [storyIndex, storyValue] of input.stories.entries()) {
    const story = asObject(storyValue);
    const storyId = stringValue(story.storyId ?? story.story_id);
    if (!storyId || seenStories.has(storyId)) throw new Error(`Пустой или повторяющийся storyId в строке ${storyIndex + 1}.`);
    if (!Array.isArray(story.publications) || story.publications.length === 0) {
      throw new Error(`У сюжета ${storyId} нет publications.`);
    }
    seenStories.add(storyId);
    const publicationKeys: string[] = [];
    for (const publicationValue of story.publications) {
      const publication = asObject(publicationValue);
      const publicationId = stringValue(publication.publicationId ?? publication.publication_id ?? publication.rawId ?? publication.raw_id);
      if (!publicationId) throw new Error(`Пустой publicationId в сюжете ${storyId}.`);
      const key = itemKey("publication", datasetId, version, publicationId);
      if (items[key]) throw new Error(`Публикация ${publicationId} встречается в нескольких сюжетах выгрузки.`);
      const text = textValue(publication.text ?? publication.postText ?? publication.post_text);
      const metadata: Record<string, string> = {};
      for (const field of ["publishedAt", "published_at", "source", "url", "rawId", "raw_id"]) {
        const value = stringValue(publication[field]);
        if (value) metadata[field] = value;
      }
      items[key] = {
        key,
        sourceId: publicationId,
        entityType: "publication",
        title: stringValue(publication.title ?? publication.publicationTitle ?? publication.publication_title) || undefined,
        text: text.trim() ? text : "Текст не предоставлен.",
        category: stringValue(publication.category) || undefined,
        metadata,
      };
      publicationKeys.push(key);
    }
    stories.push({
      storyId,
      title: stringValue(story.title ?? story.storyTitle ?? story.story_title),
      description: stringValue(story.description ?? story.storyDescription ?? story.story_description),
      category: stringValue(story.category) || undefined,
      publicationKeys,
    });
  }
  if (!stories.length) throw new Error("В quality-выгрузке нет сюжетов для проверки.");

  const source: SessionSource = {
    datasetIds: [datasetId],
    versions: [version],
    runIds: [runId],
    systemName,
    sourceFiles: [fileName],
    sourceFormat: "json",
    evaluationType: "quality",
  };
  return { source, stories, items };
}
