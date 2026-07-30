import { Briefcase, Clock, House, Plus, X } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { POI } from "../types";
import { retrievePlace, searchSuggestions, type PlaceSuggestion } from "./mapboxSearch";
import { addRecent, clearSavedPlace, getSavedPlaces, type SavedKind, setSavedPlace } from "./savedPlaces";

interface SearchSheetProps {
  onSelect: (poi: POI) => void;
}

const DEBOUNCE_MS = 250;

/** Three resting heights the sheet snaps between, like Apple Maps' bottom sheet. */
type Snap = "pill" | "medium" | "full";
const SNAPS: Snap[] = ["full", "medium", "pill"];
// Visible peek (px) left on screen when minimized — enough for the handle + the search field.
const PILL_PEEK = 96;
// Medium sheet shows ~42% of the screen (Home, Work + a couple recents).
const MEDIUM_FRACTION = 0.42;
const TAP_SLOP = 6;

/** How far the sheet is pushed down (px) for a given snap. full = flush to the top, pill = just a peek. */
function offsetForSnap(snap: Snap): number {
  const h = window.innerHeight;
  if (snap === "full") return 0;
  if (snap === "medium") return Math.max(0, h - Math.round(h * MEDIUM_FRACTION));
  return Math.max(0, h - PILL_PEEK);
}

/**
 * Apple-Maps-style draggable search sheet. One element is always mounted and slides between three
 * snap points via a CSS transform transition; the grab handle can be dragged to any of them. Tapping
 * the field expands to full-screen FIRST, then focuses (after the slide) so iOS has nothing to scroll
 * into view — avoiding the focus scroll-jump. Saved places (Home/Work) + recents live in localStorage.
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
  const dragRef = useRef<{ startY: number; startOffset: number; moved: number } | null>(null);

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

  /** Move to a snap point; focus the field once expanded, blur (and clear, if minimizing) otherwise. */
  function goSnap(next: Snap) {
    setSnap(next);
    if (next === "full") {
      // Focus only after the slide-up settles so iOS doesn't scroll the field into view mid-animation.
      setTimeout(() => inputRef.current?.focus(), 320);
    } else {
      inputRef.current?.blur();
      if (next === "pill") {
        setQuery("");
        setSuggestions([]);
        setAssignKind(null);
      }
    }
  }

  // Grab-handle tap: drop one level (full → medium → pill; a tap on the pill nudges it back to medium).
  function collapseOneLevel() {
    if (assignKind) {
      setAssignKind(null);
      setQuery("");
    }
    goSnap(snap === "full" ? "medium" : snap === "medium" ? "pill" : "medium");
  }

  function onHandleDown(e: ReactPointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startOffset = offsetForSnap(snap);
    dragRef.current = { startY: e.clientY, startOffset, moved: 0 };
    setDragging(true);
    setDragY(startOffset);
  }
  function onHandleMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    d.moved = Math.max(d.moved, Math.abs(dy));
    const next = Math.min(Math.max(d.startOffset + dy, 0), offsetForSnap("pill"));
    setDragY(next);
  }
  function onHandleUp() {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!d) return;
    if (d.moved < TAP_SLOP) {
      setDragY(null);
      collapseOneLevel();
      return;
    }
    // Released mid-drag → snap to whichever rest point is nearest the current offset.
    const cur = dragY ?? d.startOffset;
    let best: Snap = "medium";
    let bestDist = Infinity;
    for (const s of SNAPS) {
      const dist = Math.abs(offsetForSnap(s) - cur);
      if (dist < bestDist) {
        bestDist = dist;
        best = s;
      }
    }
    setDragY(null);
    goSnap(best);
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
    goSnap("full");
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
      <div
        className="search-sheet"
        data-snap={snap}
        data-dragging={dragging}
        style={{ transform: `translateY(${offset}px)` }}
      >
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
            onPointerDown={(e) => {
              // From a resting state, expand to full-screen BEFORE focusing (goSnap focuses once the
              // slide finishes). Blocking the native focus here is what prevents the iOS scroll-jump.
              if (snap !== "full") {
                e.preventDefault();
                goSnap("full");
              }
            }}
            onFocus={() => {
              if (snap !== "full") setSnap("full");
              // Belt-and-suspenders: snap the window back in case iOS still nudged it to reveal the field.
              const toTop = () => window.scrollTo(0, 0);
              requestAnimationFrame(toTop);
              setTimeout(toTop, 300);
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
