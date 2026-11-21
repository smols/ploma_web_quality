import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { reviewSessionSchema } from "@/lib/session-schema";
import { qualitySessionSchema } from "@/lib/quality-session-schema";
import type { QualityReviewSession, ReviewSession, SessionSummary } from "@/lib/types";

const DATA_ROOT = path.join(process.cwd(), "data");

export function safeSegment(input: string, fallback: string): string {
  const slug = input
    .normalize("NFKC")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  return slug || fallback;
}

export function sessionFilePath(session: ReviewSession, root = DATA_ROOT): string {
  const dataset = session.source.datasetIds.length === 1
    ? session.source.datasetIds[0]
    : "multiple-datasets";
  const version = session.source.versions.length === 1
    ? session.source.versions[0]
    : "multiple-versions";
  const run = session.source.runIds.length === 1
    ? session.source.runIds[0]
    : "multiple-runs";
  return path.join(
    root,
    safeSegment(dataset, "unversioned-dataset"),
    safeSegment(version, "unversioned"),
    safeSegment(run, "imported-run"),
    `${session.sessionId}.json`,
  );
}

export function qualitySessionFilePath(session: QualityReviewSession, root = DATA_ROOT): string {
  const dataset = session.source.datasetIds.length === 1
    ? session.source.datasetIds[0]
    : "multiple-datasets";
  const version = session.source.versions.length === 1
    ? session.source.versions[0]
    : "multiple-versions";
  const run = session.source.runIds.length === 1
    ? session.source.runIds[0]
    : "multiple-runs";
  return path.join(
    root,
    safeSegment(dataset, "unversioned-dataset"),
    safeSegment(version, "unversioned"),
    safeSegment(run, "imported-run"),
    `${session.sessionId}.json`,
  );
}

export async function saveSession(sessionValue: unknown): Promise<{ relativePath: string; updatedAt: string }> {
  const session = reviewSessionSchema.parse(sessionValue) as ReviewSession;
  const updatedAt = new Date().toISOString();
  const value = { ...session, updatedAt };
  const target = sessionFilePath(value);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
  return { relativePath: path.relative(DATA_ROOT, target), updatedAt };
}

export async function saveQualitySession(sessionValue: unknown): Promise<{ relativePath: string; updatedAt: string }> {
  const session = qualitySessionSchema.parse(sessionValue) as QualityReviewSession;
  const updatedAt = new Date().toISOString();
  const value = { ...session, updatedAt };
  const target = qualitySessionFilePath(value);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
  return { relativePath: path.relative(DATA_ROOT, target), updatedAt };
}

async function collectJsonFiles(directory = DATA_ROOT): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJsonFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(fullPath);
  }
  return files;
}

async function readValidated(pathname: string): Promise<ReviewSession | null> {
  try {
    const raw = JSON.parse(await readFile(pathname, "utf8"));
    const parsed = reviewSessionSchema.safeParse(raw);
    return parsed.success ? parsed.data as ReviewSession : null;
  } catch {
    return null;
  }
}

async function readValidatedQuality(pathname: string): Promise<QualityReviewSession | null> {
  try {
    const raw = JSON.parse(await readFile(pathname, "utf8"));
    const parsed = qualitySessionSchema.safeParse(raw);
    return parsed.success ? parsed.data as QualityReviewSession : null;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  const files = await collectJsonFiles();
  const summaries = await Promise.all(files.map(async (file) => {
    const session = await readValidated(file);
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      annotatorName: session.annotatorName,
      datasetIds: session.source.datasetIds,
      versions: session.source.versions,
      runIds: session.source.runIds,
      sourceFiles: session.source.sourceFiles,
      groupCount: session.groups.length,
      itemCount: Object.keys(session.items).length,
      updatedAt: session.updatedAt,
      relativePath: path.relative(DATA_ROOT, file),
      evaluationType: session.source.evaluationType ?? "doubles",
    } satisfies SessionSummary;
  }));
  return summaries
    .filter((summary): summary is NonNullable<typeof summary> => summary !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listQualitySessions(): Promise<SessionSummary[]> {
  const files = await collectJsonFiles();
  const summaries = await Promise.all(files.map(async (file) => {
    const session = await readValidatedQuality(file);
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      annotatorName: session.annotatorName,
      datasetIds: session.source.datasetIds,
      versions: session.source.versions,
      runIds: session.source.runIds,
      sourceFiles: session.source.sourceFiles,
      groupCount: session.stories.length,
      itemCount: Object.keys(session.items).length,
      updatedAt: session.updatedAt,
      relativePath: path.relative(DATA_ROOT, file),
      evaluationType: "quality" as const,
    } satisfies SessionSummary;
  }));
  return summaries
    .filter((summary): summary is NonNullable<typeof summary> => summary !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadSession(sessionId: string): Promise<ReviewSession | null> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const files = await collectJsonFiles();
  for (const file of files) {
    if (path.basename(file, ".json") !== sessionId) continue;
    return readValidated(file);
  }
  return null;
}

export async function loadQualitySession(sessionId: string): Promise<QualityReviewSession | null> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const files = await collectJsonFiles();
  for (const file of files) {
    if (path.basename(file, ".json") !== sessionId) continue;
    return readValidatedQuality(file);
  }
  return null;
}
