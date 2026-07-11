import type { POI } from "../types";
import { PlaceSearch } from "./PlaceSearch";

interface SearchBarProps {
  onSelect: (poi: POI) => void;
}

export function SearchBar({ onSelect }: SearchBarProps) {
  return (
    <div className="search-bar">
      <PlaceSearch placeholder="Where to?" onSelect={onSelect} />
    </div>
  );
}
