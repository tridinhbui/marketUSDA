"use client";

import { useState } from "react";

export function TriggerGithubSync() {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function handleDispatch() {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/trigger-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secret || undefined }),
      });
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
            Kích hoạt workflow cập nhật <code>public/data/*.json</code> trên GitHub. Cần biến môi
            trường <code>GITHUB_TOKEN</code> trên Vercel. Sau khi chạy xong, đợi deploy Vercel hoặc bấm
            &quot;Làm mới dữ liệu&quot; ở trên.
          </p>
          <div className="sync-footer-row">
            <input
              type="password"
              className="sync-footer-input"
              placeholder="TRIGGER_SECRET (nếu đã cấu hình)"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              className="btn-load sync-footer-btn"
              onClick={handleDispatch}
              disabled={loading}
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
