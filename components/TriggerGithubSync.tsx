"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const CONFIRM_PHRASE = "CONFIRM";
const POLL_MS = 2500;
const POLL_MAX_MS = 20 * 60 * 1000;

type StatusPayload = {
  found?: boolean;
  phase?: string;
  label?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  error?: string;
};

export function TriggerGithubSync() {
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pollSince, setPollSince] = useState<string | null>(null);
  const [progress, setProgress] = useState<StatusPayload | null>(null);

  const pollStartRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const confirmed = typed.trim().toUpperCase() === CONFIRM_PHRASE;

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    pollStartRef.current = null;
  }, []);

  const pollOnce = useCallback(async (since: string) => {
    try {
      const res = await fetch(`/api/workflow-status?since=${encodeURIComponent(since)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as StatusPayload & { details?: string };
      if (!res.ok) {
        setProgress({
          label: data.error || `HTTP ${res.status}`,
          ...(data.details ? { error: data.details } : {}),
        });
        return;
      }
      setProgress(data);

      if (data.phase === "done" || data.status === "completed") {
        stopPolling();
        setPollSince(null);
        if (data.conclusion === "success") {
          setMessage(
            "Workflow thành công. Đợi Vercel deploy (1–3 phút) rồi bấm “Làm mới dữ liệu” phía trên."
          );
        } else if (data.conclusion === "failure") {
          setError("Workflow failed — xem log trên GitHub (link bên dưới).");
        }
      }
    } catch (e) {
      setProgress({ label: e instanceof Error ? e.message : "Lỗi poll" });
    }
  }, [stopPolling]);

  useEffect(() => {
    if (!pollSince) return;

    pollStartRef.current = Date.now();
    void pollOnce(pollSince);

    timerRef.current = setInterval(() => {
      if (pollStartRef.current && Date.now() - pollStartRef.current > POLL_MAX_MS) {
        stopPolling();
        setPollSince(null);
        setProgress((p) => ({
          ...p,
          label: "Hết thời gian chờ (20 phút). Kiểm tra GitHub Actions thủ công.",
        }));
        return;
      }
      void pollOnce(pollSince);
    }, POLL_MS);

    return () => stopPolling();
  }, [pollSince, pollOnce, stopPolling]);

  async function handleDispatch() {
    if (!confirmed) return;
    setLoading(true);
    setMessage(null);
    setError(null);
    setProgress(null);
    stopPolling();
    setPollSince(null);
    try {
      const res = await fetch("/api/trigger-refresh", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        pollSince?: string;
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
      setTyped("");
      if (data.pollSince) {
        setPollSince(data.pollSince);
        setMessage(data.message || "Đang theo dõi tiến độ…");
      } else {
        setMessage(data.message || "Đã gửi.");
      }
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
            <code>GITHUB_TOKEN</code> trên Vercel. Tiến độ lấy từ GitHub Actions API.
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

          {progress && (
            <div className="sync-progress" aria-live="polite">
              <p className="sync-progress-label">{progress.label}</p>
              {progress.html_url && (
                <a
                  href={progress.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sync-progress-link"
                >
                  Mở run trên GitHub →
                </a>
              )}
            </div>
          )}

          {message && <p className="sync-footer-msg sync-footer-ok">{message}</p>}
          {error && <p className="sync-footer-msg sync-footer-err">{error}</p>}
        </div>
      )}
    </footer>
  );
}
