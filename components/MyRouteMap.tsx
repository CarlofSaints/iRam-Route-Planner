"use client";

/**
 * One day of a rep's own route: home, the numbered calls, and the drive.
 *
 * Deliberately small and separate from app/map/MapView.tsx, which is built to
 * hold every rep and every store at once. A rep sees one day at a time.
 */

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { decodePolyline } from "@/lib/google-maps";

export interface MyStop {
  storeId: string;
  storeName: string;
  lat: number;
  lng: number;
  arrivalTime: string;
  departureTime: string;
}

const homeIcon = L.divIcon({
  className: "",
  html: `<div style="width:30px;height:30px;border-radius:50%;background:#111827;border:3px solid white;
    box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;
    "><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

function stopIcon(n: number) {
  return L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;border-radius:50%;background:#7CC042;border:2px solid white;
      box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;
      color:white;font-size:12px;font-weight:700">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

/** Re-fit whenever the day changes, so picking Thursday shows Thursday. */
function FitToDay({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 14);
    else map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

export default function MyRouteMap({
  home,
  stops,
  polyline,
  fitKey,
}: {
  home: { lat: number; lng: number } | null;
  stops: MyStop[];
  polyline?: string;
  fitKey: string;
}) {
  const stopPoints = stops.map((s) => [s.lat, s.lng] as [number, number]);
  const homePoint = home ? ([home.lat, home.lng] as [number, number]) : null;
  const all = homePoint ? [homePoint, ...stopPoints] : stopPoints;

  // A saved Google polyline is the real drive. Without one we can only join
  // the calls in order, drawn dashed so it is never mistaken for the road.
  const road = polyline ? decodePolyline(polyline) : null;
  const order = homePoint ? [homePoint, ...stopPoints, homePoint] : stopPoints;

  return (
    <MapContainer
      center={all[0] ?? [-26.2, 28.05]}
      zoom={11}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToDay points={all} fitKey={fitKey} />

      {road && road.length > 1 ? (
        <>
          <Polyline positions={road} pathOptions={{ color: "white", weight: 7, opacity: 0.9 }} />
          <Polyline positions={road} pathOptions={{ color: "#7CC042", weight: 4 }} />
        </>
      ) : (
        order.length > 1 && (
          <Polyline positions={order} pathOptions={{ color: "#7CC042", weight: 3, dashArray: "6 6" }} />
        )
      )}

      {homePoint && (
        <Marker position={homePoint} icon={homeIcon}>
          <Popup>Home: your day starts and ends here</Popup>
        </Marker>
      )}
      {stops.map((s, i) => (
        <Marker key={`${s.storeId}-${i}`} position={[s.lat, s.lng]} icon={stopIcon(i + 1)}>
          <Popup>
            <strong>
              {i + 1}. {s.storeName}
            </strong>
            <br />
            {s.arrivalTime} to {s.departureTime}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
