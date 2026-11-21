import Link from "next/link";
import { notFound } from "next/navigation";
import { loadReviewProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const loaded = await loadReviewProject(projectId);
  if (!loaded) notFound();
  const { project, imported } = loaded;
  const storyCount = loaded.qualityData?.stories.length ?? imported?.groups.length ?? 0;
  const itemCount = Object.keys(loaded.qualityData?.items ?? imported?.items ?? {}).length;
  const unitLabel = project.evaluationType === "quality" ? "сюжетов" : "групп пар-кандидатов";
  const annotationHref = project.evaluationType === "quality"
    ? `/quality-review?projectId=${encodeURIComponent(project.id)}`
    : `/review?projectId=${encodeURIComponent(project.id)}`;

  return (
    <main className="shell">
      <header className="masthead">
        <div><div className="brandline">Проект · {project.version}</div><h1>{project.title}</h1><p className="muted">{project.description}</p></div>
        <span className="local-pill">Работает на localhost</span>
      </header>
      <div className="button-row"><Link className="button small" href="/">← Все проекты</Link></div>
      <section className="panel">
        <div className="grid-3">
          <div className="kpi"><strong>{storyCount}</strong><span>{unitLabel}</span></div>
          <div className="kpi"><strong>{itemCount}</strong><span>{project.evaluationType === "quality" ? "публикаций" : "уникальных записей"}</span></div>
          <div className="kpi"><strong>{project.version}</strong><span>версия промпта</span></div>
        </div>
        <p><strong>Запуск:</strong> <code>{project.runId}</code></p>
        <p><strong>Тип проверки:</strong> {project.evaluationType === "quality" ? "Качество публикаций в сюжетах" : "Поиск дублей"}</p>
        {project.runStatus && <p><strong>Статус запуска:</strong> {project.runStatus}</p>}
        <p><strong>Источник:</strong> <code>{project.sourceDatabase ?? project.datasetId}</code></p>
        {project.scopeNote && <div className="notice"><strong>Охват выборки</strong><p>{project.scopeNote}</p></div>}
        <div className="project-actions">
          <Link className="button primary" href={`/projects/${encodeURIComponent(project.id)}/results`}>Посмотреть результаты</Link>
          <Link className="button" href={annotationHref}>Разметить человеком</Link>
        </div>
      </section>
    </main>
  );
}
