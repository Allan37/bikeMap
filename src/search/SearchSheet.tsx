import { useEffect, useRef, useState } from "react";
import type { POI } from "../types";
import { retrievePlace, searchSuggestions, type PlaceSuggestion } from "./mapboxSearch";
import { addRecent, clearSavedPlace, getSavedPlaces, type SavedKind, setSavedPlace } from "./savedPlaces";

interface SearchSheetProps {
  onSelect: (poi: POI) => void;
}

const DEBOUNCE_MS = 250;

/**
 * Apple-Maps-style search: a rounded pill at the bottom that expands into a sheet with saved
 * places (Home/Work) + recents, then grows toward full-screen as you type. Saved places live in
 * localStorage (see savedPlaces.ts) — nothing personal is committed or shipped in the bundle.
 */
export function SearchSheet({ onSelect }: SearchSheetProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  // When set, a picked result is saved as Home/Work instead of navigating there.
  const [assignKind, setAssignKind] = useState<SavedKind | null>(null);
  const [places, setPlaces] = useState(() => getSavedPlaces());
  const sessionTokenRef = useRef(crypto.randomUUID());
  const skipNextSearchRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  function openSheet() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }
  function closeSheet() {
    setOpen(false);
    setQuery("");
    setSuggestions([]);
    setAssignKind(null);
  }
  function focusInputSoon() {
    setTimeout(() => inputRef.current?.focus(), 50);
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
        onSelect(poi);
        closeSheet();
      }
    } catch (err) {
      console.error("Failed to retrieve place:", err);
    }
  }

  function chooseSaved(poi: POI) {
    addRecent(poi);
    onSelect(poi);
    closeSheet();
  }

  function startAssign(kind: SavedKind) {
    setAssignKind(kind);
    setQuery("");
    setSuggestions([]);
    focusInputSoon();
  }

  if (!open) {
    return (
      <button type="button" className="search-pill" onClick={openSheet}>
        <span className="search-icon" aria-hidden="true">
          🔍
        </span>
        Search Maps
      </button>
    );
  }

  const showResults = query.trim().length > 0;
  const placeholder = assignKind ? `Set ${assignKind} address` : "Search Maps";

  return (
    <>
      <button type="button" className="search-backdrop" aria-label="Close search" onClick={closeSheet} />
      <div className={`search-sheet${showResults ? " search-sheet--full" : ""}`}>
        <div className="search-sheet-handle" />
        <div className="search-sheet-inputrow">
          <span className="search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            ref={inputRef}
            className="search-sheet-input"
            type="text"
            value={query}
            placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="search-sheet-cancel"
            onClick={
              assignKind
                ? () => {
                    setAssignKind(null);
                    setQuery("");
                  }
                : closeSheet
            }
          >
            Cancel
          </button>
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
                icon="🏠"
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
                icon="💼"
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
                {places.recents.map((r, i) => (
                  <li key={`${r.lat},${r.lon},${i}`} onMouseDown={() => chooseSaved(r)}>
                    <div className="suggestion-name">🕘 {r.name}</div>
                    <div className="suggestion-subtitle">{r.placeFormatted}</div>
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
  icon: string;
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
        <span className="saved-row-add" aria-hidden="true">
          ＋
        </span>
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
        ×
      </button>
    </div>
  );
}
