import { useEffect, useRef, useState } from "react";
import type { POI } from "../types";
import { retrievePlace, searchSuggestions, type PlaceSuggestion } from "./mapboxSearch";

interface PlaceSearchProps {
  placeholder: string;
  onSelect: (poi: POI) => void;
  autoFocus?: boolean;
  /** A fixed row pinned above the search results, e.g. "Current location" for the start field. */
  leadingOption?: { label: string; onSelect: () => void };
}

const DEBOUNCE_MS = 250;

/** Search-as-you-type place picker backed by Mapbox Search Box. Used for both the destination bar and the start-location editor. */
export function PlaceSearch({ placeholder, onSelect, autoFocus, leadingOption }: PlaceSearchProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const sessionTokenRef = useRef(crypto.randomUUID());
  // Selecting a suggestion sets `query` to the resolved name, which would otherwise
  // re-trigger this same search-as-you-type effect and reopen the dropdown. Suppress that.
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    const timeoutId = setTimeout(async () => {
      try {
        const results = await searchSuggestions(query, sessionTokenRef.current);
        setSuggestions(results);
        setIsOpen(true);
      } catch (err) {
        console.error("Search failed:", err);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [query]);

  async function handleSelect(suggestion: PlaceSuggestion) {
    try {
      const poi = await retrievePlace(suggestion.mapboxId, sessionTokenRef.current);
      onSelect(poi);
      skipNextSearchRef.current = true;
      setQuery(poi.name);
      setSuggestions([]);
      setIsOpen(false);
      // Start a fresh session for the next search, per Mapbox's session-token billing model.
      sessionTokenRef.current = crypto.randomUUID();
    } catch (err) {
      console.error("Failed to retrieve place:", err);
    }
  }

  const showDropdown = isOpen && (suggestions.length > 0 || !!leadingOption);

  return (
    <>
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        // biome-ignore lint/a11y/noAutofocus: the start-location editor is a deliberate modal
        autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)} // allow click on a suggestion first
      />
      {showDropdown && (
        <ul className="search-suggestions">
          {leadingOption && (
            <li className="search-leading-option" onMouseDown={() => leadingOption.onSelect()}>
              <div className="suggestion-name">{leadingOption.label}</div>
            </li>
          )}
          {suggestions.map((s) => (
            <li key={s.mapboxId} onMouseDown={() => handleSelect(s)}>
              <div className="suggestion-name">{s.name}</div>
              <div className="suggestion-subtitle">{s.placeFormatted}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
