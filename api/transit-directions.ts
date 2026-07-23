import type { VercelRequest, VercelResponse } from "@vercel/node";

// Logic is inlined (rather than importing ./_transitProxy) so this serverless function has no local
// imports — Vercel's bundler mishandled that before. The dev-server middleware uses _transitProxy.ts.
const DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { originLat, originLon, destLat, destLon } = req.query;
  if (
    typeof originLat !== "string" ||
    typeof originLon !== "string" ||
    typeof destLat !== "string" ||
    typeof destLon !== "string"
  ) {
    res.status(400).json({ error: "originLat, originLon, destLat, destLon are required" });
    return;
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    res.status(500).json({ error: "GOOGLE_MAPS_API_KEY is not configured on the server" });
    return;
  }

  try {
    const params = new URLSearchParams({
      origin: `${originLat},${originLon}`,
      destination: `${destLat},${destLon}`,
      mode: "transit",
      transit_mode: "subway|train|tram",
      key,
    });
    const response = await fetch(`${DIRECTIONS_URL}?${params}`);
    if (!response.ok) {
      res.status(502).json({ error: `Directions request failed: ${response.status}` });
      return;
    }

    // biome-ignore lint/suspicious/noExplicitAny: Google's response is deeply nested and untyped here.
    const data = (await response.json()) as any;
    if (data.status !== "OK") {
      res.status(200).json({ route: null });
      return;
    }
    const leg = data.routes?.[0]?.legs?.[0];
    if (!leg) {
      res.status(200).json({ route: null });
      return;
    }

    // biome-ignore lint/suspicious/noExplicitAny: see above.
    const steps = (leg.steps ?? []).map((s: any) => {
      if (s.travel_mode === "TRANSIT" && s.transit_details) {
        const td = s.transit_details;
        const line = td.line ?? {};
        return {
          kind: "transit",
          durationSeconds: s.duration?.value ?? 0,
          line: line.short_name ?? line.name ?? "",
          lineColor: line.color ?? null,
          vehicle: line.vehicle?.type ?? "SUBWAY",
          headsign: td.headsign ?? "",
          departureStop: td.departure_stop?.name ?? "",
          arrivalStop: td.arrival_stop?.name ?? "",
          numStops: td.num_stops ?? 0,
        };
      }
      return { kind: "walk", durationSeconds: s.duration?.value ?? 0, instruction: stripHtml(s.html_instructions ?? "Walk") };
    });

    res.status(200).json({
      route: {
        totalDurationSeconds: leg.duration?.value ?? 0,
        departureText: leg.departure_time?.text ?? null,
        arrivalText: leg.arrival_time?.text ?? null,
        steps,
      },
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Transit directions failed" });
  }
}
