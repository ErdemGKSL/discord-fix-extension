export default defineContentScript({

  // Apply on Discord only
  matches: ['https://discord.com/*', 'https://*.discord.com/*'],
  // Ensure we run before the page scripts initialize
  runAt: 'document_start',
  // Guard iframes too, just in case
  allFrames: true,
    // Run in the page's main world to hook native prototypes
    world: 'MAIN',
  main() {
      (function () {
        'use strict';

        // Allow pausing the protection via a page-level flag
        const PAUSE_KEY = '__t_guard_paused__';
        try {
          const paused = window.localStorage.getItem(PAUSE_KEY);
          if (paused === '1' || paused === 'true') {
            return; // Skip installing guards if paused
          }
        } catch {}

        const SHADOW_PREFIX = '__t_guard_shadow__';

        function isProtectedKey(k: string) {
          return (
            typeof k === 'string' &&
            !k.startsWith(SHADOW_PREFIX) &&
            k.toLowerCase().includes('token')
          );
        }

        function shadowKeyFor(k: string) {
          return SHADOW_PREFIX + k;
        }

        function ls() {
          try {
            return window.localStorage;
          } catch (_) {
            return null as Storage | null;
          }
        }
        function writeLS(key: string, val: string) {
          const s = ls();
          if (s) s.setItem(key, val);
        }

        function updateShadow(k: string, val: string) {
          if (typeof val === 'string' && val.length > 0 && isProtectedKey(k)) {
            writeLS(shadowKeyFor(k), val);
          }
        }

        const SP = Storage.prototype as Storage;
        const origGet = SP.getItem;
        const origSet = SP.setItem;
        const origRemove = SP.removeItem;
        const origClear = SP.clear;

        SP.getItem = function (this: Storage, k: string): string | null {
          const val = origGet.call(this, k);
          if (this === window.localStorage && isProtectedKey(k)) {
            if (typeof val === 'string' && val.length > 0) {
              updateShadow(k, val);
              return val;
            }
            const shadow = origGet.call(this, shadowKeyFor(k));
            if (typeof shadow === 'string' && shadow.length > 0) {
              return shadow;
            }
            return val;
          }
          return val;
        } as any;

        // Helpers for tokenS object patching
        const isObject = (x: any): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
        const parseJSON = (s: string): any => {
          try { return JSON.parse(s); } catch { return undefined; }
        };

        SP.setItem = function (this: Storage, k: string, v: string): void {
          // Special handling for keys that include "tokens"
          if (this === window.localStorage && typeof k === 'string' && k.toLowerCase().includes('tokens')) {
            const parsed = typeof v === 'string' ? parseJSON(v) : undefined;
            if (isObject(parsed)) {
              const keys = Object.keys(parsed);
              if (keys.length === 0) {
                // Do nothing when setting an empty object
                return;
              }
              if (keys.length === 1) {
                const onlyKey = keys[0];
                const onlyVal = parsed[onlyKey];
                if (typeof onlyVal === 'string' && onlyVal.length > 0) {
                  // Merge into existing object stored under k
                  const curStr = origGet.call(this, k) as string | null;
                  const curParsed = curStr ? parseJSON(curStr) : undefined;
                  const base: Record<string, any> = isObject(curParsed) ? { ...curParsed } : {};
                  base[onlyKey] = onlyVal;
                  const nextStr = JSON.stringify(base);
                  try { updateShadow(k, nextStr); } catch {}
                  return origSet.call(this, k, nextStr);
                } else {
                  // Non-string or empty value: ignore
                  return;
                }
              }
              // If more than 1 key, fall through to default behavior below
            }
          }

          // Default behavior with protection/shadowing
          if (this === window.localStorage && isProtectedKey(k)) {
            try {
              if (typeof v === 'string' && v.length > 0) {
                updateShadow(k, v);
              }
            } catch {}
          }
          return origSet.apply(this, arguments as unknown as [string, string]);
        } as any;

        SP.removeItem = function (this: Storage, k: string): void {
          if (this === window.localStorage && isProtectedKey(k)) {
            return; // block removal
          }
          return origRemove.apply(this, arguments as unknown as [string]);
        } as any;

        SP.clear = function (this: Storage): void {
          if (this === window.localStorage) {
            const shadows: Record<string, string> = {};
            try {
              for (let i = 0; i < this.length; i++) {
                const key = this.key(i);
                if (!key) continue;
                if (isProtectedKey(key)) {
                  const val = origGet.call(this, key);
                  if (typeof val === 'string' && val.length > 0) {
                    shadows[key] = val;
                  }
                } else if (key.startsWith(SHADOW_PREFIX)) {
                  const origKey = key.slice(SHADOW_PREFIX.length);
                  const val = origGet.call(this, key);
                  if (typeof val === 'string' && val.length > 0) {
                    shadows[origKey] = val;
                  }
                }
              }
            } catch {}

            const result = origClear.apply(this, arguments as unknown as []);

            try {
              for (const [k, v] of Object.entries(shadows)) {
                origSet.call(this, shadowKeyFor(k), v);
                origSet.call(this, k, v);
              }
            } catch {}

            return result as unknown as void;
          }
          return origClear.apply(this, arguments as unknown as []);
        } as any;

        const origDefineProperty = Object.defineProperty;
        Object.defineProperty = function (
          obj: any,
          prop: PropertyKey,
          desc: PropertyDescriptor & ThisType<any>,
        ): any {
          try {
            if (obj === window.localStorage && typeof prop === 'string' && isProtectedKey(String(prop))) {
              const k = String(prop);
              return origDefineProperty(obj, k, {
                configurable: true,
                enumerable: true,
                get() {
                  return SP.getItem.call(window.localStorage, k);
                },
                set(v: any) {
                  SP.setItem.call(window.localStorage, k, String(v));
                },
              });
            }
          } catch {}
          return origDefineProperty.apply(Object, arguments as unknown as [any, PropertyKey, PropertyDescriptor]);
        } as any;

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
        } catch {}

        window.addEventListener('beforeunload', () => {
          try {
            const s = ls();
            if (!s) return;
            for (let i = 0; i < s.length; i++) {
              const k = s.key(i);
              if (!k || !isProtectedKey(k)) continue;
              const v = origGet.call(s, k);
              if (v) updateShadow(k, v);
            }
          } catch {}
        });
      })();
  },
});
