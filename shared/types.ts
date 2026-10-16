export type Layer = 'consent' | 'privacy' | 'security' | 'politeness';
export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';

export interface Check {
  id: string;
  layer: Layer;
  label: string;
  status: CheckStatus;
  detail: string;
  evidence?: string;
}

/** Why a crawler made a call on a page. `skipped` pages are never fetched by the responsible crawler. */
export type Decision = 'collected' | 'redacted' | 'quarantined' | 'skipped' | 'error';

export interface Segment {
  id: number;
  text: string;
  where: string;
  hidden: boolean;
  hiddenReasons: string[];
  injectionScore: number;
  injectionSignals: string[];
}

export interface PiiFinding {
  kind: 'email' | 'phone' | 'ssn' | 'credit-card' | 'ip';
  value: string;
}

export interface AgentRun {
  output: string;
  /** Regex hits that indicate the agent followed an injected instruction. */
  hijackSignals: string[];
  hijacked: boolean;
}

export interface AgentComparison {
  model: string;
  simulated: boolean;
  naive: AgentRun;
  guarded: AgentRun;
}

export interface AblationResult {
  segmentId: number;
  where: string;
  text: string;
  hijackedWithout: boolean;
  causal: boolean;
  output: string;
}

export interface PageReport {
  id: string;
  url: string;
  path: string;
  depth: number;
  parent: string | null;
  title: string;
  httpStatus: number | null;
  decision: Decision;
  naiveDecision: 'collected' | 'error';
  reason: string;
  checks: Check[];
  links: string[];
  segments: Segment[];
  pii: PiiFinding[];
  visibleChars: number;
  hiddenChars: number;
  injectionRisk: number;
  agent?: AgentComparison;
  fetchedByResponsible: boolean;
}

export interface BotPolicy {
  bot: string;
  owner: string;
  purpose: string;
  rootAllowed: boolean;
  line: number;
}

export interface SitePolicy {
  origin: string;
  robotsFound: boolean;
  robotsText: string;
  crawlDelay: number | null;
  bots: BotPolicy[];
  aiTxt: string | null;
  tdmRep: string | null;
}

export interface CrawlStats {
  pages: number;
  collected: number;
  redacted: number;
  quarantined: number;
  skipped: number;
  errors: number;
  piiRedacted: number;
  hiddenSegments: number;
  injectionsFlagged: number;
  naiveHijacked: number;
  guardedHijacked: number;
}

export type CrawlEvent =
  | { type: 'start'; seed: string; origin: string; compare: boolean; maxPages: number; model: string; simulated: boolean }
  | { type: 'site'; policy: SitePolicy }
  | { type: 'discover'; url: string; parent: string | null; depth: number }
  | { type: 'page'; report: PageReport }
  | { type: 'done'; stats: CrawlStats }
  | { type: 'error'; message: string };

export interface AppConfig {
  model: string;
  simulated: boolean;
  labOrigin: string;
}
