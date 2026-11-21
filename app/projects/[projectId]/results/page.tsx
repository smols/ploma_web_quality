import Link from "next/link";
import { notFound } from "next/navigation";
import { listProjectReviewResults } from "@/lib/projects";

export const dynamic = "force-dynamic";

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export default async function ProjectResultsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const output = await listProjectReviewResults(projectId);
  if (!output) notFound();
  const { project, results } = output;

  return (
    <main className="shell">
      <header className="masthead">
        <div><div className="brandline">Результаты человеческой разметки</div><h1>{project.title}</h1><p className="muted">{project.evaluationType === "quality" ? "Проверка корректности публикаций, назначенных в сюжет." : "F1 сравнивает AI-предсказание пары с человеческой меткой на одной и той же размеченной выборке."}</p></div>
        <span className="local-pill">Работает на localhost</span>
      </header>
      <div className="button-row"><Link className="button small" href={`/projects/${encodeURIComponent(project.id)}`}>← Проект</Link><Link className="button primary" href={project.evaluationType === "quality" ? `/quality-review?projectId=${encodeURIComponent(project.id)}` : `/review?projectId=${encodeURIComponent(project.id)}`}>Новая разметка</Link></div>
      <section className="panel">
        <h2>Сессии и метрики</h2>
        {project.scopeNote && <div className="notice"><strong>Охват оценки</strong><p>{project.scopeNote}</p></div>}
        {results.length ? (
          <div className="results-list">
            {results.map(({ summary, metrics }) => (
              <article className="result-card" key={summary.sessionId}>
                <div className="panel-head">
                  <div><h3>{summary.annotatorName}</h3><p className="muted">Обновлено {new Date(summary.updatedAt).toLocaleString("ru-RU")} · {summary.groupCount} {project.evaluationType === "quality" ? "сюжетов" : "групп"}</p></div>
                  <Link className="button small" href={project.evaluationType === "quality" ? `/quality-review?sessionId=${encodeURIComponent(summary.sessionId)}` : `/review?sessionId=${encodeURIComponent(summary.sessionId)}`}>Открыть сессию</Link>
                </div>
                {"assignmentPrecision" in metrics ? (
                  <>
                    <div className="kpi-grid result-kpis">
                      <div className="kpi"><strong>{percent(metrics.assignmentPrecision)}</strong><span>подтверждено среди определённых</span></div>
                      <div className="kpi"><strong>{metrics.reviewed} / {metrics.assignments}</strong><span>оценённых публикаций</span></div>
                      <div className="kpi"><strong>{metrics.belongs}</strong><span>подходят сюжету</span></div>
                      <div className="kpi"><strong>{metrics.notBelongs}</strong><span>не относятся к сюжету</span></div>
                    </div>
                    <p className="muted">Не уверен: {metrics.uncertain} · ожидают проверки: {metrics.pending} · полностью проверено сюжетов: {metrics.fullyReviewedStories}/{metrics.stories}</p>
                  </>
                ) : (
                  <>
                    <div className="kpi-grid result-kpis">
                      <div className="kpi"><strong>{percent(metrics.f1)}</strong><span>F1</span></div>
                      <div className="kpi"><strong>{percent(metrics.precision)}</strong><span>precision</span></div>
                      <div className="kpi"><strong>{percent(metrics.recall)}</strong><span>recall</span></div>
                      <div className="kpi"><strong>{metrics.evaluatedPairs}</strong><span>размеченных пар в метриках</span></div>
                    </div>
                    <p className="muted">TP {metrics.truePositive} · FP {metrics.falsePositive} · FN {metrics.falseNegative} · TN {metrics.trueNegative} · неопределённых {metrics.uncertain}</p>
                    {metrics.f1 === null && <p className="notice">{metrics.f1Message}</p>}
                  </>
                )}
              </article>
            ))}
          </div>
        ) : <div className="empty">Для этого проекта пока нет сессий разметки.</div>}
      </section>
    </main>
  );
}
