export type CanvasMode = 'real' | 'noise' | 'block';
export type WebRtcMode = 'based-on-ip' | 'fixed' | 'real' | 'disabled';
export interface Fingerprint {
  os: 'windows' | 'macos' | 'linux' | 'android';
  userAgent: string;
  platform: string;
  screen: { width: number; height: number; availHeight: number; devicePixelRatio: number };
  hardwareConcurrency: number;
  deviceMemory: number;
  languages: string[];
  timezone: string;
  geoip: { latitude: number; longitude: number; country: string; city: string } | null;
  canvas: CanvasMode;
  webgl: { mode: CanvasMode; vendor: string; renderer: string };
  audio: CanvasMode;
  webRtc: { mode: WebRtcMode; publicIp: string | null };
  fonts: string[];
  doNotTrack: '1' | null;
  touchPoints: number;
}
export interface FingerprintInput { os: Fingerprint['os']; seed?: string }
export const FINGERPRINT_SCHEMA_VERSION = 1;
