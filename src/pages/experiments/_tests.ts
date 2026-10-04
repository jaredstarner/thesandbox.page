// The register's curated test table, keyed by normalized tag. Shared by the
// build (labels, Baseline IDs) and the client survey (tests, context notes).
// Tests detect presence only. They never prompt, never construct an
// AudioContext, never call getUserMedia, and never send anything anywhere.

export type TestState = 'detected' | 'absent' | 'blocked' | 'unknown';

export interface TestResult {
  state: TestState;
  detail: string;
}

/** What the environment survey measured, for context notes. */
export interface SurveyEnvironment {
  dpr: number;
  refreshHz: number | null;
  reducedMotion: boolean;
  microphone: PermissionState | null;
  camera: PermissionState | null;
}

export interface Technique {
  /** Display name, for example "sibling-index()". */
  label: string;
  /** Omitted for technique notes with no browser dependency. */
  test?: () => TestResult | Promise<TestResult>;
  /** Environment notes relevant to this technique, or null when there is nothing to say. */
  context?: (env: SurveyEnvironment) => string | null | Promise<string | null>;
  /** An ID in the web-features dataset, for the build-time Baseline note. */
  webFeature?: string;
  /** A handling note for objects that use this technique, in the register's procedure voice. */
  handling?: string;
}

const ALIASES: Record<string, string> = {
  webaudio: 'web-audio',
  audio: 'web-audio',
  audiocontext: 'web-audio',
  '@property': 'at-property',
  property: 'at-property',
  'registered-custom-properties': 'at-property',
  microphone: 'getusermedia',
  mic: 'getusermedia',
  'media-capture': 'getusermedia',
  'canvas-2d': 'canvas',
  canvas2d: 'canvas',
  'scroll-timeline': 'scroll-driven-animations',
  'view-timeline': 'scroll-driven-animations',
  'scroll-driven': 'scroll-driven-animations',
  'view-transition': 'view-transitions',
  anchor: 'anchor-positioning',
  'anchor-position': 'anchor-positioning',
  'container-query': 'container-queries',
  'popover-api': 'popover',
  webassembly: 'wasm',
  offscreencanvas: 'offscreen-canvas',
  workers: 'web-workers',
  'web-worker': 'web-workers',
  'dedicated-workers': 'web-workers',
  deviceorientation: 'device-orientation',
  'device-orientation-events': 'device-orientation',
  'gamepad-api': 'gamepad',
  midi: 'web-midi',
  webmidi: 'web-midi',
  speech: 'speech-synthesis',
  speechsynthesis: 'speech-synthesis',
  'progress-function': 'progress',
  'event-source': 'eventsource',
  sse: 'eventsource',
  'server-sent-events': 'eventsource',
  'doc-pip': 'document-picture-in-picture',
  'document-pip': 'document-picture-in-picture',
};

/** Lowercase, drop "()" and a leading ":", hyphenate spaces, then map aliases. */
export function normalizeTag(tag: string): string {
  const key = tag
    .trim()
    .toLowerCase()
    .replace(/\(\)$/, '')
    .replace(/^:/, '')
    .replace(/[\s_]+/g, '-');
  return ALIASES[key] ?? key;
}

const present = (ok: boolean, yes: string, no: string): TestResult =>
  ok ? { state: 'detected', detail: yes } : { state: 'absent', detail: no };

const supports = (declaration: string, label: string): TestResult => {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
    return { state: 'unknown', detail: 'CSS.supports() is not available' };
  }
  return present(CSS.supports(declaration), `${label} parses`, `${label} does not parse`);
};

const context = (kind: '2d' | 'webgl' | 'webgl2'): RenderingContext | null => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    return canvas.getContext(kind);
  } catch {
    return null;
  }
};

const releaseGl = (gl: RenderingContext | null) => {
  if (gl && 'getExtension' in gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
};

const display = (env: SurveyEnvironment) =>
  `Display ${Number(env.dpr.toFixed(2))}x` +
  (env.refreshHz ? `, refresh measured about ${env.refreshHz} Hz.` : '; refresh not measured.');

const permissionWords: Record<PermissionState, string> = {
  granted: 'granted',
  prompt: 'not yet asked',
  denied: 'denied',
};

let webgpuAdapterNote: string | null = null;

export const TECHNIQUES: Record<string, Technique> = {
  'sibling-index': {
    label: 'sibling-index()',
    webFeature: 'sibling-count',
    test: () => supports('order: sibling-index()', 'order: sibling-index()'),
  },
  'sibling-count': {
    label: 'sibling-count()',
    webFeature: 'sibling-count',
    test: () => supports('order: sibling-count()', 'order: sibling-count()'),
  },
  progress: {
    label: 'progress()',
    webFeature: 'progress-function',
    test: () => supports('opacity: progress(1, 0, 2)', 'opacity: progress(1, 0, 2)'),
  },
  'scroll-driven-animations': {
    label: 'Scroll-driven animations',
    webFeature: 'scroll-driven-animations',
    test: () => supports('animation-timeline: view()', 'animation-timeline: view()'),
    handling: 'Moves as you scroll.',
    context: (env) =>
      env.reducedMotion
        ? 'Reduced motion: requested in this browser.'
        : 'Reduced motion: not requested, so scroll-linked motion will play.',
  },
  'at-property': {
    label: '@property',
    webFeature: 'registered-custom-properties',
    test: () =>
      present(
        typeof CSS !== 'undefined' && typeof CSS.registerProperty === 'function',
        'CSS.registerProperty() present',
        'CSS.registerProperty() missing',
      ),
  },
  has: {
    label: ':has()',
    webFeature: 'has',
    test: () => supports('selector(:has(a))', 'selector(:has(a))'),
  },
  canvas: {
    label: 'Canvas 2D',
    webFeature: 'canvas-2d',
    test: () => present(context('2d') !== null, 'a 2D context opens', 'no 2D context'),
    context: display,
  },
  'web-audio': {
    label: 'Web Audio',
    webFeature: 'web-audio',
    handling: 'May make sound.',
    test: () => {
      if (typeof AudioContext === 'function') return { state: 'detected', detail: 'AudioContext present, not started' };
      if ('webkitAudioContext' in window) return { state: 'detected', detail: 'prefixed webkitAudioContext only' };
      return { state: 'absent', detail: 'no AudioContext' };
    },
    context: () => {
      const nav = navigator as Navigator & { getAutoplayPolicy?: (type: string) => string };
      if (typeof nav.getAutoplayPolicy !== 'function') return null;
      try {
        const policy = nav.getAutoplayPolicy('audiocontext');
        return policy === 'allowed'
          ? 'Autoplay policy for audio: allowed.'
          : 'Autoplay policy for audio: sound waits for a tap or key press.';
      } catch {
        return null;
      }
    },
  },
  getusermedia: {
    label: 'getUserMedia',
    webFeature: 'media-capture',
    handling: 'May ask for your microphone. This register never does.',
    test: async () => {
      if (!window.isSecureContext) return { state: 'blocked', detail: 'not a secure context' };
      if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
        return { state: 'absent', detail: 'mediaDevices.getUserMedia missing' };
      }
      const state = await queryPermission('microphone');
      if (state === 'denied') return { state: 'blocked', detail: 'microphone permission denied for this site' };
      return { state: 'detected', detail: 'present; never called here' };
    },
    context: (env) =>
      env.microphone
        ? `Microphone permission for this site: ${permissionWords[env.microphone]}. Permission is per site, so this is the state the exhibit will see.`
        : 'Microphone permission for this site: not disclosed by this browser.',
  },
  webgl: {
    label: 'WebGL',
    webFeature: 'webgl',
    handling: 'Renders on the GPU.',
    test: () => {
      const gl = context('webgl');
      releaseGl(gl);
      return present(gl !== null, 'a WebGL context opens', 'no WebGL context');
    },
    context: display,
  },
  webgl2: {
    label: 'WebGL 2',
    webFeature: 'webgl2',
    handling: 'Renders on the GPU.',
    test: () => {
      const gl = context('webgl2');
      releaseGl(gl);
      return present(gl !== null, 'a WebGL 2 context opens', 'no WebGL 2 context');
    },
    context: display,
  },
  webgpu: {
    label: 'WebGPU',
    webFeature: 'webgpu',
    handling: 'Renders on the GPU.',
    test: async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      if (!gpu) return { state: 'absent', detail: 'navigator.gpu missing' };
      const adapter = (await gpu.requestAdapter()) as { info?: { vendor?: string; architecture?: string } } | null;
      if (!adapter) return { state: 'absent', detail: 'navigator.gpu present, but no adapter' };
      const info = [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(' ');
      webgpuAdapterNote = info ? `WebGPU adapter: ${info}.` : null;
      return { state: 'detected', detail: 'an adapter is available' };
    },
    context: (env) => [webgpuAdapterNote, display(env)].filter(Boolean).join(' '),
  },
  'view-transitions': {
    label: 'View transitions',
    webFeature: 'view-transitions',
    test: () =>
      present(
        typeof document.startViewTransition === 'function',
        'document.startViewTransition() present',
        'document.startViewTransition() missing',
      ),
  },
  'anchor-positioning': {
    label: 'Anchor positioning',
    webFeature: 'anchor-positioning',
    test: () => supports('anchor-name: --a', 'anchor-name: --a'),
  },
  'container-queries': {
    label: 'Container queries',
    webFeature: 'container-queries',
    test: () => supports('container-type: inline-size', 'container-type: inline-size'),
  },
  popover: {
    label: 'Popover',
    webFeature: 'popover',
    test: () => present('popover' in HTMLElement.prototype, 'the popover attribute is reflected', 'no popover attribute'),
  },
  wasm: {
    label: 'WebAssembly',
    webFeature: 'wasm',
    test: () => present(typeof WebAssembly === 'object', 'WebAssembly present', 'WebAssembly missing'),
  },
  'offscreen-canvas': {
    label: 'OffscreenCanvas',
    webFeature: 'offscreen-canvas',
    test: () => present(typeof OffscreenCanvas === 'function', 'OffscreenCanvas present', 'OffscreenCanvas missing'),
    context: display,
  },
  'web-workers': {
    label: 'Web workers',
    webFeature: 'dedicated-workers',
    test: () => present(typeof Worker === 'function', 'Worker present', 'Worker missing'),
  },
  'device-orientation': {
    label: 'Device orientation',
    webFeature: 'device-orientation-events',
    handling: 'Responds to how the device is held, and may ask for motion access.',
    test: () => {
      if (typeof DeviceOrientationEvent !== 'function') return { state: 'absent', detail: 'DeviceOrientationEvent missing' };
      const needsPermission =
        typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function';
      return {
        state: 'detected',
        detail: needsPermission ? 'present; requires permission, asked on a tap' : 'present; a sensor is not guaranteed',
      };
    },
  },
  gamepad: {
    label: 'Gamepad',
    webFeature: 'gamepad',
    handling: 'Accepts a game controller.',
    test: () =>
      present(typeof navigator.getGamepads === 'function', 'navigator.getGamepads() present', 'Gamepad API missing'),
  },
  'web-midi': {
    label: 'Web MIDI',
    webFeature: 'web-midi',
    handling: 'May ask for access to MIDI devices.',
    test: () =>
      present(
        typeof (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function',
        'present; never called here',
        'navigator.requestMIDIAccess() missing',
      ),
  },
  'speech-synthesis': {
    label: 'Speech synthesis',
    webFeature: 'speech-synthesis',
    handling: 'May speak aloud.',
    test: () => present('speechSynthesis' in window, 'speechSynthesis present', 'speechSynthesis missing'),
  },
  eventsource: {
    label: 'Server-sent events',
    webFeature: 'server-sent-events',
    handling: 'Streams live data from an outside source while open.',
    test: () => present(typeof EventSource === 'function', 'EventSource present', 'EventSource missing'),
  },
  'document-picture-in-picture': {
    label: 'Document Picture-in-Picture',
    webFeature: 'document-picture-in-picture',
    handling: 'May open a floating window when you ask it to.',
    test: () => {
      if (!window.isSecureContext) return { state: 'blocked', detail: 'not a secure context' };
      return present(
        'documentPictureInPicture' in window,
        'window.documentPictureInPicture present',
        'window.documentPictureInPicture missing',
      );
    },
  },
  // Technique notes: no browser dependency, so no test and no light.
  css: { label: 'CSS' },
  'split-flap': { label: 'Split-flap' },
  'live-data': { label: 'Live data' },
  html: { label: 'HTML' },
  svg: { label: 'SVG' },
  javascript: { label: 'JavaScript' },
  physics: { label: 'Physics' },
  autocorrelation: { label: 'Autocorrelation' },
};

/** Query a permission without ever prompting; null when the browser will not say. */
export async function queryPermission(name: 'microphone' | 'camera'): Promise<PermissionState | null> {
  try {
    if (!navigator.permissions?.query) return null;
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state;
  } catch {
    return null;
  }
}

/** The display label for any tag, catalogued or not. */
export function techniqueLabel(tag: string): string {
  return TECHNIQUES[normalizeTag(tag)]?.label ?? tag;
}

/** True when the register has a test for this tag. */
export function isTestable(tag: string): boolean {
  return typeof TECHNIQUES[normalizeTag(tag)]?.test === 'function';
}
