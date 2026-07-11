import { useEffect, useRef, useState } from "react";
import type { POI } from "../types";
import { retrievePlace, searchSuggestions, type PlaceSuggestion } from "./mapboxSearch";

interface SearchBarProps {
  onSelect: (poi: POI) => void;
}

const DEBOUNCE_MS = 250;

export function SearchBar({ onSelect }: SearchBarProps) {
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

  return (
    <div className="search-bar">
      <input
        type="text"
        value={query}
        placeholder="Where to?"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => suggestions.length > 0 && setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)} // allow click on a suggestion first
      />
      {isOpen && suggestions.length > 0 && (
        <ul className="search-suggestions">
          {suggestions.map((s) => (
            <li key={s.mapboxId} onMouseDown={() => handleSelect(s)}>
              <div className="suggestion-name">{s.name}</div>
              <div className="suggestion-subtitle">{s.placeFormatted}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
