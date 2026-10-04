// Every edit to a Wikipedia article, as it happens. The live source is
// Wikimedia's public EventStreams feed; when it goes quiet, the page polls
// each wiki's recent-changes API instead. Both are free, keyless, and CORS-open.

const STREAM = 'https://stream.wikimedia.org/v2/stream/recentchange';
const POLL_EVERY = 6000;
const QUIET_AFTER = 15000;
const REOPEN_AFTER = 20000;

/** Wikis the poller walks through when the board shows every wiki. */
const POLL_WIKIS = ['en', 'de', 'fr', 'es', 'ja', 'ru', 'it', 'pt', 'zh', 'nl', 'pl', 'sv'];

export type Kind = 'new' | 'revert' | 'bot' | 'anon' | 'minor' | 'edit';
export type Status = 'connecting' | 'live' | 'polling' | 'down';

export interface Arrival {
  key: string;
  wiki: string;
  title: string;
  time: Date;
  delta: number;
  kind: Kind;
  bot: boolean;
  url: string;
}

// The board prints Latin, Greek, Cyrillic, and CJK titles. Right-to-left and
// shaped scripts fall apart when each character sits in its own cell.
const PRINTABLE =
  /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]+$/u;

// Edit summaries are free text, so reverts are a guess from common wording in
// the larger wikis' languages.
const REVERT =
  /\b(revert(ed|ing)?|undid|undo|rvv?|rollback)\b|rückgängig|révocation|annulation|revertid|deshecha|annullat|desfeita|отмен|откат|ongedaan|teruggedraaid|wycofan|anulowanie|återställ|取り消し|巻き戻し|回退|撤销|撤銷|还原|還原/i;

const ANON = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f]*:[0-9a-f:]+|~\d{4}-.*)$/i;

/** True when the board can print this title. */
export const printable = (title: string): boolean => PRINTABLE.test(title);

function kindOf(type: string, bot: boolean, minor: boolean, user: string, comment: string): Kind {
  if (type === 'new') return 'new';
  if (REVERT.test(comment)) return 'revert';
  if (bot) return 'bot';
  if (ANON.test(user)) return 'anon';
  if (minor) return 'minor';
  return 'edit';
}

interface StreamEvent {
  type: string;
  namespace: number;
  title: string;
  timestamp: number;
  user: string;
  bot: boolean;
  minor?: boolean;
  comment?: string;
  server_name: string;
  length?: { old?: number; new?: number };
  revision?: { old?: number; new?: number };
}

function fromStream(e: StreamEvent): Arrival | null {
  if (e.namespace !== 0 || (e.type !== 'edit' && e.type !== 'new')) return null;
  const match = /^([a-z-]+)\.wikipedia\.org$/.exec(e.server_name);
  if (!match) return null;
  const wiki = match[1]!;
  const host = `https://${e.server_name}`;
  const rev = e.revision?.new ?? 0;
  return {
    key: `${wiki}:${rev}`,
    wiki,
    title: e.title,
    time: new Date(e.timestamp * 1000),
    delta: (e.length?.new ?? 0) - (e.length?.old ?? 0),
    kind: kindOf(e.type, e.bot, e.minor ?? false, e.user, e.comment ?? ''),
    bot: e.bot,
    url:
      e.type === 'new'
        ? `${host}/w/index.php?oldid=${rev}`
        : `${host}/w/index.php?diff=${rev}&oldid=${e.revision?.old ?? ''}`,
  };
}

interface ApiChange {
  type: string;
  title: string;
  revid: number;
  old_revid: number;
  oldlen: number;
  newlen: number;
  timestamp: string;
  user?: string;
  comment?: string;
  bot?: boolean;
  minor?: boolean;
  anon?: boolean;
}

function fromApi(wiki: string, c: ApiChange): Arrival {
  const host = `https://${wiki}.wikipedia.org`;
  return {
    key: `${wiki}:${c.revid}`,
    wiki,
    title: c.title,
    time: new Date(c.timestamp),
    delta: c.newlen - c.oldlen,
    kind: kindOf(c.type, c.bot ?? false, c.minor ?? false, c.anon ? '0.0.0.0' : (c.user ?? ''), c.comment ?? ''),
    bot: c.bot ?? false,
    url:
      c.type === 'new'
        ? `${host}/w/index.php?oldid=${c.revid}`
        : `${host}/w/index.php?diff=${c.revid}&oldid=${c.old_revid}`,
  };
}

/**
 * Listens to the live stream, and falls back to polling when the stream is
 * closed or silent. Reports each edit once, whichever source it came from.
 */
export class Feed {
  onArrival: (arrival: Arrival) => void = () => {};
  onStatus: (status: Status) => void = () => {};
  /** The wiki to poll when the stream is down; null walks through the big ones. */
  wiki: string | null = null;

  private stream: EventSource | null = null;
  private status: Status = 'connecting';
  private lastHeard = 0;
  private pollTimer = 0;
  private pollTurn = 0;
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];

  start(): void {
    this.open();
    this.lastHeard = Date.now();
    setInterval(() => this.watch(), 3000);
  }

  private open(): void {
    this.stream?.close();
    const stream = new EventSource(STREAM);
    this.stream = stream;
    stream.onmessage = (message) => {
      this.lastHeard = Date.now();
      if (this.status !== 'live') this.setStatus('live');
      this.stopPolling();
      let event: StreamEvent;
      try {
        event = JSON.parse(message.data as string) as StreamEvent;
      } catch {
        return;
      }
      const arrival = fromStream(event);
      if (arrival) this.report(arrival);
    };
  }

  private watch(): void {
    const quiet = Date.now() - this.lastHeard;
    if (quiet > QUIET_AFTER && !this.pollTimer) this.startPolling();
    // EventSource retries on its own after a dropped connection, but gives up
    // for good on some errors. Reopen it now and then while it is closed.
    if (this.stream?.readyState === EventSource.CLOSED && quiet > REOPEN_AFTER) {
      this.lastHeard = Date.now() - QUIET_AFTER;
      this.open();
    }
  }

  private startPolling(): void {
    if (this.status === 'live') this.setStatus('connecting');
    const poll = async () => {
      const wiki = this.wiki ?? POLL_WIKIS[this.pollTurn++ % POLL_WIKIS.length]!;
      const url =
        `https://${wiki}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*` +
        '&list=recentchanges&rcnamespace=0&rctype=edit|new&rclimit=12' +
        '&rcprop=title|ids|sizes|flags|user|timestamp|comment';
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { query?: { recentchanges?: ApiChange[] } };
        const changes = body.query?.recentchanges ?? [];
        // Oldest first, so the newest lands last, as it would from the stream.
        for (const change of changes.reverse()) this.report(fromApi(wiki, change));
        if (this.status !== 'live') this.setStatus('polling');
      } catch {
        if (this.status !== 'live') this.setStatus('down');
      }
    };
    void poll();
    this.pollTimer = window.setInterval(poll, POLL_EVERY);
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = 0;
  }

  private setStatus(status: Status): void {
    this.status = status;
    this.onStatus(status);
  }

  private report(arrival: Arrival): void {
    if (this.seen.has(arrival.key)) return;
    this.seen.add(arrival.key);
    this.seenOrder.push(arrival.key);
    if (this.seenOrder.length > 2000) this.seen.delete(this.seenOrder.shift()!);
    this.onArrival(arrival);
  }
}
