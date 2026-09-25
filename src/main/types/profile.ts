import type { Fingerprint } from './fingerprint';
export interface Profile {
  id: string; name: string; group_id: string; tags: string[]; note: string;
  startup_urls: string[]; raw_proxy: string; fingerprint: Fingerprint;
  created_at: string; updated_at: string;
}
export interface ProfileRow {
  id: string; name: string; group_id: string; tags: string; note: string;
  startup_urls: string; raw_proxy: string; fingerprint_json: string;
  created_at: string; updated_at: string;
}
