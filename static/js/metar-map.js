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
  let dashboardReady = false;

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

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = $(id);
    if (el && el.textContent !== value) el.textContent = value;
  }

  function setHidden(id, hidden) {
    const el = $(id);
    if (el) el.hidden = hidden;
  }

  function fieldBusy(el) {
    return Boolean(el && (document.activeElement === el || dragging));
  }

  function setChecked(id, value) {
    const el = $(id);
    if (!el || fieldBusy(el)) return;
    if (el.checked !== value) el.checked = value;
  }

  function setValue(id, value) {
    const el = $(id);
    if (!el || fieldBusy(el)) return;
    if (String(el.value) !== String(value)) el.value = value;
  }

  function viewModel(status) {
    const pending = status.pendingCommandId > status.appliedCommandId;
    const busy = Boolean(status.loading || status.phase === "fetching" || optimisticLoading);
    const kind = connectionKind(status);
    const brightness = dragging
      ? Number($("metar-brightness")?.value || status.brightness)
      : status.desired && pending
        ? status.desired.brightness
        : status.brightness;
    const schedule = status.desired && pending ? status.desired.schedule : status.schedule;
    const displayOn = status.desired && pending ? status.desired.displayOn : status.displayOn;
    const intervalMs =
      status.desired && pending ? status.desired.refreshIntervalMs : status.refreshIntervalMs;
    let banner = "";
    let bannerInfo = true;
    if (busy) {
      banner = "Updating weather…";
      bannerInfo = false;
    } else if (pending) {
      banner = kind === "online" ? "Sending to the map…" : "Saved. The map will apply this when it reconnects.";
    } else if (kind === "offline") {
      banner = "Map is offline. Controls stay available and apply when it reconnects.";
    } else if (kind === "unknown") {
      banner = "Map has not checked in yet. Settings are saved for the first connection.";
    }
    return {
      pending,
      busy,
      kind,
      brightness,
      percent: Math.round((brightness * 100) / 255),
      schedule,
      displayOn,
      intervalMin: Math.round((intervalMs / 60000) * 100) / 100,
      banner,
      bannerInfo,
    };
  }

  function renderLogin(error) {
    dashboardReady = false;
    root.innerHTML =
      '<div class="metar-map metar-enter"><div class="metar-card metar-login">' +
      "<h2>METAR map</h2>" +
      "<p>Private control for the LED weather map.</p>" +
      '<form class="metar-login-form" id="metar-login">' +
      '<label class="metar-field-label" for="metar-password">Password</label>' +
      '<input id="metar-password" name="password" type="password" autocomplete="current-password" required>' +
      (error ? '<p class="metar-error">' + escapeHtml(error) + "</p>" : "") +
      '<div class="metar-actions"><button class="metar-btn primary" type="submit">Log in</button></div>' +
      "</form></div></div>";

    $("metar-login").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = $("metar-password").value;
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

  function mountDashboard() {
    if (dashboardReady) return;
    root.innerHTML =
      '<div class="metar-map metar-enter">' +
      '<div class="metar-top"><span></span><button type="button" class="metar-logout" id="metar-logout">log out</button></div>' +
      '<div class="metar-card">' +
      "<h2>Connection</h2>" +
      '<div class="metar-status">' +
      '<span class="metar-pill" id="metar-pill-conn">Online</span>' +
      '<span class="metar-pill is-busy" id="metar-pill-busy" hidden>Updating weather</span>' +
      '<span class="metar-pill" id="metar-pill-send" hidden>Sending…</span>' +
      "</div>" +
      '<div class="metar-banner is-info" id="metar-banner" hidden></div>' +
      "</div>" +
      '<div class="metar-card">' +
      "<h2>Power</h2>" +
      '<div class="metar-row"><label for="metar-power">Display</label>' +
      '<div class="metar-switch"><input id="metar-power" type="checkbox"><span></span></div></div>' +
      '<p class="metar-help">Manual on/off lasts until the next scheduled transition.</p>' +
      "</div>" +
      '<div class="metar-card">' +
      "<h2>Schedule</h2>" +
      '<div class="metar-row"><label for="metar-schedule">Auto on/off</label>' +
      '<div class="metar-switch"><input id="metar-schedule" type="checkbox"><span></span></div></div>' +
      '<div class="metar-times">' +
      '<label>On <input id="metar-on" type="time" value="10:00"></label>' +
      '<label>Off <input id="metar-off" type="time" value="22:00"></label>' +
      "</div>" +
      '<p class="metar-help">Pacific Time (America/Los_Angeles). Overnight windows are fine. Turning the schedule off does not change the current power state.</p>' +
      "</div>" +
      '<div class="metar-card">' +
      "<h2>Brightness</h2>" +
      '<input id="metar-brightness" type="range" min="0" max="255" step="1" value="20">' +
      '<p class="metar-bright-readout" id="metar-bright-label">20 / 255 · 8%</p>' +
      "</div>" +
      '<div class="metar-card">' +
      "<h2>Weather refresh</h2>" +
      '<label class="metar-field-label" for="metar-interval">Interval (minutes)</label>' +
      '<input id="metar-interval" type="number" min="0.25" step="0.25" value="15">' +
      '<p class="metar-help">Minimum 15 seconds (0.25 minutes). Default is 15 minutes.</p>' +
      '<div class="metar-actions"><button type="button" class="metar-btn primary" id="metar-refresh-now">Refresh now</button></div>' +
      "</div>" +
      '<div class="metar-card">' +
      "<h2>Last update</h2>" +
      '<dl class="metar-dl">' +
      "<dt>METARs</dt><dd id=\"metar-last-metar\">never</dd>" +
      "<dt>Status</dt><dd id=\"metar-last-phase\">Idle</dd>" +
      "<dt>Last error</dt><dd id=\"metar-last-error\">None</dd>" +
      '<dt id="metar-clock-dt" hidden>Map clock</dt><dd id="metar-clock-dd" hidden></dd>' +
      "</dl>" +
      "</div></div>";

    $("metar-logout").addEventListener("click", logout);
    $("metar-power").addEventListener("change", async (event) => {
      await mutate("/api/metar-map/power", "PUT", { on: event.target.checked });
    });
    $("metar-schedule").addEventListener("change", queueSchedule);
    $("metar-on").addEventListener("change", queueSchedule);
    $("metar-off").addEventListener("change", queueSchedule);
    const slider = $("metar-brightness");
    slider.addEventListener("pointerdown", () => {
      dragging = true;
    });
    slider.addEventListener("input", () => {
      const value = Number(slider.value);
      const pct = Math.round((value * 100) / 255);
      setText("metar-bright-label", value + " / 255 · " + pct + "%");
      clearTimeout(brightnessTimer);
      brightnessTimer = setTimeout(() => putBrightness(value), DEBOUNCE_MS);
    });
    slider.addEventListener("change", () => {
      dragging = false;
      clearTimeout(brightnessTimer);
      putBrightness(Number(slider.value));
    });
    $("metar-interval").addEventListener("change", queueInterval);
    $("metar-refresh-now").addEventListener("click", refreshNow);
    dashboardReady = true;
  }

  function showDashboard(status) {
    mountDashboard();
    const vm = viewModel(status);
    const conn = $("metar-pill-conn");
    if (conn) {
      conn.className = "metar-pill is-" + vm.kind + (vm.busy ? " is-busy" : "");
      setText("metar-pill-conn", connectionText(status));
    }
    setHidden("metar-pill-busy", !vm.busy);
    setHidden("metar-pill-send", !(vm.pending && !vm.busy));

    const banner = $("metar-banner");
    if (banner) {
      banner.hidden = !vm.banner;
      banner.className = "metar-banner" + (vm.bannerInfo ? " is-info" : "");
      if (vm.banner && banner.textContent !== vm.banner) banner.textContent = vm.banner;
    }

    setChecked("metar-power", Boolean(vm.displayOn));
    setChecked("metar-schedule", Boolean(vm.schedule.enabled));
    setValue("metar-on", (vm.schedule.on || "10:00").slice(0, 5));
    setValue("metar-off", (vm.schedule.off || "22:00").slice(0, 5));
    setValue("metar-brightness", vm.brightness);
    if (!dragging) setText("metar-bright-label", vm.brightness + " / 255 · " + vm.percent + "%");
    setValue("metar-interval", vm.intervalMin);

    setText("metar-last-metar", humanizeMs(status.lastRefreshAgoMs));
    setText("metar-last-phase", phaseLabel(status));
    setText("metar-last-error", errorLabel(status.lastError));
    const hasClock = Boolean(status.time);
    setHidden("metar-clock-dt", !hasClock);
    setHidden("metar-clock-dd", !hasClock);
    if (hasClock) setText("metar-clock-dd", status.time + " PT");
  }

  function scheduleBody() {
    return {
      enabled: $("metar-schedule").checked,
      on: $("metar-on").value,
      off: $("metar-off").value,
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
    const minutes = Number($("metar-interval").value);
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
    if (lastStatus) showDashboard(lastStatus);
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
      if (!res.ok) return;
      lastStatus = data;
      if (data && (data.loading || data.phase === "fetching")) optimisticLoading = false;
      showDashboard(data);
      schedulePoll(data);
    } catch {
      /* keep the current screen */
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
      showDashboard(data);
      schedulePoll(data);
    } catch {
      if (!dashboardReady) renderLogin("Can't reach the map service.");
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
