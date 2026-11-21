import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseReviewInput } from "@/lib/importers";
import { parseQualityExport } from "@/lib/quality-importer";
import { calculateCandidateMetrics, type CandidateMetrics } from "@/lib/metrics";
import { calculateQualityMetrics, type QualityMetrics } from "@/lib/quality-metrics";
import {
  listQualitySessions,
  listSessions,
  loadQualitySession,
  loadSession,
} from "@/lib/store";
import type { EvaluationType, ImportedCollection, ImportedQualityCollection, SessionSummary } from "@/lib/types";

const EXPORTS_ROOT = path.join(process.cwd(), "exports");
const projectIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const evaluationTypes: EvaluationType[] = ["doubles", "quality"];

const projectManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(projectIdPattern),
  evaluationType: z.enum(["doubles", "quality"]).optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  datasetId: z.string().min(1),
  version: z.string().min(1),
  runId: z.string().min(1),
  systemName: z.string().min(1),
  sourceFile: z.string().regex(/^[a-zA-Z0-9._-]+\.(csv|json)$/),
  promptSha256: z.string().optional(),
  sourceDatabase: z.string().optional(),
  createdAt: z.string().optional(),
  runStatus: z.string().optional(),
  scopeNote: z.string().optional(),
  counts: z.record(z.string(), z.number().nonnegative()).optional(),
});

export type ReviewProject = Omit<z.infer<typeof projectManifestSchema>, "evaluationType"> & {
  evaluationType: EvaluationType;
};

export interface ReviewProjectWithData {
  project: ReviewProject;
  imported?: ImportedCollection;
  qualityData?: ImportedQualityCollection;
}

export type ProjectMetrics = CandidateMetrics | QualityMetrics;

export interface ProjectReviewResult {
  summary: SessionSummary;
  metrics: CandidateMetrics | QualityMetrics;
}

export async function listReviewProjects(): Promise<ReviewProject[]> {
  const projects: ReviewProject[] = [];
  for (const evaluationType of evaluationTypes) {
    let entries;
    try {
      entries = await readdir(path.join(EXPORTS_ROOT, evaluationType), { withFileTypes: true });
    } catch {
      continue;
    }
    const found = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && projectIdPattern.test(entry.name))
      .map(async (entry) => readProjectManifest(entry.name, evaluationType)));
    projects.push(...found.filter((project): project is ReviewProject => project !== null));
  }
  return projects.sort((a, b) => b.createdAt?.localeCompare(a.createdAt ?? "") || a.title.localeCompare(b.title));
}

async function readProjectManifest(projectId: string, expectedType?: EvaluationType): Promise<ReviewProject | null> {
  if (!projectIdPattern.test(projectId)) return null;
  const types = expectedType ? [expectedType] : evaluationTypes;
  for (const type of types) {
    try {
      const manifestPath = path.join(EXPORTS_ROOT, type, projectId, "manifest.json");
      const parsed = projectManifestSchema.safeParse(JSON.parse(await readFile(manifestPath, "utf8")));
      if (!parsed.success || parsed.data.id !== projectId) continue;
      const evaluationType = parsed.data.evaluationType ?? type;
      if (evaluationType !== type) continue;
      return { ...parsed.data, evaluationType };
    } catch {
      // Continue in case the same project ID is present under the other type.
    }
  }
  return null;
}

export async function loadReviewProject(projectId: string): Promise<ReviewProjectWithData | null> {
  const project = await readProjectManifest(projectId);
  if (!project) return null;
  try {
    const folder = path.join(EXPORTS_ROOT, project.evaluationType, projectId);
    const sourcePath = path.join(folder, project.sourceFile);
    if (path.dirname(sourcePath) !== folder) return null;
    const content = await readFile(sourcePath, "utf8");
    if (project.evaluationType === "quality") {
      return {
        project,
        qualityData: parseQualityExport(project.sourceFile, content, project),
      };
    }
    return { project, imported: parseReviewInput(project.sourceFile, content) };
  } catch {
    return null;
  }
}

function matchesProject(summary: SessionSummary, project: ReviewProject): boolean {
  return summary.datasetIds.includes(project.datasetId) &&
    summary.versions.includes(project.version) &&
    summary.runIds.includes(project.runId) &&
    (summary.evaluationType ?? "doubles") === project.evaluationType;
}

export async function listProjectReviewResults(projectId: string): Promise<{
  project: ReviewProject;
  results: ProjectReviewResult[];
} | null> {
  const project = await readProjectManifest(projectId);
  if (!project) return null;
  if (project.evaluationType === "quality") {
    const summaries = (await listQualitySessions()).filter((summary) => matchesProject(summary, project));
    const results = await Promise.all(summaries.map(async (summary) => {
      const session = await loadQualitySession(summary.sessionId);
      if (!session) return null;
      return { summary, metrics: calculateQualityMetrics(session) };
    }));
    return {
      project,
      results: results.filter((result): result is { summary: SessionSummary; metrics: QualityMetrics } => result !== null),
    };
  }

  const summaries = (await listSessions()).filter((summary) => matchesProject(summary, project));
  const results = await Promise.all(summaries.map(async (summary) => {
    const session = await loadSession(summary.sessionId);
    if (!session) return null;
    return { summary, metrics: calculateCandidateMetrics(session) };
  }));
  return {
    project,
    results: results.filter((result): result is { summary: SessionSummary; metrics: CandidateMetrics } => result !== null),
  };
}
