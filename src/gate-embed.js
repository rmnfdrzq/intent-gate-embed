/**
 * Intent Gate Embed Script
 *
 * Auto gate resolution by page URL. No data-gate-id required.
 * Token persisted in localStorage. Gate opens in new tab; token via postMessage.
 *
 * Developer notes:
 * - pageUrl always uses window.location.href including query (full URL sent to API).
 * - origin is optional; when sent we use window.location.origin as-is (no client-side normalization; server normalizes).
 * - 400 "Invalid job page URL": we log a warning and fail open (no redirect, no blocked screen; intent check disabled on that page).
 * - Redirect loop guard: we avoid opening the gate again for the same page URL within a short window (sessionStorage).
 * - data-gate-id is not used (gate is resolved by siteKey + pageUrl). If data-return-url is ever used, default to window.location.href when missing.
 *
 * @version 5.0.0
 */
(function () {
  "use strict";

  var API_BASE = __API_BASE__;
  var GATE_UI_BASE = __GATE_UI_BASE__;
  var GATE_UI_ORIGIN = __GATE_UI_ORIGIN__;
  var HANDSHAKE_TIMEOUT_MS = __HANDSHAKE_TIMEOUT_MS__;
  var MUTATION_OBSERVER_TIMEOUT_MS = __MUTATION_OBSERVER_TIMEOUT_MS__;
  var DEBOUNCE_MS = __DEBOUNCE_MS__;
  var SCORE_THRESHOLD = __SCORE_THRESHOLD__;
  var SCORE_GAP_REQUIRED = __SCORE_GAP_REQUIRED__;
  var DEBUG = __DEBUG__;

  var REDIRECT_GUARD_WINDOW_MS = 10000; // 10 seconds
  var REDIRECT_GUARD_KEY = "intent_gate_last_open";
  var URL_CHANGE_DEBOUNCE_MS = 150;
  var INIT_AFTER_NAV_DELAY_MS = 250;

  var IG_READY = "IG_READY";
  var IG_INIT = "IG_INIT";
  var APPLYINTENT_SUBMIT_DECISION = "APPLYINTENT_SUBMIT_DECISION";
  var APPLYINTENT_GATE_PASSED = "APPLYINTENT_GATE_PASSED";
  var DECISION_CLOSE = "close";
  var DECISION_SUBMIT_ANYWAY = "submit_anyway";
  var INVALID_URL_LOG = "[ApplyIntent] Invalid job page URL. Intent check disabled on this page.";

  var pendingDecisionNonce = null;
  var pendingDecision = false;
  var allowOneSubmit = false;
  var pendingForm = null;
  var pendingConfig = null;
  var decisionListenerAdded = false;
  var attachedFormRef = null;
  var attachedConfigRef = null;

  var EMBED_SCRIPT_ID = "applyintent-embed-script";

  function getScriptElement() {
    if (document.currentScript) return document.currentScript;
    var byId = document.getElementById(EMBED_SCRIPT_ID);
    if (byId) return byId;
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      if (s.getAttribute("data-site-key") && (s.src || "").indexOf("embed.") !== -1) return s;
    }
    return null;
  }

  var scriptElement = getScriptElement();
  var lastSeenPath = "";
  var urlChangeDebounceTimer = null;

  if (!scriptElement) {
    console.warn("[ApplyIntent] Script element not found. Embed disabled.");
    return;
  }

  /** Full current page URL including query (and hash). Use this for all API pageUrl fields. */
  function getPageUrl() {
    return window.location.href;
  }

  /** Path + search + hash. Used to detect "same page" and to support hash-based SPA routing. */
  function getPagePath() {
    var loc = window.location;
    return loc.pathname + loc.search + (loc.hash || "");
  }

  function tokenStorageKey(origin, gateId) {
    return "intent_gate_token:" + origin + ":" + gateId;
  }

  function skipOnceKey(gateId) {
    return "intent_gate_skip_once_" + gateId;
  }

  function firstSubmitDoneKey(origin, gateId) {
    return "intent_gate_first_submit_done:" + origin + ":" + gateId;
  }

  function hasFirstSubmitBeenAllowed(config) {
    try {
      return sessionStorage.getItem(firstSubmitDoneKey(window.location.origin, config.gateId)) === "1";
    } catch (e) {
      return false;
    }
  }

  function setFirstSubmitDone(config) {
    try {
      sessionStorage.setItem(firstSubmitDoneKey(window.location.origin, config.gateId), "1");
    } catch (e) {}
  }

  function clearFirstSubmitDone(config) {
    try {
      sessionStorage.removeItem(firstSubmitDoneKey(window.location.origin, config.gateId));
    } catch (e) {}
  }

  function isInvalidJobPageUrlError(err) {
    if (!err || err.status !== 400) return false;
    var msg = (err.message || "").toLowerCase();
    return msg.indexOf("invalid") !== -1 && (msg.indexOf("job page") !== -1 || msg.indexOf("page url") !== -1);
  }

  function getConfig() {
    var siteKey = scriptElement.getAttribute("data-site-key");
    var formSelector = scriptElement.getAttribute("data-form-selector");
    var submitSelector = scriptElement.getAttribute("data-submit-selector");

    if (!siteKey) {
      console.warn("[ApplyIntent] Missing required attribute: data-site-key");
      return null;
    }

    return {
      siteKey: siteKey,
      formSelector: formSelector || null,
      submitSelector: submitSelector || null,
    };
  }

  function apiRequest(method, endpoint, data) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, API_BASE + endpoint, true);
      xhr.setRequestHeader("Content-Type", "application/json");

      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText || "{}"));
            } catch (e) {
              reject(new Error("Invalid JSON response"));
            }
          } else {
            var body = null;
            try {
              body = JSON.parse(xhr.responseText || "{}");
            } catch (e) {}
            var err = new Error(body && body.message ? body.message : "Request failed: " + xhr.status);
            err.status = xhr.status;
            err.body = body;
            reject(err);
          }
        }
      };

      xhr.onerror = function () {
        var err = new Error("Network error");
        err.status = 0;
        reject(err);
      };

      xhr.send(data ? JSON.stringify(data) : undefined);
    });
  }

  function resolveGate(config) {
    return apiRequest("POST", "/v1/gates/resolve", {
      siteKey: config.siteKey,
      pageUrl: getPageUrl(),
    });
  }

  function issueToken(config) {
    var payload = {
      gateId: config.gateId,
      pageUrl: getPageUrl(),
    };
    if (window.location.origin) {
      payload.origin = window.location.origin;
    }
    return apiRequest("POST", "/v1/token/issue", payload).then(function (response) {
      if (response && response.tokenId && response.expiresAt) {
        return { tokenId: response.tokenId, expiresAt: response.expiresAt };
      }
      throw new Error("No tokenId in response");
    });
  }

  function verifyToken(tokenId, config) {
    var payload = {
      tokenId: tokenId,
      pageUrl: getPageUrl(),
    };
    if (window.location.origin) {
      payload.origin = window.location.origin;
    }
    return apiRequest("POST", "/v1/token/verify", payload);
  }

  function getStoredTokenRecord(config) {
    try {
      var key = tokenStorageKey(window.location.origin, config.gateId);
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || !rec.tokenId) return null;
      return rec;
    } catch (e) {
      return null;
    }
  }

  function storeTokenRecord(config, tokenId, expiresAt) {
    try {
      var key = tokenStorageKey(window.location.origin, config.gateId);
      localStorage.setItem(key, JSON.stringify({ tokenId: tokenId, expiresAt: expiresAt }));
    } catch (e) {
      console.warn("[ApplyIntent] Unable to store token");
    }
  }

  function clearTokenRecord(config) {
    try {
      localStorage.removeItem(tokenStorageKey(window.location.origin, config.gateId));
    } catch (e) {}
  }

  function isTokenExpired(expiresAt) {
    if (!expiresAt) return true;
    try {
      var t = new Date(expiresAt).getTime();
      return isNaN(t) || t <= Date.now();
    } catch (e) {
      return true;
    }
  }

  function setSkipOnce(config) {
    try {
      sessionStorage.setItem(skipOnceKey(config.gateId), "1");
    } catch (e) {}
  }

  function consumeSkipOnce(config) {
    try {
      var key = skipOnceKey(config.gateId);
      var val = sessionStorage.getItem(key);
      if (val === "1") {
        sessionStorage.removeItem(key);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function getSubmitButton(form, config) {
    if (config.submitSelector) {
      var btn =
        form.querySelector(config.submitSelector) ||
        document.querySelector(config.submitSelector);
      if (btn) return btn;
    }
    return (
      form.querySelector('button[type="submit"]') ||
      form.querySelector('input[type="submit"]')
    );
  }

  var APP_KEYWORDS = ["resume", "cv", "cover", "portfolio", "linkedin", "github", "candidate", "application", "apply"];
  var APP_HEADING_KEYWORDS = ["apply", "application", "job", "role", "position"];
  var APP_BUTTON_KEYWORDS = ["apply", "submit application", "send application", "apply now"];
  var NEG_BUTTON_KEYWORDS = ["contact", "send message", "support", "help", "newsletter"];
  var NEG_FIELD_KEYWORDS = ["message", "subject", "support"];

  function textContains(text, keywords) {
    if (!text || typeof text !== "string") return false;
    var lower = text.toLowerCase();
    for (var i = 0; i < keywords.length; i++) {
      if (lower.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
  }

  function countInteractiveFields(form) {
    var inputs = form.querySelectorAll("input, select, textarea");
    var count = 0;
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var type = (el.type || "").toLowerCase();
      if (type === "hidden" || type === "submit") continue;
      if (type === "checkbox" || type === "radio") continue;
      count++;
    }
    return count;
  }

  function hasAncestor(el, tagNames, maxLevels) {
    maxLevels = maxLevels || 10;
    var current = el.parentElement;
    var level = 0;
    while (current && level < maxLevels) {
      if (tagNames.indexOf(current.tagName.toLowerCase()) !== -1) return true;
      current = current.parentElement;
      level++;
    }
    return false;
  }

  function getClosestHeading(form) {
    var current = form.parentElement;
    var level = 0;
    while (current && level < 3) {
      var h = current.querySelector("h1, h2, h3");
      if (h && h.textContent) return h.textContent;
      current = current.parentElement;
      level++;
    }
    return "";
  }

  function scoreForm(form) {
    var score = 0;
    var signals = [];

    if (form.querySelector('input[type="file"]')) {
      score += 4;
      signals.push("file");
    }

    if (form.querySelector("textarea")) {
      score += 1;
      signals.push("textarea");
    }

    var keywordCount = 0;
    var fields = form.querySelectorAll("input, select, textarea");
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var attrs = [
        (f.name || ""),
        (f.id || ""),
        (f.getAttribute("aria-label") || ""),
        (f.placeholder || ""),
      ].join(" ");
      for (var k = 0; k < APP_KEYWORDS.length && keywordCount < 2; k++) {
        if (attrs.toLowerCase().indexOf(APP_KEYWORDS[k]) !== -1) {
          keywordCount++;
          break;
        }
      }
    }
    var kwBonus = Math.min(keywordCount * 2, 4);
    score += kwBonus;
    if (kwBonus) signals.push("app_keywords");

    var submitBtn =
      form.querySelector('button[type="submit"]') ||
      form.querySelector('input[type="submit"]');
    if (submitBtn) {
      var btnText = (submitBtn.textContent || submitBtn.value || "").trim();
      if (textContains(btnText, APP_BUTTON_KEYWORDS)) {
        score += 2;
        signals.push("app_button");
      }
      if (textContains(btnText, NEG_BUTTON_KEYWORDS)) {
        score -= 4;
        signals.push("neg_button");
      }
    }

    var headingText = getClosestHeading(form);
    if (textContains(headingText, APP_HEADING_KEYWORDS)) {
      score += 2;
      signals.push("app_heading");
    }

    var hasNegField = false;
    for (var j = 0; j < fields.length; j++) {
      var attrs2 =
        (fields[j].name || "") +
        (fields[j].placeholder || "") +
        (fields[j].getAttribute("aria-label") || "");
      if (textContains(attrs2, NEG_FIELD_KEYWORDS)) {
        hasNegField = true;
        break;
      }
    }
    if (hasNegField) {
      score -= 3;
      signals.push("neg_field");
    }

    if (hasAncestor(form, ["footer", "nav"])) {
      score -= 2;
      signals.push("footer_nav");
    }

    var fieldCount = countInteractiveFields(form);
    if (fieldCount <= 2) {
      score -= 1;
      signals.push("few_fields");
    }

    return { score: score, signals: signals };
  }

  function discoverForm(config) {
    var forms = document.querySelectorAll("form");
    var scored = [];

    for (var i = 0; i < forms.length; i++) {
      var result = scoreForm(forms[i]);
      scored.push({ form: forms[i], score: result.score, signals: result.signals });
    }

    scored.sort(function (a, b) {
      return b.score - a.score;
    });

    if (DEBUG) {
      for (var s = 0; s < scored.length; s++) {
        console.log("[ApplyIntent] Form score:", scored[s].score, scored[s].signals);
      }
    }

    var above = scored.filter(function (x) {
      return x.score >= SCORE_THRESHOLD;
    });

    if (above.length === 0) {
      if (DEBUG) console.warn("[ApplyIntent] No suitable application form detected");
      return null;
    }

    if (above.length > 1) {
      if (DEBUG) console.warn("[ApplyIntent] Multiple possible application forms detected, gate not attached");
      return null;
    }

      if (scored.length > 1 && scored[0].score - scored[1].score < SCORE_GAP_REQUIRED) {
      if (DEBUG) console.warn("[ApplyIntent] Ambiguous form selection, gate not attached");
      return null;
    }

    return above[0].form;
  }

  function waitForForm(config) {
    return new Promise(function (resolve) {
      function tryDiscover() {
        if (config.formSelector) {
          var form = document.querySelector(config.formSelector);
          if (form) {
            resolve(form);
            return true;
          }
          return false;
        }
        var form = discoverForm(config);
        if (form) {
          resolve(form);
          return true;
        }
        return false;
      }

      if (tryDiscover()) return;

      var debounceTimer = null;
      var observer = new MutationObserver(function () {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          if (tryDiscover()) {
            observer.disconnect();
          }
        }, DEBOUNCE_MS);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setTimeout(function () {
        observer.disconnect();
        if (debounceTimer) clearTimeout(debounceTimer);
        var form = config.formSelector
          ? document.querySelector(config.formSelector)
          : discoverForm(config);
        resolve(form || null);
      }, MUTATION_OBSERVER_TIMEOUT_MS);
    });
  }

  function getRedirectGuardData() {
    try {
      var raw = sessionStorage.getItem(REDIRECT_GUARD_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function setRedirectGuard() {
    try {
      sessionStorage.setItem(
        REDIRECT_GUARD_KEY,
        JSON.stringify({ url: getPageUrl(), at: Date.now() })
      );
    } catch (e) {}
  }

  function shouldSkipOpenDueToGuard() {
    var data = getRedirectGuardData();
    if (!data || !data.url || data.at == null) return false;
    if (data.url !== getPageUrl()) return false;
    return Date.now() - data.at < REDIRECT_GUARD_WINDOW_MS;
  }

  function openGateInNewTab(config) {
    if (shouldSkipOpenDueToGuard()) {
      console.warn("[ApplyIntent] Skipping gate open (recent open for this page); possible loop avoided.");
      return null;
    }
    setRedirectGuard();
    var url = GATE_UI_BASE + "/g/" + encodeURIComponent(config.gateId);
    return window.open(url, "_blank");
  }

  function generateNonce() {
    var arr = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
    } else {
      for (var i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    var hex = "";
    for (var j = 0; j < arr.length; j++) hex += ("0" + arr[j].toString(16)).slice(-2);
    return hex;
  }

  function buildAlreadySubmittedUrl(config, nonce) {
    var pageUrl = encodeURIComponent(getPageUrl());
    var openerOrigin = encodeURIComponent(window.location.origin);
    return (
      GATE_UI_BASE +
      "/embed/already-submitted?nonce=" +
      encodeURIComponent(nonce) +
      "&gateId=" +
      encodeURIComponent(config.gateId) +
      "&pageUrl=" +
      pageUrl +
      "&openerOrigin=" +
      openerOrigin +
      "&v=1"
    );
  }

  function addDecisionMessageListener() {
    if (decisionListenerAdded) return;
    decisionListenerAdded = true;
    window.addEventListener("message", function (ev) {
      if (ev.origin !== GATE_UI_ORIGIN) return;
      var data = ev.data;
      if (!data || typeof data !== "object") return;

      if (data.type === APPLYINTENT_GATE_PASSED) {
        var cfg = attachedConfigRef;
        var form = attachedFormRef;
        if (form && cfg && data.gateId === cfg.gateId) {
          allowOneSubmit = true;
          setFirstSubmitDone(cfg);
          if (form.requestSubmit) {
            form.requestSubmit();
          } else {
            try {
              HTMLFormElement.prototype.submit.call(form);
            } catch (e) {
              form.submit();
            }
          }
        }
        return;
      }

      if (data.type !== APPLYINTENT_SUBMIT_DECISION) return;
      if (data.nonce !== pendingDecisionNonce) return;
      var decision = data.decision;
      if (decision !== DECISION_CLOSE && decision !== DECISION_SUBMIT_ANYWAY) return;

      pendingDecision = false;
      pendingDecisionNonce = null;
      var form = pendingForm;
      var cfg = pendingConfig;
      pendingForm = null;
      pendingConfig = null;

      if (DEBUG) console.log("[ApplyIntent] Decision received:", decision);

      if (decision === DECISION_CLOSE) {
        return;
      }
      if (decision === DECISION_SUBMIT_ANYWAY && form) {
        allowOneSubmit = true;
        if (form.requestSubmit) {
          form.requestSubmit();
        } else {
          form.submit();
        }
      }
    });
  }

  function performHandshake(config, tokenId, gateWindow) {
    return new Promise(function (resolve, reject) {
      var resolved = false;
      var timeoutId;

      function cleanup() {
        window.removeEventListener("message", handler);
        if (timeoutId) clearTimeout(timeoutId);
      }

      function sendInit(win) {
        if (!win || win.closed) return false;
        try {
          win.postMessage(
            { type: IG_INIT, gateId: config.gateId, tokenId: tokenId },
            GATE_UI_ORIGIN
          );
          return true;
        } catch (e) {
          return false;
        }
      }

      function handler(ev) {
        if (resolved) return;
        if (ev.origin !== GATE_UI_ORIGIN) return;
        if (ev.data && ev.data.type === IG_READY && ev.data.gateId === config.gateId) {
          resolved = true;
          cleanup();
          if (sendInit(gateWindow)) {
            resolve();
          } else {
            reject(new Error("Failed to send IG_INIT"));
          }
        }
      }

      window.addEventListener("message", handler);

      timeoutId = setTimeout(function () {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error("Handshake timeout"));
        }
      }, HANDSHAKE_TIMEOUT_MS);

      var attempts = 0;
      var maxAttempts = 5;
      var retryInterval = 400;

      function trySend() {
        if (resolved) return;
        sendInit(gateWindow);
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(trySend, retryInterval);
        }
      }

      setTimeout(trySend, 100);
    });
  }

  function ensureTokenAndOpenGate(config, form, submitButton) {
    var rec = getStoredTokenRecord(config);
    var tokenId = null;

    if (rec && rec.tokenId && !isTokenExpired(rec.expiresAt)) {
      tokenId = rec.tokenId;
    } else {
      clearTokenRecord(config);
      return issueToken(config).then(function (data) {
        tokenId = data.tokenId;
        storeTokenRecord(config, data.tokenId, data.expiresAt);
        return openGateAndHandshake(config, form, submitButton, data.tokenId);
      });
    }

    return openGateAndHandshake(config, form, submitButton, tokenId);
  }

  function openGateAndHandshake(config, form, submitButton, tokenId) {
    var gateWindow = openGateInNewTab(config);
    if (!gateWindow) {
      console.warn("[ApplyIntent] Popup blocked, could not open gate");
      return Promise.resolve();
    }
    return performHandshake(config, tokenId, gateWindow);
  }

  function attachSubmitHandler(config, form, submitButton) {
    var nativeSubmit = form.submit.bind(form);
    var isHandling = false;

    attachedFormRef = form;
    attachedConfigRef = config;
    addDecisionMessageListener();

    function handleSubmit() {
      if (allowOneSubmit) {
        allowOneSubmit = false;
        return;
      }
      if (consumeSkipOnce(config)) return;
      if (isHandling) return;
      isHandling = true;

      var rec = getStoredTokenRecord(config);
      var tokenId = rec ? rec.tokenId : null;
      var p = tokenId
        ? handleVerifySubmit(config, form, submitButton, tokenId)
        : handleFirstSubmit(config, form, submitButton);
      if (p && typeof p.finally === "function") {
        p.finally(function () {
          isHandling = false;
        });
      } else {
        isHandling = false;
      }
    }

    form.addEventListener(
      "submit",
      function (e) {
        if (allowOneSubmit) {
          allowOneSubmit = false;
          setFirstSubmitDone(config);
          return;
        }
        if (consumeSkipOnce(config)) return;
        e.preventDefault();
        e.stopPropagation();
        handleSubmit();
      },
      true
    );

    form.submit = function () {
      if (allowOneSubmit) {
        allowOneSubmit = false;
        setFirstSubmitDone(config);
        nativeSubmit();
        return;
      }
      if (consumeSkipOnce(config)) {
        nativeSubmit();
        return;
      }
      handleSubmit();
    };
  }

  function handleFirstSubmit(config, form, submitButton) {
    return ensureTokenAndOpenGate(config, form, submitButton).catch(function (err) {
      if (isInvalidJobPageUrlError(err)) {
        console.warn(INVALID_URL_LOG);
        return;
      }
      console.warn("[ApplyIntent] Failed:", err.message);
    });
  }

  function handleVerifySubmit(config, form, submitButton, tokenId) {
    return verifyToken(tokenId, config)
      .then(function (response) {
        if (response && response.ok === true && response.status === "PASSED") {
          if (!hasFirstSubmitBeenAllowed(config)) {
            if (form.requestSubmit) {
              allowOneSubmit = true;
              form.requestSubmit();
            } else {
              setFirstSubmitDone(config);
              try {
                HTMLFormElement.prototype.submit.call(form);
              } catch (e) {
                form.submit();
              }
            }
            return;
          }
          if (pendingDecision) {
            if (DEBUG) console.log("[ApplyIntent] Already showing warning; submission blocked.");
            return;
          }
          var nonce = generateNonce();
          pendingDecisionNonce = nonce;
          pendingDecision = true;
          pendingForm = form;
          pendingConfig = config;
          var url = buildAlreadySubmittedUrl(config, nonce);
          if (DEBUG) console.log("[ApplyIntent] Opening already-submitted warning.");
          var win = window.open(url, "_blank");
          if (!win) {
            console.warn("[ApplyIntent] Popup blocked; allowing submission.");
            pendingDecision = false;
            pendingDecisionNonce = null;
            pendingForm = null;
            pendingConfig = null;
            if (form.requestSubmit) {
              allowOneSubmit = true;
              form.requestSubmit();
            } else {
              try {
                HTMLFormElement.prototype.submit.call(form);
              } catch (e) {
                allowOneSubmit = true;
                form.submit();
              }
            }
          }
          return;
        }
        var status = response && response.status;
        if (status === "EXPIRED") {
          clearTokenRecord(config);
          clearFirstSubmitDone(config);
          return issueToken(config).then(function (data) {
            storeTokenRecord(config, data.tokenId, data.expiresAt);
            return openGateAndHandshake(config, form, submitButton, data.tokenId);
          });
        }
        clearFirstSubmitDone(config);
        return openGateAndHandshake(config, form, submitButton, tokenId);
      })
      .catch(function (err) {
        if (isInvalidJobPageUrlError(err)) {
          console.warn(INVALID_URL_LOG);
          return;
        }
        console.warn("[ApplyIntent] Verification failed:", err.message);
      });
  }

  /**
   * Run init for the current page: resolve gate by URL, find form, attach only if still on same page.
   * "Same page" = same pathname+search (hash changes do not abort).
   */
  function init() {
    var config = getConfig();
    if (!config) return;

    var runPath = getPagePath();

    // First, ensure there is an application form on the page.
    // If no form is found, we bail out early and avoid any API calls.
    waitForForm(config).then(function (form) {
      if (getPagePath() !== runPath) return;

          if (!form) {
        if (config.formSelector) {
          console.warn("[ApplyIntent] Form not attached: selector not found:", config.formSelector);
        } else {
          console.warn("[ApplyIntent] Form not attached: no suitable application form detected");
        }
        return;
      }

      // Form exists – now resolve gate by URL and attach only if gate is found.
      resolveGate(config)
        .then(function (result) {
          if (getPagePath() !== runPath) return;
          if (!result || result.found !== true || !result.gateId) {
            return;
          }

          var resolvedConfig = {
            gateId: result.gateId,
            formSelector: config.formSelector,
            submitSelector: config.submitSelector,
          };

          var submitButton = getSubmitButton(form, resolvedConfig);
          if (!submitButton) {
            console.warn("[ApplyIntent] Submit button not found");
            return;
          }

          attachSubmitHandler(resolvedConfig, form, submitButton);
          console.log("[ApplyIntent] Form attached successfully");
        })
        .catch(function (err) {
          if (getPagePath() !== runPath) return;
          if (isInvalidJobPageUrlError(err)) {
            console.warn(INVALID_URL_LOG);
            return;
          }
          console.warn(
            "[ApplyIntent] Form not attached: resolve failed (" +
              (err && err.message ? err.message : "request error") +
              ")"
          );
        });
    });
  }

  function onUrlChange() {
    var path = getPagePath();
    if (path === lastSeenPath) return;
    lastSeenPath = path;
    // Delay init so SPA has time to replace DOM with the new page before we look for the form
    setTimeout(function () {
      if (getPagePath() !== path) return;
      init();
    }, INIT_AFTER_NAV_DELAY_MS);
  }

  function scheduleUrlChange() {
    if (urlChangeDebounceTimer) clearTimeout(urlChangeDebounceTimer);
    urlChangeDebounceTimer = setTimeout(function () {
      urlChangeDebounceTimer = null;
      onUrlChange();
    }, URL_CHANGE_DEBOUNCE_MS);
  }

  /**
   * Listen for SPA navigation: history API and hashchange.
   */
  function setupUrlChangeListener() {
    lastSeenPath = getPagePath();
    try {
      var pushState = history.pushState;
      var replaceState = history.replaceState;
      if (typeof pushState === "function" && typeof replaceState === "function") {
        history.pushState = function () {
          pushState.apply(this, arguments);
          scheduleUrlChange();
        };
        history.replaceState = function () {
          replaceState.apply(this, arguments);
          scheduleUrlChange();
        };
      }
      window.addEventListener("popstate", scheduleUrlChange);
      window.addEventListener("hashchange", scheduleUrlChange);
    } catch (e) {
      /* ignore */
    }
  }

  function runEmbed() {
    setupUrlChangeListener();
    init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runEmbed);
  } else {
    runEmbed();
  }
})();
