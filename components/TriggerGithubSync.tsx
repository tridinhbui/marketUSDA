"use client";

import { useState } from "react";

const CONFIRM_PHRASE = "CONFIRM";

export function TriggerGithubSync() {
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const confirmed = typed.trim().toUpperCase() === CONFIRM_PHRASE;

  async function handleDispatch() {
    if (!confirmed) return;
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/trigger-refresh", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        hint?: string;
        details?: string;
      };
      if (!res.ok) {
        setError(
          [data.error, data.hint, data.details].filter(Boolean).join(" — ") || `HTTP ${res.status}`
        );
        return;
      }
      setMessage(data.message || "Đã gửi yêu cầu tới GitHub.");
      setTyped("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <footer className="sync-footer">
      <button
        type="button"
        className="sync-footer-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? "▼" : "▶"} Đồng bộ dữ liệu USDA (GitHub Actions)
      </button>
      {open && (
        <div className="sync-footer-panel">
          <p className="sync-footer-hint">
            Kích hoạt workflow cập nhật <code>public/data/*.json</code> trên GitHub. Cần{" "}
            <code>GITHUB_TOKEN</code> trên Vercel. Sau khi chạy xong, đợi deploy hoặc bấm &quot;Làm mới
            dữ liệu&quot;.
          </p>
          <p className="sync-footer-confirm-label">
            Gõ <kbd className="sync-footer-kbd">CONFIRM</kbd> để mở khóa nút (tránh bấm nhầm):
          </p>
          <div className="sync-footer-row">
            <input
              type="text"
              className="sync-footer-input"
              placeholder={CONFIRM_PHRASE}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={typed.length > 0 && !confirmed}
            />
            <button
              type="button"
              className="btn-load sync-footer-btn"
              onClick={handleDispatch}
              disabled={loading || !confirmed}
            >
              {loading ? "Đang gửi…" : "Chạy workflow trên GitHub"}
            </button>
          </div>
          {message && <p className="sync-footer-msg sync-footer-ok">{message}</p>}
          {error && <p className="sync-footer-msg sync-footer-err">{error}</p>}
        </div>
      )}
    </footer>
  );
}
