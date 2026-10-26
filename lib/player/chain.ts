/**
 * Ланцюжок запасних джерел (data-model.md 1.5, research.md 3, contracts/ui-events.md).
 * Чисті функції: нічого не емітують і не читають годинник — `now` приходить в аргументі.
 */
import type {
  ChainSelection,
  Ms,
  PlayerFacebookConsentRequired,
  PlayerSlotId,
  PlayerSource,
  PlayerSourceSwitched,
  SwitchingErrorCode,
} from './types';

export interface ChainContext {
  slot: PlayerSlotId;
  eventId: string;
  sources: readonly PlayerSource[];
  /** Джерела, позначені недоступними в цьому сеансі. */
  failed: readonly string[];
  facebookConsent: boolean;
  /** Серверний час (`TimeSource.now()`). */
  now: Ms;
}

export type ChainCause =
  | { type: 'error'; code: number }
  | { type: 'ended' }
  | { type: 'not-live' };

export type ChainTransition =
  /** Код 153: немає `Referer` (поганий `Referrer-Policy`) — баг конфігурації сайту, джерело не міняється. */
  | { type: 'config-error'; code: 153 }
  | { type: 'ignored' }
  | {
      type: 'switched';
      failed: string[];
      selection: ChainSelection;
      switched: PlayerSourceSwitched;
      consentRequired?: PlayerFacebookConsentRequired;
    };

const SWITCHING_CODES: ReadonlySet<number> = new Set<SwitchingErrorCode>([2, 5, 100, 101, 150]);
export const CONFIG_ERROR_CODE = 153;

export function classifyPlayerError(code: number): 'switch' | 'config' | 'ignore' {
  if (SWITCHING_CODES.has(code)) return 'switch';
  if (code === CONFIG_ERROR_CODE) return 'config';
  return 'ignore';
}

/** Чи можна взагалі показати джерело зараз (без урахування згоди Facebook і списку недоступних). */
export function isPlayable(source: PlayerSource, now: Ms): boolean {
  if (!source.embeddable) return false;
  // Twitch у цій області не вбудовується.
  if (source.platform === 'twitch') return false;
  if (source.platform === 'youtube' && !source.videoId) return false;
  if (source.startsAt !== undefined) {
    const startsAt = Date.parse(source.startsAt);
    if (Number.isFinite(startsAt) && startsAt > now) return false;
  }
  // `expected` після startsAt стає живою сама; `live`, що перестала бути live, пропускається.
  if (source.status === 'live' && !source.isLive && !source.alwaysOn) return false;
  return true;
}

function sorted(sources: readonly PlayerSource[]): PlayerSource[] {
  return [...sources].sort((a, b) => a.order - b.order);
}

/**
 * Вибір джерела: перше придатне за `order`; Facebook без згоди пропускається,
 * якщо є інше придатне джерело; якщо воно єдине — `facebook-consent`; нічого — `countdown-scene`.
 */
export function selectSource(ctx: ChainContext): ChainSelection {
  const failed = new Set(ctx.failed);
  const candidates = sorted(ctx.sources).filter((s) => !failed.has(s.id) && isPlayable(s, ctx.now));
  const usable = candidates.find((s) => s.platform !== 'facebook' || ctx.facebookConsent);
  if (usable) return { kind: 'source', source: usable, index: usable.order };
  const facebook = candidates.find((s) => s.platform === 'facebook');
  if (facebook) return { kind: 'facebook-consent', source: facebook, index: facebook.order };
  return { kind: 'countdown-scene' };
}

export function consentEventFor(
  ctx: Pick<ChainContext, 'slot' | 'eventId' | 'now'>,
  selection: ChainSelection,
): PlayerFacebookConsentRequired | undefined {
  if (selection.kind !== 'facebook-consent') return undefined;
  return {
    eventKey: `fb-consent:${ctx.slot}:${selection.source.id}`,
    at: ctx.now,
    slot: ctx.slot,
    eventId: ctx.eventId,
    sourceId: selection.source.id,
  };
}

function reasonOf(cause: ChainCause): PlayerSourceSwitched['reason'] {
  if (cause.type === 'ended') return 'ended';
  if (cause.type === 'not-live') return 'not-live';
  return cause.code === 101 || cause.code === 150 ? 'not-embeddable' : 'error';
}

/** Поточне джерело зламалось / завершилось → наступне придатне в ланцюжку. */
export function advanceChain(
  ctx: ChainContext,
  input: { currentSourceId: string; cause: ChainCause },
): ChainTransition {
  const { cause, currentSourceId } = input;
  if (cause.type === 'error') {
    const kind = classifyPlayerError(cause.code);
    if (kind === 'config') return { type: 'config-error', code: CONFIG_ERROR_CODE };
    if (kind === 'ignore') return { type: 'ignored' };
  }

  const failed = ctx.failed.includes(currentSourceId) ? [...ctx.failed] : [...ctx.failed, currentSourceId];
  const selection = selectSource({ ...ctx, failed });
  const exhausted = selection.kind === 'countdown-scene';
  const toSourceId = exhausted ? '' : selection.source.id;

  const switched: PlayerSourceSwitched = {
    eventKey: exhausted
      ? `switched:${ctx.slot}:exhausted:${currentSourceId}`
      : `switched:${ctx.slot}:${toSourceId}`,
    at: ctx.now,
    slot: ctx.slot,
    eventId: ctx.eventId,
    fromSourceId: currentSourceId,
    toSourceId,
    chainIndex: exhausted ? -1 : selection.index,
    reason: reasonOf(cause),
  };
  if (cause.type === 'error') switched.errorCode = cause.code as SwitchingErrorCode;
  if (exhausted) switched.exhausted = true;

  const consentRequired = consentEventFor(ctx, selection);
  return consentRequired
    ? { type: 'switched', failed, selection, switched, consentRequired }
    : { type: 'switched', failed, selection, switched };
}
