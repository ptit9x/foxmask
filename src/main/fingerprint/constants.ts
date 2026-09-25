// Per-OS data pools used by the fingerprint generator.
// All values modeled after real Chromium-on-platform populations so that
// cross-surface consistency (UA ↔ screen ↔ GPU ↔ fonts) holds.

export type Os = 'windows' | 'macos' | 'linux' | 'android';

export interface ScreenPoolEntry {
  width: number;
  height: number;
  /** available (work-area) height in CSS px */
  availHeight: number;
  devicePixelRatio: number;
}

export interface GpuPoolEntry {
  vendor: string;
  renderer: string;
}

/** Chrome majors kept in rotation; bump as new stable majors ship. */
const CHROME_MAJORS = [138, 137, 136] as const;
const CHROME_MAJOR_DATE = { 138: '2025-10-15', 137: '2025-09-24', 136: '2025-08-20' } as const;

function chromeUa(platformToken: string, major: number): string {
  return (
    `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${major}.0.0.0 Safari/537.36`
  );
}

function desktopUas(platformToken: string): string[] {
  return CHROME_MAJORS.map((m) => chromeUa(platformToken, m));
}

/** User-agent pools. Android UAs are mobile Chrome (touch-first). */
export const USER_AGENTS: Record<Os, string[]> = {
  windows: desktopUas('Windows NT 10.0; Win64; x64'),
  macos: desktopUas('Macintosh; Intel Mac OS X 10_15_7'),
  linux: desktopUas('X11; Linux x86_64'),
  android: [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36'
  ]
};

/** Map a UA string back to the Chrome major it advertises (138 → '2025-10-15'). */
export function chromeMajorDateForUa(ua: string): string {
  const m = /Chrome\/(\d+)\./.exec(ua);
  const major = m ? Number(m[1]) : 138;
  const table = CHROME_MAJOR_DATE as Record<number, string>;
  return table[major] ?? CHROME_MAJOR_DATE[138];
}

export const NAV_PLATFORM: Record<Os, string> = {
  windows: 'Win32',
  macos: 'MacIntel',
  linux: 'Linux x86_64',
  android: 'Linux armv8l'
};

export const SCREENS: Record<Os, ScreenPoolEntry[]> = {
  windows: [
    { width: 1920, height: 1080, availHeight: 1032, devicePixelRatio: 1 },
    { width: 1366, height: 768, availHeight: 728, devicePixelRatio: 1 },
    { width: 2560, height: 1440, availHeight: 1392, devicePixelRatio: 1 },
    { width: 1536, height: 864, availHeight: 816, devicePixelRatio: 1.25 }
  ],
  macos: [
    { width: 1440, height: 900, availHeight: 875, devicePixelRatio: 2 },
    { width: 1680, height: 1050, availHeight: 1025, devicePixelRatio: 2 },
    { width: 2560, height: 1600, availHeight: 1575, devicePixelRatio: 2 }
  ],
  linux: [
    { width: 1920, height: 1080, availHeight: 1053, devicePixelRatio: 1 },
    { width: 1600, height: 900, availHeight: 873, devicePixelRatio: 1 }
  ],
  android: [
    { width: 360, height: 800, availHeight: 712, devicePixelRatio: 3 },
    { width: 412, height: 915, availHeight: 827, devicePixelRatio: 2.625 }
  ]
};

export const GPUS: Record<Os, GpuPoolEntry[]> = {
  windows: [
    {
      vendor: 'Google Inc. (NVIDIA)',
      renderer:
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)'
    },
    {
      vendor: 'Google Inc. (Intel)',
      renderer:
        'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)'
    },
    {
      vendor: 'Google Inc. (AMD)',
      renderer:
        'ANGLE (AMD, AMD Radeon(TM) RX 580 Series (0x000067DF) Direct3D11 vs_5_0 ps_5_0, D3D11)'
    }
  ],
  macos: [
    {
      vendor: 'Google Inc. (Apple)',
      renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'
    },
    {
      vendor: 'Google Inc. (Apple)',
      renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'
    },
    {
      vendor: 'Google Inc. (Intel)',
      renderer: 'ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 645, OpenGL 4.1)'
    }
  ],
  linux: [
    {
      vendor: 'Google Inc. (Intel)',
      renderer:
        'ANGLE (Intel, Mesa Intel(R) UHD Graphics (CML GT2), OpenGL 4.6 (Core Profile) Mesa 23.2.1)'
    },
    {
      vendor: 'Google Inc. (Google)',
      renderer:
        'ANGLE (Google, ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver-5.0.0)'
    },
    {
      vendor: 'Google Inc. (Google)',
      renderer: 'ANGLE (llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5 (Core Profile) Mesa 23.2.1)'
    }
  ],
  android: [
    { vendor: 'Qualcomm', renderer: 'Adreno (TM) 740' },
    { vendor: 'ARM', renderer: 'Mali-G715' }
  ]
};

export const FONTS: Record<Os, string[]> = {
  windows: [
    'Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Ebrima',
    'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Ink Free',
    'Javanese Text', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic', 'Marlett',
    'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft New Tai Lue', 'Microsoft PhagsPa',
    'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei', 'MingLiU-ExtB',
    'Mongolian Baiti', 'MS Gothic', 'MV Boli', 'Myanmar Text', 'Nirmala UI',
    'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Emoji',
    'Segoe UI Historic', 'Segoe UI Symbol', 'SimSun', 'Sitka', 'Sylfaen', 'Symbol', 'Tahoma',
    'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic'
  ],
  macos: [
    'American Typewriter', 'Andale Mono', 'Apple Color Emoji', 'AppleGothic', 'Arial',
    'Arial Rounded MT Bold', 'Avenir', 'Avenir Next', 'Baskerville', 'Bodoni 72',
    'Bradley Hand', 'Chalkboard', 'Chalkduster', 'Charter', 'Cochin', 'Comic Sans MS',
    'Copperplate', 'Courier New', 'Didot', 'Futura', 'Geneva', 'Georgia', 'Gill Sans',
    'Helvetica', 'Helvetica Neue', 'Hiragino Sans', 'Hoefler Text', 'Impact', 'Ink Free',
    'Lucida Grande', 'Luminari', 'Marker Felt', 'Menlo', 'Microsoft Sans Serif', 'Monaco',
    'Mukta Mahee', 'Noteworthy', 'Optima', 'Palatino', 'Papyrus', 'Perpetua', 'Rockwell',
    'Savoye LET', 'SignPainter', 'Skia', 'Snell Roundhand', 'Tahoma', 'Times New Roman',
    'Trattatello', 'Trebuchet MS', 'Verdana', 'Zapfino'
  ],
  linux: [
    'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'Liberation Sans', 'Liberation Serif',
    'Liberation Mono', 'Ubuntu', 'Ubuntu Mono', 'Cantarell', 'FreeSans', 'FreeSerif',
    'Noto Sans', 'Noto Sans Mono', 'Noto Color Emoji', 'Arial', 'Times New Roman',
    'Courier New'
  ],
  android: [
    'Roboto', 'Droid Sans', 'Noto Sans', 'Noto Naskh Arabic', 'Noto Color Emoji',
    'Coming Soon', 'Carrois Gothic SC', 'Cutive Mono'
  ]
};

/** Accepted navigator.language stacks (first tag is navigator.language). */
export const LANGUAGE_STACKS: string[][] = [
  ['en-US', 'en'],
  ['vi-VN', 'vi', 'en-US', 'en'],
  ['de-DE', 'de'],
  ['fr-FR', 'fr'],
  ['ja-JP', 'ja'],
  ['pt-BR', 'pt'],
  ['es-ES', 'es'],
  ['ru-RU', 'ru'],
  ['ko-KR', 'ko'],
  ['zh-CN', 'zh']
];

export const HARDWARE_CONCURRENCY: Record<Os, number[]> = {
  windows: [4, 8, 12, 16],
  macos: [4, 8, 12, 16],
  linux: [4, 8, 12, 16],
  android: [8]
};

export const DEVICE_MEMORY: Record<Os, number[]> = {
  windows: [4, 8],
  macos: [8],
  linux: [4, 8],
  android: [4, 8]
};

/**
 * Default timezone pool. Usually overridden at launch with the timezone
 * resolved from the profile's proxy geo.
 */
export const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Ho_Chi_Minh',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney'
];

/** Fraction range [min, max] of the OS font pool a fingerprint exposes. */
export const FONT_SUBSET_FRACTIONS: Record<Os, [number, number]> = {
  windows: [0.85, 1],
  macos: [0.85, 1],
  linux: [0.8, 1],
  android: [1, 1]
};

export const TOUCH_POINTS: Record<Os, number> = {
  windows: 0,
  macos: 0,
  linux: 0,
  android: 5
};
