// ── polling ──────────────────────────────────────────────────────────────────
// A visibility-aware replacement for setInterval on auto-refreshing views.
//
// Every auto-refresh in the app (dashboard totals, health status, the Graylog
// live search) re-runs a database-backed request on a fixed cadence. Plain
// setInterval keeps firing even when the browser tab is in the background — so a
// dashboard left open on a hidden tab quietly runs ~120 queries/hour that no one
// will ever look at. startPolling pauses the loop while document.hidden is true
// and resumes it — with one immediate refresh so the user never returns to stale
// data — when the tab becomes visible again.
//
// Returns a stop() to call from disconnectedCallback (it also detaches the
// visibilitychange listener, so it fully cleans up).
export function startPolling(fn, intervalMs) {
  let timer = null;
  const start = () => { if (timer === null) timer = setInterval(fn, intervalMs); };
  const stop  = () => { if (timer !== null) { clearInterval(timer); timer = null; } };

  const onVisibility = () => {
    if (document.hidden) stop();
    else { fn(); start(); } // catch up immediately, then resume the cadence
  };
  document.addEventListener('visibilitychange', onVisibility);

  if (!document.hidden) start(); // don't burn a timer if we mount in a hidden tab

  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
