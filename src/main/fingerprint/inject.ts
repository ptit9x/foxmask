import type { Fingerprint } from '../types/fingerprint';
import { createRng } from './random';

/**
 * Fingerprint → injection script builder.
 *
 * buildInjectScript(fp) returns ONE self-contained IIFE to run at document
 * start. Everything fingerprint-specific (tz offsets, noise seed, battery and
 * connection values, full FP json) is baked at build time, so:
 *   - same fp → byte-identical script,
 *   - the script never references outer scope, require(), process, or
 *     Math.random (all runtime noise derives from the baked seed),
 *   - missing globals are tolerated (typeof guards) so it runs in any context,
 *   - mode-specific code is pruned at build time via @fm-branch markers, so
 *     each emitted script contains only its active branch (and its marker).
 */

/** JS-sign convention offset (minutes) of `tz` at instant `when`. */
export function getTzOffsetMinutes(tz: string, when: Date = new Date()): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
  const part = dtf.formatToParts(when).find((p) => p.type === 'timeZoneName');
  const name = part ? part.value : 'GMT';
  const m = /^(GMT([+-])(\d{1,2})(?::(\d{2}))?)$/.exec(name);
  if (!m) return 0; // plain "GMT" → UTC
  const sign = m[2] === '-' ? -1 : 1;
  // JS getTimezoneOffset convention: minutes to ADD to local time to reach UTC
  // (positive west of Greenwich) — the negation of the ISO offset from GMT±.
  const iso = sign * (Number(m[3]) * 60 + Number(m[4] ?? 0));
  return iso === 0 ? 0 : -iso;
}

/**
 * Standard/DST offset pair for a tz (sampled mid-January / mid-July UTC).
 * Both are baked into the script; the runtime picks by month so
 * Intl-resolved timeZone and Date.getTimezoneOffset() stay consistent
 * without shipping a tz database.
 */
export function getTzOffsets(
  tz: string,
  year: number = new Date().getFullYear()
): [number, number] {
  return [
    getTzOffsetMinutes(tz, new Date(Date.UTC(year, 0, 15, 0, 30))),
    getTzOffsetMinutes(tz, new Date(Date.UTC(year, 6, 15, 0, 30)))
  ];
}

/** Deterministic 32-bit seed for all per-fingerprint noise. */
export function canvasNoiseSeed(fp: Fingerprint): number {
  let h = 2176701787 >>> 0;
  const str = `${fp.os}|${fp.userAgent}|${fp.timezone}|${fp.screen.width}x${fp.screen.height}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 374761393) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
  }
  return h >>> 0;
}

export const GENERIC_FONT_FAMILIES = [
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui'
];

export interface MinorSurfaceValues {
  battery: { level: number; charging: boolean };
  connection: { effectiveType: string; rtt: number; downlink: number };
}

/** Seeded "minor" surface values (battery / network information). */
export function minorSurfaceValues(fp: Fingerprint): MinorSurfaceValues {
  const rng = createRng(`minor::${fp.os}::${fp.userAgent}::${fp.timezone}`);
  return {
    // realistic laptop-ish battery: half to full, discharging
    battery: { level: (50 + rng.int(0, 50)) / 100, charging: false },
    connection: { effectiveType: '4g', rtt: rng.int(50, 100), downlink: 10 }
  };
}

/** 1x1 fully transparent PNG data URL (canvas "block" mode return value). */
export const TRANSPARENT_1x1_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';

/** Token replacement that never interprets `$` in replacement values. */
function fill(source: string, token: string, value: string): string {
  return source.split(token).join(value);
}

/**
 * Build-time dead-branch elimination. Blocks wrapped in
 *   // @fm-branch <surface>=<mode|mode|...>   ...   // @fm-branch-end
 * are kept (markers stripped) only when the fingerprint's mode for that
 * surface is listed; otherwise the whole block is dropped. This keeps e.g.
 * FM_BLOCK markers out of scripts built for noise mode.
 */
function pruneBranches(script: string, fp: Fingerprint): string {
  const active: Record<string, string> = {
    canvas: fp.canvas,
    webgl: fp.webgl.mode,
    audio: fp.audio,
    webrtc: fp.webRtc.mode
  };
  const re = /^[ \t]*\/\/ @fm-branch (\w+)=([\w|-]+)\n([\s\S]*?)^[ \t]*\/\/ @fm-branch-end\n/gm;
  return script.replace(re, (_all, surface: string, modes: string, content: string) =>
    modes.split('|').includes(active[surface]) ? content : ''
  );
}

export function buildInjectScript(fp: Fingerprint): string {
  const [tzJan, tzJul] = getTzOffsets(fp.timezone);
  const minor = minorSurfaceValues(fp);
  let s = pruneBranches(TEMPLATE, fp);
  s = fill(s, '__FP_JSON__', JSON.stringify(fp));
  s = fill(s, '__GENERIC_FONTS_JSON__', JSON.stringify(GENERIC_FONT_FAMILIES));
  s = fill(s, '__BLANK_PNG__', TRANSPARENT_1x1_PNG);
  s = fill(s, '__WEBRTC_IP_JSON__', JSON.stringify(fp.webRtc.publicIp));
  s = fill(s, '__BATTERY_JSON__', JSON.stringify(minor.battery));
  s = fill(s, '__CONNECTION_JSON__', JSON.stringify(minor.connection));
  s = fill(s, '__TZ_JAN__', String(tzJan));
  s = fill(s, '__TZ_JUL__', String(tzJul));
  s = fill(s, '__NOISE_SEED__', String(canvasNoiseSeed(fp)));
  s = fill(s, '__WORKER_SPOOF__', JSON.stringify(buildWorkerSpoofScript(fp)));
  return s;
}

/**
 * Compact worker-scope spoof: navigator properties only (no DOM APIs). Gets
 * prepended to worker sources via the Blob technique in the main init script,
 * so Web/SharedWorkers see the same identity as the main frame.
 */
export function buildWorkerSpoofScript(fp: Fingerprint): string {
  const brands = ((): string => {
    const m = /Chrome\/(\d+)/.exec(fp.userAgent);
    const v = m ? m[1] : '137';
    const list = [
      { brand: 'Chromium', version: v },
      { brand: 'Google Chrome', version: v }
    ];
    return JSON.stringify(list);
  })();
  const fullVersion = ((): string => {
    const m = /Chrome\/([\d.]+)/.exec(fp.userAgent);
    const v = m ? m[1] : '137.0.0.0';
    return JSON.stringify([
      { brand: 'Chromium', version: v },
      { brand: 'Google Chrome', version: v }
    ]);
  })();
  return (
    '(function(){' +
    '"use strict";' +
    'var d=function(o,p,v){try{Object.defineProperty(o,p,{get:function(){return v},set:function(){},configurable:true,enumerable:true})}catch(e){}};' +
    `var N=self.navigator;` +
    `d(N,"userAgent",${JSON.stringify(fp.userAgent)});` +
    `d(N,"appVersion",${JSON.stringify(fp.userAgent.replace(/^Mozilla\//, ''))});` +
    `d(N,"platform",${JSON.stringify(fp.platform)});` +
    `d(N,"language",${JSON.stringify(fp.languages[0])});` +
    `d(N,"languages",Object.freeze(${JSON.stringify(fp.languages.slice())}));` +
    `d(N,"hardwareConcurrency",${JSON.stringify(fp.hardwareConcurrency)});` +
    `d(N,"deviceMemory",${JSON.stringify(fp.deviceMemory)});` +
    // userAgentData: brands must not say HeadlessChrome
    `try{if(N&&N.userAgentData){var UA=Object.create(N.userAgentData.constructor.prototype);d(UA,"brands",Object.freeze(${brands}));d(UA,"mobile",${JSON.stringify(fp.os === 'android')});d(UA,"platform",${JSON.stringify(fp.platform)});UA.getHighEntropyValues=function(h){var r={};h.forEach(function(k){r[k]=${JSON.stringify(fullVersion)}[0].version});if(h.indexOf("platform")>=0)r.platform=${JSON.stringify(fp.platform)};if(h.indexOf("architecture")>=0)r.architecture="x86";if(h.indexOf("bitness")>=0)r.bitness="64";if(h.indexOf("model")>=0)r.model="";if(h.indexOf("uaFullVersion")>=0)r.uaFullVersion=${JSON.stringify(fullVersion)}[0].version;if(h.indexOf("fullVersionList")>=0)r.fullVersionList=${fullVersion};return Promise.resolve(r)};d(N,"userAgentData",UA);}}catch(e){}` +
    // WebGL inside workers (OffscreenCanvas): vendor/renderer
    `try{var VP=0x9245,RD=0x9246;[self.WebGLRenderingContext,self.WebGL2RenderingContext].forEach(function(C){if(!C||!C.prototype)return;var o=C.prototype.getParameter;C.prototype.getParameter=function(p){try{if(p===VP)return ${JSON.stringify(fp.webgl.vendor)};if(p===RD)return ${JSON.stringify(fp.webgl.renderer)};}catch(e){}return o.call(this,p)};});}catch(e){}` +
    '})();'
  );
}

// The injected script body. A plain backtick template (no ${} inside); regex
// backslashes are doubled so they survive the template literal.
const TEMPLATE = `(() => {
  "use strict";
  const FP = __FP_JSON__;
  const GENERIC_FONTS = __GENERIC_FONTS_JSON__;
  const BLANK_PNG = "__BLANK_PNG__";
  const WEBRTC_IP = __WEBRTC_IP_JSON__;
  const BATTERY = __BATTERY_JSON__;
  const CONNECTION = __CONNECTION_JSON__;
  const TZ_JAN = __TZ_JAN__, TZ_JUL = __TZ_JUL__;
  const NOISE_SEED = __NOISE_SEED__; // FM_NOISE_SEED
  const WORKER_SPOOF = __WORKER_SPOOF__;
  const MODE_CANVAS = FP.canvas, MODE_WEBGL = FP.webgl.mode, MODE_AUDIO = FP.audio, MODE_WEBRTC = FP.webRtc.mode;

  function maskAsNative(fn, name) {
    try { Object.defineProperty(fn, "name", { value: name, configurable: true }); } catch (e) {}
    try {
      Object.defineProperty(fn, "toString", {
        value: function toString() { return "function " + name + "() { [native code] }"; },
        writable: true,
        configurable: true
      });
    } catch (e) {}
    return fn;
  }

  function def(obj, prop, value) {
    try {
      Object.defineProperty(obj, prop, {
        get: maskAsNative(function () { return value; }, "get " + prop),
        set: function () {},
        enumerable: true,
        configurable: true
      });
    } catch (e) {}
  }

  function hashString(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) | 0;
    return h >>> 0;
  }

  function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  /* ---------- navigator ---------- */
  if (typeof Navigator !== "undefined" && Navigator.prototype) {
    def(Navigator.prototype, "userAgent", FP.userAgent);
    def(Navigator.prototype, "appVersion", FP.userAgent.replace(/^Mozilla\\//, ""));
    def(Navigator.prototype, "platform", FP.platform);
    def(Navigator.prototype, "vendor", FP.os === "macos" ? "Google Inc." : "");
    def(Navigator.prototype, "languages", Object.freeze(FP.languages.slice()));
    def(Navigator.prototype, "language", FP.languages[0]);
    def(Navigator.prototype, "hardwareConcurrency", FP.hardwareConcurrency);
    def(Navigator.prototype, "deviceMemory", FP.deviceMemory);
    def(Navigator.prototype, "maxTouchPoints", FP.touchPoints);
    def(Navigator.prototype, "doNotTrack", FP.doNotTrack);
    try {
      if ("webdriver" in Navigator.prototype) delete Navigator.prototype.webdriver;
      Object.defineProperty(Navigator.prototype, "webdriver", {
        get: maskAsNative(function () { return false; }, "get webdriver"),
        set: function () {},
        enumerable: true,
        configurable: true
      });
    } catch (e) {}
  }

  /* ---------- plugins / mimeTypes — Chrome-standard 5 PDF entries ---------- */
  if (typeof Navigator !== "undefined" && Navigator.prototype) {
    const mimeTypes = [
      { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
      { type: "text/pdf", suffixes: "pdf", description: "Portable Document Format" }
    ];
    const pluginNames = [
      "PDF Viewer",
      "Chrome PDF Viewer",
      "Chromium PDF Viewer",
      "Microsoft Edge PDF Viewer",
      "WebKit built-in PDF"
    ];
    const plugins = pluginNames.map(function (name) {
      return {
        name: name,
        filename: "internal-pdf-viewer",
        description: "Portable Document Format",
        length: mimeTypes.length
      };
    });
    Object.defineProperty(plugins, "item", {
      value: maskAsNative(function item(i) { return plugins[i] || null; }, "item"),
      enumerable: false, configurable: true
    });
    Object.defineProperty(plugins, "namedItem", {
      value: maskAsNative(function namedItem(n) {
        for (let i = 0; i < plugins.length; i++) if (plugins[i].name === n) return plugins[i];
        return null;
      }, "namedItem"),
      enumerable: false, configurable: true
    });
    Object.defineProperty(plugins, "refresh", {
      value: maskAsNative(function refresh() {}, "refresh"),
      enumerable: false, configurable: true
    });
    const mimes = mimeTypes.map(function (m) {
      return { type: m.type, suffixes: m.suffixes, description: m.description, enabledPlugin: plugins[0] };
    });
    def(Navigator.prototype, "plugins", plugins);
    def(Navigator.prototype, "mimeTypes", mimes);
  }

  /* ---------- screen / window ---------- */
  if (typeof Screen !== "undefined" && Screen.prototype) {
    def(Screen.prototype, "width", FP.screen.width);
    def(Screen.prototype, "height", FP.screen.height);
    def(Screen.prototype, "availWidth", FP.screen.width);
    def(Screen.prototype, "availHeight", FP.screen.availHeight);
    def(Screen.prototype, "colorDepth", 24);
    def(Screen.prototype, "pixelDepth", 24);
  }
  if (typeof window !== "undefined") {
    def(window, "devicePixelRatio", FP.screen.devicePixelRatio);
    def(window, "outerWidth", FP.screen.width);
    def(window, "outerHeight", FP.screen.height);
  }

  /* ---------- timezone (Intl name + Date offset stay consistent) ---------- */
  try {
    if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
      const orig = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = maskAsNative(function resolvedOptions() {
        const r = orig.call(this);
        r.timeZone = FP.timezone;
        return r;
      }, "resolvedOptions");
    }
  } catch (e) {}
  try {
    Date.prototype.getTimezoneOffset = maskAsNative(function getTimezoneOffset() {
      const m = this.getUTCMonth();
      // Rough DST window (Mar–Oct, northern hemisphere) picks the July sample.
      const off = TZ_JAN !== TZ_JUL && m >= 2 && m <= 9 ? TZ_JUL : TZ_JAN;
      return off;
    }, "getTimezoneOffset");
  } catch (e) {}

  /* ---------- canvas ---------- */
  function addCanvasNoise(ctx, canvas) {
    // Imperceptible deterministic 1x1 fill: position and color derive from
    // (canvas size hash + baked seed) — never Math.random.
    try {
      const w = canvas.width || 1, h = canvas.height || 1;
      const k = (hashString(w + "x" + h) ^ NOISE_SEED) >>> 0;
      const x = k % w, y = (k >>> 8) % h;
      const r = (k >>> 16) & 255, g = (k >>> 20) & 255, b = (k >>> 24) & 255;
      const prev = ctx.fillStyle;
      ctx.fillStyle = "rgba(" + r + "," + g + "," + b + ",0.02)";
      ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = prev;
    } catch (e) {}
  }
  // @fm-branch canvas=noise
  if (typeof HTMLCanvasElement !== "undefined") { // FM_NOISE canvas
    const proto = HTMLCanvasElement.prototype;
    if (typeof proto.toDataURL === "function") {
      const orig = proto.toDataURL;
      proto.toDataURL = maskAsNative(function toDataURL() {
        try { const c = this.getContext("2d"); if (c) addCanvasNoise(c, this); } catch (e) {}
        return orig.apply(this, arguments);
      }, "toDataURL");
    }
    if (typeof proto.toBlob === "function") {
      const orig = proto.toBlob;
      proto.toBlob = maskAsNative(function toBlob() {
        try { const c = this.getContext("2d"); if (c) addCanvasNoise(c, this); } catch (e) {}
        return orig.apply(this, arguments);
      }, "toBlob");
    }
    if (typeof CanvasRenderingContext2D !== "undefined" &&
        typeof CanvasRenderingContext2D.prototype.getImageData === "function") {
      const orig = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = maskAsNative(function getImageData() {
        const img = orig.apply(this, arguments);
        try {
          const key = (hashString(Array.prototype.join.call(arguments, ",")) ^ NOISE_SEED) | 0;
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            const n = ((key ^ Math.imul(i, 2654435761)) % 7) - 3;
            d[i] = clamp8(d[i] + n);
            d[i + 1] = clamp8(d[i + 1] + n);
            d[i + 2] = clamp8(d[i + 2] + n);
          }
        } catch (e) {}
        return img;
      }, "getImageData");
    }
  }
  // @fm-branch-end
  // @fm-branch canvas=block
  if (typeof HTMLCanvasElement !== "undefined") { // FM_BLOCK canvas
    const proto = HTMLCanvasElement.prototype;
    if (typeof proto.toDataURL === "function") {
      proto.toDataURL = maskAsNative(function toDataURL() { return BLANK_PNG; }, "toDataURL");
    }
    if (typeof proto.toBlob === "function") {
      proto.toBlob = maskAsNative(function toBlob(callback) {
        try {
          if (typeof atob === "function" && typeof Blob === "function") {
            const bytes = atob(BLANK_PNG.split(",")[1]);
            const buf = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
            setTimeout(function () { callback(new Blob([buf], { type: "image/png" })); }, 0);
          } else if (typeof setTimeout === "function") {
            setTimeout(function () { callback(null); }, 0);
          }
        } catch (e) {}
      }, "toBlob");
    }
    if (typeof CanvasRenderingContext2D !== "undefined" &&
        typeof CanvasRenderingContext2D.prototype.getImageData === "function") {
      CanvasRenderingContext2D.prototype.getImageData = maskAsNative(function getImageData(sx, sy, sw, sh) {
        return {
          width: sw,
          height: sh,
          colorSpace: "srgb",
          data: new Uint8ClampedArray(Math.max(0, sw * sh * 4))
        };
      }, "getImageData");
    }
  }
  // @fm-branch-end

  /* ---------- webgl ---------- */
  function patchGetParam(Ctor) {
    if (!Ctor || !Ctor.prototype || typeof Ctor.prototype.getParameter !== "function") return;
    const orig = Ctor.prototype.getParameter;
    Ctor.prototype.getParameter = maskAsNative(function getParameter(pname) {
      if (pname === 0x9245) return FP.webgl.vendor;   // UNMASKED_VENDOR_WEBGL
      if (pname === 0x9246) return FP.webgl.renderer; // UNMASKED_RENDERER_WEBGL
      return orig.call(this, pname);
    }, "getParameter");
  }
  // @fm-branch webgl=noise|block
  if (typeof WebGLRenderingContext !== "undefined") patchGetParam(WebGLRenderingContext); // FM_WEBGL_PATCH
  if (typeof WebGL2RenderingContext !== "undefined") patchGetParam(WebGL2RenderingContext);
  // @fm-branch-end
  // @fm-branch webgl=noise
  if (typeof WebGLRenderingContext !== "undefined" &&
      typeof WebGLRenderingContext.prototype.readPixels === "function") { // FM_NOISE webgl
    const orig = WebGLRenderingContext.prototype.readPixels;
    WebGLRenderingContext.prototype.readPixels = maskAsNative(function readPixels() {
      orig.apply(this, arguments);
      try {
        const px = arguments[6];
        if (px && px.length) {
          for (let i = 0; i < px.length; i += 4) {
            const n = ((NOISE_SEED ^ Math.imul(i, 2654435761)) % 5) - 2;
            px[i] = clamp8(px[i] + n);
            px[i + 1] = clamp8(px[i + 1] + n);
            px[i + 2] = clamp8(px[i + 2] + n);
          }
        }
      } catch (e) {}
    }, "readPixels");
  }
  // @fm-branch-end

  /* ---------- audio ---------- */
  // @fm-branch audio=noise
  if (typeof AudioBuffer !== "undefined" &&
      typeof AudioBuffer.prototype.getChannelData === "function") { // FM_NOISE audio
    const orig = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = maskAsNative(function getChannelData(channel) {
      const d = orig.call(this, channel);
      try {
        for (let i = 0; i < d.length; i++) {
          d[i] = d[i] + (((NOISE_SEED ^ Math.imul(i, 2654435761)) % 2001) - 1000) / 1e8;
        }
      } catch (e) {}
      return d;
    }, "getChannelData");
  }
  // @fm-branch-end
  // @fm-branch audio=block
  if (typeof AudioBuffer !== "undefined" &&
      typeof AudioBuffer.prototype.getChannelData === "function") { // FM_BLOCK audio
    const orig = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = maskAsNative(function getChannelData(channel) {
      const d = orig.call(this, channel);
      try { for (let i = 0; i < d.length; i++) d[i] = 0; } catch (e) {}
      return d;
    }, "getChannelData");
  }
  // @fm-branch-end
  // @fm-branch audio=noise|block
  if (typeof AnalyserNode !== "undefined" &&
      typeof AnalyserNode.prototype.getFloatFrequencyData === "function") { // FM_AUDIO_ANALYSER
    const orig = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = maskAsNative(function getFloatFrequencyData(arr) {
      orig.call(this, arr);
      try {
        if (MODE_AUDIO === "block") {
          for (let i = 0; i < arr.length; i++) arr[i] = 0;
        } else {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = arr[i] + (((NOISE_SEED ^ Math.imul(i, 2654435761)) % 2001) - 1000) / 1e8;
          }
        }
      } catch (e) {}
    }, "getFloatFrequencyData");
  }
  // @fm-branch-end

  /* ---------- webrtc ---------- */
  function candidateNeedsRewrite(line) {
    return / typ (srflx|relay|prflx)( |$)/.test(String(line));
  }
  function rewriteCandidateLine(line) {
    if (!candidateNeedsRewrite(line)) return line; // host / mDNS untouched
    if (!WEBRTC_IP) return ""; // no known public IP → drop public candidates
    const m = /^(a=candidate:\\S+ \\d+ \\S+ \\d+ )(\\S+)( .*)$/.exec(line);
    if (!m) return "";
    return m[1] + WEBRTC_IP + m[3];
  }
  function rewriteSdp(sdp) {
    return sdp.replace(/a=candidate:[^\\r\\n]* typ (?:srflx|relay|prflx)[^\\r\\n]*/g, rewriteCandidateLine);
  }
  // Shared event filter for both delivery paths (onicecandidate property and
  // addEventListener): public candidates are dropped/rewritten, host+M-DNS
  // candidates pass untouched, end-of-candidates events pass through.
  function wrapIceHandler(listener) {
    return function (ev) {
      if (ev && ev.candidate && ev.candidate.candidate) {
        const line = rewriteCandidateLine(ev.candidate.candidate);
        if (!line) return; // public candidate filtered out
        if (line === ev.candidate.candidate) return listener.call(this, ev);
        const c = {};
        for (const k in ev.candidate) c[k] = ev.candidate[k];
        c.candidate = line;
        const ev2 = {};
        for (const k in ev) ev2[k] = ev[k];
        ev2.candidate = c;
        return listener.call(this, ev2);
      }
      return listener.call(this, ev);
    };
  }
  // @fm-branch webrtc=disabled
  try { if (typeof window !== "undefined") delete window.RTCPeerConnection; } catch (e) {} // FM_WEBRTC_DISABLED
  try { if (typeof window !== "undefined") delete window.webkitRTCPeerConnection; } catch (e) {}
  // @fm-branch-end
  // @fm-branch webrtc=based-on-ip|fixed
  if (typeof RTCPeerConnection !== "undefined" && RTCPeerConnection.prototype) { // FM_WEBRTC_REWRITE
    const RC = RTCPeerConnection;
    if (typeof RC.prototype.createOffer === "function") {
      const orig = RC.prototype.createOffer;
      RC.prototype.createOffer = maskAsNative(function createOffer() {
        const p = orig.apply(this, arguments);
        if (p && typeof p.then === "function") {
          return p.then(function (desc) {
            if (desc && desc.sdp) desc.sdp = rewriteSdp(desc.sdp);
            return desc;
          });
        }
        return p;
      }, "createOffer");
    }
    if (typeof RC.prototype.setLocalDescription === "function") {
      const orig = RC.prototype.setLocalDescription;
      RC.prototype.setLocalDescription = maskAsNative(function setLocalDescription(desc) {
        if (desc && desc.sdp) desc.sdp = rewriteSdp(desc.sdp);
        return orig.call(this, desc);
      }, "setLocalDescription");
    }
    // Promise-form .then consumers read pc.localDescription AFTER the native
    // promise resolves — the description object Chrome builds internally can
    // still carry unrewritten srflx lines. Sanitize on read via getters.
    try {
      const props = ["localDescription", "currentLocalDescription", "pendingLocalDescription"];
      for (let i = 0; i < props.length; i++) {
        const prop = props[i];
        const d = Object.getOwnPropertyDescriptor(RC.prototype, prop);
        if (!d || !d.get) continue;
        Object.defineProperty(RC.prototype, prop, {
          get: maskAsNative(function () {
            const desc = d.get.call(this);
            if (desc && desc.sdp) {
              try {
                return { type: desc.type, sdp: rewriteSdp(desc.sdp) };
              } catch (e) { return desc; }
            }
            return desc;
          }, "get " + prop),
          configurable: true,
          enumerable: true
        });
      }
    } catch (e) {}
    // Property-form handler: pc.onicecandidate = fn was never intercepted.
    const ocDesc = Object.getOwnPropertyDescriptor(RC.prototype, "onicecandidate");
    if (ocDesc && ocDesc.set && ocDesc.get) {
      const origSet = ocDesc.set, origGet = ocDesc.get;
      let stored = null;
      Object.defineProperty(RC.prototype, "onicecandidate", {
        get: maskAsNative(function () { return origGet.call(this) || stored; }, "get onicecandidate"),
        set: maskAsNative(function (fn) {
          stored = typeof fn === "function" ? fn : null;
          origSet.call(this, typeof fn === "function" ? wrapIceHandler(fn) : fn);
        }, "set onicecandidate"),
        configurable: true,
        enumerable: true
      });
    }
    if (typeof RC.prototype.addEventListener === "function") {
      const orig = RC.prototype.addEventListener;
      RC.prototype.addEventListener = maskAsNative(function addEventListener(type) {
        if (type === "icecandidate" && typeof arguments[1] === "function") {
          const listener = arguments[1];
          const args = Array.prototype.slice.call(arguments);
          args[1] = wrapIceHandler(listener);
          return orig.apply(this, args);
        }
        return orig.apply(this, arguments);
      }, "addEventListener");
    }
  }
  // @fm-branch-end

  /* ---------- font probing ---------- */
  if (typeof document !== "undefined" && document.fonts &&
      typeof document.fonts.check === "function") {
    const allowed = {};
    for (let i = 0; i < FP.fonts.length; i++) allowed[FP.fonts[i].toLowerCase()] = true;
    for (let i = 0; i < GENERIC_FONTS.length; i++) allowed[GENERIC_FONTS[i]] = true;
    const orig = document.fonts.check.bind(document.fonts);
    document.fonts.check = maskAsNative(function check(font, text) {
      const s = String(font);
      let family = "";
      const quoted = /["']([^"']+)["']/.exec(s);
      if (quoted) family = quoted[1];
      else family = s.split(",")[0].replace(/^\\s*[\\d.]+\\s*[a-z%]+\\s+/i, "");
      family = family.trim().toLowerCase();
      if (!family) return orig(font, text);
      return allowed[family] === true;
    }, "check");
  }

  /* ---------- worker scope ---------- */
  // Init scripts do not run inside Web/SharedWorkers; without this, worker
  // scopes report the REAL host identity (HeadlessChrome, true OS/cores).
  // Wrap the constructors: fetch same-origin worker source, prepend the
  // compact spoof preamble, and start the worker from a Blob URL. On any
  // failure (cross-origin, CSP, fetch error) fall back to the native path —
  // the site keeps working, the leak is logged.
  function blobUrlForWorker(url, opts) {
    const NativeWorker = window.__fm_NativeWorker;
    return fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (src) {
        try {
          var blob = new Blob([WORKER_SPOOF + "\\n;" + src], { type: "text/javascript" });
          var blobUrl = URL.createObjectURL(blob);
          return blobUrl;
        } catch (e) { return null; }
      })
      .catch(function () { return null; });
  }
  if (typeof window !== "undefined") {
    if (typeof Worker === "function") {
      window.__fm_NativeWorker = Worker;
      window.Worker = maskAsNative(function Worker(url, opts) {
        var shell = this;
        if (!(shell instanceof Worker)) throw new TypeError("Failed to construct 'Worker': please use the 'new' operator");
        // Synchronous facade: we cannot await in a constructor, so we queue
        // postMessage/addEventListener until the real worker is up.
        var queue = [];
        var real = null;
        shell.postMessage = function (d) { real ? real.postMessage(d) : queue.push(["postMessage", d]); };
        shell.terminate = function () { real && real.terminate(); real = null; };
        shell.addEventListener = function (t, fn, o) { real ? real.addEventListener(t, fn, o) : queue.push(["addEventListener", t, fn, o]); };
        shell.removeEventListener = function (t, fn, o) { real && real.removeEventListener(t, fn, o); };
        // The shell must not inherit native event-property setters (they throw
        // "Illegal invocation" on non-native receivers) — define safe storage.
        var evtProps = ["onmessage", "onerror", "onmessageerror"];
        var shellHandlers = {};
        for (var pi = 0; pi < evtProps.length; pi++) {
          (function (p) {
            Object.defineProperty(shell, p, {
              get: function () { return shellHandlers[p]; },
              set: function (fn) {
                shellHandlers[p] = typeof fn === "function" ? fn : null;
                if (real) forwardEvents(real, shell, shellHandlers);
              },
              configurable: true,
              enumerable: true
            });
          })(evtProps[pi]);
        }
        function forwardEvents(target, shellObj, handlers) {
          target.onmessage = handlers["onmessage"] ? function (e) { handlers["onmessage"].call(shellObj, e); } : null;
          target.onerror = handlers["onerror"] ? function (e) { handlers["onerror"].call(shellObj, e); } : null;
          target.onmessageerror = handlers["onmessageerror"] ? function (e) { handlers["onmessageerror"].call(shellObj, e); } : null;
        }
        blobUrlForWorker(url, opts).then(function (blobUrl) {
          real = new window.__fm_NativeWorker(blobUrl || url, opts);
          for (var i = 0; i < queue.length; i++) {
            var a = queue[i];
            if (a[0] === "postMessage") real.postMessage(a[1]);
            else if (a[0] === "addEventListener") real.addEventListener(a[1], a[2], a[3]);
          }
          forwardEvents(real, shell, shellHandlers);
        });
      }, "Worker");
      try { Object.defineProperty(Worker, "prototype", { value: window.__fm_NativeWorker.prototype }); } catch (e) {}
    }
    if (typeof SharedWorker === "function") {
      window.__fm_NativeSharedWorker = SharedWorker;
      window.SharedWorker = maskAsNative(function SharedWorker(url, opts) {
        // SharedWorker ports are MessagePorts; the worker scope itself is what
        // leaks. Fetch the source, prepend the spoof preamble, start from a
        // Blob URL. Fallback to native on any failure.
        var shell = this;
        if (!(shell instanceof SharedWorker)) throw new TypeError("Failed to construct 'SharedWorker': please use the 'new' operator");
        var nativeFallback = function () { return new window.__fm_NativeSharedWorker(url, opts); };
        var real = null;
        blobUrlForWorker(url, opts).then(function (blobUrl) {
          if (!blobUrl) { real = nativeFallback(); wire(); return; }
          try { real = new window.__fm_NativeSharedWorker(blobUrl, opts); }
          catch (e) { real = nativeFallback(); }
          wire();
        }).catch(function () { real = nativeFallback(); wire(); });
        var wired = false;
        function wire() {
          if (wired || !real) return;
          wired = true;
          try {
            var pd = Object.getOwnPropertyDescriptor(window.__fm_NativeSharedWorker.prototype, "port");
            if (pd && pd.get) {
              Object.defineProperty(shell, "port", {
                get: maskAsNative(function () { return pd.get.call(real); }, "get port"),
                configurable: true,
                enumerable: true
              });
            }
          } catch (e) {}
        }
      }, "SharedWorker");
    }
  }

  /* ---------- battery / connection ---------- */
  if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
    const orig = navigator.getBattery.bind(navigator);
    navigator.getBattery = maskAsNative(function getBattery() {
      return orig().then(function (b) {
        def(b, "level", BATTERY.level);
        def(b, "charging", BATTERY.charging);
        def(b, "chargingTime", BATTERY.charging ? 0 : Infinity);
        def(b, "dischargingTime", BATTERY.charging ? Infinity : 3600);
        return b;
      });
    }, "getBattery");
  }
  if (typeof navigator !== "undefined" && navigator.connection) {
    def(navigator.connection, "effectiveType", CONNECTION.effectiveType);
    def(navigator.connection, "rtt", CONNECTION.rtt);
    def(navigator.connection, "downlink", CONNECTION.downlink);
    def(navigator.connection, "saveData", false);
  }
})();
`;
