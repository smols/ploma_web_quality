"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MemberCard from "@/components/member-card";
import { calculateQualityMetrics } from "@/lib/quality-metrics";
import { createQualitySession, qualityJudgmentKey, setQualityLabel, setQualityNote, touchQualitySession } from "@/lib/quality-session";
import type {
  ImportedQualityCollection,
  QualityLabel,
  QualityReviewSession,
  QualityStoryGroup,
  SessionSummary,
} from "@/lib/types";

type QualityFilter = "all" | "pending" | "reviewed";
type QualityJudgmentPatch = {
  key: string;
  humanLabel?: QualityLabel;
  note?: string;
};
type QualitySessionPatch = {
  sessionId: string;
  currentStoryId?: string | null;
  judgments?: QualityJudgmentPatch[];
};

function mergeQualitySessionPatches(
  first: QualitySessionPatch | null,
  next: QualitySessionPatch | null,
): QualitySessionPatch | null {
  if (!first) return next;
  if (!next) return first;
  if (first.sessionId !== next.sessionId) return next;

  const judgments = new Map<string, QualityJudgmentPatch>();
  for (const patch of [...(first.judgments ?? []), ...(next.judgments ?? [])]) {
    judgments.set(patch.key, { ...judgments.get(patch.key), ...patch });
  }
  return {
    sessionId: next.sessionId,
    ...(Object.hasOwn(next, "currentStoryId")
      ? { currentStoryId: next.currentStoryId }
      : Object.hasOwn(first, "currentStoryId") ? { currentStoryId: first.currentStoryId } : {}),
    ...(judgments.size ? { judgments: [...judgments.values()] } : {}),
  };
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function downloadSession(session: QualityReviewSession) {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${session.sessionId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function storyState(session: QualityReviewSession, story: QualityStoryGroup): "pending" | "reviewed" {
  return story.publicationKeys.every((key) =>
    session.judgments[qualityJudgmentKey(story.storyId, key)]?.humanLabel != null,
  ) ? "reviewed" : "pending";
}

export default function QualityReviewPage() {
  const [session, setSession] = useState<QualityReviewSession | null>(null);
  const [pendingData, setPendingData] = useState<ImportedQualityCollection | null>(null);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [annotatorName, setAnnotatorName] = useState("");
  const [savedSessions, setSavedSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("Не сохранено");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"review" | "metrics">("review");
  const [filter, setFilter] = useState<QualityFilter>("pending");
  const [search, setSearch] = useState("");
  const [storyIndex, setStoryIndex] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingPatch = useRef<QualitySessionPatch | null>(null);
  const inFlightPatch = useRef<QualitySessionPatch | null>(null);
  const patchSaveActive = useRef(false);
  const patchRequestStarted = useRef(false);
  const observedStory = useRef<{ sessionId: string; storyId: string | null } | null>(null);
  const restoredSessionId = useRef<string | null>(null);
  const ignoreNextStoryChange = useRef(false);

  const refreshSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/quality-sessions", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { sessions: SessionSummary[] };
      setSavedSessions(payload.sessions);
    } catch {
      // Local annotations remain usable if the API is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    const params = new URLSearchParams(window.location.search);
    const selectedProjectId = params.get("projectId");
    const sessionId = params.get("sessionId");
    if (!selectedProjectId && !sessionId) {
      return () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
      };
    }
    setBusy(true);
    const endpoint = sessionId
      ? `/api/quality-sessions?sessionId=${encodeURIComponent(sessionId)}`
      : `/api/projects/${encodeURIComponent(selectedProjectId as string)}/data`;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as {
          project?: { id: string; title: string; evaluationType: string };
          qualityData?: ImportedQualityCollection;
          session?: QualityReviewSession;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Не удалось открыть quality-проект.");
        if (sessionId && payload.session) {
          setSession(payload.session);
          setAnnotatorName(payload.session.annotatorName);
          setSaveStatus(`Загружено · ${payload.session.annotatorName}`);
        } else if (payload.project?.evaluationType === "quality" && payload.qualityData) {
          setProjectTitle(payload.project.title);
          setProjectId(payload.project.id);
          setPendingData(payload.qualityData);
        } else {
          throw new Error("В проекте нет quality-выгрузки.");
        }
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Не удалось открыть проект."))
      .finally(() => setBusy(false));
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [refreshSessions]);

  const persistNow = useCallback(async (next: QualityReviewSession) => {
    const save = async () => {
      setSaveStatus("Сохраняю…");
      try {
        const response = await fetch("/api/quality-sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        });
        const payload = await response.json() as { error?: string; relativePath?: string };
        if (!response.ok) throw new Error(payload.error || "Не удалось сохранить разметку.");
        setSaveStatus(`Сохранено локально · ${payload.relativePath || "JSON"}`);
        setError("");
        void refreshSessions();
      } catch (saveError) {
        setSaveStatus("Ошибка локального сохранения");
        setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить разметку.");
      }
    };
    const queuedSave = saveQueue.current.then(save, save);
    saveQueue.current = queuedSave.then(() => undefined, () => undefined);
    await queuedSave;
  }, [refreshSessions]);

  const flushPendingPatch = useCallback(async (): Promise<boolean> => {
    if (patchSaveActive.current) {
      await saveQueue.current;
      return pendingPatch.current ? flushPendingPatch() : true;
    }
    const patch = pendingPatch.current;
    if (!patch) return true;

    pendingPatch.current = null;
    inFlightPatch.current = patch;
    patchSaveActive.current = true;
    patchRequestStarted.current = false;
    const save = async () => {
      setSaveStatus("Сохраняю…");
      patchRequestStarted.current = true;
      const response = await fetch("/api/quality-sessions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        keepalive: true,
      });
      const payload = await response.json() as { error?: string; relativePath?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить разметку.");
      setSaveStatus(`Сохранено локально · ${payload.relativePath || "JSON"}`);
      setError("");
      void refreshSessions();
    };
    const queuedSave = saveQueue.current.then(save, save);
    saveQueue.current = queuedSave.then(() => undefined, () => undefined);
    try {
      await queuedSave;
      return true;
    } catch (saveError) {
      pendingPatch.current = mergeQualitySessionPatches(patch, pendingPatch.current);
      setSaveStatus("Ошибка локального сохранения");
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить разметку.");
      return false;
    } finally {
      inFlightPatch.current = null;
      patchSaveActive.current = false;
      patchRequestStarted.current = false;
    }
  }, [refreshSessions]);

  const updateSession = useCallback((
    next: QualityReviewSession,
    change: Omit<QualitySessionPatch, "sessionId">,
    immediate = false,
  ) => {
    setSession(next);
    setSaveStatus("Изменения ожидают сохранения…");
    pendingPatch.current = mergeQualitySessionPatches(pendingPatch.current, {
      sessionId: next.sessionId,
      ...change,
    });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (immediate) {
      saveTimer.current = null;
      void flushPendingPatch();
      return;
    }
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void flushPendingPatch();
    }, 350);
  }, [flushPendingPatch]);

  const sendPendingPatch = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const patch = mergeQualitySessionPatches(
      patchRequestStarted.current ? null : inFlightPatch.current,
      pendingPatch.current,
    );
    if (!patch) return;
    const body = JSON.stringify(patch);
    if (new Blob([body]).size > 60 * 1024) return;
    void fetch("/api/quality-sessions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") sendPendingPatch();
      else if (pendingPatch.current) void flushPendingPatch();
    };
    window.addEventListener("pagehide", sendPendingPatch);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", sendPendingPatch);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sendPendingPatch();
    };
  }, [flushPendingPatch, sendPendingPatch]);

  const navigateAfterSaving = useCallback(async (href: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const saved = await flushPendingPatch();
    await saveQueue.current;
    if (!saved || pendingPatch.current) return;
    window.location.href = href;
  }, [flushPendingPatch]);

  function beginSession() {
    if (!pendingData || !annotatorName.trim()) return;
    const next = createQualitySession(pendingData, annotatorName.trim());
    setSession(next);
    setPendingData(null);
    setView("review");
    setFilter("pending");
    setStoryIndex(0);
    void persistNow(next);
  }

  function resumeSession(sessionId: string) {
    setBusy(true);
    setError("");
    fetch(`/api/quality-sessions?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { session?: QualityReviewSession; error?: string };
        if (!response.ok || !payload.session) throw new Error(payload.error || "Не удалось открыть сессию.");
        setSession(payload.session);
        setAnnotatorName(payload.session.annotatorName);
        setView("review");
        setFilter("pending");
        setStoryIndex(0);
        setSaveStatus(`Загружено · ${payload.session.annotatorName}`);
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Не удалось открыть сессию."))
      .finally(() => setBusy(false));
  }

  const metrics = useMemo(() => session ? calculateQualityMetrics(session) : null, [session]);
  const storiesToReview = useMemo(() => {
    if (!session) return [];
    const needle = search.trim().toLocaleLowerCase();
    return session.stories.filter((story) => {
      const publicationItems = story.publicationKeys.map((key) => session.items[key]).filter(Boolean);
      const matchesSearch = !needle || [story.storyId, story.title, story.description, ...publicationItems.flatMap((item) => [item.sourceId, item.title, item.text])]
        .some((value) => value?.toLocaleLowerCase().includes(needle));
      if (!matchesSearch) return false;
      const state = storyState(session, story);
      return filter === "all" || (filter === state);
    });
  }, [filter, search, session]);

  useEffect(() => {
    if (storyIndex >= storiesToReview.length) setStoryIndex(Math.max(0, storiesToReview.length - 1));
  }, [storyIndex, storiesToReview.length]);

  useEffect(() => {
    if (!session) {
      restoredSessionId.current = null;
      return;
    }
    if (restoredSessionId.current === session.sessionId) return;
    restoredSessionId.current = session.sessionId;

    let targetIndex = 0;
    if (session.currentStoryId) {
      const visibleIndex = storiesToReview.findIndex((story) => story.storyId === session.currentStoryId);
      if (visibleIndex >= 0) {
        targetIndex = visibleIndex;
      } else {
        const sessionIndex = session.stories.findIndex((story) => story.storyId === session.currentStoryId);
        if (sessionIndex >= 0) {
          setFilter("all");
          targetIndex = sessionIndex;
        }
      }
    }
    observedStory.current = {
      sessionId: session.sessionId,
      storyId: session.stories[targetIndex]?.storyId ?? null,
    };
    ignoreNextStoryChange.current = true;
    setStoryIndex(targetIndex);
  }, [session, storiesToReview]);

  function labelPublication(story: QualityStoryGroup, publicationKey: string, label: QualityLabel) {
    if (!session) return;
    const key = qualityJudgmentKey(story.storyId, publicationKey);
    updateSession(setQualityLabel(session, key, label), { judgments: [{ key, humanLabel: label }] }, true);
  }

  function notePublication(story: QualityStoryGroup, publicationKey: string, note: string) {
    if (!session) return;
    const key = qualityJudgmentKey(story.storyId, publicationKey);
    updateSession(setQualityNote(session, key, note), { judgments: [{ key, note }] });
  }

  const activeStory = storiesToReview[storyIndex];
  const coverage = metrics?.assignments ? metrics.reviewed / metrics.assignments : 0;

  useEffect(() => {
    const storyId = activeStory?.storyId ?? null;
    if (!session) {
      observedStory.current = null;
      restoredSessionId.current = null;
      return;
    }
    if (ignoreNextStoryChange.current) {
      ignoreNextStoryChange.current = false;
      return;
    }
    if (observedStory.current?.sessionId !== session.sessionId) {
      observedStory.current = { sessionId: session.sessionId, storyId };
      return;
    }
    if (observedStory.current.storyId === storyId) return;
    observedStory.current.storyId = storyId;
    if (!storyId) return;

    const next = touchQualitySession(session, storyId);
    updateSession(next, { currentStoryId: storyId }, true);
  }, [activeStory?.storyId, session, updateSession]);

  return (
    <main className="shell">
      <header className="masthead">
        <div><div className="brandline">Quality · проверка принадлежности</div><h1>Story Group Review</h1><p className="muted">Проверьте, относится ли каждая публикация к сюжету, которому её назначил AI.</p></div>
        <span className="local-pill">Работает на localhost</span>
      </header>
      <div className="button-row"><a className="button small" href={projectId ? `/projects/${encodeURIComponent(projectId)}` : "/"} onClick={(event) => { event.preventDefault(); void navigateAfterSaving(projectId ? `/projects/${encodeURIComponent(projectId)}` : "/"); }}>← К проекту</a></div>
      {error && <div className="error" role="alert">{error}</div>}

      {!session ? (
        <>
          {projectTitle && <section className="panel">
            <h2>{projectTitle}</h2>
            <p className="muted">{busy ? "Загружаю выгрузку…" : `${pendingData?.stories.length ?? 0} сюжетов · ${Object.keys(pendingData?.items ?? {}).length} публикаций. Все публикации каждого выбранного сюжета оцениваются отдельно.`}</p>
            <div className="field"><label htmlFor="quality-annotator">Имя проверяющего <span aria-hidden="true">*</span></label><input id="quality-annotator" autoComplete="name" maxLength={120} value={annotatorName} onChange={(event) => setAnnotatorName(event.target.value)} placeholder="Например, Анна Иванова" /></div>
            <div className="button-row"><button className="button primary" type="button" disabled={!pendingData || !annotatorName.trim() || busy} onClick={beginSession}>Начать проверку качества</button></div>
          </section>}
          {!projectTitle && <section className="panel">
            <h2>Сохранённые quality-сессии</h2>
            {savedSessions.length ? <div className="session-list">{savedSessions.map((saved) => <div className="session-row" key={saved.sessionId}>
              <div><p><strong>{saved.annotatorName}</strong> · {saved.versions.join(", ")}</p><p className="muted">{saved.groupCount} сюжетов · {saved.itemCount} публикаций · {new Date(saved.updatedAt).toLocaleString("ru-RU")}</p></div>
              <button className="button small" type="button" disabled={busy} onClick={() => resumeSession(saved.sessionId)}>Продолжить</button>
            </div>)}</div> : <div className="empty">Нет сохранённых quality-сессий.</div>}
          </section>}
        </>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <div><h2>{session.annotatorName} · {session.source.versions.join(", ")}</h2><p className="muted">{session.stories.length} сюжетов · {Object.keys(session.items).length} публикаций · run {session.source.runIds.join(", ")}</p></div>
            <div className="button-row"><span className="save-state" aria-live="polite">{saveStatus}</span><button className="button small" type="button" onClick={() => downloadSession(session)}>Скачать JSON</button><button className="button small" type="button" onClick={() => void navigateAfterSaving(projectId ? `/projects/${encodeURIComponent(projectId)}` : "/")}>Закрыть сессию</button></div>
          </div>
          <div className="tabs" role="tablist" aria-label="Quality-разметка">
            <button className={`tab ${view === "review" ? "active" : ""}`} type="button" onClick={() => setView("review")}>Проверка</button>
            <button className={`tab ${view === "metrics" ? "active" : ""}`} type="button" onClick={() => setView("metrics")}>Итоги качества</button>
          </div>
          {view === "review" && metrics && <>
            <div className="grid-4">
              <div className="kpi"><strong>{metrics.stories}</strong><span>сюжетов в выборке</span></div>
              <div className="kpi"><strong>{metrics.reviewed} / {metrics.assignments}</strong><span>оценённых публикаций</span></div>
              <div className="kpi"><strong>{percent(coverage)}</strong><span>покрытие проверки</span></div>
              <div className="kpi"><strong>{percent(metrics.assignmentPrecision)}</strong><span>подтверждено среди определённых</span></div>
            </div>
            <div className="progress" aria-label={`Оценено ${metrics.reviewed} из ${metrics.assignments} публикаций`}><span style={{ width: `${coverage * 100}%` }} /></div>
            <div className="toolbar">
              <div className="field"><label htmlFor="quality-search">Поиск по сюжету и публикациям</label><input id="quality-search" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setStoryIndex(0); }} placeholder="Название, ID или текст" /></div>
              <div className="field"><label htmlFor="quality-filter">Показать сюжеты</label><select id="quality-filter" value={filter} onChange={(event) => { setFilter(event.target.value as QualityFilter); setStoryIndex(0); }}><option value="pending">Есть публикации без оценки</option><option value="all">Все сюжеты</option><option value="reviewed">Полностью проверены</option></select></div>
              <span className="muted">В списке: {storiesToReview.length}</span>
            </div>
            {activeStory ? <>
              <div className="pager">
                <button className="button small" type="button" disabled={storyIndex <= 0} onClick={() => setStoryIndex((index) => Math.max(0, index - 1))}>← Предыдущий сюжет</button>
                <span className="muted">Сюжет {storyIndex + 1} из {storiesToReview.length}</span>
                <button className="button small" type="button" disabled={storyIndex >= storiesToReview.length - 1} onClick={() => setStoryIndex((index) => Math.min(storiesToReview.length - 1, index + 1))}>Следующий сюжет →</button>
              </div>
              <article className="quality-story">
                <header className="quality-story-header">
                  <div><h2>{activeStory.title || activeStory.storyId}</h2><p className="muted">ID {activeStory.storyId} · {activeStory.publicationKeys.length} публикаций {activeStory.category ? `· ${activeStory.category}` : ""}</p></div>
                  {activeStory.category && <span className="chip">{activeStory.category}</span>}
                </header>
                <div className="quality-story-description">
                  <MemberCard item={{
                    key: `story-description:${activeStory.storyId}`,
                    sourceId: activeStory.storyId,
                    entityType: "story",
                    text: activeStory.description || "Описание сюжета отсутствует.",
                    metadata: {},
                  }} showSourceId={false} />
                </div>
                <div className="quality-publications">
                  {activeStory.publicationKeys.map((publicationKey) => {
                    const publication = session.items[publicationKey];
                    const judgmentKey = qualityJudgmentKey(activeStory.storyId, publicationKey);
                    const judgment = session.judgments[judgmentKey];
                    if (!publication || !judgment) return null;
                    return <article className="quality-publication" key={publicationKey}>
                      <MemberCard item={publication} />
                      <div className="quality-controls" role="group" aria-label={`Публикация ${publication.sourceId} в сюжете ${activeStory.storyId}`}>
                        <QualityChoice name={judgmentKey} value="belongs" current={judgment.humanLabel} onChange={(label) => labelPublication(activeStory, publicationKey, label)}>Подходит сюжету</QualityChoice>
                        <QualityChoice name={judgmentKey} value="not_belongs" current={judgment.humanLabel} onChange={(label) => labelPublication(activeStory, publicationKey, label)}>Не подходит</QualityChoice>
                        <QualityChoice name={judgmentKey} value="uncertain" current={judgment.humanLabel} onChange={(label) => labelPublication(activeStory, publicationKey, label)}>Не уверен</QualityChoice>
                      </div>
                      <div className="field quality-note"><label htmlFor={`quality-note-${encodeURIComponent(judgmentKey)}`}>Заметка <span className="muted">(необязательно)</span></label><input id={`quality-note-${encodeURIComponent(judgmentKey)}`} type="text" value={judgment.note} onChange={(event) => notePublication(activeStory, publicationKey, event.target.value)} placeholder="Причина решения" /></div>
                    </article>;
                  })}
                </div>
              </article>
              <div className="pager"><button className="button primary" type="button" disabled={storyIndex >= storiesToReview.length - 1} onClick={() => setStoryIndex((index) => Math.min(storiesToReview.length - 1, index + 1))}>Следующий сюжет</button></div>
            </> : <div className="empty">Под этот фильтр сюжеты не попали.</div>}
          </>}
          {view === "metrics" && metrics && <QualityMetricsView session={session} />}
        </section>
      )}
      <p className="footer-note">Разметка сохраняется локально в `web_app/data/`. Исходные выгрузки не меняются.</p>
    </main>
  );
}

function QualityChoice({
  name,
  value,
  current,
  onChange,
  children,
}: {
  name: string;
  value: Exclude<QualityLabel, null>;
  current: QualityLabel;
  onChange: (label: QualityLabel) => void;
  children: React.ReactNode;
}) {
  return <label className={`quality-choice ${current === value ? "selected" : ""}`}>
    <input type="radio" name={`quality-${name}`} checked={current === value} onChange={() => onChange(value)} />
    {children}
  </label>;
}

function QualityMetricsView({ session }: { session: QualityReviewSession }) {
  const metrics = calculateQualityMetrics(session);
  return <div>
    <h2>Итоги проверки качества</h2>
    <div className="kpi-grid">
      <div className="kpi"><strong>{metrics.stories}</strong><span>сюжетов</span></div>
      <div className="kpi"><strong>{metrics.reviewed} / {metrics.assignments}</strong><span>оценённых публикаций</span></div>
      <div className="kpi"><strong>{percent(metrics.assignmentPrecision)}</strong><span>подтверждено среди определённых</span></div>
      <div className="kpi"><strong>{metrics.fullyReviewedStories} / {metrics.stories}</strong><span>полностью проверенных сюжетов</span></div>
    </div>
    <div className="notice"><strong>Как читать показатель</strong><p>Доля показывает, какая часть проверенных с определённым ответом публикаций подходит назначенному сюжету. «Не уверен» исключается из доли; пропущенные публикации не учитываются.</p></div>
    <table className="metric-bar"><tbody>
      <tr><th>Подходит сюжету</th><td>{metrics.belongs}</td></tr>
      <tr><th>Не подходит</th><td>{metrics.notBelongs}</td></tr>
      <tr><th>Не уверен</th><td>{metrics.uncertain}</td></tr>
      <tr><th>Ожидают проверки</th><td>{metrics.pending}</td></tr>
      <tr><th>Подтверждено среди определённых</th><td>{percent(metrics.assignmentPrecision)}</td></tr>
    </tbody></table>
  </div>;
}
