import { z } from "zod";

const stringRecord = z.record(z.string(), z.string());

const reviewItemSchema = z.object({
  key: z.string().min(1),
  sourceId: z.string().min(1),
  entityType: z.enum(["story", "publication"]),
  title: z.string().optional(),
  text: z.string(),
  category: z.string().optional(),
  metadata: stringRecord,
}).strict();

const reviewGroupSchema = z.object({
  id: z.string().min(1),
  sourceGroupId: z.string().min(1),
  entityType: z.enum(["story", "publication"]),
  datasetId: z.string().min(1),
  version: z.string().min(1),
  runId: z.string().min(1),
  aiLabel: z.enum(["same", "different"]).optional(),
  memberKeys: z.array(z.string()).min(2),
  metadata: stringRecord,
}).strict();

const judgmentSchema = z.object({
  key: z.string().min(1),
  itemKeyA: z.string().min(1),
  itemKeyB: z.string().min(1),
  humanLabel: z.enum(["same", "different", "uncertain"]).nullable(),
  note: z.string(),
  updatedAt: z.string().datetime().nullable(),
}).strict();

export const reviewSessionSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().uuid(),
  annotatorName: z.string().trim().min(1).max(120),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  source: z.object({
    datasetIds: z.array(z.string()),
    versions: z.array(z.string()),
    runIds: z.array(z.string()),
    systemName: z.string(),
    sourceFiles: z.array(z.string()),
    sourceFormat: z.enum(["csv", "json"]),
  }).strict(),
  items: z.record(z.string(), reviewItemSchema),
  groups: z.array(reviewGroupSchema).min(1),
  judgments: z.record(z.string(), judgmentSchema),
}).strict().superRefine((session, context) => {
  for (const [index, group] of session.groups.entries()) {
    if (group.memberKeys.some((key) => !session.items[key])) {
      context.addIssue({
        code: "custom",
        path: ["groups", index, "memberKeys"],
        message: "Группа ссылается на неизвестный элемент.",
      });
    }
  }
  for (const [key, judgment] of Object.entries(session.judgments)) {
    if (key !== judgment.key || !session.items[judgment.itemKeyA] || !session.items[judgment.itemKeyB]) {
      context.addIssue({
        code: "custom",
        path: ["judgments", key],
        message: "Оценка пары ссылается на неизвестный элемент или имеет неверный ключ.",
      });
    }
  }
});

export type ValidReviewSession = z.infer<typeof reviewSessionSchema>;
