import type { YelpBusiness } from "../types";

interface PoiCardProps {
  business: YelpBusiness;
  onClose: () => void;
}

function Stars({ rating }: { rating: number }) {
  const filled = Math.round(rating);
  return (
    <span className="poi-card-stars" aria-hidden="true">
      {"★★★★★".slice(0, filled)}
      <span className="poi-card-stars-empty">{"★★★★★".slice(filled)}</span>
    </span>
  );
}

export function PoiCard({ business, onClose }: PoiCardProps) {
  // Prefer a precise pin from Yelp's coordinates; fall back to a name+address query.
  const appleMapsUrl = business.coordinates
    ? `https://maps.apple.com/?q=${encodeURIComponent(business.name)}&ll=${business.coordinates.lat},${business.coordinates.lon}`
    : `https://maps.apple.com/?q=${encodeURIComponent(`${business.name} ${business.address}`)}`;
  return (
    <div className="poi-card">
      <button type="button" className="poi-card-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      {business.imageUrl && <img className="poi-card-photo" src={business.imageUrl} alt="" />}
      <div className="poi-card-body">
        <div className="poi-card-name">{business.name}</div>
        <div className="poi-card-subtitle">
          {business.categories.join(", ")}
          {business.price ? ` · ${business.price}` : ""}
        </div>
        <div className="poi-card-rating">
          <Stars rating={business.rating} />
          <span className="poi-card-rating-number">{business.rating.toFixed(1)}</span>
          <span className="poi-card-review-count">({business.reviewCount})</span>
          {business.isOpenNow !== null && (
            <span className={business.isOpenNow ? "poi-card-open" : "poi-card-closed"}>
              {business.isOpenNow ? " · Open now" : " · Closed"}
            </span>
          )}
        </div>
        <div className="poi-card-address">{business.address}</div>
        {business.phone && <div className="poi-card-phone">{business.phone}</div>}
        <div className="poi-card-actions">
          <a className="poi-card-yelp-link" href={business.yelpUrl} target="_blank" rel="noreferrer">
            View on Yelp →
          </a>
          <a className="poi-card-maps-link" href={appleMapsUrl} target="_blank" rel="noreferrer">
            Open in Apple Maps →
          </a>
        </div>
      </div>
    </div>
  );
}
