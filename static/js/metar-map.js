(function () {
  const SESSION_KEY = "metar-map-session";
  const DEBOUNCE_MS = 250;

  function apiOrigin() {
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      if (typeof window.METAR_API_ORIGIN === "string" && /localhost|127\.0\.0\.1/.test(window.METAR_API_ORIGIN)) {
        return window.METAR_API_ORIGIN.replace(/\/$/, "");
      }
      return "http://127.0.0.1:8788";
    }
    if (typeof window.METAR_API_ORIGIN === "string") {
      return window.METAR_API_ORIGIN.replace(/\/$/, "");
    }
    return "";
  }

  const root = document.getElementById("metar-map-app");
  if (!root) return;

  let session = sessionStorage.getItem(SESSION_KEY) || "";
  let pollTimer = null;
  let brightnessTimer = null;
  let scheduleTimer = null;
  let intervalTimer = null;
  let dragging = false;
  let lastSentBrightness = null;
  let lastStatus = null;
  let optimisticLoading = false;

  function headers(jsonBody) {
    const h = { Accept: "application/json" };
    if (jsonBody) h["Content-Type"] = "application/json";
    if (session) h.Authorization = "Bearer " + session;
    return h;
  }

  async function api(path, options) {
    const opts = options || {};
    const res = await fetch(apiOrigin() + path, {
      method: opts.method || "GET",
      headers: headers(opts.body !== undefined),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: apiOrigin() ? "omit" : "include",
    });
    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { res, data };
  }

  function humanizeMs(ms) {
    if (ms == null || ms < 0) return "never";
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    const m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 48) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  function errorLabel(code) {
    if (!code) return "None";
    if (code === "wifi") return "Wi-Fi";
    if (code === "metar") return "Weather download";
    return code;
  }

  function phaseLabel(status) {
    if (status.loading || status.phase === "fetching") return "Updating weather…";
    switch (status.phase) {
      case "boot":
        return "Starting up…";
      case "wifi":
        return "Connecting to Wi-Fi…";
      case "ntp":
        return "Syncing time…";
      case "idle":
        return "Idle";
      case "error":
        return "Error";
      default:
        return status.phase || "Unknown";
    }
  }

  function connectionKind(status) {
    if (!status.lastSeenAt) return "unknown";
    if (status.online) return "online";
    return "offline";
  }

  function connectionText(status) {
    const kind = connectionKind(status);
    if (kind === "unknown") return "Never seen";
    if (kind === "online") return "Online";
    return "Offline";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderLogin(error) {
    root.innerHTML =
      '<div class="metar-map"><div class="metar-card metar-login">' +
      "<h2>METAR map</h2>" +
      "<p>Private control for the LED weather map.</p>" +
      '<form class="metar-login-form" id="metar-login">' +
      '<label class="metar-field-label" for="metar-password">Password</label>' +
      '<input id="metar-password" name="password" type="password" autocomplete="current-password" required>' +
      (error ? '<p class="metar-error">' + escapeHtml(error) + "</p>" : "") +
      '<div class="metar-actions"><button class="metar-btn primary" type="submit">Log in</button></div>' +
      "</form></div></div>";

    document.getElementById("metar-login").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = document.getElementById("metar-password").value;
      try {
        const { res, data } = await api("/api/metar-map/login", {
          method: "POST",
          body: { password },
        });
        if (!res.ok) {
          renderLogin((data && data.error) === "unauthorized" ? "Wrong password." : "Could not log in.");
          return;
        }
        session = data.token || "";
        if (session) sessionStorage.setItem(SESSION_KEY, session);
        await loadAndRender();
      } catch {
        renderLogin("Can't reach the map service.");
      }
    });
  }

  function renderDashboard(status) {
    const pending = status.pendingCommandId > status.appliedCommandId;
    const busy = Boolean(status.loading || status.phase === "fetching" || optimisticLoading);
    const kind = connectionKind(status);
    const brightness = dragging
      ? Number(document.getElementById("metar-brightness")?.value || status.brightness)
      : status.desired && pending
        ? status.desired.brightness
        : status.brightness;
    const percent = Math.round((brightness * 100) / 255);
    const schedule = status.desired && pending ? status.desired.schedule : status.schedule;
    const displayOn = status.desired && pending ? status.desired.displayOn : status.displayOn;
    const intervalMs =
      status.desired && pending ? status.desired.refreshIntervalMs : status.refreshIntervalMs;
    const intervalMin = Math.round((intervalMs / 60000) * 100) / 100;

    let banner = "";
    if (busy) {
      banner = '<div class="metar-banner" role="status">Updating weather…</div>';
    } else if (pending) {
      banner =
        '<div class="metar-banner is-info" role="status">' +
        (kind === "online" ? "Sending to the map…" : "Saved. The map will apply this when it reconnects.") +
        "</div>";
    } else if (kind === "offline") {
      banner =
        '<div class="metar-banner is-info" role="status">Map is offline. Controls stay available and apply when it reconnects.</div>';
    } else if (kind === "unknown") {
      banner =
        '<div class="metar-banner is-info" role="status">Map has not checked in yet. Settings are saved for the first connection.</div>';
    }

    root.innerHTML =
      '<div class="metar-map">' +
      '<div class="metar-top"><span></span><button type="button" class="metar-logout" id="metar-logout">log out</button></div>' +
      '<div class="metar-card">' +
      "<h2>Connection</h2>" +
      '<div class="metar-status">' +
      '<span class="metar-pill is-' +
      kind +
      (busy ? " is-busy" : "") +
      '">' +
      escapeHtml(connectionText(status)) +
      "</span>" +
      (busy ? '<span class="metar-pill is-busy">Updating weather</span>' : "") +
      (pending && !busy ? '<span class="metar-pill">Sending…</span>' : "") +
      "</div>" +
      banner +
      "</div>" +
      '<div class="metar-card">' +
      "<h2>Power</h2>" +
      '<div class="metar-row"><label for="metar-power">Display</label>' +
      '<div class="metar-switch"><input id="metar-power" type="checkbox"' +
      (displayOn ? " checked" : "") +
      '><span></span></div></div>' +
      '<p class="metar-help">Manual on/off lasts until the next scheduled transition.</p>' +
      "</div>" +
      '<div class="metar-card">' +
      "<h2>Schedule</h2>" +
      '<div class="metar-row"><label for="metar-schedule">Auto on/off</label>' +
      '<div class="metar-switch"><input id="metar-schedule" type="checkbox"' +
      (schedule.enabled ? " checked" : "") +
      '><span></span></div></div>' +
      '<div class="metar-times">' +
      '<label>On <input id="metar-on" type="time" value="' +
      escapeHtml((schedule.on || "10:00").slice(0, 5)) +
      '"></label>' +
      '<label>Off <input id="metar-off" type="time" value="' +
      escapeHtml((schedule.off || "22:00").slice(0, 5)) +
      '"></label>' +
      "</div>" +
      '<p class="metar-help">Pacific Time (America/Los_Angeles). Overnight windows are fine. Turning the schedule off does not change the current power state.</p>' +
      "</div>" +
      '<div class="metar-card">' +
      "<h2>Brightness</h2>" +
      '<input id="metar-brightness" type="range" min="0" max="255" step="1" value="' +
      brightness +
      '">' +
      '<p class="metar-bright-readout" id="metar-bright-label">' +
      brightness +
      " / 255 · " +
      percent +
      "%</p>" +
      "</div>" +
      '<div class="metar-card">' +
      "<h2>Weather refresh</h2>" +
      '<label class="metar-field-label" for="metar-interval">Interval (minutes)</label>' +
      '<input id="metar-interval" type="number" min="0.25" step="0.25" value="' +
      intervalMin +
      '">' +
      '<p class="metar-help">Minimum 15 seconds (0.25 minutes). Default is 15 minutes.</p>' +
      '<div class="metar-actions"><button type="button" class="metar-btn primary" id="metar-refresh-now">Refresh now</button></div>' +
      "</div>" +
      '<div class="metar-card">' +
      "<h2>Last update</h2>" +
      '<dl class="metar-dl">' +
      "<dt>METARs</dt><dd>" +
      escapeHtml(humanizeMs(status.lastRefreshAgoMs)) +
      "</dd>" +
      "<dt>Status</dt><dd>" +
      escapeHtml(phaseLabel(status)) +
      "</dd>" +
      "<dt>Last error</dt><dd>" +
      escapeHtml(errorLabel(status.lastError)) +
      "</dd>" +
      (status.time ? "<dt>Map clock</dt><dd>" + escapeHtml(status.time) + " PT</dd>" : "") +
      "</dl>" +
      "</div></div>";

    document.getElementById("metar-logout").addEventListener("click", logout);
    document.getElementById("metar-power").addEventListener("change", async (event) => {
      await mutate("/api/metar-map/power", "PUT", { on: event.target.checked });
    });
    document.getElementById("metar-schedule").addEventListener("change", () => {
      queueSchedule();
    });
    document.getElementById("metar-on").addEventListener("change", queueSchedule);
    document.getElementById("metar-off").addEventListener("change", queueSchedule);
    const slider = document.getElementById("metar-brightness");
    slider.addEventListener("pointerdown", () => {
      dragging = true;
    });
    slider.addEventListener("input", () => {
      const value = Number(slider.value);
      const pct = Math.round((value * 100) / 255);
      document.getElementById("metar-bright-label").textContent = value + " / 255 · " + pct + "%";
      clearTimeout(brightnessTimer);
      brightnessTimer = setTimeout(() => putBrightness(value), DEBOUNCE_MS);
    });
    slider.addEventListener("change", () => {
      dragging = false;
      clearTimeout(brightnessTimer);
      putBrightness(Number(slider.value));
    });
    document.getElementById("metar-interval").addEventListener("change", queueInterval);
    document.getElementById("metar-refresh-now").addEventListener("click", refreshNow);
  }

  function isInteracting() {
    if (dragging) return true;
    const el = document.activeElement;
    return Boolean(el && root.contains(el) && (el.tagName === "INPUT" || el.tagName === "SELECT"));
  }

  function scheduleBody() {
    return {
      enabled: document.getElementById("metar-schedule").checked,
      on: document.getElementById("metar-on").value,
      off: document.getElementById("metar-off").value,
    };
  }

  function queueSchedule() {
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(() => mutate("/api/metar-map/schedule", "PUT", scheduleBody()), 300);
  }

  function queueInterval() {
    clearTimeout(intervalTimer);
    intervalTimer = setTimeout(putInterval, 300);
  }

  async function putInterval() {
    const minutes = Number(document.getElementById("metar-interval").value);
    if (!Number.isFinite(minutes)) return;
    await mutate("/api/metar-map/refresh", "PUT", { intervalMinutes: minutes });
  }

  async function putBrightness(value) {
    if (lastSentBrightness === value) return;
    lastSentBrightness = value;
    await mutate("/api/metar-map/brightness", "PUT", { value });
  }

  async function refreshNow() {
    optimisticLoading = true;
    if (lastStatus) renderDashboard(lastStatus);
    await mutate("/api/metar-map/refresh", "POST");
  }

  async function mutate(path, method, body) {
    try {
      const { res, data } = await api(path, { method, body });
      if (res.status === 401) {
        session = "";
        sessionStorage.removeItem(SESSION_KEY);
        renderLogin("Session expired.");
        return;
      }
      if (!res.ok) {
        if (lastStatus) renderDashboard(lastStatus);
        return;
      }
      lastStatus = data;
      if (data && (data.loading || data.phase === "fetching")) optimisticLoading = false;
      if (!isInteracting()) renderDashboard(data);
      schedulePoll(data);
    } catch {
      if (lastStatus) renderDashboard(lastStatus);
    }
  }

  async function logout() {
    try {
      await api("/api/metar-map/logout", { method: "POST", body: {} });
    } catch {
      /* ignore */
    }
    session = "";
    sessionStorage.removeItem(SESSION_KEY);
    stopPoll();
    renderLogin();
  }

  function stopPoll() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function schedulePoll(status) {
    stopPoll();
    const busy =
      Boolean(status && (status.loading || status.phase === "fetching" || optimisticLoading)) ||
      Boolean(status && status.pendingCommandId > status.appliedCommandId);
    pollTimer = setTimeout(loadAndRender, busy ? 1000 : 3000);
  }

  async function loadAndRender() {
    try {
      const { res, data } = await api("/api/metar-map/status");
      if (res.status === 401) {
        renderLogin();
        return;
      }
      if (!res.ok) {
        renderLogin("Could not load map status.");
        return;
      }
      lastStatus = data;
      if (data.loading || data.phase === "fetching") optimisticLoading = false;
      else if (data.pendingCommandId <= data.appliedCommandId) optimisticLoading = false;
      if (!isInteracting()) renderDashboard(data);
      schedulePoll(data);
    } catch {
      renderLogin("Can't reach the map service.");
    }
  }

  window.addEventListener("pointerup", () => {
    dragging = false;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPoll();
    else if (session || lastStatus) loadAndRender();
  });

  loadAndRender();
})();
