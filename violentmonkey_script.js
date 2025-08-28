// ==UserScript==
// @name         Discord token-guard (substring match, ignore shadows)
// @namespace    local.discord.token.guard
// @match        https://discord.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const SHADOW_PREFIX = "__t_guard_shadow__";

  // Case-insensitive check: protect any key that contains "token"
  function isProtectedKey(k) {
    return (
      typeof k === "string" &&
      !k.startsWith(SHADOW_PREFIX) && // ignore shadow keys
      k.toLowerCase().includes("token")
    );
  }

  function shadowKeyFor(k) {
    return SHADOW_PREFIX + k;
  }

  // Helpers
  function ls() {
    try {
      return window.localStorage;
    } catch (_) {
      return null;
    }
  }
  function readLS(key) {
    const s = ls();
    return s ? s.getItem(key) : null;
  }
  function writeLS(key, val) {
    const s = ls();
    if (s) s.setItem(key, val);
  }

  function updateShadow(k, val) {
    if (typeof val === "string" && val.length > 0 && isProtectedKey(k)) {
      writeLS(shadowKeyFor(k), val);
    }
  }

  const SP = Storage.prototype;
  const origGet = SP.getItem;
  const origSet = SP.setItem;
  const origRemove = SP.removeItem;
  const origClear = SP.clear;

  // getItem override
  SP.getItem = function (k) {
    const val = origGet.call(this, k);
    if (this === window.localStorage && isProtectedKey(k)) {
      if (typeof val === "string" && val.length > 0) {
        updateShadow(k, val);
        return val;
      }
      const shadow = origGet.call(this, shadowKeyFor(k));
      if (typeof shadow === "string" && shadow.length > 0) {
        return shadow;
      }
      return val;
    }
    return val;
  };

  // setItem override
  SP.setItem = function (k, v) {
    if (this === window.localStorage && isProtectedKey(k)) {
      try {
        if (typeof v === "string" && v.length > 0) {
          updateShadow(k, v);
        }
      } catch (_) {}
    }
    return origSet.apply(this, arguments);
  };

  // removeItem override
  SP.removeItem = function (k) {
    if (this === window.localStorage && isProtectedKey(k)) {
      return; // block removal
    }
    return origRemove.apply(this, arguments);
  };

  // clear override
  SP.clear = function () {
    if (this === window.localStorage) {
      const shadows = {};
      try {
        for (let i = 0; i < this.length; i++) {
          const key = this.key(i);
          if (!key) continue;
          if (isProtectedKey(key)) {
            const val = origGet.call(this, key);
            if (typeof val === "string" && val.length > 0) {
              shadows[key] = val;
            }
          } else if (key.startsWith(SHADOW_PREFIX)) {
            const origKey = key.slice(SHADOW_PREFIX.length);
            const val = origGet.call(this, key);
            if (typeof val === "string" && val.length > 0) {
              shadows[origKey] = val;
            }
          }
        }
      } catch (_) {}

      const result = origClear.apply(this, arguments);

      try {
        for (const [k, v] of Object.entries(shadows)) {
          origSet.call(this, shadowKeyFor(k), v);
          origSet.call(this, k, v);
        }
      } catch (_) {}

      return result;
    }
    return origClear.apply(this, arguments);
  };

  // Property-style access: localStorage.token
  const origDefineProperty = Object.defineProperty;
  Object.defineProperty = function (obj, prop, desc) {
    try {
      if (obj === window.localStorage && isProtectedKey(String(prop))) {
        const k = String(prop);
        return origDefineProperty(obj, k, {
          configurable: true,
          enumerable: true,
          get() {
            return SP.getItem.call(window.localStorage, k);
          },
          set(v) {
            SP.setItem.call(window.localStorage, k, String(v));
          },
        });
      }
    } catch (_) {}
    return origDefineProperty.apply(Object, arguments);
  };

  // Early restore
  try {
    const s = ls();
    if (s) {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (!k) continue;
        if (isProtectedKey(k)) {
          const cur = origGet.call(s, k);
          if (!cur) {
            const shadow = origGet.call(s, shadowKeyFor(k));
            if (shadow) origSet.call(s, k, shadow);
          } else {
            updateShadow(k, cur);
          }
        }
      }
    }
  } catch (_) {}

  // Keep shadows fresh on unload
  window.addEventListener("beforeunload", () => {
    try {
      const s = ls();
      if (!s) return;
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (!k || !isProtectedKey(k)) continue;
        const v = origGet.call(s, k);
        if (v) updateShadow(k, v);
      }
    } catch (_) {}
  });
})();