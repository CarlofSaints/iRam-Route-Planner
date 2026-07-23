"use client";

import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Store, Rep, Channel, RouteStop } from "@/lib/types";

interface Props {
  stores: Store[];
  repMap: Map<string, Rep>;
  channelMap: Map<string, Channel>;
  repColors: Record<string, string>;
  routeStops?: RouteStop[];
  routeLines?: [number, number][][]; // per-day polyline positions
  repHome?: { lat: number; lng: number } | null;
  showRoute?: boolean;
  singleDay?: boolean; // true when viewing exactly one day (show sequence numbers)
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

/** Create a numbered circle marker icon */
function numberedIcon(num: number): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      background: #DC2626;
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

/** Home marker icon */
const homeIcon = L.divIcon({
  className: "",
  html: `<div style="
    background: #1D4ED8;
    color: white;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    border: 2px solid white;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  ">&#8962;</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

export default function MapView({
  stores,
  repMap,
  channelMap,
  repColors,
  routeStops,
  routeLines,
  repHome,
  showRoute,
  singleDay,
}: Props) {
  const center: [number, number] = [-26.2, 28.05];
  const zoom = 10;

  const fmt = (n: number) =>
    "R " + (n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
                  <p><span className="text-gray-500">Rep:</span> {rep?.name || store.repCode}</p>
                  <p><span className="text-gray-500">Sales:</span> {fmt(store.monthlySales)}</p>
                  <p><span className="text-gray-500">ID:</span> {store.placeId}</p>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* Route polylines — one per day */}
        {showRoute && routeLines?.map((positions, i) =>
          positions.length > 1 ? (
            <Polyline
              key={`route-line-${i}`}
              positions={positions}
              pathOptions={{
                color: lineColors[i % lineColors.length],
                weight: 3,
                opacity: singleDay ? 0.7 : 0.5,
                dashArray: "8, 6",
              }}
            />
          ) : null
        )}

        {/* Route stop markers */}
        {showRoute &&
          routeStops?.map((stop) => (
            <Marker
              key={`route-${stop.storeId}-${stop.sequence}`}
              position={[stop.lat, stop.lng]}
              icon={singleDay ? numberedIcon(stop.sequence) : numberedIcon(stop.sequence)}
            >
              <Popup>
                <div className="text-xs space-y-1">
                  <p className="font-bold text-sm">#{stop.sequence} {stop.storeName}</p>
                  <p><span className="text-gray-500">Arrive:</span> {stop.arrivalTime}</p>
                  <p><span className="text-gray-500">Depart:</span> {stop.departureTime}</p>
                  <p><span className="text-gray-500">Visit:</span> {stop.visitDuration} min</p>
                  {stop.distanceFromPrev > 0 && (
                    <p><span className="text-gray-500">Distance:</span> {stop.distanceFromPrev} km</p>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}

        {/* Rep home marker */}
        {showRoute && repHome && (
          <Marker position={[repHome.lat, repHome.lng]} icon={homeIcon}>
            <Popup>
              <div className="text-xs font-medium">Rep Home Base</div>
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
          </div>
        </div>
      )}
    </div>
  );
}
