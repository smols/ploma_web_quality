import Link from "next/link";
import { listReviewProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await listReviewProjects();
  const doublesProjects = projects.filter((project) => project.evaluationType === "doubles");
  const qualityProjects = projects.filter((project) => project.evaluationType === "quality");
  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <div className="brandline">Локальная оценка групп</div>
          <h1>Story Group Review</h1>
          <p className="muted">Выберите тип оценки и проект: поиск дублей сюжетов или проверка качества публикаций в сюжетах.</p>
        </div>
        <span className="local-pill">Работает на localhost</span>
      </header>

      <section className="panel">
        <div className="panel-head">
          <div><h2>Doubles · Поиск дублей</h2><p className="muted">Выгрузки из `web_app/exports/doubles/`.</p></div>
          <Link className="button small" href="/review">Импортировать CSV/JSON</Link>
        </div>
        {doublesProjects.length ? (
          <div className="project-grid">
            {doublesProjects.map((project) => (
              <article className="project-card" key={project.id}>
                <div className="chips"><span className="chip">Промпт {project.version}</span><span className="chip">{project.runId}</span>{project.runStatus && project.runStatus !== "complete" && <span className="chip">Запуск: {project.runStatus}</span>}</div>
                <h3>{project.title}</h3>
                <p className="muted">{project.description}</p>
                {project.scopeNote && <p className="notice project-note">{project.scopeNote}</p>}
                <p className="muted">{project.counts?.pairs ? `${project.counts.pairs} пар` : "Выгрузка пар"} · {project.systemName}</p>
                <Link className="button primary" href={`/projects/${encodeURIComponent(project.id)}`}>Открыть проект</Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">Выгрузок для проверки дублей пока нет.</div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Quality · Качество сюжетов</h2><p className="muted">Проверка, относится ли публикация к сюжету из `web_app/exports/quality/`.</p></div></div>
        {qualityProjects.length ? (
          <div className="project-grid">
            {qualityProjects.map((project) => (
              <article className="project-card" key={project.id}>
                <div className="chips"><span className="chip">Промпт {project.version}</span><span className="chip">{project.runId}</span>{project.runStatus && project.runStatus !== "complete" && <span className="chip">Запуск: {project.runStatus}</span>}</div>
                <h3>{project.title}</h3>
                <p className="muted">{project.description}</p>
                {project.scopeNote && <p className="notice project-note">{project.scopeNote}</p>}
                <p className="muted">{project.counts?.stories ?? 0} сюжетов · {project.counts?.publications ?? 0} публикаций · {project.systemName}</p>
                <Link className="button primary" href={`/projects/${encodeURIComponent(project.id)}`}>Открыть проект</Link>
              </article>
            ))}
          </div>
        ) : <div className="empty">Выгрузок для проверки качества сюжетов пока нет.</div>}
      </section>

      <section className="panel">
        <h2>Сохранение разметки</h2>
        <p className="muted">Сессии сохраняются локально в `web_app/data/` отдельно от исходных выгрузок.</p>
      </section>
      <p className="footer-note">Исходные данные и результаты разметки остаются на этом компьютере; внешние API не используются.</p>
    </main>
  );
}
