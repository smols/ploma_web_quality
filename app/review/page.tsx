"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MemberCard from "@/components/member-card";
import { calculateCandidateMetrics } from "@/lib/metrics";
import { parseReviewInput, selectImportedVersion } from "@/lib/importers";
import { createReviewSession, groupPairs, groupReviewState, setGroupPairsLabel, setPairLabel } from "@/lib/session";
import { reviewSessionSchema } from "@/lib/session-schema";
import type { HumanLabel, ImportedCollection, ReviewGroup, ReviewSession, SessionSummary } from "@/lib/types";

type View = "review" | "metrics";
type Filter = "all" | "pending" | "reviewed" | "split";

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function sessionCaption(session: Pick<ReviewSession, "source">): string {
  const source = session.source;
  return [source.datasetIds.join(", ") || "dataset не указан", source.versions.join(", ") || "версия не указана"]
    .filter(Boolean)
    .join(" · ");
}

function downloadSession(session: ReviewSession) {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${session.sessionId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function groupMatchesSearch(session: ReviewSession, group: ReviewGroup, query: string): boolean {
  if (!query) return true;
  const needle = query.toLocaleLowerCase();
  const members = group.memberKeys.map((key) => session.items[key]).filter(Boolean);
  return [group.sourceGroupId, group.version, group.datasetId, ...members.flatMap((item) => [item.sourceId, item.title, item.text])]
    .some((value) => value?.toLocaleLowerCase().includes(needle));
}

export default function HomePage() {
  const [annotatorName, setAnnotatorName] = useState("");
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [pendingImport, setPendingImport] = useState<ImportedCollection | null>(null);
  const [pendingVersion, setPendingVersion] = useState("");
  const [savedSessions, setSavedSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("Не сохранено");
  const [view, setView] = useState<View>("review");
  const [filter, setFilter] = useState<Filter>("pending");
  const [search, setSearch] = useState("");
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectLoadError, setProjectLoadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { sessions: SessionSummary[] };
      setSavedSessions(payload.sessions);
    } catch {
      // The app can still work in-browser if the local server API is unavailable.
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("projectId");
    const sessionId = params.get("sessionId");
    if (!projectId && !sessionId) {
      return () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
      };
    }
    setBusy(true);
    const endpoint = sessionId
      ? `/api/sessions?sessionId=${encodeURIComponent(sessionId)}`
      : `/api/projects/${encodeURIComponent(projectId as string)}/data`;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as {
          project?: { title: string };
          imported?: ImportedCollection;
          session?: ReviewSession;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Не удалось загрузить проект.");
        }
        if (sessionId && payload.session) {
          setSession(payload.session);
          setAnnotatorName(payload.session.annotatorName);
          setSaveStatus(`Загружено · ${payload.session.annotatorName}`);
        } else if (payload.project && payload.imported) {
          setProjectName(payload.project.title);
          setProjectId(projectId as string);
          setPendingImport(payload.imported);
        } else {
          throw new Error("Сервер вернул неполные данные проекта.");
        }
      })
      .catch((loadError: unknown) => {
        setProjectLoadError(loadError instanceof Error ? loadError.message : "Не удалось загрузить проект.");
      })
      .finally(() => setBusy(false));
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [refreshSessions]);

  const persistNow = useCallback(async (next: ReviewSession) => {
    setSaveStatus("Сохраняю…");
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const payload = await response.json() as { error?: string; relativePath?: string; updatedAt?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить файл.");
      setSaveStatus(`Сохранено локально · ${payload.relativePath || "JSON"}`);
      setError("");
      void refreshSessions();
    } catch (saveError) {
      setSaveStatus("Ошибка локального сохранения");
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить JSON.");
    }
  }, [refreshSessions]);

  const updateSession = useCallback((next: ReviewSession) => {
    setSession(next);
    setError("");
    setSaveStatus("Изменения ожидают сохранения…");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persistNow(next), 450);
  }, [persistNow]);

  async function startImport(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const content = await file.text();
      if (file.name.toLowerCase().endsWith(".json")) {
        try {
          const existing = reviewSessionSchema.safeParse(JSON.parse(content));
          if (existing.success) {
            setSession(existing.data as ReviewSession);
            setAnnotatorName(existing.data.annotatorName);
            setView("review");
            setFilter("pending");
            setSearch("");
            setActiveGroupIndex(0);
            await persistNow(existing.data as ReviewSession);
            return;
          }
        } catch {
          // Continue and try the generic group JSON format below.
        }
      }
      if (!annotatorName.trim()) throw new Error("Перед импортом укажите имя тестирующего.");
      const imported = parseReviewInput(file.name, content);
      if (imported.source.versions.length > 1) {
        setPendingImport(imported);
        setPendingVersion(imported.source.versions[0]);
      } else {
        await beginReviewSession(imported);
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Не удалось прочитать файл.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function beginReviewSession(imported: ImportedCollection, version?: string) {
    const selected = version ? selectImportedVersion(imported, version) : imported;
    const next = createReviewSession(selected, annotatorName.trim());
    setSession(next);
    setPendingImport(null);
    setPendingVersion("");
    setView("review");
    setFilter("pending");
    setSearch("");
    setActiveGroupIndex(0);
    await persistNow(next);
  }

  async function resumeSession(sessionId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const payload = await response.json() as { session?: ReviewSession; error?: string };
      if (!response.ok || !payload.session) throw new Error(payload.error || "Не удалось открыть сессию.");
      setSession(payload.session);
      setAnnotatorName(payload.session.annotatorName);
      setView("review");
      setFilter("pending");
      setSearch("");
      setActiveGroupIndex(0);
      setSaveStatus(`Загружено · ${payload.session.annotatorName}`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось открыть сессию.");
    } finally {
      setBusy(false);
    }
  }

  const metrics = useMemo(() => session ? calculateCandidateMetrics(session) : null, [session]);
  const groupsToReview = useMemo(() => {
    if (!session) return [];
    return session.groups.filter((group) => {
      if (!groupMatchesSearch(session, group, search.trim())) return false;
      const state = groupReviewState(session, group);
      if (filter === "pending") return state === "unreviewed" || state === "partial";
      if (filter === "reviewed") return state === "accepted" || state === "split" || state === "uncertain";
      if (filter === "split") return state === "split";
      return true;
    });
  }, [filter, search, session]);

  useEffect(() => {
    if (activeGroupIndex >= groupsToReview.length) setActiveGroupIndex(Math.max(0, groupsToReview.length - 1));
  }, [activeGroupIndex, groupsToReview.length]);

  function updatePair(group: ReviewGroup, pairKey: string, humanLabel: HumanLabel) {
    if (!session) return;
    updateSession(setPairLabel(session, pairKey, humanLabel));
  }

  function updateGroupBulk(groupId: string, checked: boolean) {
    if (!session) return;
    const next = setGroupPairsLabel(session, groupId, checked ? "same" : null);
    updateSession(next);
  }

  function updateNote(pairKey: string, note: string) {
    if (!session) return;
    const current = session.judgments[pairKey];
    if (!current) return;
    const next: ReviewSession = {
      ...session,
      updatedAt: new Date().toISOString(),
      judgments: {
        ...session.judgments,
        [pairKey]: { ...current, note, updatedAt: new Date().toISOString() },
      },
    };
    updateSession(next);
  }

  const activeGroup = groupsToReview[activeGroupIndex];

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <div className="brandline">Локальная оценка групп</div>
          <h1>Story Group Review</h1>
          <p className="muted">Проверка групп публикаций и сюжетов человеком с сохранением результата в локальный JSON.</p>
        </div>
        <span className="local-pill">Работает на localhost</span>
      </header>

      {error && <div className="error" role="alert">{error}</div>}

      {!session ? (
        <>
          <div className="button-row"><a className="button small" href="/">← Каталог проектов</a></div>
          {projectName && (
            <section className="panel">
              <h2>Разметка проекта: {projectName}</h2>
              <p className="muted">{busy ? "Загружаю выгрузку…" : `Групп в выгрузке: ${pendingImport?.groups.length ?? 0}. Укажите имя проверяющего и начните сессию.`}</p>
              {projectLoadError && <div className="error" role="alert">{projectLoadError}</div>}
              <div className="field">
                <label htmlFor="project-annotator">Имя проверяющего <span aria-hidden="true">*</span></label>
                <input id="project-annotator" type="text" autoComplete="name" maxLength={120} value={annotatorName} onChange={(event) => setAnnotatorName(event.target.value)} placeholder="Например, Анна Иванова" />
              </div>
              <div className="button-row">
                <button className="button primary" type="button" disabled={!pendingImport || !annotatorName.trim() || busy} onClick={() => pendingImport && void beginReviewSession(pendingImport)}>
                  {busy ? "Загружаю…" : "Начать разметку"}
                </button>
                <a className="button" href="/">Отмена</a>
              </div>
            </section>
          )}
          {pendingImport && (
            !projectName && <section className="panel">
              <h2>Выберите AI-версию для отдельной сессии</h2>
              <p className="muted">В файле найдено несколько версий. Каждая сессия будет сохранена в папку своей версии.</p>
              <div className="field"><label htmlFor="pending-version">Версия</label><select id="pending-version" value={pendingVersion} onChange={(event) => setPendingVersion(event.target.value)}>{pendingImport.source.versions.map((version) => <option key={version} value={version}>{version}</option>)}</select></div>
              <p className="muted">Групп этой версии: {pendingImport.groups.filter((group) => group.version === pendingVersion).length}</p>
              <div className="button-row"><button className="button primary" type="button" disabled={!pendingVersion || busy || !annotatorName.trim()} onClick={() => void beginReviewSession(pendingImport, pendingVersion)}>Создать сессию версии</button><button className="button" type="button" onClick={() => setPendingImport(null)}>Отмена</button></div>
            </section>
          )}
          {!projectName && <section className="panel">
            <h2>Новая проверка</h2>
            <p className="muted">Загрузите пары или группы из 2 и более элементов. Для сравнения AI и человека импортируйте пары с колонкой `ai_label` (`same`/`different`).</p>
            <div className="grid">
              <div>
                <div className="field">
                  <label htmlFor="annotator-name">Имя тестирующего <span aria-hidden="true">*</span></label>
                  <input
                    id="annotator-name"
                    type="text"
                    autoComplete="name"
                    maxLength={120}
                    value={annotatorName}
                    onChange={(event) => setAnnotatorName(event.target.value)}
                    placeholder="Например, Анна Иванова"
                  />
                  <small>Имя записывается в каждый файл сессии; анонимные сессии не создаются.</small>
                </div>
                <label className="file-picker" htmlFor="input-file">
                  <span><strong>{busy ? "Импортирую…" : "Выберите CSV или JSON"}</strong><span className="muted">story_duplicate_cases.csv, story_duplicate_all_cliques.csv, story_duplicate_group_members.csv или общий шаблон</span></span>
                  <input
                    id="input-file"
                    ref={fileInput}
                    type="file"
                    accept=".csv,.json,text/csv,application/json"
                    onChange={(event) => void startImport(event.target.files?.[0])}
                    disabled={busy}
                  />
                </label>
                <p className="save-state">Файл обрабатывается локально; внешние API не используются.</p>
              </div>
              <div className="notice">
                <strong>Сравнение AI и человека</strong>
                <p>F1 рассчитывается только для пар с AI-предсказанием `same`/`different` и человеческой меткой «один сюжет»/«разные сюжеты». Группы-кандидаты без AI-меток позволяют смотреть принятие кандидатов, но не дают pairwise F1.</p>
                <p>Внутри группы можно поставить общую отметку «все элементы — один сюжет» или разметить каждую пару отдельно.</p>
              </div>
            </div>
          </section>}

          {!projectName && <section className="panel">
            <div className="panel-head"><div><h2>Сохранённые сессии</h2><p className="muted">Локальные JSON-файлы сгруппированы по dataset, версии AI и run.</p></div><button className="button small" type="button" onClick={() => void refreshSessions()}>Обновить</button></div>
            {savedSessions.length ? (
              <div className="session-list">
                {savedSessions.map((saved) => (
                  <div className="session-row" key={saved.sessionId}>
                    <div>
                      <p><strong>{saved.annotatorName}</strong> · {saved.versions.join(", ") || "версия не указана"}</p>
                      <p className="muted">{saved.datasetIds.join(", ") || "dataset не указан"} · {saved.groupCount} групп · обновлено {new Date(saved.updatedAt).toLocaleString("ru-RU")}</p>
                    </div>
                    <button className="button small" type="button" onClick={() => void resumeSession(saved.sessionId)} disabled={busy}>Продолжить</button>
                  </div>
                ))}
              </div>
            ) : <div className="empty">Пока нет сохранённых сессий.</div>}
          </section>}
        </>
      ) : (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>{session.annotatorName} · {sessionCaption(session)}</h2>
                <p className="muted">Система: {session.source.systemName} · источники: {session.source.sourceFiles.join(", ")} · ID сессии <code>{session.sessionId}</code></p>
              </div>
              <div className="button-row">
                <span className="save-state" aria-live="polite">{saveStatus}</span>
                <button className="button small" type="button" onClick={() => downloadSession(session)}>Скачать JSON</button>
                <button className="button small" type="button" onClick={() => { if (projectId) window.location.href = `/projects/${encodeURIComponent(projectId)}`; else { setSession(null); setError(""); } }}>Закрыть сессию</button>
              </div>
            </div>
            <div className="tabs" role="tablist" aria-label="Разделы сессии">
              <button className={`tab ${view === "review" ? "active" : ""}`} onClick={() => setView("review")} type="button">Проверка</button>
              <button className={`tab ${view === "metrics" ? "active" : ""}`} onClick={() => setView("metrics")} type="button">Итоги и метрики</button>
            </div>
            {view === "review" && metrics && (
              <>
                <div className="grid-4">
                  <div className="kpi"><strong>{metrics.candidateGroups}</strong><span>групп из выгрузки</span></div>
                  <div className="kpi"><strong>{metrics.reviewedPairs} / {metrics.candidatePairs}</strong><span>размеченных пар</span></div>
                  <div className="kpi"><strong>{percent(metrics.coverage)}</strong><span>покрытие проверки</span></div>
                  <div className="kpi"><strong>{metrics.f1 === null ? "—" : percent(metrics.f1)}</strong><span>F1 на размеченной выборке</span></div>
                </div>
                <div className="progress" aria-label={`Проверено ${metrics.reviewedPairs} из ${metrics.candidatePairs} пар`}><span style={{ width: `${metrics.coverage * 100}%` }} /></div>
                <div className="toolbar">
                  <div className="field"><label htmlFor="group-search">Поиск по ID и тексту</label><input id="group-search" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setActiveGroupIndex(0); }} placeholder="story ID, группа или фраза" /></div>
                  <div className="field"><label htmlFor="group-filter">Показать</label><select id="group-filter" value={filter} onChange={(event) => { setFilter(event.target.value as Filter); setActiveGroupIndex(0); }}><option value="pending">Неразмеченные</option><option value="all">Все группы</option><option value="reviewed">Размеченные</option><option value="split">С ошибками/разделённые</option></select></div>
                  <span className="muted">Групп в выборке: {groupsToReview.length}</span>
                </div>
                {activeGroup ? (
                  <>
                    <div className="pager">
                      <button className="button small" type="button" disabled={activeGroupIndex <= 0} onClick={() => setActiveGroupIndex((index) => Math.max(0, index - 1))}>← Предыдущая</button>
                      <span className="muted">Группа {activeGroupIndex + 1} из {groupsToReview.length}</span>
                      <button className="button small" type="button" disabled={activeGroupIndex >= groupsToReview.length - 1} onClick={() => setActiveGroupIndex((index) => Math.min(groupsToReview.length - 1, index + 1))}>Следующая →</button>
                    </div>
                    <GroupCard session={session} group={activeGroup} onGroupAllSame={updateGroupBulk} onPairLabel={updatePair} onPairNote={updateNote} />
                    <div className="pager">
                      <button className="button small" type="button" disabled={activeGroupIndex <= 0} onClick={() => setActiveGroupIndex((index) => Math.max(0, index - 1))}>← Предыдущая</button>
                      <button className="button primary" type="button" disabled={activeGroupIndex >= groupsToReview.length - 1} onClick={() => setActiveGroupIndex((index) => Math.min(groupsToReview.length - 1, index + 1))}>Следующая группа</button>
                    </div>
                  </>
                ) : <div className="empty">Под этот фильтр группы не попали.</div>}
              </>
            )}
            {view === "metrics" && metrics && <MetricsView session={session} />}
          </section>
        </>
      )}
      <p className="footer-note">Исходные файлы не изменяются. Сессии сохраняются на этом компьютере в `web_app/data/`.</p>
    </main>
  );
}

function GroupCard({
  session,
  group,
  onGroupAllSame,
  onPairLabel,
  onPairNote,
}: {
  session: ReviewSession;
  group: ReviewGroup;
  onGroupAllSame: (groupId: string, checked: boolean) => void;
  onPairLabel: (group: ReviewGroup, pairKey: string, label: HumanLabel) => void;
  onPairNote: (pairKey: string, note: string) => void;
}) {
  const pairs = groupPairs(group);
  const state = groupReviewState(session, group);
  const allSame = state === "accepted";
  const memberNames = group.memberKeys.map((key) => session.items[key]?.sourceId || key);
  const sameLabel = "в один сюжет";
  return (
    <article className="group-card">
      <header className="group-card-header">
        <div className="group-title">
          <h2>{group.sourceGroupId}</h2>
          <div className="chips">
            <span className={`chip ${state === "accepted" ? "accepted" : state === "split" ? "split" : "pending"}`}>{stateLabel(state)}</span>
            <span className="chip">{group.entityType === "story" ? "Сюжеты" : "Публикации"}</span>
            <span className="chip">{group.memberKeys.length} элементов · {pairs.length} пар</span>
            <span className="chip">{group.version}</span>
            {group.metadata.category_a && <span className="chip">{group.metadata.category_a}</span>}
            {group.metadata.category_b && group.metadata.category_b !== group.metadata.category_a && <span className="chip">{group.metadata.category_b}</span>}
            {group.metadata.group_type && <span className="chip">{group.metadata.group_type}</span>}
            {group.metadata.categories && <span className="chip">{group.metadata.categories}</span>}
            {group.metadata.size && <span className="chip">размер {group.metadata.size}</span>}
            {group.metadata.classification && <span className="chip">{group.metadata.classification}</span>}
            {group.aiLabel && <span className="chip">AI: {group.aiLabel === "same" ? "один сюжет" : "разные сюжеты"}</span>}
            {group.metadata.cosine_similarity && <span className="chip">cosine {Number(group.metadata.cosine_similarity).toFixed(3)}</span>}
            {group.metadata.cosine_mean && <span className="chip">средний cosine {Number(group.metadata.cosine_mean).toFixed(3)}</span>}
          </div>
          <p className="muted">{memberNames.join(" · ")}</p>
        </div>
        <div className="button-row">
          <label className="group-check">
            <input type="checkbox" checked={allSame} onChange={(event) => onGroupAllSame(group.id, event.target.checked)} />
            <span><strong>Все элементы — {sameLabel}</strong><span className="muted">Отметка распространяется на все пары этой группы.</span></span>
          </label>
        </div>
      </header>
      <div className="group-body">
        <div className="members">
          {group.memberKeys.map((key) => {
            const item = session.items[key];
            if (!item) return null;
            return <MemberCard item={item} key={key} />;
          })}
        </div>
        {group.memberKeys.length > 2 && <p className="muted">Если группа не целиком правильна, отметьте каждую пару отдельно: группа может содержать несколько разных сюжетов.</p>}
        <div className="pair-list">
          {pairs.map((pair) => {
            const itemA = session.items[pair.itemKeyA];
            const itemB = session.items[pair.itemKeyB];
            const judgment = session.judgments[pair.key];
            if (!itemA || !itemB || !judgment) return null;
            return <div className="pair-row" key={pair.key}>
              <div><strong>{itemA.sourceId}</strong><span className="muted"> ↔ </span><strong>{itemB.sourceId}</strong></div>
              <div className="pair-label" role="radiogroup" aria-label={`Разметка пары ${itemA.sourceId} и ${itemB.sourceId}`}>
                <Choice name={pair.key} value="same" checked={judgment.humanLabel === "same"} onChange={(label) => onPairLabel(group, pair.key, label)} label="Один сюжет" />
                <Choice name={pair.key} value="different" checked={judgment.humanLabel === "different"} onChange={(label) => onPairLabel(group, pair.key, label)} label="Разные сюжеты" />
                <Choice name={pair.key} value="uncertain" checked={judgment.humanLabel === "uncertain"} onChange={(label) => onPairLabel(group, pair.key, label)} label="Неясно" />
              </div>
              <div className="field pair-note"><label htmlFor={`note-${encodeURIComponent(pair.key)}`}>Комментарий к паре <span className="muted">(необязательно)</span></label><input id={`note-${encodeURIComponent(pair.key)}`} type="text" value={judgment.note} onChange={(event) => onPairNote(pair.key, event.target.value)} placeholder="Короткая причина решения" /></div>
            </div>;
          })}
        </div>
      </div>
    </article>
  );
}

function Choice({ name, value, checked, onChange, label }: {
  name: string;
  value: Exclude<HumanLabel, null>;
  checked: boolean;
  onChange: (value: Exclude<HumanLabel, null>) => void;
  label: string;
}) {
  return <label className="choice"><input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />{label}</label>;
}

function stateLabel(state: ReturnType<typeof groupReviewState>): string {
  if (state === "accepted") return "Все пары подтверждены";
  if (state === "split") return "Есть разные сюжеты";
  if (state === "uncertain") return "Неясно";
  if (state === "partial") return "Частично размечено";
  return "Ожидает проверки";
}

function MetricsView({ session }: { session: ReviewSession }) {
  const metrics = calculateCandidateMetrics(session);
  return <div>
    <h2>Результат проверки</h2>
    <div className="kpi-grid">
      <div className="kpi"><strong>{metrics.candidateGroups}</strong><span>групп из выгрузки</span></div>
      <div className="kpi"><strong>{metrics.reviewedPairs} / {metrics.candidatePairs}</strong><span>размеченных предложенных пар</span></div>
      <div className="kpi"><strong>{metrics.same}</strong><span>человек отметил «один сюжет»</span></div>
      <div className="kpi"><strong>{metrics.different}</strong><span>человек отметил «разные сюжеты»</span></div>
      <div className="kpi"><strong>{metrics.f1 === null ? "—" : percent(metrics.f1)}</strong><span>F1 AI против человека</span></div>
    </div>
    <div className="notice"><strong>Сравнение AI и человека</strong><p>{metrics.f1Message}</p><p>Метрики отражают только эту оценочную выборку; неопределённые и неразмеченные пары в матрицу ошибок не входят.</p></div>
    <table className="metric-bar"><tbody>
      <tr><th>Всего уникальных пар-кандидатов</th><td>{metrics.candidatePairs}</td></tr>
      <tr><th>Пар с AI-предсказанием</th><td>{metrics.aiLabeledPairs}</td></tr>
      <tr><th>Пар, вошедших в расчёт метрик</th><td>{metrics.evaluatedPairs}</td></tr>
      <tr><th>AI same / человек same (TP)</th><td>{metrics.truePositive}</td></tr>
      <tr><th>AI same / человек different (FP)</th><td>{metrics.falsePositive}</td></tr>
      <tr><th>AI different / человек same (FN)</th><td>{metrics.falseNegative}</td></tr>
      <tr><th>AI different / человек different (TN)</th><td>{metrics.trueNegative}</td></tr>
      <tr><th>{metrics.aiLabeledPairs ? "Precision AI same" : "Подтверждение AI-кандидатов"}</th><td>{percent(metrics.precision)}</td></tr>
      <tr><th>Recall AI same</th><td>{percent(metrics.recall)}</td></tr>
      <tr><th>F1 AI против человека</th><td>{percent(metrics.f1)}</td></tr>
      <tr><th>Accuracy</th><td>{percent(metrics.accuracy)}</td></tr>
      <tr><th>Ожидают разметки</th><td>{metrics.pendingPairs}</td></tr>
      <tr><th>Неопределённых</th><td>{metrics.uncertain}</td></tr>
      <tr><th>Группы целиком подтверждены</th><td>{metrics.acceptedGroups}</td></tr>
      <tr><th>Группы с разделёнными сюжетами</th><td>{metrics.splitGroups}</td></tr>
      <tr><th>Группы, требующие проверки</th><td>{metrics.pendingGroups + metrics.uncertainGroups}</td></tr>
    </tbody></table>
  </div>;
}
