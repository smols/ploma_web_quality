import Papa from "papaparse";
import type {
  EntityType,
  ImportedCollection,
  ReviewGroup,
  ReviewItem,
  SessionSource,
} from "@/lib/types";

type CsvRow = Record<string, string | undefined>;

const EMPTY_META = "не указано";

function value(row: CsvRow, ...keys: string[]): string {
  for (const key of keys) {
    const found = row[key.toLowerCase()];
    if (found !== undefined && String(found).trim() !== "") return String(found).trim();
  }
  return "";
}

function normaliseRow(row: Record<string, unknown>): CsvRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, entry]) => [
      key.trim().toLowerCase().replace(/[\s-]+/g, "_"),
      entry == null ? "" : String(entry),
    ]),
  );
}

function safeKeyPart(value: string): string {
  return encodeURIComponent(value.trim() || EMPTY_META);
}

export function itemKey(
  entityType: EntityType,
  datasetId: string,
  version: string,
  sourceId: string,
): string {
  return [entityType, datasetId, version, sourceId].map(safeKeyPart).join("::");
}

function sourceFrom(rows: CsvRow[], fileName: string, format: "csv" | "json"): SessionSource {
  const datasets = new Set(rows.map((row) => value(row, "dataset_id", "datasetid", "dataset")));
  const versions = new Set(rows.map((row) => value(row, "version", "prompt_version", "model_version")));
  const runs = new Set(rows.map((row) => value(row, "run_id", "runid")));
  const versionList = [...versions].filter(Boolean).sort();
  const runList = [...runs].filter(Boolean).sort();
  const systems = new Set(rows.map((row) => value(row, "system_name", "model", "system")));
  return {
    datasetIds: [...datasets].filter(Boolean).sort(),
    versions: versionList,
    runIds: runList.length ? runList : versionList,
    systemName: [...systems].filter(Boolean).sort().join(", ") || "Импортированные группы",
    sourceFiles: [fileName],
    sourceFormat: format,
  };
}

function metadata(row: CsvRow): Record<string, string> {
  const excluded = new Set([
    "story_id", "story_id_a", "story_id_b", "publication_id", "publication_id_a",
    "publication_id_b", "item_id", "item_id_a", "item_id_b", "group_id", "group_type",
    "raw_id", "raw_id_a", "raw_id_b", "entity_type", "ai_label", "predicted_label",
    "ai_story_id_a", "ai_story_id_b", "pair_id",
    "story_ids", "publication_ids", "description", "description_a", "description_b",
    "plot_description", "post_text", "text", "title", "publication_title", "category",
    "text_a", "text_b", "title_a", "title_b", "published_at_a", "published_at_b",
    "source_a", "source_b", "url_a", "url_b", "model",
    "category_a", "category_b", "version", "dataset_id", "direction", "run_id",
  ]);
  return Object.entries(row).reduce<Record<string, string>>((result, [key, entry]) => {
    if (!excluded.has(key) && entry?.trim()) result[key] = entry.trim();
    return result;
  }, {});
}

function groupIdentity(
  datasetId: string,
  version: string,
  groupId: string,
  rowIndex: number,
): string {
  return `${safeKeyPart(datasetId)}::${safeKeyPart(version)}::${safeKeyPart(groupId)}::${rowIndex}`;
}

function makeItem(
  row: CsvRow,
  id: string,
  entityType: EntityType,
  datasetId: string,
  version: string,
  text: string,
  title = "",
  categoryOverride = "",
): ReviewItem {
  const category = categoryOverride || value(row, "category", "category_a", "publication_category");
  return {
    key: itemKey(entityType, datasetId, version, id),
    sourceId: id,
    entityType,
    title: title || undefined,
    text: text || "Текст не предоставлен.",
    category: category || undefined,
    metadata: metadata(row),
  };
}

function parseCsvRows(text: string): CsvRow[] {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase().replace(/[\s-]+/g, "_"),
  });
  const errors = parsed.errors.filter((error) => error.code !== "TooFewFields");
  if (errors.length) {
    throw new Error(`Не удалось прочитать CSV: ${errors[0].message}`);
  }
  const rows = parsed.data.map(normaliseRow).filter((row) => Object.values(row).some(Boolean));
  if (!rows.length) throw new Error("В CSV нет строк данных.");
  return rows;
}

function inferEntityType(row: CsvRow, fallback?: string): EntityType {
  const explicit = value(row, "entity_type", "entitytype", "item_type").toLowerCase();
  if (explicit === "publication" || explicit === "raw_publication") return "publication";
  if (explicit === "story") return "story";
  if (value(row, "publication_id", "publication_id_a", "publication_id_b")) return "publication";
  if (fallback === "publication") return "publication";
  return "story";
}

function fromPairRows(rows: CsvRow[], fileName: string): ImportedCollection {
  const items: Record<string, ReviewItem> = {};
  const groups: ReviewGroup[] = [];
  rows.forEach((row, index) => {
    const entityType = inferEntityType(row);
    const datasetId = value(row, "dataset_id", "datasetid") || EMPTY_META;
    const version = value(row, "version", "prompt_version") || "unversioned";
    const idA = value(row, "story_id_a", "publication_id_a", "raw_id_a", "item_id_a");
    const idB = value(row, "story_id_b", "publication_id_b", "raw_id_b", "item_id_b");
    if (!idA || !idB || idA === idB) return;
    const textA = value(row, "description_a", "plot_description_a", "post_text_a", "text_a");
    const textB = value(row, "description_b", "plot_description_b", "post_text_b", "text_b");
    const titleA = value(row, "title_a", "publication_title_a");
    const titleB = value(row, "title_b", "publication_title_b");
    const itemA = makeItem(row, idA, entityType, datasetId, version, textA, titleA, value(row, "category_a"));
    const itemB = makeItem(row, idB, entityType, datasetId, version, textB, titleB, value(row, "category_b"));
    items[itemA.key] ??= itemA;
    items[itemB.key] ??= itemB;
    const groupId = value(row, "group_id") || `${idA}__${idB}`;
    const aiLabelText = value(row, "ai_label", "predicted_label").toLowerCase();
    if (aiLabelText && aiLabelText !== "same" && aiLabelText !== "different") {
      throw new Error(`Неизвестная AI-метка в строке ${index + 2}: ${aiLabelText}`);
    }
    groups.push({
      id: groupIdentity(datasetId, version, groupId, index + 1),
      sourceGroupId: groupId,
      entityType,
      datasetId,
      version,
      runId: value(row, "run_id", "runid") || version,
      ...(aiLabelText ? { aiLabel: aiLabelText as "same" | "different" } : {}),
      memberKeys: [itemA.key, itemB.key],
      metadata: {
        ...metadata(row),
        ...(value(row, "category_a") ? { category_a: value(row, "category_a") } : {}),
        ...(value(row, "category_b") ? { category_b: value(row, "category_b") } : {}),
      },
    });
  });
  if (!groups.length) throw new Error("Не найдены пары с двумя разными ID.");
  return { source: sourceFrom(rows, fileName, "csv"), items, groups };
}

function fromMemberRows(rows: CsvRow[], fileName: string): ImportedCollection {
  const items: Record<string, ReviewItem> = {};
  const groupsById = new Map<string, ReviewGroup>();
  rows.forEach((row, index) => {
    const entityType = inferEntityType(row, value(row, "entity_type") as EntityType);
    const id = value(row, "story_id", "publication_id", "item_id");
    const rawGroupId = value(row, "group_id");
    if (!id || !rawGroupId) return;
    const datasetId = value(row, "dataset_id", "datasetid") || EMPTY_META;
    const version = value(row, "version", "prompt_version") || "unversioned";
    const groupType = value(row, "group_type") || "group";
    const compositeGroupId = `${version}::${datasetId}::${groupType}::${rawGroupId}`;
    const item = makeItem(
      row,
      id,
      entityType,
      datasetId,
      version,
      value(row, "description", "plot_description", "post_text", "text"),
      value(row, "title", "publication_title"),
    );
    items[item.key] ??= item;
    let group = groupsById.get(compositeGroupId);
    if (!group) {
      group = {
        id: groupIdentity(datasetId, version, `${groupType}::${rawGroupId}`, index + 1),
        sourceGroupId: rawGroupId,
        entityType,
        datasetId,
        version,
        runId: value(row, "run_id", "runid") || version,
        memberKeys: [],
        metadata: { ...metadata(row), group_type: groupType },
      };
      groupsById.set(compositeGroupId, group);
    }
    if (!group.memberKeys.includes(item.key)) group.memberKeys.push(item.key);
  });
  const groups = [...groupsById.values()].filter((group) => group.memberKeys.length >= 2);
  if (!groups.length) throw new Error("Не найдены группы как минимум из двух элементов.");
  return { source: sourceFrom(rows, fileName, "csv"), items, groups };
}

function splitMemberIds(value: string): string[] {
  return value
    .split(/\s*\|\|\s*|\s*;\s*|\s*,\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function fromCliqueRows(rows: CsvRow[], fileName: string): ImportedCollection {
  const items: Record<string, ReviewItem> = {};
  const groups: ReviewGroup[] = [];
  rows.forEach((row, index) => {
    const entityType = value(row, "publication_ids") ? "publication" : "story";
    const idText = value(row, "story_ids", "publication_ids", "member_ids");
    const ids = splitMemberIds(idText);
    if (ids.length < 2) return;
    const datasetId = value(row, "dataset_id", "datasetid") || EMPTY_META;
    const version = value(row, "version", "prompt_version") || "unversioned";
    const groupId = value(row, "group_id") || `group-${index + 1}`;
    const memberKeys = ids.map((id) => {
      const item = makeItem(row, id, entityType, datasetId, version, "Текст не предоставлен.");
      items[item.key] ??= item;
      return item.key;
    });
    groups.push({
      id: groupIdentity(datasetId, version, groupId, index + 1),
      sourceGroupId: groupId,
      entityType,
      datasetId,
      version,
      runId: value(row, "run_id", "runid") || version,
      memberKeys,
      metadata: {
        ...metadata(row),
        ...(value(row, "group_type") ? { group_type: value(row, "group_type") } : {}),
      },
    });
  });
  if (!groups.length) throw new Error("Не найдены группы с двумя или более ID.");
  return { source: sourceFrom(rows, fileName, "csv"), items, groups };
}

function fromGenericJson(text: string, fileName: string): ImportedCollection {
  const input = JSON.parse(text) as Record<string, unknown>;
  if (!Array.isArray(input.groups)) {
    throw new Error("JSON должен содержать массив groups.");
  }
  const fallbackDataset = String(input.datasetId ?? input.dataset_id ?? EMPTY_META);
  const fallbackVersion = String(input.version ?? input.promptVersion ?? "unversioned");
  const fallbackRun = String(input.runId ?? "imported");
  const items: Record<string, ReviewItem> = {};
  const groups: ReviewGroup[] = [];
  for (const [index, raw] of input.groups.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const group = raw as Record<string, unknown>;
    const datasetId = String(group.datasetId ?? fallbackDataset);
    const version = String(group.version ?? fallbackVersion);
    const runId = String(group.runId ?? fallbackRun);
    const entityType = group.entityType === "publication" ? "publication" : "story";
    const members = Array.isArray(group.members) ? group.members : [];
    const memberKeys: string[] = [];
    for (const memberValue of members) {
      const member = typeof memberValue === "string"
        ? { id: memberValue }
        : (memberValue as Record<string, unknown>);
      if (!member || typeof member !== "object") continue;
      const id = String(member.id ?? member.itemId ?? "").trim();
      if (!id) continue;
      const item: ReviewItem = {
        key: itemKey(entityType, datasetId, version, id),
        sourceId: id,
        entityType,
        title: member.title ? String(member.title) : undefined,
        text: String(member.text ?? member.description ?? "Текст не предоставлен."),
        category: member.category ? String(member.category) : undefined,
        metadata: {},
      };
      items[item.key] ??= item;
      memberKeys.push(item.key);
    }
    if (memberKeys.length < 2) continue;
    const sourceGroupId = String(group.groupId ?? group.id ?? `group-${index + 1}`);
    groups.push({
      id: groupIdentity(datasetId, version, sourceGroupId, index + 1),
      sourceGroupId,
      entityType,
      datasetId,
      version,
      runId,
      memberKeys,
      metadata: {},
    });
  }
  if (!groups.length) throw new Error("В JSON нет валидных групп с двумя или более элементами.");
  const source: SessionSource = {
    datasetIds: [...new Set(groups.map((group) => group.datasetId))].sort(),
    versions: [...new Set(groups.map((group) => group.version))].sort(),
    runIds: [...new Set(groups.map((group) => group.runId))].sort(),
    systemName: String(input.systemName ?? input.model ?? "Импортированные группы"),
    sourceFiles: [fileName],
    sourceFormat: "json",
  };
  return { source, items, groups };
}

export function parseReviewInput(fileName: string, text: string): ImportedCollection {
  if (fileName.toLowerCase().endsWith(".json")) return fromGenericJson(text, fileName);
  const rows = parseCsvRows(text);
  const first = rows[0];
  if (value(first, "story_id_a", "publication_id_a", "raw_id_a", "item_id_a") &&
      value(first, "story_id_b", "publication_id_b", "raw_id_b", "item_id_b")) {
    return fromPairRows(rows, fileName);
  }
  if (value(first, "story_ids", "publication_ids", "member_ids")) {
    return fromCliqueRows(rows, fileName);
  }
  if (value(first, "group_id") && value(first, "story_id", "publication_id", "item_id")) {
    return fromMemberRows(rows, fileName);
  }
  throw new Error(
    "Неизвестный CSV. Нужны пары (story_id_a/story_id_b), cliques (story_ids) или строки group_id + story_id/publication_id/item_id.",
  );
}

export function selectImportedVersion(
  imported: ImportedCollection,
  version: string,
): ImportedCollection {
  const groups = imported.groups.filter((group) => group.version === version);
  if (!groups.length) throw new Error(`В загруженном файле нет групп версии ${version}.`);
  const memberKeys = new Set(groups.flatMap((group) => group.memberKeys));
  const items = Object.fromEntries(
    Object.entries(imported.items).filter(([key]) => memberKeys.has(key)),
  );
  return {
    source: {
      ...imported.source,
      datasetIds: [...new Set(groups.map((group) => group.datasetId))].sort(),
      versions: [version],
      runIds: [...new Set(groups.map((group) => group.runId))].sort(),
    },
    items,
    groups,
  };
}
