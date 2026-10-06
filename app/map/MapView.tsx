"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Store, Rep, Channel, RouteStop, VisitRole, getVisitRoleName } from "@/lib/types";

/**
 * One day's line on the map. `road` false means no saved Google geometry, so
 * the line only joins the stops in order and is drawn dashed to say so.
 */
export interface RouteLine {
  positions: [number, number][];
  road: boolean;
}

/**
 * A route stop plus which day plan it came from. Sequence numbers restart at 1
 * inside every day, so as soon as more than one day is on the map the number
 * alone is ambiguous — several markers legitimately read "1". Carrying the day
 * through lets each day get its own colour and lets the popup say which day a
 * stop belongs to.
 */
export interface MapRouteStop extends RouteStop {
  dayIndex: number;
  week: string;
  day: string;
}

interface Props {
  stores: Store[];
  repMap: Map<string, Rep>;
  channelMap: Map<string, Channel>;
  repColors: Record<string, string>;
  visitRoles: VisitRole[];
  routeStops?: MapRouteStop[];
  routeLines?: RouteLine[];
  /**
   * Stop 0. `derived` means no home address was captured and this is the
   * centroid of the rep's stores — it must not be presented as their home.
   */
  repHome?: {
    lat: number;
    lng: number;
    derived?: boolean;
    address?: string;
    repName?: string;
    /** Set when the rep HAS a home but the saved route still starts this far from it. */
    homeNotInRouteKm?: number;
  } | null;
  showRoute?: boolean;
  singleDay?: boolean; // true when exactly one day plan is on the map
  /** Changes when the rep, day or week changes: the map re-fits to the new route. */
  fitKey?: string;
}

/** Decode Google's encoded polyline format */
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

/** Create a numbered circle marker icon, coloured to match its day's line */
function numberedIcon(num: number, background: string = "#DC2626"): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      background: ${background};
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      border: 2px solid white;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    ">${num}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/**
 * "Thabo's", but "Thomas'": a trailing s takes the apostrophe alone. Trimmed,
 * because rep names arrive from the Perigee export with trailing spaces.
 */
function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`;
}

/**
 * Home marker — numbered 0.
 *
 * The day starts and ends at the rep's home, so it is stop zero: the first
 * store is already 1, and 0 reads as "before the first call" without renaming
 * anything. Same shape as a numbered stop so the eye follows 0 → 1 → 2, but
 * larger and in a colour no day line uses, so it stays distinguishable when
 * several days are drawn at once.
 */
const homeIcon = L.divIcon({
  className: "",
  html: `<div style="
    background: #1D4ED8;
    color: white;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    border: 3px solid white;
    box-shadow: 0 1px 5px rgba(0,0,0,0.4);
  ">0</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

/**
 * Move the map to whatever is being shown, but only when the SELECTION changes.
 *
 * The map opens on Gauteng. Pick a KZN or Cape rep and their route is drawn
 * hundreds of kilometres off screen, which looks exactly like a rep with no
 * routes. Fitting on every render instead would
 * fight the user: pan away to look at something and the map would snap back.
 */
function FitToRoute({ fitKey, positions }: { fitKey: string; positions: [number, number][] }) {
  const map = useMap();
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!positions.length || fitKey === lastKey.current) return;
    lastKey.current = fitKey;
    map.fitBounds(L.latLngBounds(positions), { padding: [60, 60], maxZoom: 13 });
  }, [fitKey, positions, map]);
  return null;
}

/**
 * Pull markers that land on top of each other apart, in SCREEN pixels.
 *
 * Two shops in one centre are metres apart, and a 24px marker is about 100m
 * wide at this zoom, so the later one hides the earlier one completely and the
 * route reads 5, 7 with no 6. Two stores in one mall can share a coordinate
 * exactly, so no zoom level separates them on its own.
 *
 * The offset is computed in pixels and undone into lat/lng, so the fan is the
 * same visual size at every zoom and collapses back onto the true position as
 * you zoom in and the markers stop colliding. Popups still name the real store,
 * and the line still runs through the true points.
 */
function useFannedPositions(stops: MapRouteStop[] | undefined): Map<string, [number, number]> {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [map]);

  return useMemo(() => {
    const out = new Map<string, [number, number]>();
    if (!stops?.length) return out;

    const CELL = 26; // px — a marker is 24px, so anything inside one cell collides
    const RADIUS = 15; // px to push each colliding marker off the shared centre
    const buckets = new Map<string, MapRouteStop[]>();
    const points = new Map<string, L.Point>();

    for (const s of stops) {
      const key = `${s.week}-${s.day}-${s.storeId}-${s.sequence}`;
      const pt = map.project([s.lat, s.lng], zoom);
      points.set(key, pt);
      const cell = `${Math.round(pt.x / CELL)}:${Math.round(pt.y / CELL)}`;
      const list = buckets.get(cell) ?? [];
      list.push(s);
      buckets.set(cell, list);
    }

    for (const group of buckets.values()) {
      group.forEach((s, i) => {
        const key = `${s.week}-${s.day}-${s.storeId}-${s.sequence}`;
        const pt = points.get(key)!;
        if (group.length === 1) {
          out.set(key, [s.lat, s.lng]);
          return;
        }
        const angle = (2 * Math.PI * i) / group.length;
        const moved = L.point(pt.x + RADIUS * Math.cos(angle), pt.y + RADIUS * Math.sin(angle));
        const ll = map.unproject(moved, zoom);
        out.set(key, [ll.lat, ll.lng]);
      });
    }
    return out;
  }, [stops, map, zoom]);
}

/**
 * The numbered stops, fanned apart where they would cover each other.
 *
 * Lives in its own component because the fan needs the live map (useMap), which
 * is only available inside <MapContainer>.
 */
function RouteStopMarkers({
  routeStops,
  singleDay,
  lineColors,
}: {
  routeStops: MapRouteStop[];
  singleDay?: boolean;
  lineColors: string[];
}) {
  const fanned = useFannedPositions(routeStops);

  return (
    <>
      {routeStops.map((stop) => {
        const key = `${stop.week}-${stop.day}-${stop.storeId}-${stop.sequence}`;
        const shown = fanned.get(key) ?? [stop.lat, stop.lng];
        const moved = shown[0] !== stop.lat || shown[1] !== stop.lng;
        return (
          <Marker
            key={`route-${key}`}
            position={shown}
            riseOnHover
            icon={numberedIcon(
              stop.sequence,
              singleDay ? "#DC2626" : lineColors[stop.dayIndex % lineColors.length]
            )}
          >
            <Popup>
              <div className="text-xs space-y-1">
                <p className="font-bold text-sm">#{stop.sequence} {stop.storeName}</p>
                {!singleDay && (
                  <p className="font-medium" style={{ color: lineColors[stop.dayIndex % lineColors.length] }}>
                    {stop.week} · {stop.day}
                  </p>
                )}
                <p><span className="text-gray-500">Arrive:</span> {stop.arrivalTime}</p>
                <p><span className="text-gray-500">Depart:</span> {stop.departureTime}</p>
                <p><span className="text-gray-500">Visit:</span> {stop.visitDuration} min</p>
                {stop.distanceFromPrev > 0 && (
                  <p><span className="text-gray-500">Distance:</span> {stop.distanceFromPrev} km</p>
                )}
                {moved && (
                  <p className="text-gray-400">Nudged to clear another stop at the same spot</p>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

export default function MapView({
  stores,
  repMap,
  channelMap,
  repColors,
  visitRoles,
  routeStops,
  routeLines,
  repHome,
  showRoute,
  singleDay,
  fitKey,
}: Props) {
  const center: [number, number] = [-26.2, 28.05];
  const zoom = 10;

  // Per-day polyline colors (cycle through for multi-day views)
  const lineColors = ["#DC2626", "#2563EB", "#16A34A", "#D97706", "#7C3AED", "#0891B2", "#DB2777", "#65A30D"];

  // Route summary stats
  const routeSummary = useMemo(() => {
    if (!showRoute || !routeStops || routeStops.length === 0) return null;
    const totalDistance = routeStops.reduce((s, st) => s + st.distanceFromPrev, 0);
    const totalTravel = routeStops.reduce((s, st) => s + st.travelTimeFromPrev, 0);
    return {
      stops: routeStops.length,
      distance: Math.round(totalDistance),
      travelHours: (totalTravel / 60).toFixed(1),
    };
  }, [showRoute, routeStops]);

  return (
    <div className="relative h-full w-full">
      <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Store markers */}
        {stores.map((store) => {
          const lat = parseFloat(store.gpsLat);
          const lng = parseFloat(store.gpsLng);
          if (isNaN(lat) || isNaN(lng)) return null;

          const color = repColors[store.repCode] || "#6B7280";
          const rep = repMap.get(store.repCode);
          const ch = channelMap.get(store.channelId);

          return (
            <CircleMarker
              key={store.id}
              center={[lat, lng]}
              radius={showRoute ? 3 : 5}
              pathOptions={{
                fillColor: color,
                color: color,
                weight: 1,
                opacity: showRoute ? 0.3 : 0.8,
                fillOpacity: showRoute ? 0.2 : 0.6,
              }}
            >
              <Popup>
                <div className="text-xs space-y-1">
                  <p className="font-bold text-sm">{store.name}</p>
                  <p><span className="text-gray-500">Channel:</span> {ch?.name || store.channelId}</p>
                  <p>
                    <span className="text-gray-500">Rep:</span> {rep?.name || store.repCode}
                    {rep && <span className="text-gray-500"> ({getVisitRoleName(rep.visitRoleId, visitRoles)})</span>}
                  </p>
                  <p><span className="text-gray-500">ID:</span> {store.placeId}</p>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* Route polylines — one per day.
            Drawn over a street map that is itself all coloured lines, so each
            day gets a white casing underneath: without it a 50%-opacity dashed
            line disappears into the roads and the route reads as missing.
            A SOLID line is the real drive from Google; DASHED is the fallback
            that only joins the stops in order. */}
        {showRoute &&
          routeLines?.map(({ positions, road }, i) =>
            positions.length > 1 ? (
              <Fragment key={`route-line-${i}`}>
                <Polyline
                  positions={positions}
                  pathOptions={{ color: "#FFFFFF", weight: 7, opacity: 0.85 }}
                />
                <Polyline
                  positions={positions}
                  pathOptions={{
                    color: lineColors[i % lineColors.length],
                    weight: 4,
                    opacity: singleDay ? 0.95 : 0.85,
                    dashArray: road ? undefined : "10, 7",
                  }}
                />
              </Fragment>
            ) : null
          )}

        {/* Route stop markers.
            Numbers restart at 1 within each day, so when several days are
            shown the map legitimately contains more than one "1". Each day's
            markers take that day's line colour, and the popup names the day,
            so repeated numbers can be told apart. */}
        {/* Bring the selection on screen: a Cape or KZN rep's route is drawn
            far outside the Gauteng view the map opens on. */}
        {showRoute && fitKey && (
          <FitToRoute
            fitKey={fitKey}
            positions={[
              ...(routeStops ?? []).map((s) => [s.lat, s.lng] as [number, number]),
              ...(repHome ? [[repHome.lat, repHome.lng] as [number, number]] : []),
            ]}
          />
        )}

        {showRoute && routeStops && (
          <RouteStopMarkers
            routeStops={routeStops}
            singleDay={singleDay}
            lineColors={lineColors}
          />
        )}

        {/* Rep home marker — stop 0, where every day starts and ends */}
        {showRoute && repHome && (
          <Marker position={[repHome.lat, repHome.lng]} icon={homeIcon}>
            <Popup>
              <div className="text-xs space-y-1">
                <p className="font-bold text-sm">
                  {repHome.repName
                    ? repHome.derived
                      ? `${possessive(repHome.repName)} start point`
                      : `${possessive(repHome.repName)} Home`
                    : "0 · Start & End of Day"}
                </p>
                {repHome.repName && <p className="text-gray-500">0 · Start &amp; End of Day</p>}
                {repHome.homeNotInRouteKm ? (
                  <>
                    <p className="text-amber-700 font-medium">
                      Their home is {repHome.homeNotInRouteKm.toFixed(1)} km away, and this route does not use it
                    </p>
                    <p className="text-gray-500">
                      The home address was captured after these routes were
                      generated, so the day still starts at the centre of their
                      stores. Regenerate routes to start from home.
                    </p>
                  </>
                ) : repHome.derived ? (
                  <>
                    <p className="text-amber-700 font-medium">Not a real home address</p>
                    <p className="text-gray-500">
                      This rep has no home GPS captured, so routes start from the
                      centre of their stores. Enter their home address on the Reps
                      page to plan from where they actually leave.
                    </p>
                  </>
                ) : (
                  <p className="text-gray-500">{repHome.address || "Rep home base"}</p>
                )}
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Route summary overlay */}
      {routeSummary && (
        <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur rounded-lg shadow-lg px-4 py-3 z-[1000] text-xs">
          <div className="font-semibold text-gray-900 mb-1">Route Summary</div>
          <div className="text-gray-600 space-y-0.5">
            <p>{routeSummary.stops} stops</p>
            <p>{routeSummary.distance} km total</p>
            <p>{routeSummary.travelHours}h travel time</p>
            {/* Only shown when a day on screen actually has no road geometry —
                a legend for something that is not there teaches the wrong thing. */}
            {routeLines?.some((l) => !l.road) && (
              <p className="text-gray-400 pt-1">Dashed: call order, no road route saved</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
