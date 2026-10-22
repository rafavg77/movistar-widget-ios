// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: cyan; icon-glyph: mobile-alt;

/**
 * Mi Movistar Data Consumption Widget for iOS (Scriptable)
 *
 * Displays real-time mobile data usage, remaining GB, daily budget,
 * plan expiration/cutoff countdown, and recharge balance for Movistar México.
 *
 * Features:
 *  - Secure iOS Keychain credential and session storage.
 *  - Zero third-party cloud servers: requests travel directly from iPhone to Movistar.
 *  - Interactive WebView login helper for Google reCAPTCHA v3 compliance.
 *  - AES-256-GCM hardware-accelerated decryption using Movistar's guard key.
 *  - High-resolution DrawContext dual-color semicircular gauge.
 *  - Automatic offline JSON cache fallback when network is unavailable.
 *  - Supports both Small and Medium widget sizes.
 */

const CONFIG = {
  // Can be left empty; will be safely stored into iOS Keychain on first in-app run
  phone: "",
  password: "",
  token: "",
  useMockData: false, // Set to true to instantly test visual styling
  cacheFileName: "movistar_usage_cache.json",
  guardString: "MDM4MTg5NTQwNzIyNjEyNjc5MzM5MjE0NTMwMjgwNjg="
};

const COLORS = {
  bg: new Color("#0C1017"),
  cardBg: new Color("#161D2B"),
  pillBg: new Color("#1F293D"),
  brandBlue: new Color("#00A9E0"), // Movistar Cyan
  brandGreen: new Color("#5BC500"), // Movistar Accent Green
  spentRed: new Color("#FF453A"),
  white: new Color("#FFFFFF"),
  subtitleGray: new Color("#8E9AA8"),
  trackGray: new Color("#253043"),
  warnYellow: new Color("#FFD60A")
};

// ============================================================================
// MAIN CONTROLLER
// ============================================================================

async function main() {
  let usageData = null;

  if (CONFIG.useMockData) {
    usageData = getMockData();
  } else {
    try {
      const session = await getOrPromptSession();
      if (!session) {
        throw new Error("No active Movistar session available.");
      }
      usageData = await fetchMovistarData(session);
      saveCache(usageData);
    } catch (error) {
      console.warn("Network or authentication failed: " + error.message);
      usageData = loadCache();
      if (usageData) {
        usageData.fromCache = true;
      }
    }
  }

  const widget = createWidget(usageData);

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    const family = config.widgetFamily || "medium";
    if (family === "small") {
      await widget.presentSmall();
    } else {
      await widget.presentMedium();
    }
  }

  Script.complete();
}

// ============================================================================
// AUTHENTICATION & KEYCHAIN MANAGEMENT
// ============================================================================

function extractPid(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/[?&]p_id=([^&#\s]+)/);
  if (match) return decodeURIComponent(match[1]);
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return null; // URL without p_id is invalid
  }
  return trimmed;
}

async function getOrPromptSession() {
  // Check if token was passed via URL scheme (e.g. scriptable:///run?scriptName=Mi%20Movistar&p_id=...)
  if (typeof args !== "undefined" && args.queryParameters) {
    const qToken = args.queryParameters.p_id || args.queryParameters.token;
    if (qToken) {
      const clean = extractPid(qToken);
      if (clean) {
        Keychain.set("MOVISTAR_TOKEN", clean);
        return clean;
      }
    }
  }

  let token = Keychain.contains("MOVISTAR_TOKEN") ? Keychain.get("MOVISTAR_TOKEN") : CONFIG.token;

  // Sanitize: remove any legacy invalid tokens (such as raw URLs saved by mistake)
  if (token && (token.startsWith("http://") || token.startsWith("https://") || token.length < 15)) {
    console.warn("Clearing invalid legacy token from Keychain: " + token);
    Keychain.remove("MOVISTAR_TOKEN");
    token = null;
  }

  if (!token && !config.runsInWidget) {
    const alert = new Alert();
    alert.title = "Mi Movistar Setup";
    alert.message = "Choose an option to sign in and activate your widget:";
    alert.addAction("1. Web Login (In-App — Recommended)");
    alert.addAction("2. Paste Safari URL (With p_id)");
    alert.addAction("3. Test with Mock Data");
    alert.addCancelAction("Cancel");

    const choice = await alert.presentAlert();
    if (choice === 0) {
      token = await presentInteractiveLogin();
    } else if (choice === 1) {
      token = await promptPasteUrl();
    } else if (choice === 2) {
      CONFIG.useMockData = true;
      return null;
    }
  }

  return token;
}

async function promptPasteUrl() {
  const pasteAlert = new Alert();
  pasteAlert.title = "Paste Safari URL";
  pasteAlert.message = "Make sure the copied URL contains '?p_id=' (for example: https://mi.movistar.com.mx/consumptions?p_id=...):\n\nIf Safari doesn't show '?p_id=', use Option 1 (Web Login) instead.";
  pasteAlert.addTextField("Paste URL or p_id here", "");
  pasteAlert.addAction("Save");
  pasteAlert.addCancelAction("Cancel");

  if ((await pasteAlert.presentAlert()) === 0) {
    const rawInput = pasteAlert.textFieldValue(0).trim();
    const pid = extractPid(rawInput);
    if (pid && pid.length > 10) {
      Keychain.set("MOVISTAR_TOKEN", pid);
      const okAlert = new Alert();
      okAlert.title = "Session Saved!";
      okAlert.message = "Session token saved to Keychain. The widget will now load your consumption.";
      okAlert.addAction("OK");
      await okAlert.presentAlert();
      return pid;
    } else {
      const failAlert = new Alert();
      failAlert.title = "Invalid URL / Token";
      failAlert.message = "The text you pasted does not contain a session token (?p_id=...). Please use Option 1 ('Web Login') to sign in directly inside the app.";
      failAlert.addAction("OK");
      await failAlert.presentAlert();
    }
  }
  return null;
}

async function presentInteractiveLogin() {
  const wv = new WebView();
  await wv.loadURL("https://mi.movistar.com.mx/login");

  // Inject helper banner and AJAX response interceptor
  try {
    await wv.waitForLoad();
    const injectInterceptorScript = `
      (() => {
        // In-app visual banner
        if (!document.getElementById('agy-movistar-helper')) {
          const b = document.createElement('div');
          b.id = 'agy-movistar-helper';
          b.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#00A9E0;color:#ffffff;padding:14px 16px;text-align:center;font-family:-apple-system,sans-serif;font-size:13px;font-weight:600;z-index:99999999;box-shadow:0 3px 12px rgba(0,0,0,0.4);';
          b.innerHTML = '📱 <b>Mi Movistar:</b> Inicia sesión abajo. En cuanto entres, pulsa <b>Listo (Done)</b> arriba para activar tu widget.';
          document.body.prepend(b);
        }

        // Intercept XMLHttpRequest to capture authentication token immediately
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url) {
          this._agyUrl = url;
          return origOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function() {
          this.addEventListener('load', function() {
            try {
              if (this._agyUrl && this._agyUrl.includes('authenticate')) {
                const data = JSON.parse(this.responseText);
                if (data && data.content && data.content.ec_auth) {
                  window.__CAPTURED_PID__ = data.content.ec_auth;
                  localStorage.setItem('MOVISTAR_PID', data.content.ec_auth);
                  const banner = document.getElementById('agy-movistar-helper');
                  if (banner) {
                    banner.style.background = '#5BC500';
                    banner.innerHTML = '✅ <b>¡Sesión iniciada!</b> Pulsa <b>Listo (Done)</b> arriba a la izquierda para continuar.';
                  }
                }
              }
            } catch (_) {}
          });
          return origSend.apply(this, arguments);
        };

        // Watch URL changes
        setInterval(() => {
          try {
            const p = new URLSearchParams(window.location.search).get('p_id');
            if (p) {
              window.__CAPTURED_PID__ = p;
              localStorage.setItem('MOVISTAR_PID', p);
            }
          } catch (_) {}
        }, 500);
      })()
    `;
    await wv.evaluateJavaScript(injectInterceptorScript);
  } catch (_) {}

  // Present the modal webview to the user
  await wv.present(false);

  // Once dismissed, retrieve the intercepted token
  let capturedToken = null;
  try {
    capturedToken = await wv.evaluateJavaScript(`
      (() => {
        if (window.__CAPTURED_PID__) return window.__CAPTURED_PID__;
        try {
          const stored = localStorage.getItem('MOVISTAR_PID') || localStorage.getItem('p_id') || localStorage.getItem('ec_auth');
          if (stored) return stored;
        } catch (_) {}
        const p = new URLSearchParams(window.location.search).get('p_id');
        if (p) return p;
        return null;
      })()
    `);
  } catch (e) {
    console.warn("Could not evaluate JavaScript after modal dismiss: " + e.message);
  }

  // Fallback: check window.location.href
  if (!capturedToken) {
    try {
      const currentUrl = await wv.evaluateJavaScript("window.location.href");
      capturedToken = extractPid(currentUrl);
    } catch (_) {}
  }

  if (capturedToken && capturedToken.length > 10) {
    Keychain.set("MOVISTAR_TOKEN", capturedToken);
    const successAlert = new Alert();
    successAlert.title = "Login Successful!";
    successAlert.message = "Your Movistar session has been saved securely to iOS Keychain. Your widget will now update.";
    successAlert.addAction("OK");
    await successAlert.presentAlert();
    return capturedToken;
  } else {
    const notFoundAlert = new Alert();
    notFoundAlert.title = "Session Not Detected";
    notFoundAlert.message = "Please make sure you submit the login form and see your dashboard before tapping 'Done'.";
    notFoundAlert.addAction("OK");
    await notFoundAlert.presentAlert();
  }

  return null;
}

// ============================================================================
// DATA FETCHING & AES-256-GCM DECRYPTION
// ============================================================================

async function fetchMovistarData(token) {
  const url = "https://mi.movistar.com.mx/consumptions-controller/datos-iniciales";
  let responseJson = null;

  // Try direct Request with loadString
  try {
    const req = new Request(url);
    req.method = "GET";
    req.headers = {
      "Authorization": token,
      "Content-Type": "application/json",
      "Referer": "https://mi.movistar.com.mx/consumptions",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
    };

    const text = await req.loadString();
    if (text && text.trim().startsWith("{")) {
      responseJson = JSON.parse(text);
    } else {
      console.warn("Direct request returned non-JSON: " + (text ? text.slice(0, 100) : "empty"));
    }
  } catch (e) {
    console.warn("Direct request error: " + e.message);
  }

  // Fallback: Query via headless WebView (bypasses Cloudflare challenge)
  if (!responseJson || !responseJson.content) {
    console.log("Querying consumption data via headless WebView...");
    try {
      const wv = new WebView();
      await wv.loadURL("https://mi.movistar.com.mx/login");
      const script = `
        fetch("https://mi.movistar.com.mx/consumptions-controller/datos-iniciales", {
          method: "GET",
          headers: {
            "Authorization": "${token}",
            "Content-Type": "application/json"
          }
        })
        .then(r => r.text())
        .then(t => completion(t))
        .catch(err => completion(JSON.stringify({ error: err.message })));
      `;
      const resText = await wv.evaluateJavaScript(script, true);
      if (resText && typeof resText === "string" && resText.trim().startsWith("{")) {
        responseJson = JSON.parse(resText);
      }
    } catch (wvErr) {
      console.warn("Headless WebView error: " + wvErr.message);
    }
  }

  if (!responseJson || !responseJson.content) {
    throw new Error("Unable to read consumption data from Movistar. Your session may have expired; please re-authenticate using Option 1 (Web Login).");
  }

  const decryptedText = await decryptMovistarPayload(responseJson.content, CONFIG.guardString);
  const parsed = JSON.parse(decryptedText);
  return formatMovistarData(parsed);
}

async function decryptMovistarPayload(ciphertext, guardString) {
  const [encB64, ivB64] = ciphertext.split(":");
  if (!encB64 || !ivB64) {
    throw new Error("Malformed ciphertext, missing IV separator.");
  }

  // Use WebCrypto directly if available in JavaScriptCore runtime
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const pad = s => (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    const keyBytes = Uint8Array.from(atob(pad(guardString)), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(pad(ivB64)), c => c.charCodeAt(0));
    const encData = Uint8Array.from(atob(pad(encB64)), c => c.charCodeAt(0));

    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, encData);
    return new TextDecoder().decode(decrypted);
  }

  // Fallback to headless WebView evaluation using Scriptable's completion callback
  const wv = new WebView();
  await wv.loadURL("https://mi.movistar.com.mx/login");
  const script = `
    (async () => {
      try {
        const pad = s => (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
        const keyBytes = Uint8Array.from(atob(pad("${guardString}")), c => c.charCodeAt(0));
        const iv = Uint8Array.from(atob(pad("${ivB64}")), c => c.charCodeAt(0));
        const encData = Uint8Array.from(atob(pad("${encB64}")), c => c.charCodeAt(0));
        const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encData);
        completion(new TextDecoder().decode(decrypted));
      } catch (err) {
        completion(JSON.stringify({ error: err.message }));
      }
    })();
  `;
  const result = await wv.evaluateJavaScript(script, true);
  if (typeof result === "string" && result.startsWith('{"error":')) {
    const parsedErr = JSON.parse(result);
    throw new Error("Decryption failed: " + parsedErr.error);
  }
  return result;
}

function formatMovistarData(raw) {
  const planName = raw.offering || "Movistar Libre";
  let mainBag = null;
  const extraBags = [];

  if (Array.isArray(raw.bolton)) {
    for (const b of raw.bolton) {
      if (!mainBag && (b.name === "Navegación" || (b.consumptionLabel && (b.consumptionLabel.includes("GB") || b.consumptionLabel.includes("MB"))))) {
        mainBag = b;
      } else {
        extraBags.push(b);
      }
    }
  }

  let totalMB = 0;
  let consumedMB = 0;
  let availableMB = 0;
  let percentUsed = 0;
  let cutoffDate = "";
  let daysLeft = 1;

  if (mainBag) {
    cutoffDate = mainBag.vigencia || "";
    percentUsed = typeof mainBag.consumption === "number" ? mainBag.consumption : 0;

    const label = (mainBag.consumptionLabel || "").replace(/Llevas\s+/i, "");
    if (label.includes(" de ")) {
      const parts = label.split(" de ");
      consumedMB = parseUnitsToMB(parts[0]);
      totalMB = parseUnitsToMB(parts[1]);
    } else if (mainBag.totalBenefit) {
      totalMB = parseUnitsToMB(mainBag.totalBenefit);
      consumedMB = totalMB * (percentUsed / 100);
    }

    availableMB = Math.max(0, totalMB - consumedMB);

    if (cutoffDate) {
      daysLeft = computeDaysLeft(cutoffDate);
    }
  }

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");

  const dailyMB = daysLeft > 0 ? availableMB / daysLeft : availableMB;
  const rechargeBalance = raw.saldos?.totalBalance || "0.00";
  const balanceCutoff = raw.saldos?.topupsBalanceExpiration || "";

  return {
    planName,
    totalMB,
    consumedMB,
    availableMB,
    percentUsed,
    cutoffDate,
    daysLeft,
    dailyMB,
    rechargeBalance,
    balanceCutoff,
    extraBags,
    updatedAt: `${hh}:${mm}`,
    fromCache: false
  };
}

function parseUnitsToMB(str) {
  if (!str) return 0;
  const m = str.trim().match(/([\d.,]+)\s*(GB|MB|KB)?/i);
  if (!m) return 0;
  const val = parseFloat(m[1].replace(/,/g, ""));
  const unit = (m[2] || "MB").toUpperCase();
  if (unit === "GB") return val * 1024;
  if (unit === "KB") return val / 1024;
  return val;
}

function computeDaysLeft(dateStr) {
  const parts = dateStr.trim().split(/[/.-]/);
  if (parts.length < 3) return 1;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  const target = new Date(year, month, day, 23, 59, 59);
  const diffMs = target.getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, diffDays);
}

// ============================================================================
// CACHE HELPERS
// ============================================================================

function saveCache(data) {
  try {
    const fm = FileManager.local();
    const dir = fm.libraryDirectory();
    const path = fm.joinPath(dir, CONFIG.cacheFileName);
    fm.writeString(path, JSON.stringify(data));
  } catch (e) {
    console.warn("Could not save cache: " + e.message);
  }
}

function loadCache() {
  try {
    const fm = FileManager.local();
    const dir = fm.libraryDirectory();
    const path = fm.joinPath(dir, CONFIG.cacheFileName);
    if (fm.fileExists(path)) {
      const content = fm.readString(path);
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn("Could not read cache: " + e.message);
  }
  return null;
}

function getMockData() {
  return {
    planName: "Movistar Libre 10GB",
    totalMB: 10240,
    consumedMB: 6656,
    availableMB: 3584,
    percentUsed: 65,
    cutoffDate: "28/10/2026",
    daysLeft: 8,
    dailyMB: 448,
    rechargeBalance: "150.00",
    balanceCutoff: "28/10/2026",
    extraBags: [
      { name: "Redes Sociales", consumptionLabel: "Ilimitado" },
      { name: "Minutos y SMS", consumptionLabel: "Ilimitado" }
    ],
    updatedAt: "10:30",
    fromCache: false
  };
}

// ============================================================================
// UI DRAWING & WIDGET GENERATION
// ============================================================================

function drawArc(ctx, cx, cy, r, startAngle, endAngle, thickness, color) {
  if (endAngle - startAngle <= 0.005) return;
  const path = new Path();
  const steps = Math.max(12, Math.ceil((endAngle - startAngle) * 40));
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + ((endAngle - startAngle) * i) / steps;
    const pt = new Point(cx + r * Math.cos(a), cy + r * Math.sin(a));
    if (i === 0) path.move(pt);
    else path.addLine(pt);
  }
  ctx.addPath(path);
  ctx.setStrokeColor(color);
  ctx.setLineWidth(thickness);
  ctx.strokePath();

  ctx.setFillColor(color);
  const half = thickness / 2;
  for (const a of [startAngle, endAngle]) {
    ctx.fillEllipse(new Rect(cx + r * Math.cos(a) - half, cy + r * Math.sin(a) - half, thickness, thickness));
  }
}

function drawSemicircleGauge(spentRatio, mainLabel, subLabel) {
  const width = 360;
  const height = 180;
  const cx = width / 2;
  const cy = 150;
  const r = 120;
  const thickness = 22;

  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  // Background track (from PI to 2*PI)
  drawArc(ctx, cx, cy, r, Math.PI, 2 * Math.PI, thickness, COLORS.trackGray);

  // Red spent arc (from PI up to splitAngle)
  const clampedRatio = Math.min(1, Math.max(0, spentRatio));
  const splitAngle = Math.PI + clampedRatio * Math.PI;
  if (clampedRatio > 0.01) {
    drawArc(ctx, cx, cy, r, Math.PI, splitAngle, thickness, COLORS.spentRed);
  }

  // Brand Cyan/Green available arc (from splitAngle to 2*PI)
  if (clampedRatio < 0.99) {
    drawArc(ctx, cx, cy, r, splitAngle, 2 * Math.PI, thickness, COLORS.brandBlue);
  }

  // Draw center percentage
  ctx.setTextColor(COLORS.white);
  ctx.setFont(Font.boldSystemFont(46));
  ctx.setTextAlignedCenter();
  ctx.drawTextInRect(mainLabel, new Rect(0, 72, width, 52));

  // Draw sublabel
  ctx.setTextColor(COLORS.subtitleGray);
  ctx.setFont(Font.mediumSystemFont(17));
  ctx.drawTextInRect(subLabel, new Rect(0, 124, width, 24));

  return ctx.getImage();
}

function createWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(12, 14, 12, 14);

  const scriptName = (typeof Script !== "undefined" && Script.name && Script.name()) ? Script.name() : "Mi Movistar";
  w.url = "scriptable:///run?scriptName=" + encodeURIComponent(scriptName);

  if (!data) {
    const errorStack = w.addStack();
    errorStack.layoutVertically();
    const errTitle = errorStack.addText("Mi Movistar");
    errTitle.font = Font.boldSystemFont(14);
    errTitle.textColor = COLORS.brandBlue;
    errorStack.addSpacer(4);
    const errMsg = errorStack.addText("No session found.\nTap here to open Scriptable and sign in.");
    errMsg.font = Font.mediumSystemFont(12);
    errMsg.textColor = COLORS.white;
    return w;
  }

  const family = config.widgetFamily || "medium";
  if (family === "small") {
    buildSmallWidget(w, data);
  } else {
    buildMediumWidget(w, data);
  }

  return w;
}

function buildSmallWidget(w, data) {
  const ratio = data.totalMB > 0 ? data.consumedMB / data.totalMB : 0;
  const remainingGB = (data.availableMB / 1024).toFixed(2);
  const totalGB = (data.totalMB / 1024).toFixed(1);

  // Header row
  const header = w.addStack();
  header.layoutHorizontally();
  header.centerAlignContent();

  const brandText = header.addText("Movistar");
  brandText.font = Font.boldSystemFont(12);
  brandText.textColor = COLORS.brandBlue;

  header.addSpacer();

  const daysPill = header.addStack();
  daysPill.backgroundColor = COLORS.pillBg;
  daysPill.cornerRadius = 6;
  daysPill.setPadding(2, 6, 2, 6);
  const daysText = daysPill.addText(`${data.daysLeft}d left`);
  daysText.font = Font.semiboldSystemFont(10);
  daysText.textColor = data.daysLeft <= 3 ? COLORS.warnYellow : COLORS.white;

  w.addSpacer(2);

  // Gauge
  const gaugeImg = drawSemicircleGauge(ratio, `${data.percentUsed}%`, "USED");
  const imgWidget = w.addImage(gaugeImg);
  imgWidget.applyFillingContentMode();
  imgWidget.centerAlignImage();

  w.addSpacer(2);

  // Remaining Data Text
  const remStack = w.addStack();
  remStack.layoutHorizontally();
  remStack.centerAlignContent();
  const remNumber = remStack.addText(`${remainingGB} GB`);
  remNumber.font = Font.boldSystemFont(15);
  remNumber.textColor = COLORS.white;
  remStack.addSpacer(4);
  const remSub = remStack.addText(`of ${totalGB} GB`);
  remSub.font = Font.regularSystemFont(11);
  remSub.textColor = COLORS.subtitleGray;

  // Daily Allowance Pill
  w.addSpacer(4);
  const footerStack = w.addStack();
  footerStack.layoutHorizontally();
  footerStack.centerAlignContent();

  const dailyAllowance = data.dailyMB >= 1024
    ? `${(data.dailyMB / 1024).toFixed(2)} GB/d`
    : `${Math.round(data.dailyMB)} MB/d`;

  const dailyText = footerStack.addText(`Budget: ${dailyAllowance}`);
  dailyText.font = Font.mediumSystemFont(10);
  dailyText.textColor = COLORS.brandGreen;

  footerStack.addSpacer();

  const timeText = footerStack.addText(data.fromCache ? `${data.updatedAt} ⏳` : data.updatedAt);
  timeText.font = Font.regularSystemFont(9);
  timeText.textColor = COLORS.subtitleGray;
}

function buildMediumWidget(w, data) {
  const ratio = data.totalMB > 0 ? data.consumedMB / data.totalMB : 0;
  const remainingGB = (data.availableMB / 1024).toFixed(2);
  const totalGB = (data.totalMB / 1024).toFixed(1);

  const mainRow = w.addStack();
  mainRow.layoutHorizontally();
  mainRow.centerAlignContent();

  // Left Column: Semicircular Gauge
  const leftCol = mainRow.addStack();
  leftCol.layoutVertically();
  leftCol.size = new Size(130, 0);

  const gaugeImg = drawSemicircleGauge(ratio, `${data.percentUsed}%`, "CONSUMED");
  const imgWidget = leftCol.addImage(gaugeImg);
  imgWidget.applyFillingContentMode();

  leftCol.addSpacer(4);

  const dailyAllowance = data.dailyMB >= 1024
    ? `${(data.dailyMB / 1024).toFixed(2)} GB/day`
    : `${Math.round(data.dailyMB)} MB/day`;

  const budgetPill = leftCol.addStack();
  budgetPill.backgroundColor = COLORS.pillBg;
  budgetPill.cornerRadius = 6;
  budgetPill.setPadding(3, 8, 3, 8);
  const budgetText = budgetPill.addText(`⚡ ${dailyAllowance}`);
  budgetText.font = Font.semiboldSystemFont(10);
  budgetText.textColor = COLORS.brandGreen;

  mainRow.addSpacer(12);

  // Right Column: Breakdown details
  const rightCol = mainRow.addStack();
  rightCol.layoutVertically();

  // Top header: Brand & Plan name
  const brandHeader = rightCol.addStack();
  brandHeader.layoutHorizontally();
  brandHeader.centerAlignContent();

  const brandText = brandHeader.addText("Mi Movistar");
  brandText.font = Font.boldSystemFont(13);
  brandText.textColor = COLORS.brandBlue;

  brandHeader.addSpacer();

  const cutoffBadge = brandHeader.addStack();
  cutoffBadge.backgroundColor = COLORS.cardBg;
  cutoffBadge.cornerRadius = 5;
  cutoffBadge.setPadding(2, 6, 2, 6);
  const cutoffText = cutoffBadge.addText(data.cutoffDate ? `Cutoff ${data.cutoffDate}` : `${data.daysLeft}d left`);
  cutoffText.font = Font.mediumSystemFont(9.5);
  cutoffText.textColor = COLORS.subtitleGray;

  rightCol.addSpacer(4);

  // Plan subtitle
  const planSub = rightCol.addText(data.planName);
  planSub.font = Font.regularSystemFont(11);
  planSub.textColor = COLORS.subtitleGray;

  rightCol.addSpacer(8);

  // Remaining Data Block
  const dataBlock = rightCol.addStack();
  dataBlock.layoutHorizontally();
  dataBlock.bottomAlignContent();

  const gbBig = dataBlock.addText(remainingGB);
  gbBig.font = Font.boldSystemFont(22);
  gbBig.textColor = COLORS.white;

  dataBlock.addSpacer(4);

  const gbUnit = dataBlock.addText(`GB left of ${totalGB} GB`);
  gbUnit.font = Font.mediumSystemFont(11);
  gbUnit.textColor = COLORS.subtitleGray;

  rightCol.addSpacer(8);

  // Bottom info: Balance & Perks
  const bottomRow = rightCol.addStack();
  bottomRow.layoutHorizontally();
  bottomRow.centerAlignContent();

  const balanceBadge = bottomRow.addStack();
  balanceBadge.backgroundColor = COLORS.pillBg;
  balanceBadge.cornerRadius = 6;
  balanceBadge.setPadding(3, 7, 3, 7);
  const balanceText = balanceBadge.addText(`Balance: $${data.rechargeBalance}`);
  balanceText.font = Font.semiboldSystemFont(10);
  balanceText.textColor = COLORS.brandBlue;

  bottomRow.addSpacer();

  const perksBadge = bottomRow.addStack();
  perksBadge.backgroundColor = COLORS.pillBg;
  perksBadge.cornerRadius = 6;
  perksBadge.setPadding(3, 7, 3, 7);
  const perksText = perksBadge.addText(data.fromCache ? `${data.updatedAt} (cached)` : `Updated ${data.updatedAt}`);
  perksText.font = Font.regularSystemFont(9.5);
  perksText.textColor = COLORS.subtitleGray;
}

// Execute script
await main();
