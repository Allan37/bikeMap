import { Briefcase, Clock, House, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { POI } from "../types";
import { retrievePlace, searchSuggestions, type PlaceSuggestion } from "./mapboxSearch";
import { addRecent, clearSavedPlace, getSavedPlaces, type SavedKind, setSavedPlace } from "./savedPlaces";

interface SearchSheetProps {
  onSelect: (poi: POI) => void;
}

const DEBOUNCE_MS = 250;

/**
 * Apple-Maps-style search. Tapping the bottom pill expands a medium sheet with saved places
 * (Home/Work) + recents WITHOUT raising the keyboard; tapping the field then goes full-screen and
 * focuses (this two-stage flow avoids iOS scroll-jump on focus). Saved places live in localStorage.
 */
export function SearchSheet({ onSelect }: SearchSheetProps) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
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

  function closeSheet() {
    inputRef.current?.blur();
    setOpen(false);
    setFocused(false);
    setQuery("");
    setSuggestions([]);
    setAssignKind(null);
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
    setFocused(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  if (!open) {
    return (
      <button type="button" className="search-pill" onClick={() => setOpen(true)}>
        Search Maps
      </button>
    );
  }

  const showResults = query.trim().length > 0;
  const placeholder = assignKind ? `Set ${assignKind} address` : "Search Maps";

  return (
    <>
      {/* Only dim + capture taps in full-screen mode — in the half sheet the map stays interactive. */}
      {focused && <button type="button" className="search-backdrop" aria-label="Close search" onClick={closeSheet} />}
      <div className={`search-sheet${focused ? " search-sheet--full" : ""}`}>
        <div className="search-sheet-handle" />
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
              setFocused(true);
              // iOS scrolls the whole page up to reveal a focused field even when it's already at
              // the top; snap the window back (now and after the keyboard animates) to counter it.
              const toTop = () => window.scrollTo(0, 0);
              requestAnimationFrame(toTop);
              setTimeout(toTop, 300);
            }}
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
                {places.recents.map((r, i) => (
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
