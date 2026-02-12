/**
 * Intent Gate Embed Loader
 *
 * Loads the versioned embed script from manifest.json so the embed is never served from cache.
 * Run once; injects a single script tag with id="applyintent-embed-script" and copies
 * data-site-key (and other data-*) from this loader's script tag.
 */
(function () {
  "use strict";

  var EMBED_SCRIPT_ID = "applyintent-embed-script";
  var LOADER_SRC_SUFFIX = "/loader.js";
  var warned = false;

  function warnOnce(msg) {
    if (!warned) {
      warned = true;
      console.warn("[ApplyIntent] " + msg);
    }
  }

  function getLoaderScript() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || "";
      if (src.indexOf(LOADER_SRC_SUFFIX) !== -1 || src.endsWith(LOADER_SRC_SUFFIX)) return scripts[i];
    }
    return null;
  }

  if (document.getElementById(EMBED_SCRIPT_ID)) return;

  var loaderScript = getLoaderScript();
  if (!loaderScript) {
    warnOnce("Loader script tag not found. Embed disabled.");
    return;
  }

  var baseOrigin;
  try {
    baseOrigin = new URL(loaderScript.src).origin;
  } catch (e) {
    warnOnce("Could not parse loader script URL. Embed disabled.");
    return;
  }

  var manifestUrl = baseOrigin + "/manifest.json?ts=" + Date.now();
  fetch(manifestUrl, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  })
    .then(function (res) {
      if (!res.ok) throw new Error("manifest " + res.status);
      return res.json();
    })
    .then(function (manifest) {
      var path = manifest && manifest.embed;
      if (!path || typeof path !== "string") {
        warnOnce("Invalid manifest: missing embed path.");
        return;
      }
      var embedUrl = path.indexOf("http") === 0 ? path : baseOrigin + (path.charAt(0) === "/" ? path : "/" + path);

      var embedScript = document.createElement("script");
      embedScript.id = EMBED_SCRIPT_ID;
      embedScript.src = embedUrl;
      embedScript.async = true;

      var attrs = loaderScript.attributes;
      for (var j = 0; j < attrs.length; j++) {
        var a = attrs[j];
        if (a.name && a.name.indexOf("data-") === 0) embedScript.setAttribute(a.name, a.value || "");
      }

      var head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
      head.appendChild(embedScript);
    })
    .catch(function () {
      warnOnce("Failed to load embed manifest. Embed disabled.");
    });
})();
