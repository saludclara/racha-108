import type { DataProvider, MatchCandidate } from "@/lib/engine/types";

export type SourceStatus = {
  id: DataProvider;
  label: string;
  enabled: boolean;
  configured: boolean;
  ok: boolean;
  count: number;
  error?: string;
};

export type FetchOptions = {
  now?: Date;
  enableApiFootball?: boolean;
  enableOddsApi?: boolean;
  enableEsports?: boolean;
  /** Prefer this ESPN/AF league name when resolving a single event. */
  leagueHint?: string;
};

export type ProviderResult = {
  matches: MatchCandidate[];
  status: SourceStatus;
};

export interface MatchProvider {
  id: DataProvider;
  label: string;
  /** True if env key present (or no key needed). */
  isConfigured(): boolean;
  fetch(opts: FetchOptions): Promise<ProviderResult>;
  refreshByExternalId?(
    externalId: string,
    opts?: FetchOptions,
  ): Promise<MatchCandidate | null>;
}
