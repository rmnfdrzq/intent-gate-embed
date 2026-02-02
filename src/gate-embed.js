/**
 * Intent Gate Embed Script
 *
 * Auto Form Detection v1: precheck page URL, auto-detect application form.
 * Token persisted in localStorage. Gate opens in new tab; token via postMessage.
 *
 * @version 4.0.0
 */
(function () {
  "use strict";

  var API_BASE = "http://localhost:3000";
  var GATE_UI_BASE = "http://localhost:5173";
  var GATE_UI_ORIGIN = "http://localhost:5173";
  var DEFAULT_TIMEOUT_MS = 10000;
  var HANDSHAKE_TIMEOUT_MS = 5000;
  var MUTATION_OBSERVER_TIMEOUT_MS = 8000;
  var DEBOUNCE_MS = 250;
  var SCORE_THRESHOLD = 5;
  var SCORE_GAP_REQUIRED = 2;
  var DEBUG = false;

  var IG_READY = "IG_READY";
  var IG_INIT = "IG_INIT";

  var scriptElement = document.currentScript;

  if (!scriptElement) {
    console.warn("[IntentGate] Script element not found. Embed disabled.");
    return;
  }

  function tokenStorageKey(origin, gateId) {
    return "intent_gate_token:" + origin + ":" + gateId;
  }

  function skipOnceKey(gateId) {
    return "intent_gate_skip_once_" + gateId;
  }

  function getConfig() {
    var gateId = scriptElement.getAttribute("data-gate-id");
    var formSelector = scriptElement.getAttribute("data-form-selector");
    var submitSelector = scriptElement.getAttribute("data-submit-selector");

    if (!gateId) {
      console.warn("[IntentGate] Missing required attribute: data-gate-id");
      return null;
    }

    return {
      gateId: gateId,
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
            reject(new Error("Request failed: " + xhr.status));
          }
        }
      };

      xhr.onerror = function () {
        reject(new Error("Network error"));
      };

      xhr.send(data ? JSON.stringify(data) : undefined);
    });
  }

  function precheck(config) {
    return apiRequest("POST", "/v1/gates/" + encodeURIComponent(config.gateId) + "/embed/precheck", {
      origin: window.location.origin,
      pageUrl: window.location.href,
    }).then(function (r) {
      return r && r.ok === true;
    });
  }

  function issueToken(config) {
    return apiRequest("POST", "/v1/token/issue", {
      gateId: config.gateId,
      origin: window.location.origin,
      pageUrl: window.location.href,
    }).then(function (response) {
      if (response && response.tokenId && response.expiresAt) {
        return { tokenId: response.tokenId, expiresAt: response.expiresAt };
      }
      throw new Error("No tokenId in response");
    });
  }

  function verifyToken(tokenId, config) {
    return apiRequest("POST", "/v1/token/verify", {
      tokenId: tokenId,
      origin: window.location.origin,
      pageUrl: window.location.href,
    });
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
      console.warn("[IntentGate] Unable to store token");
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

  function showMessage(form, message, type) {
    var existing = form.querySelector(".intent-gate-message");
    if (existing) existing.remove();

    var msgEl = document.createElement("div");
    msgEl.className = "intent-gate-message";
    msgEl.style.cssText =
      "padding: 12px 16px; margin: 12px 0; border-radius: 4px; font-size: 14px;";

    if (type === "error") {
      msgEl.style.cssText += "background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;";
    } else {
      msgEl.style.cssText += "background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe;";
    }

    msgEl.textContent = message;
    form.insertBefore(msgEl, form.firstChild);
  }

  function showFallbackLink(form, config) {
    var existing = form.querySelector(".intent-gate-message");
    if (existing) existing.remove();

    var msgEl = document.createElement("div");
    msgEl.className = "intent-gate-message";
    msgEl.style.cssText =
      "padding: 12px 16px; margin: 12px 0; border-radius: 4px; font-size: 14px; background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;";

    var url = GATE_UI_BASE + "/g/" + encodeURIComponent(config.gateId);
    msgEl.innerHTML =
      "Popups may be blocked. Please allow popups and <a href='" +
      url +
      "' target='_blank' rel='noopener'>click here to open the check</a>.";
    form.insertBefore(msgEl, form.firstChild);
  }

  function hideMessage(form) {
    var existing = form.querySelector(".intent-gate-message");
    if (existing) existing.remove();
  }

  function setButtonLoading(button, loading) {
    if (loading) {
      button.disabled = true;
      button.setAttribute("data-original-text", button.textContent);
      button.textContent = "Please wait...";
    } else {
      button.disabled = false;
      var originalText = button.getAttribute("data-original-text");
      if (originalText) button.textContent = originalText;
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
        console.log("[IntentGate] Form score:", scored[s].score, scored[s].signals);
      }
    }

    var above = scored.filter(function (x) {
      return x.score >= SCORE_THRESHOLD;
    });

    if (above.length === 0) {
      console.warn("[IntentGate] No suitable application form detected");
      return null;
    }

    if (above.length > 1) {
      console.warn("[IntentGate] Multiple possible application forms detected, gate not attached");
      return null;
    }

    if (scored.length > 1 && scored[0].score - scored[1].score < SCORE_GAP_REQUIRED) {
      console.warn("[IntentGate] Ambiguous form selection, gate not attached");
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

  function openGateInNewTab(config) {
    var url = GATE_UI_BASE + "/g/" + encodeURIComponent(config.gateId);
    return window.open(url, "_blank");
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
      showFallbackLink(form, config);
      setButtonLoading(submitButton, false);
      return;
    }

    performHandshake(config, tokenId, gateWindow)
      .then(function () {
        showMessage(
          form,
          "A short check opened in a new tab. Complete it, then return here and click Submit again.",
          "info"
        );
      })
      .catch(function () {
        showFallbackLink(form, config);
      })
      .finally(function () {
        setButtonLoading(submitButton, false);
      });
  }

  function attachSubmitHandler(config, form, submitButton) {
    var nativeSubmit = form.submit.bind(form);

    form.addEventListener(
      "submit",
      function (e) {
        if (consumeSkipOnce(config)) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        var rec = getStoredTokenRecord(config);
        var tokenId = rec ? rec.tokenId : null;

        if (tokenId) {
          handleVerifySubmit(config, form, submitButton, tokenId);
        } else {
          handleFirstSubmit(config, form, submitButton);
        }
      },
      true
    );

    form.submit = function () {
      if (consumeSkipOnce(config)) {
        nativeSubmit();
        return;
      }
      handleFirstSubmit(config, form, submitButton);
    };
  }

  function handleFirstSubmit(config, form, submitButton) {
    setButtonLoading(submitButton, true);
    hideMessage(form);

    ensureTokenAndOpenGate(config, form, submitButton).catch(function (err) {
      console.warn("[IntentGate] Failed:", err.message);
      showMessage(form, "Unable to start the check. Please try again.", "error");
      setButtonLoading(submitButton, false);
    });
  }

  function handleVerifySubmit(config, form, submitButton, tokenId) {
    setButtonLoading(submitButton, true);
    hideMessage(form);

    verifyToken(tokenId, config)
      .then(function (response) {
        if (response && response.ok === true && response.status === "PASSED") {
          setSkipOnce(config);
          if (form.requestSubmit) {
            form.requestSubmit();
          } else {
            var ev = new Event("submit", { bubbles: true, cancelable: true });
            form.dispatchEvent(ev);
            if (!ev.defaultPrevented) {
              form.submit();
            }
          }
        } else {
          var status = response && response.status;
          if (status === "EXPIRED") {
            clearTokenRecord(config);
            return issueToken(config).then(function (data) {
              storeTokenRecord(config, data.tokenId, data.expiresAt);
              setButtonLoading(submitButton, false);
              return openGateAndHandshake(config, form, submitButton, data.tokenId);
            });
          }
          setButtonLoading(submitButton, false);
          openGateAndHandshake(config, form, submitButton, tokenId);
        }
      })
      .catch(function (err) {
        console.warn("[IntentGate] Verification failed:", err.message);
        showMessage(form, "Please complete the check.", "error");
      })
      .finally(function () {
        setButtonLoading(submitButton, false);
      });
  }

  function init() {
    var config = getConfig();
    if (!config) return;

    precheck(config)
      .then(function (allowed) {
        if (!allowed) {
          return;
        }

        return waitForForm(config).then(function (form) {
          if (!form) {
            if (config.formSelector) {
              console.warn("[IntentGate] Form not found for selector:", config.formSelector);
            } else {
              console.warn("[IntentGate] No suitable application form detected");
            }
            return;
          }

          var submitButton = getSubmitButton(form, config);
          if (!submitButton) {
            console.warn("[IntentGate] Submit button not found");
            return;
          }

          attachSubmitHandler(config, form, submitButton);
        });
      })
      .catch(function (err) {
        if (DEBUG) console.warn("[IntentGate] Precheck failed:", err.message);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
