import { Briefcase, Clock, House, Plus, X } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { POI } from "../types";
import { retrievePlace, searchSuggestions, type PlaceSuggestion } from "./mapboxSearch";
import { addRecent, clearSavedPlace, getSavedPlaces, type SavedKind, setSavedPlace } from "./savedPlaces";

interface SearchSheetProps {
  onSelect: (poi: POI) => void;
}

const DEBOUNCE_MS = 250;

/** Resting states, top → bottom. "pill" is a small floating bar; the other two are the full sheet. */
type Snap = "full" | "medium" | "pill";
const SNAPS: Snap[] = ["full", "medium", "pill"];
const SNAP_INDEX: Record<Snap, number> = { full: 0, medium: 1, pill: 2 };
// Medium sheet shows ~42% of the screen (Home, Work + a couple recents).
const MEDIUM_FRACTION = 0.42;
const TAP_SLOP = 6; // px of movement below which a handle press counts as a tap, not a drag
const FLICK_VY = 0.5; // px/ms — a release faster than this flings to the extreme in its direction
const BIG_FRACTION = 0.22; // a drag covering more than this much of the screen also jumps to the extreme

/** How far the sheet is pushed down (px) at each snap. Pill = fully off-screen (the floating pill takes over). */
function offsetForSnap(snap: Snap): number {
  const h = window.innerHeight;
  if (snap === "full") return 0;
  if (snap === "medium") return Math.max(0, h - Math.round(h * MEDIUM_FRACTION));
  return h; // pill: slide the whole sheet off the bottom
}

/**
 * Apple-Maps-style search. The full sheet slides between "full" and "medium" via a transform, and
 * collapses off-screen into a small floating pill for the minimized state. The grab handle is
 * draggable with velocity/direction-aware snapping (a downward flick drops a level or flings to the
 * pill). Focus is always raised from inside the originating tap — iOS only opens the keyboard for a
 * focus() call that happens within a user gesture, so we never defer it. Saved places live in
 * localStorage.
 */
export function SearchSheet({ onSelect }: SearchSheetProps) {
  const [snap, setSnap] = useState<Snap>("medium");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  // When set, a picked result is saved as Home/Work instead of navigating there.
  const [assignKind, setAssignKind] = useState<SavedKind | null>(null);
  const [places, setPlaces] = useState(() => getSavedPlaces());
  // Live drag offset (px) while a finger is on the handle; null when resting at a snap point.
  const [dragY, setDragY] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const sessionTokenRef = useRef(crypto.randomUUID());
  const skipNextSearchRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ startY: number; startOffset: number; startSnap: Snap; moved: number; curOffset: number; lastY: number; lastT: number; vy: number } | null>(null);
  const pillSwipeRef = useRef<number | null>(null);

  const focused = snap === "full";

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

  /** iOS tries to scroll a focused field into view; the page can't scroll (body is locked), but pin
   *  it to the top anyway for a few hundred ms to absorb any stray scroll while the keyboard opens. */
  function pinScrollTop() {
    const pin = () => window.scrollTo(0, 0);
    pin();
    requestAnimationFrame(pin);
    const onScroll = () => pin();
    window.addEventListener("scroll", onScroll, { passive: true });
    setTimeout(() => window.removeEventListener("scroll", onScroll), 550);
  }

  /** Expand to full-screen and raise the keyboard. MUST be called synchronously from a tap handler. */
  function openFull() {
    setSnap("full");
    inputRef.current?.focus();
    pinScrollTop();
  }

  /** Move to a rest point without focusing (used for collapses, cancel, snap-after-drag). */
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

  function onHandleDown(e: ReactPointerEvent<HTMLButtonElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some synthetic/edge pointer IDs can't be captured; the drag still works via bubbling.
    }
    const startOffset = offsetForSnap(snap);
    dragRef.current = { startY: e.clientY, startOffset, startSnap: snap, moved: 0, curOffset: startOffset, lastY: e.clientY, lastT: performance.now(), vy: 0 };
    setDragging(true);
    setDragY(startOffset);
  }
  function onHandleMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d) return;
    const now = performance.now();
    const dt = now - d.lastT;
    // Smooth the velocity over a ~6ms+ window so a single tiny inter-sample gap can't read as a fling.
    if (dt >= 6) {
      const inst = (e.clientY - d.lastY) / dt;
      d.vy = d.vy * 0.6 + inst * 0.4;
      d.lastY = e.clientY;
      d.lastT = now;
    }
    const dy = e.clientY - d.startY;
    d.moved = Math.max(d.moved, Math.abs(dy));
    // Clamp between full (0) and fully off-screen (pill).
    d.curOffset = Math.min(Math.max(d.startOffset + dy, 0), offsetForSnap("pill"));
    setDragY(d.curOffset);
  }
  function onHandleUp() {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setDragY(null);
    if (!d) return;
    if (d.moved < TAP_SLOP) {
      collapseOneLevel();
      return;
    }
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

  return (
    <>
      {/* Only dim + capture taps in full-screen mode — in the half/pill states the map stays interactive. */}
      {focused && (
        <button type="button" className="search-backdrop" aria-label="Close search" onClick={() => goSnap("medium")} />
      )}

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
        Search Maps
      </button>

      <div className="search-sheet" data-snap={snap} data-dragging={dragging} style={{ transform: `translateY(${offset}px)` }}>
        <button
          type="button"
          className="search-sheet-handle"
          aria-label="Resize search"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        />
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
              // Native focus (from tapping the field) is already inside the gesture, so the keyboard
              // opens; just expand the sheet and pin the scroll position.
              if (snap !== "full") setSnap("full");
              pinScrollTop();
            }}
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* Cancel only while searching/assigning (Apple-style); the resting sheet has none — drag the
              handle to minimize. */}
          {(focused || assignKind) && (
            <button
              type="button"
              className="search-sheet-cancel"
              onClick={
                assignKind
                  ? () => {
                      setAssignKind(null);
                      setQuery("");
                    }
                  : () => goSnap("medium")
              }
            >
              Cancel
            </button>
          )}
        </div>

        <div className="search-sheet-body">
          {showResults ? (
            <ul className="search-results">
              {suggestions.map((s) => (
                <li key={s.mapboxId} onMouseDown={() => pick(s)}>
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
                onClear={() => {
                  clearSavedPlace("home");
                  setPlaces(getSavedPlaces());
                }}
              />
              <SavedRow
                icon={<Briefcase size={19} strokeWidth={2} />}
                label="Work"
                poi={places.work}
                onGo={chooseSaved}
                onSet={() => startAssign("work")}
                onClear={() => {
                  clearSavedPlace("work");
                  setPlaces(getSavedPlaces());
                }}
              />
              {places.recents.length > 0 && <div className="search-section-title">Recents</div>}
              <ul className="search-results">
                {places.recents.slice(0, 2).map((r, i) => (
                  <li key={`${r.lat},${r.lon},${i}`} className="result-row" onMouseDown={() => chooseSaved(r)}>
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
  onClear: () => void;
}

function SavedRow({ icon, label, poi, onGo, onSet, onClear }: SavedRowProps) {
  if (!poi) {
    return (
      <button type="button" className="saved-row saved-row-unset" onMouseDown={onSet}>
        <span className="saved-row-icon">{icon}</span>
        <span className="saved-row-label">Set {label}</span>
        <Plus size={18} className="saved-row-add" />
      </button>
    );
  }
  return (
    <div className="saved-row">
      <button type="button" className="saved-row-main" onMouseDown={() => onGo(poi)}>
        <span className="saved-row-icon">{icon}</span>
        <span className="saved-row-text">
          <span className="saved-row-label">{label}</span>
          <span className="suggestion-subtitle">{poi.name}</span>
        </span>
      </button>
      <button type="button" className="saved-row-clear" onMouseDown={onClear} aria-label={`Clear ${label}`}>
        <X size={16} />
      </button>
    </div>
  );
}
