"use client";

import { useState } from "react";
import type { ReviewItem } from "@/lib/types";

export default function MemberCard({ item, showSourceId = true }: { item: ReviewItem; showSourceId?: boolean }) {
  const [translation, setTranslation] = useState<{ title: string; text: string } | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggleTranslation() {
    if (translation) {
      setShowTranslation((visible) => !visible);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: item.title ?? "", text: item.text }),
      });
      const payload = await response.json() as { translation?: { title: string; text: string }; error?: string };
      if (!response.ok || !payload.translation) throw new Error(payload.error || "Не удалось перевести текст.");
      setTranslation(payload.translation);
      setShowTranslation(true);
    } catch (translationError) {
      setError(translationError instanceof Error ? translationError.message : "Не удалось перевести текст.");
    } finally {
      setBusy(false);
    }
  }

  return <article className="member">
    {showSourceId && <div className="member-id">{item.sourceId}</div>}
    {item.title && <div className="member-title">{item.title}</div>}
    {item.category && <span className="chip">{item.category}</span>}
    <p className="member-text">{item.text}</p>
    <button className="button small translate-button" type="button" onClick={() => void toggleTranslation()} disabled={busy} aria-expanded={showTranslation}>
      {busy ? "Перевожу через Luna…" : showTranslation ? "Скрыть перевод" : translation ? "Показать перевод" : "Перевести на русский"}
    </button>
    {error && <p className="translation-error" role="alert">{error}</p>}
    {showTranslation && translation && <section className="translation-panel" aria-label="Перевод на русский">
      <div className="translation-heading">Перевод · Luna</div>
      {translation.title && <h4>{translation.title}</h4>}
      <p className="member-text">{translation.text}</p>
    </section>}
    {Object.keys(item.metadata).length > 0 && <details><summary className="muted">Ещё поля</summary><dl>{Object.entries(item.metadata).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></details>}
  </article>;
}
