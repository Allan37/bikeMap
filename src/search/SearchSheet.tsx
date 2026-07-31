import { Briefcase, Clock, House, Plus } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { POI } from "../types";
import { retrievePlace, searchSuggestions, type PlaceSuggestion } from "./mapboxSearch";
import { addRecent, getSavedPlaces, type SavedKind, setSavedPlace } from "./savedPlaces";

interface SearchSheetProps {
  onSelect: (poi: POI) => void;
  /** Reports how much of the screen the sheet covers (0 pill, ~0.42 half) so the map can bias
   *  "center on me" above it. */
  onCoverageChange?: (fraction: number) => void;
}

const DEBOUNCE_MS = 250;

/** Resting states, top → bottom. "pill" is a small floating bar; the other two are the full sheet. */
type Snap = "full" | "medium" | "pill";
const SNAPS: Snap[] = ["full", "medium", "pill"];
const SNAP_INDEX: Record<Snap, number> = { full: 0, medium: 1, pill: 2 };
// Full sheet stops this far down so a strip of live map still shows above the grab handle.
const FULL_TOP_FRACTION = 0.11;
// Medium sheet shows ~42% of the screen (Home, Work + a couple recents).
const MEDIUM_FRACTION = 0.42;
const TAP_SLOP = 6; // px of movement below which a press counts as a tap, not a drag
const DECIDE_SLOP = 8; // px before we commit to "this drag moves the sheet" vs "this scrolls the list"
const FLICK_VY = 0.5; // px/ms — a release faster than this flings to the extreme in its direction
const BIG_FRACTION = 0.22; // a drag covering more than this much of the screen also jumps to the extreme

/** How far the sheet is pushed down (px) at each snap. Pill = fully off-screen (the floating pill takes over). */
function offsetForSnap(snap: Snap): number {
  const h = window.innerHeight;
  if (snap === "full") return Math.round(h * FULL_TOP_FRACTION);
  if (snap === "medium") return Math.max(0, h - Math.round(h * MEDIUM_FRACTION));
  return h; // pill: slide the whole sheet off the bottom
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  startSnap: Snap;
  inScroll: boolean;
  onHandle: boolean;
  decided: boolean;
  engaged: boolean;
  moved: number;
  curOffset: number;
  lastY: number;
  lastT: number;
  vy: number;
}

/**
 * Apple-Maps-style search. One full-height sheet slides between "full" (a map strip stays visible up
 * top) and "medium", and collapses off-screen into a small floating pill. The whole sheet is
 * draggable — a swipe anywhere moves it between snaps, yielding to the results list only while it has
 * room to scroll. Tapping the field raises the keyboard first, then slides the sheet up a beat later
 * so the two don't jitter against each other. No Cancel: dismiss by swiping down. Saved places live
 * in localStorage.
 */
export function SearchSheet({ onSelect, onCoverageChange }: SearchSheetProps) {
  const [snap, setSnap] = useState<Snap>("medium");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  // When set, a picked result is saved as Home/Work instead of navigating there.
  const [assignKind, setAssignKind] = useState<SavedKind | null>(null);
  const [places, setPlaces] = useState(() => getSavedPlaces());
  // Live drag offset (px) while a finger is dragging the sheet; null when resting at a snap point.
  const [dragY, setDragY] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  // Snap to full with no slide (used on tap-to-open) so ONLY the keyboard animates — a sliding sheet
  // racing the keyboard rise is what read as jitter.
  const [instant, setInstant] = useState(false);
  const sessionTokenRef = useRef(crypto.randomUUID());
  const skipNextSearchRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pillSwipeRef = useRef<number | null>(null);

  // Tell the map how much it's covered so "center on me" lands the dot in the visible area.
  useEffect(() => {
    onCoverageChange?.(snap === "pill" ? 0 : MEDIUM_FRACTION);
  }, [snap, onCoverageChange]);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    const id = setTimeout(async () => {
      try {
        setSuggestions(await searchSuggestions(query, sessionTokenRef.current));
      } catch (err) {
        console.error("Search failed:", err);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  /** iOS may nudge the page to scroll a focused field into view; the page can't really scroll (body
   *  is locked), so a couple of gentle scroll-to-top calls absorb any stray offset. */
  function pinScrollTop() {
    const pin = () => window.scrollTo(0, 0);
    pin();
    requestAnimationFrame(pin);
    setTimeout(pin, 300);
  }

  /** Jump straight to full with no slide animation (for tap-to-open). */
  function fillInstant() {
    setInstant(true);
    setSnap("full");
    requestAnimationFrame(() => setInstant(false));
  }

  /** Raise the keyboard now (must be inside the tap gesture — iOS only opens it then) and put the
   *  sheet at full instantly, so the only thing animating is the keyboard sliding up. */
  function openFull() {
    inputRef.current?.focus();
    pinScrollTop();
    fillInstant();
  }

  /** Move to a rest point without focusing (used for collapses and snap-after-drag). */
  function goSnap(next: Snap) {
    setSnap(next);
    if (next !== "full") {
      inputRef.current?.blur();
      if (next === "pill") {
        setQuery("");
        setSuggestions([]);
        setAssignKind(null);
      }
    }
  }

  // A tap on the grab handle drops one level: full → medium → pill.
  function collapseOneLevel() {
    if (assignKind) {
      setAssignKind(null);
      setQuery("");
    }
    goSnap(snap === "full" ? "medium" : "pill");
  }

  // --- Whole-sheet dragging -----------------------------------------------------------------------
  function onSheetPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as Node;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffset: offsetForSnap(snap),
      startSnap: snap,
      inScroll: !!bodyRef.current?.contains(target),
      onHandle: !!handleRef.current?.contains(target),
      decided: false,
      engaged: false,
      moved: 0,
      curOffset: offsetForSnap(snap),
      lastY: e.clientY,
      lastT: performance.now(),
      vy: 0,
    };
  }

  function onSheetPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dy = e.clientY - d.startY;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.startX, dy));

    if (!d.decided) {
      if (Math.abs(dy) < DECIDE_SLOP) return;
      // Decide whether this gesture drags the sheet or scrolls the results list. It scrolls only when
      // it started in the list, the list can scroll, and the motion isn't a pull-down from the top.
      let engage = true;
      if (d.inScroll && bodyRef.current) {
        const b = bodyRef.current;
        const scrollable = b.scrollHeight > b.clientHeight + 1;
        if (scrollable) engage = dy > 0 && b.scrollTop <= 0;
      }
      d.decided = true;
      d.engaged = engage;
      if (engage) {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(d.pointerId);
        } catch {
          // ignore — dragging still works via bubbling
        }
        setDragging(true);
      }
    }

    if (d.engaged) {
      const now = performance.now();
      const dt = now - d.lastT;
      if (dt >= 6) {
        d.vy = d.vy * 0.6 + ((e.clientY - d.lastY) / dt) * 0.4;
        d.lastY = e.clientY;
        d.lastT = now;
      }
      d.curOffset = Math.min(Math.max(d.startOffset + dy, offsetForSnap("full")), offsetForSnap("pill"));
      setDragY(d.curOffset);
      if (e.cancelable) e.preventDefault();
    }
  }

  function onSheetPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;

    if (!d.engaged) {
      // A tap on the handle collapses a level; taps elsewhere fall through to buttons/the input.
      if (d.moved < TAP_SLOP && d.onHandle) collapseOneLevel();
      return;
    }

    setDragging(false);
    setDragY(null);
    // Direction- and velocity-aware snapping: a downward drag drops at least one level, and a big or
    // fast one flings all the way to the pill (symmetric upward toward full).
    const net = d.curOffset - d.startOffset;
    const h = window.innerHeight;
    const idx = SNAP_INDEX[d.startSnap];
    let target = d.startSnap;
    if (net > TAP_SLOP || d.vy > FLICK_VY) {
      const big = net > h * BIG_FRACTION || d.vy > FLICK_VY;
      target = SNAPS[big ? 2 : Math.min(idx + 1, 2)];
    } else if (net < -TAP_SLOP || d.vy < -FLICK_VY) {
      const big = -net > h * BIG_FRACTION || d.vy < -FLICK_VY;
      target = SNAPS[big ? 0 : Math.max(idx - 1, 0)];
    }
    goSnap(target);
  }

  async function pick(suggestion: PlaceSuggestion) {
    try {
      const poi = await retrievePlace(suggestion.mapboxId, sessionTokenRef.current);
      sessionTokenRef.current = crypto.randomUUID();
      if (assignKind) {
        setSavedPlace(assignKind, poi);
        setPlaces(getSavedPlaces());
        setAssignKind(null);
        skipNextSearchRef.current = true;
        setQuery("");
        setSuggestions([]);
      } else {
        addRecent(poi);
        onSelect(poi); // App swaps the sheet out for the trip panel, so no need to collapse here.
      }
    } catch (err) {
      console.error("Failed to retrieve place:", err);
    }
  }

  function chooseSaved(poi: POI) {
    addRecent(poi);
    onSelect(poi);
  }

  function startAssign(kind: SavedKind) {
    setAssignKind(kind);
    setQuery("");
    setSuggestions([]);
    openFull(); // called from the "Set Home/Work" tap, so focus-in-gesture raises the keyboard
  }

  const showResults = query.trim().length > 0;
  const placeholder = assignKind ? `Set ${assignKind} address` : "Search Maps";
  const offset = dragY ?? offsetForSnap(snap);
  const recentsCount = snap === "full" ? 3 : 2;

  return (
    <>
      {/* Minimized floating pill; fades/rises in as the sheet slides off the bottom. */}
      <button
        type="button"
        className={`search-pill${snap === "pill" ? " is-visible" : ""}`}
        onPointerDown={(e) => {
          pillSwipeRef.current = e.clientY;
        }}
        onPointerUp={(e) => {
          const start = pillSwipeRef.current;
          pillSwipeRef.current = null;
          // A clear swipe up on the pill → half sheet; a tap falls through to onClick (→ full).
          if (start != null && start - e.clientY > 24) goSnap("medium");
        }}
        onClick={() => {
          if (snap === "pill") openFull();
        }}
      >
        <span className="search-pill-grip" />
        Search Maps
      </button>

      <div
        className="search-sheet"
        data-snap={snap}
        data-dragging={dragging}
        data-instant={instant}
        style={{ transform: `translateY(${offset}px)` }}
        onPointerDown={onSheetPointerDown}
        onPointerMove={onSheetPointerMove}
        onPointerUp={onSheetPointerUp}
        onPointerCancel={onSheetPointerUp}
      >
        <button ref={handleRef} type="button" className="search-sheet-handle" aria-label="Resize search" />
        <div className="search-sheet-inputrow">
          <input
            ref={inputRef}
            className="search-sheet-input"
            type="search"
            value={query}
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            onFocus={() => {
              // Native focus (from tapping the field) already opened the keyboard inside the gesture;
              // jump to full instantly so only the keyboard animates, and pin the scroll.
              pinScrollTop();
              if (snap !== "full") fillInstant();
            }}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="search-sheet-body" ref={bodyRef}>
          {showResults ? (
            <ul className="search-results">
              {suggestions.map((s) => (
                <li key={s.mapboxId} onClick={() => pick(s)}>
                  <div className="suggestion-name">{s.name}</div>
                  <div className="suggestion-subtitle">{s.placeFormatted}</div>
                </li>
              ))}
            </ul>
          ) : assignKind ? (
            <div className="search-hint">Search for your {assignKind} address to save it.</div>
          ) : (
            <>
              <SavedRow
                icon={<House size={19} strokeWidth={2} />}
                label="Home"
                poi={places.home}
                onGo={chooseSaved}
                onSet={() => startAssign("home")}
              />
              <SavedRow
                icon={<Briefcase size={19} strokeWidth={2} />}
                label="Work"
                poi={places.work}
                onGo={chooseSaved}
                onSet={() => startAssign("work")}
              />
              {places.recents.length > 0 && <div className="search-section-title">Recents</div>}
              <ul className="search-results">
                {places.recents.slice(0, recentsCount).map((r, i) => (
                  <li key={`${r.lat},${r.lon},${i}`} className="result-row" onClick={() => chooseSaved(r)}>
                    <Clock size={18} className="result-icon" />
                    <div>
                      <div className="suggestion-name">{r.name}</div>
                      <div className="suggestion-subtitle">{r.placeFormatted}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface SavedRowProps {
  icon: ReactNode;
  label: string;
  poi?: POI;
  onGo: (poi: POI) => void;
  onSet: () => void;
}

function SavedRow({ icon, label, poi, onGo, onSet }: SavedRowProps) {
  if (!poi) {
    return (
      <button type="button" className="saved-row saved-row-unset" onClick={onSet}>
        <span className="saved-row-icon">{icon}</span>
        <span className="saved-row-label">Set {label}</span>
        <Plus size={18} className="saved-row-add" />
      </button>
    );
  }
  return (
    <button type="button" className="saved-row saved-row-main" onClick={() => onGo(poi)}>
      <span className="saved-row-icon">{icon}</span>
      <span className="saved-row-text">
        <span className="saved-row-label">{label}</span>
        <span className="suggestion-subtitle">{poi.name}</span>
      </span>
    </button>
  );
}
