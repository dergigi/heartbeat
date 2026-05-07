import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { EVENT_TYPES, type EventType } from '../types';
import { EVENT_TYPE_META } from '../eventTypes';
import type { FilterControl } from '../lib/useUrlSet';
import { useUrlString } from '../lib/useUrlString';
import { RepoLabel } from './RepoLabel';

const CHIP_BASE = 'px-2 py-1 sm:py-0.5 text-xs rounded border transition';
const CHIP_IDLE = 'border-zinc-800 bg-transparent text-zinc-500';
const CHIP_HOVER = 'hover:text-zinc-300 hover:border-zinc-700';
const CHIP_ACTIVE = 'border-zinc-500 bg-zinc-800 text-zinc-100';
const CHIP_FOCUS_ACTIVE = 'focus:border-zinc-500 focus:bg-zinc-800 focus:text-zinc-100';
const ROW_LABEL = 'text-zinc-600 text-xs shrink-0 w-14';

const HEADER_LOGO_URL = 'https://dergigi.com/assets/images/avatar.jpg';

/** Font Awesome 6 solid "heart-pulse" — https://fontawesome.com/icons/heart-pulse (Free, CC BY 4.0) */
function HeartPulseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      className={className}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M228.3 469.1L47.6 300.4c-4.2-3.9-8.2-8.1-11.9-12.4h87c22.6 0 43-13.6 51.7-34.5l10.5-25.2 49.3 109.5c3.8 8.5 12.1 14 21.4 14.1s17.8-5 22-13.3L320 253.7l1.7 3.4c9.5 19 28.9 31 50.1 31H476.3c-3.7 4.3-7.7 8.5-11.9 12.4L283.7 469.1c-7.5 7-17.4 10.9-27.7 10.9s-20.2-3.9-27.7-10.9zM503.7 240h-132c-3 0-5.8-1.7-7.2-4.4l-23.2-46.3c-4.1-8.1-12.4-13.3-21.5-13.3s-17.4 5.1-21.5 13.3l-41.4 82.8L205.9 158.2c-3.9-8.7-12.7-14.3-22.2-14.1s-18.1 5.9-21.8 14.8l-31.8 76.3c-1.2 3-4.2 4.9-7.4 4.9H16c-2.6 0-5 .4-7.3 1.1C3 225.2 0 208.2 0 190.9v-5.8c0-69.9 50.5-129.5 119.4-141C165 36.5 211.4 51.4 244 84l12 12 12-12c32.6-32.6 79-47.5 124.6-39.9C461.5 55.6 512 115.2 512 185.1v5.8c0 16.9-2.8 33.5-8.3 49.1z"
      />
    </svg>
  );
}

const chipClass = (active: boolean) =>
  active ? `${CHIP_BASE} ${CHIP_ACTIVE}` : `${CHIP_BASE} ${CHIP_IDLE} ${CHIP_HOVER}`;

type Props = {
  repos: string[];
  funds: Record<string, string[]>;

  fundFilter: FilterControl;
  repoFilter: FilterControl;
  typeFilter: FilterControl;
  actorFilter: FilterControl;
};

const clearIfActive = (f: FilterControl) => (f.selected != null ? f.clear : undefined);

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button type="button" onClick={onClick} title={title} className={chipClass(active)}>
      {children}
    </button>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-zinc-500 hover:text-zinc-300 ml-1"
    >
      clear
    </button>
  );
}

function ChipRow({
  label,
  onClear,
  className,
  children,
}: {
  label: string;
  onClear?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      <span className={ROW_LABEL}>{label}</span>
      {children}
      {onClear && <ClearButton onClick={onClear} />}
    </div>
  );
}

export function FilterBar({
  repos,
  funds,
  fundFilter,
  repoFilter,
  typeFilter,
  actorFilter,
}: Props) {
  const selectedActors = actorFilter.selected;
  const [repoQuery, setRepoQuery] = useUrlString('q');
  const [reposExpanded, setReposExpanded] = useState(false);
  // The deferred query lets the input update at urgent priority while
  // the (heavier) filtered chip list and downstream effects re-render
  // at low priority. Keeps typing snappy on big repo lists.
  const deferredQuery = useDeferredValue(repoQuery);

  const fundNames = useMemo(() => Object.keys(funds).sort(), [funds]);
  const has = (s: Set<string> | null, v: string) => s != null && s.has(v);

  const filteredRepos = useMemo(() => {
    let list = repos;
    const sel = fundFilter.selected;
    if (sel && sel.size > 0) {
      const allowed = new Set<string>();
      for (const f of sel) for (const r of funds[f] ?? []) allowed.add(r);
      list = list.filter((r) => allowed.has(r));
    }
    const q = deferredQuery.trim().toLowerCase();
    if (q) list = list.filter((r) => r.toLowerCase().includes(q));
    return list;
  }, [repos, funds, fundFilter.selected, deferredQuery]);

  const showRepoChips = reposExpanded || repoQuery.length > 0;

  // Typing in the filter auto-selects matching repos; clearing the
  // input drops the param so the timeline returns to all repos. We
  // ignore the empty->empty case so URL-bound selections survive
  // first render. Debounced so URL writes (which serialize the full
  // repo set into history.replaceState) coalesce while typing.
  const { set: setRepoSelection } = repoFilter;
  const prevQueryRef = useRef(deferredQuery);
  useEffect(() => {
    const handle = setTimeout(() => {
      const prev = prevQueryRef.current;
      prevQueryRef.current = deferredQuery;
      if (deferredQuery.length === 0) {
        if (prev.length > 0) setRepoSelection(null);
        return;
      }
      setRepoSelection(new Set(filteredRepos));
    }, 150);
    return () => clearTimeout(handle);
  }, [deferredQuery, filteredRepos, setRepoSelection]);

  const renderRepoChips = (list: string[]) => {
    if (list.length === 0) {
      return <span className="text-xs text-zinc-600">no matching repos</span>;
    }
    return list.map((r) => (
      <Chip
        key={r}
        active={has(repoFilter.selected, r)}
        onClick={() => repoFilter.toggle(r)}
        title={r}
      >
        <RepoLabel repo={r} />
      </Chip>
    ));
  };

  const repoClearIfActive = clearIfActive(repoFilter);
  const selectedRepoCount = repoFilter.selected?.size ?? 0;
  const repoToggleLabel =
    selectedRepoCount > 0 ? `${selectedRepoCount} selected` : `show all ${filteredRepos.length}`;

  const filterRowContent = (
    <>
      <span className={ROW_LABEL}>filter:</span>
      <input
        type="text"
        value={repoQuery}
        onChange={(e) => setRepoQuery(e.target.value)}
        placeholder="repo name"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={`${chipClass(Boolean(repoQuery))} min-w-0 flex-1 max-w-40 placeholder:text-zinc-600 focus:outline-none ${repoQuery ? '' : CHIP_FOCUS_ACTIVE}`}
      />
      {repoQuery && <ClearButton onClick={() => setRepoQuery('')} />}
    </>
  );

  const clearAll = () => {
    fundFilter.clear();
    repoFilter.clear();
    typeFilter.clear();
    actorFilter.clear();
    setRepoQuery('');
    setReposExpanded(false);
  };

  return (
    <div className="border-b border-zinc-900 bg-zinc-950/80 backdrop-blur px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={clearAll}
          className="flex items-center gap-1.5 cursor-pointer transition-opacity hover:opacity-80"
          title="reset all filters"
          aria-label="reset all filters"
        >
          <img
            src={HEADER_LOGO_URL}
            alt=""
            className="h-7 w-7 shrink-0 rounded-full object-cover"
          />
          <HeartPulseIcon className="h-7 w-7 shrink-0 text-rose-400" />
          <h1 className="text-zinc-100 text-base font-medium">heartbeat</h1>
        </button>
        <span className="text-xs text-zinc-600">
          by{' '}
          <a
            href="https://njump.me/dergigi.com"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-zinc-300 transition-colors"
            title="Gigi on Nostr (@dergigi.com)"
          >
            Gigi
          </a>
          {' / '}
          <a
            href="https://github.com/OpenSats/heartbeat"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-zinc-300 transition-colors"
            title="Upstream: OpenSats heartbeat"
          >
            OpenSats
          </a>
        </span>
      </div>

      {fundNames.length > 1 && (
        <ChipRow label="fund:" onClear={clearIfActive(fundFilter)}>
          {fundNames.map((f) => (
            <Chip key={f} active={has(fundFilter.selected, f)} onClick={() => fundFilter.toggle(f)}>
              {f}
            </Chip>
          ))}
        </ChipRow>
      )}

      <div className="flex items-center gap-1.5">{filterRowContent}</div>

      <div className="space-y-2">
        <ChipRow label="repos:" onClear={repoClearIfActive}>
          {!repoQuery && (
            <Chip
              active={false}
              onClick={() => setReposExpanded((v) => !v)}
              title={`${repos.length} repos`}
            >
              {reposExpanded ? 'hide' : repoToggleLabel}
            </Chip>
          )}
        </ChipRow>
        {showRepoChips && (
          <div className="flex flex-wrap items-center gap-1.5 sm:max-h-[40vh] sm:overflow-y-auto">
            {renderRepoChips(filteredRepos)}
          </div>
        )}
      </div>

      <ChipRow label="types:" onClear={clearIfActive(typeFilter)}>
        {EVENT_TYPES.map((t: EventType) => {
          const meta = EVENT_TYPE_META[t];
          return (
            <Chip
              key={t}
              active={has(typeFilter.selected, t)}
              onClick={() => typeFilter.toggle(t)}
              title={meta.label}
            >
              <span className={`${meta.colorClass} mr-1`}>{meta.sigil}</span>
              {meta.label}
            </Chip>
          );
        })}
      </ChipRow>

      {selectedActors && selectedActors.size > 0 && (
        <ChipRow label="dev:" onClear={clearIfActive(actorFilter)}>
          {[...selectedActors].sort().map((a) => (
            <Chip key={a} active onClick={() => actorFilter.toggle(a)} title={`remove ${a}`}>
              {a}
            </Chip>
          ))}
        </ChipRow>
      )}
    </div>
  );
}
