// The Survey Conditions form: what this browser discloses about itself.
// Read-only probes. Nothing prompts, and nothing leaves the browser. A value
// the browser will not give is null, and the form prints it as withheld.
import { queryPermission, type SurveyEnvironment } from './_tests';

export type EnvironmentField =
  | 'browser'
  | 'viewport'
  | 'gamut'
  | 'range'
  | 'refresh'
  | 'pointer'
  | 'motion'
  | 'scheme'
  | 'locale'
  | 'cores'
  | 'memory'
  | 'gpu'
  | 'permissions'
  | 'network';

export interface EnvironmentReading {
  values: Record<EnvironmentField, string | null>;
  env: SurveyEnvironment;
}

type NavigatorExtras = Navigator & {
  userAgentData?: { brands?: { brand: string; version: string }[]; platform?: string };
  deviceMemory?: number;
  connection?: { effectiveType?: string; saveData?: boolean };
};

const nav = navigator as NavigatorExtras;

const safe = <T,>(probe: () => T): T | null => {
  try {
    return probe();
  } catch {
    return null;
  }
};

const mq = (query: string) => window.matchMedia(query).matches;

/** The first value of a media feature that matches; null when the browser supports none of them. */
const mediaValue = <T extends string>(feature: string, values: T[]): T | null =>
  values.find((value) => mq(`(${feature}: ${value})`)) ?? null;

function browser(): string | null {
  const data = nav.userAgentData;
  const brands = (data?.brands ?? []).filter((b) => !/not.a.brand/i.test(b.brand));
  if (brands.length > 0) {
    const named = brands.filter((b) => b.brand !== 'Chromium');
    const names = (named.length > 0 ? named : brands).map((b) => `${b.brand} ${b.version}`).join(' · ');
    return data?.platform ? `${names} on ${data.platform}` : names;
  }
  const ua = navigator.userAgent;
  const engines: [RegExp, string][] = [
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Edg\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  let name: string | null = null;
  let version: string | null = null;
  for (const [pattern, engine] of engines) {
    const found = ua.match(pattern);
    if (found) {
      name = engine;
      version = found[1] ?? null;
      break;
    }
  }
  if (!name) return null;
  const platform = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return `${name}${version ? ` ${version}` : ''}${platform ? ` on ${platform}` : ''} (from its user-agent string)`;
}

function gamut(): string | null {
  const value = mediaValue('color-gamut', ['rec2020', 'p3', 'srgb']);
  return value ? { rec2020: 'Rec. 2020', p3: 'Display P3', srgb: 'sRGB' }[value] : null;
}

function range(): string | null {
  const value = mediaValue('dynamic-range', ['high', 'standard']);
  return value ? { high: 'High (HDR)', standard: 'Standard' }[value] : null;
}

function pointer(): string | null {
  const kinds = [mq('(any-pointer: fine)') && 'fine pointer', mq('(any-pointer: coarse)') && 'coarse pointer'].filter(
    Boolean,
  ) as string[];
  if (kinds.length === 0 && !mq('(any-pointer: none)')) return null;
  const parts = kinds.length > 0 ? kinds : ['no pointer'];
  parts.push(mq('(any-hover: hover)') ? 'hover' : 'no hover');
  const touch = navigator.maxTouchPoints;
  parts.push(touch > 0 ? `${touch} touch ${touch === 1 ? 'point' : 'points'}` : 'no touch');
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function motion(): string | null {
  const value = mediaValue('prefers-reduced-motion', ['reduce', 'no-preference']);
  return value ? { reduce: 'Reduced motion requested', 'no-preference': 'No preference' }[value] : null;
}

function scheme(): string | null {
  const color = mediaValue('prefers-color-scheme', ['dark', 'light']);
  const contrast = mediaValue('prefers-contrast', ['more', 'less', 'custom', 'no-preference']);
  const forced = mq('(forced-colors: active)');
  if (!color && !contrast) return null;
  const parts = [
    color && `${color === 'dark' ? 'Dark' : 'Light'} scheme`,
    contrast && { more: 'more contrast', less: 'less contrast', custom: 'custom contrast', 'no-preference': 'standard contrast' }[contrast],
    forced && 'forced colours',
  ].filter(Boolean) as string[];
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function locale(): string | null {
  const zone = safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const parts = [navigator.language, zone].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function gpu(): string | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl');
  if (!gl) return null;
  try {
    // RENDERER first: Firefox and Safari answer it directly. Chromium masks it
    // as "WebKit WebGL" and gives the real name through the debug extension.
    let renderer: unknown = gl.getParameter(gl.RENDERER);
    if (typeof renderer !== 'string' || /^webkit webgl$/i.test(renderer)) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
    }
    return typeof renderer === 'string' && renderer && !/^webkit webgl$/i.test(renderer) ? renderer : null;
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

const permissionWords: Record<PermissionState, string> = {
  granted: 'granted',
  prompt: 'not yet asked',
  denied: 'denied',
};

function permissions(microphone: PermissionState | null, camera: PermissionState | null): string | null {
  if (!microphone && !camera) return null;
  const word = (state: PermissionState | null) => (state ? permissionWords[state] : 'not disclosed');
  return `Microphone ${word(microphone)} · camera ${word(camera)}`;
}

function network(): string | null {
  const connection = nav.connection;
  if (!connection?.effectiveType) return null;
  return `Effective type ${connection.effectiveType} · data saver ${connection.saveData ? 'on' : 'off'}`;
}

/** The median frame interval over a few dozen frames, as a rate; null if the tab is hidden or frames are too few. */
export function measureRefresh(frames = 40, timeout = 1500): Promise<number | null> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let last: number | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (deltas.length < 10) return resolve(null);
      deltas.sort((a, b) => a - b);
      const median = deltas[deltas.length >> 1]!;
      resolve(median > 0 ? Math.round(1000 / median) : null);
    };
    const tick = (time: number) => {
      if (done) return;
      if (last !== null) deltas.push(time - last);
      last = time;
      if (deltas.length >= frames) finish();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(finish, timeout);
  });
}

export async function readEnvironment(): Promise<EnvironmentReading> {
  const [refreshHz, microphone, camera] = await Promise.all([
    measureRefresh().catch(() => null),
    queryPermission('microphone'),
    queryPermission('camera'),
  ]);
  const dpr = window.devicePixelRatio || 1;
  const values: Record<EnvironmentField, string | null> = {
    browser: safe(browser),
    viewport: `${window.innerWidth} × ${window.innerHeight} CSS px at ${Number(dpr.toFixed(2))}x`,
    gamut: safe(gamut),
    range: safe(range),
    refresh: refreshHz ? `About ${refreshHz} Hz, measured` : null,
    pointer: safe(pointer),
    motion: safe(motion),
    scheme: safe(scheme),
    locale: safe(locale),
    cores: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} logical` : null,
    memory: nav.deviceMemory ? `About ${nav.deviceMemory} GB, as the browser rounds it` : null,
    gpu: safe(gpu),
    permissions: permissions(microphone, camera),
    network: safe(network),
  };
  return {
    values,
    env: { dpr, refreshHz, reducedMotion: mq('(prefers-reduced-motion: reduce)'), microphone, camera },
  };
}

// Fields the register measures itself: a missing value is a failed
// measurement, not something the browser withheld.
const NOT_MEASURED: Partial<Record<EnvironmentField, string>> = {
  refresh: 'not measured: too few frames arrived during the survey',
};

/** Print a reading into the form. Withheld values get a redaction bar and say so in words. */
export function fillForm(values: Record<EnvironmentField, string | null>) {
  for (const cell of document.querySelectorAll<HTMLElement>('[data-env]')) {
    const field = cell.dataset.env as EnvironmentField;
    const value = values[field] ?? NOT_MEASURED[field] ?? null;
    cell.replaceChildren();
    cell.removeAttribute('data-withheld');
    if (value) {
      cell.textContent = value;
      continue;
    }
    const bar = document.createElement('span');
    bar.className = 'redacted';
    bar.setAttribute('aria-hidden', 'true');
    const words = document.createElement('span');
    words.className = 'withheld';
    words.textContent = 'not disclosed by this browser';
    cell.append(bar, words);
    cell.dataset.withheld = '';
  }
}
