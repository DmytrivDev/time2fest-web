'use client';

/**
 * Прихована панель «машини часу» (T085, contracts/time-machine.md). Лише тестова збірка:
 * монтується через `TimeMachineMount` за `IS_TEST_BUILD`, у робочому пакеті її немає.
 * Відкривається `?panel=1` або `Ctrl+Alt+T`, закривається так само чи `Esc`.
 * `role="dialog"` без блокування сторінки (`aria-modal="false"`, без підкладки й пастки фокуса),
 * поза областю плеєра.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/primitives/Button';
import { IconButton } from '@/components/primitives/IconButton';
import { SegmentedControl } from '@/components/primitives/SegmentedControl';
import { Switch } from '@/components/primitives/Switch';
import { useStreamChains } from '@/lib/api/hooks/live';
import { chatDev } from '@/lib/api/hooks/chat';
import { getData } from '@/lib/data/load';
import type { PayResult } from '@/lib/data/types';
import { currentAirEvent } from '@/lib/engine/currentAirEvent';
import { computeJumps, JUMP_IDS, type JumpId } from '@/lib/time/jumps';
import { parseIsoWithOffset, parseMachineParams } from '@/lib/time/params';
import { useNow, useTimeMachine, useTimeSource } from '@/lib/time/TimeProvider';
import { authActions, useDevCode, useSession } from '@/lib/api/hooks/auth';
import { devFaults } from '@/lib/api/hooks/dev';
import { resetDeviceState } from '@/stores/resetDevice';
import { useTestControls } from '@/stores/testControls';
import styles from './time-machine-panel.module.css';

const SPEEDS = [
  { value: '1', label: '×1' },
  { value: '10', label: '×10' },
  { value: '60', label: '×60' },
] as const;
const PAY_RESULTS: PayResult[] = ['success', 'pending', 'declined', 'expired'];
const OFFSETS = Array.from({ length: 27 }, (_, i) => i - 12).map((h) => {
  const sign = h < 0 ? '-' : '+';
  return `${sign}${String(Math.abs(h)).padStart(2, '0')}:00`;
});
const DEFAULT_OFFSET = '+02:00';

function offsetMs(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1;
  return sign * Number(offset.slice(1, 3)) * 3_600_000;
}

/** Локальний вигляд для `datetime-local` у заданому зсуві. */
function toLocalInput(ms: number, offset: string): string {
  return new Date(Math.round(ms) + offsetMs(offset)).toISOString().slice(0, 19);
}

const kyivFmt = new Intl.DateTimeFormat('uk-UA', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export interface TimeMachinePanelProps {
  /** Для Storybook: відкрита одразу (замість `?panel=1`). */
  defaultOpen?: boolean;
}

export function TimeMachinePanel({ defaultOpen = false }: TimeMachinePanelProps) {
  const [open, setOpen] = useState(() => {
    if (defaultOpen) return true;
    return typeof window !== 'undefined' && parseMachineParams(window.location.search).panel;
  });
  const [warnings, setWarnings] = useState<boolean>(
    () => typeof window !== 'undefined' && parseMachineParams(window.location.search).warnings.length > 0,
  );
  const lastFocus = useRef<HTMLElement | null>(null);

  const toggle = useCallback((next?: boolean) => {
    setOpen((cur) => {
      const v = next ?? !cur;
      if (v && !cur) lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return v;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && !e.metaKey && e.code === 'KeyT') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Escape') {
        toggle(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  if (!open) return null;
  return (
    <PanelBody
      invalid={warnings}
      onInvalid={setWarnings}
      onClose={() => {
        toggle(false);
        lastFocus.current?.focus?.();
      }}
    />
  );
}

function PanelBody({
  invalid,
  onInvalid,
  onClose,
}: {
  invalid: boolean;
  onInvalid: (v: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations('timeMachine');
  const machine = useTimeMachine();
  const source = useTimeSource();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  const [offset, setOffset] = useState(DEFAULT_OFFSET);
  const [moment, setMoment] = useState(() => toLocalInput(machine?.now() ?? Date.now(), DEFAULT_OFFSET));
  const speed = useSyncExternalStore(
    useCallback((l: () => void) => machine?.subscribe(l) ?? (() => undefined), [machine]),
    () => machine?.speed ?? 1,
    () => 1,
  );
  const payResult = useTestControls((s) => s.payResult);
  const chatAvailable = useTestControls((s) => s.chatAvailable);
  const offline = useTestControls((s) => s.offlineSimulated);
  const slowForced = useTestControls((s) => s.slowForcedSec);
  const emptyCountry = useTestControls((s) => s.emptyCountry);
  const authUnavailable = useTestControls((s) => s.authUnavailable);
  const googleCancelled = useTestControls((s) => s.googleCancelled);
  const googleRedirect = useTestControls((s) => s.googleRedirect);
  const notifications = useTestControls((s) => s.notifications);
  const signedIn = (useSession().session?.user ?? null) !== null;
  const devCode = useDevCode();
  const faults = devFaults();
  const [apiSlow, setApiSlow] = useState(false);
  const [apiDown, setApiDown] = useState(false);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const chains = useStreamChains();
  const jumps = useMemo(() => computeJumps(currentAirEvent(now, getData(), chains)), [now, chains]);

  if (!machine) return null;

  const apply = () => {
    const ms = parseIsoWithOffset(`${moment.length === 16 ? `${moment}:00` : moment}${offset}`);
    if (ms === undefined) {
      console.warn('[time-machine] Невірний t');
      onInvalid(true);
      return;
    }
    onInvalid(false);
    machine.set({ at: ms });
  };

  const jump = (id: JumpId) => {
    const target = jumps[id];
    if (target !== null) machine.set({ at: target });
  };

  const api = typeof window === 'undefined' ? undefined : window.__t2f;
  const timeNow = Math.round(now);

  return (
    <section
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label={t('title')}
      tabIndex={-1}
      data-t2f-time-machine=""
      className={`${styles.panel} z-50 flex flex-col gap-4 rounded-lg border border-border-strong bg-surface p-4 text-text shadow-overlay`}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-body-strong">{t('title')}</h2>
        <IconButton aria-label={t('close')} icon="close" onClick={onClose} />
      </header>

      <dl className="flex flex-col gap-1 text-caption text-text-secondary" aria-label={t('virtualTime')}>
        <div className="flex gap-3">
          <dt className="w-16">{t('kyiv')}</dt>
          <dd data-testid="tm-kyiv" className="text-text">
            {kyivFmt.format(timeNow)}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-16">{t('utc')}</dt>
          <dd data-testid="tm-utc" className="text-text">
            {formatUtc(timeNow)}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-16">{t('speed')}</dt>
          <dd data-testid="tm-speed" className="text-text">
            ×{speed}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-16">{t('source')}</dt>
          <dd data-testid="tm-source" className="text-text">
            {source.status === 'machine' ? t('sourceMachine') : t('sourceServer')}
          </dd>
        </div>
      </dl>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-caption text-text-secondary">
            {t('moment')}
            <input
              type="datetime-local"
              step={1}
              value={moment}
              onChange={(e) => setMoment(e.target.value)}
              className="t2f-focus min-h-touch-min rounded-md border border-border-strong bg-background px-3 text-body text-text"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption text-text-secondary">
            {t('offset')}
            <select
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              className="t2f-focus min-h-touch-min rounded-md border border-border-strong bg-background px-2 text-body text-text"
            >
              {OFFSETS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button type="submit" variant="tonal">
          {t('apply')}
        </Button>
        {invalid && (
          <p role="alert" data-testid="tm-warning" className="text-caption text-primary">
            {t('invalidT')}
          </p>
        )}
      </form>

      <SegmentedControl
        label={t('speed')}
        value={String(speed)}
        onValueChange={(v) => machine.set({ speed: Number(v) })}
        options={[...SPEEDS, { value: '0', label: t('pause') }]}
        className="flex-wrap"
      />

      <div className="flex flex-col gap-2" role="group" aria-label={t('jumps')}>
        <h3 className="text-label-sm text-text-secondary">{t('jumps')}</h3>
        <div className="flex flex-wrap gap-2">
          {JUMP_IDS.map((id) => (
            <Button key={id} variant="secondary" compact disabled={jumps[id] === null} onClick={() => jump(id)}>
              {t(`jump.${id}`)}
            </Button>
          ))}
        </div>
        {jumps.midnight === null && <p className="text-caption text-text-muted">{t('jumpsNone')}</p>}
      </div>

      <div className="flex flex-col gap-2" role="group" aria-label={t('extras')}>
        <h3 className="text-label-sm text-text-secondary">{t('extras')}</h3>
        <Button variant="secondary" compact onClick={() => (api ? api.resetGuest() : resetDeviceState())} className="self-start">
          {t('resetGuest')}
        </Button>
        <label className="flex flex-col gap-1 text-caption text-text-secondary">
          {t('payResult')}
          <select
            value={payResult}
            onChange={(e) => {
              const r = e.target.value as PayResult;
              if (api) api.setPayResult(r);
              else useTestControls.getState().setPayResult(r);
            }}
            className="t2f-focus min-h-touch-min rounded-md border border-border-strong bg-background px-2 text-body text-text"
          >
            {PAY_RESULTS.map((r) => (
              <option key={r} value={r}>
                {t(`pay.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <Switch
          label={t('chatUnavailable')}
          checked={!chatAvailable}
          onCheckedChange={(v) => {
            if (api) api.setChatAvailable(!v);
            else useTestControls.getState().setChatAvailable(!v);
          }}
        />
        <Switch label={t('offline')} checked={offline} onCheckedChange={(v) => useTestControls.getState().setOfflineSimulated(v)} />
        <Switch
          label={t('chatSlow')}
          checked={slowForced > 0}
          onCheckedChange={(v) => useTestControls.getState().setSlowForcedSec(v ? 15 : 0)}
        />
        <Switch
          label={t('chatEmptyCountry')}
          checked={emptyCountry}
          onCheckedChange={(v) => useTestControls.getState().setEmptyCountry(v)}
        />
        <Button variant="secondary" compact onClick={() => chatDev.emitReply(timeNow)} className="self-start" data-action="emit-reply">
          {t('emitReply')}
        </Button>
        <Switch
          label={t('authUnavailable')}
          checked={authUnavailable}
          onCheckedChange={(v) => useTestControls.getState().setAuthUnavailable(v)}
        />
        <Switch
          label={t('googleCancelled')}
          checked={googleCancelled}
          onCheckedChange={(v) => useTestControls.getState().setGoogleCancelled(v)}
        />
        <Switch
          label={t('googleRedirect')}
          checked={googleRedirect}
          onCheckedChange={(v) => useTestControls.getState().setGoogleRedirect(v)}
        />
        {devCode ? (
          <div className="flex flex-col gap-1 text-caption text-text-secondary" data-control="auth-code">
            {t('code')}
            {devCode.code && !devCode.code.used ? (
              <span className="flex flex-wrap items-center gap-2 text-body text-text">
                <span data-testid="tm-code">{t('codeLine', { code: devCode.code.code, email: devCode.code.email })}</span>
                <Button variant="secondary" compact onClick={devCode.expire}>
                  {t('codeExpire')}
                </Button>
              </span>
            ) : (
              <span className="text-text-muted">{t('codeNone')}</span>
            )}
          </div>
        ) : null}
        {faults ? (
          <>
            <Switch
              label={t('apiSlow')}
              checked={apiSlow}
              onCheckedChange={(v) => {
                setApiSlow(v);
                faults.delay('*', v ? 3000 : 0);
              }}
            />
            <Switch
              label={t('apiDown')}
              checked={apiDown}
              onCheckedChange={(v) => {
                setApiDown(v);
                if (v) faults.fail('*', undefined, 'network');
                else faults.unfail('*');
              }}
            />
          </>
        ) : null}
        <label className="flex items-center justify-between gap-3 text-body">
          {t('notifications')}
          <select
            value={notifications}
            onChange={(e) => useTestControls.getState().setNotifications(Number(e.target.value))}
            className="rounded-md border border-border-strong bg-surface px-2 py-1 text-body"
            data-control="notifications"
          >
            {[0, 3, 12, 140].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {signedIn ? (
          <Button variant="secondary" compact onClick={() => void authActions.signOut()} className="self-start">
            {t('signOut')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
