"use client";

/**
 * Pick a store's location by dropping a pin.
 *
 * Ported from Clippa. An iRam store record has no street address either, only
 * a name, a province and a rep, so there is nothing to geocode and typing
 * numbers is the only other way in. Typing numbers is how a digit goes missing.
 *
 * 🔴 The map opens on the rep's OTHER stores, not on Gauteng. A picker that
 * opens 1 400 km from the shop you are placing is a picker nobody uses — and
 * seeing the rest of the round drawn around the pin is the only on-screen
 * evidence that the spot is plausible at all.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { checkCoordinate } from "@/lib/saCoordinates";

/** lib/saCoordinates is shared byte-for-byte with Clippa; keep its long dashes off screen. */
export const plainDash = (text: string) => text.replace(/\s*—\s*/g, ": ");

export interface NearbyStore {
  lat: number;
  lng: number;
  name: string;
}

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="
    width: 26px; height: 26px; border-radius: 50% 50% 50% 0;
    background: #DC2626; border: 3px solid white;
    transform: rotate(-45deg);
    box-shadow: 0 2px 6px rgba(0,0,0,0.4);
  "></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

/** Click anywhere to move the pin. */
function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/**
 * Frame the rep's whole patch.
 *
 * 🔴 Centring on the AVERAGE of their stores and guessing a zoom puts the map
 * wherever the arithmetic lands — for one rep that was the middle of
 * Pilanesberg National Park, nowhere near a shop. Fitting to the bounds of
 * their stores always frames the territory itself, however it is shaped.
 * Runs once: re-fitting on every render would fight the person panning.
 */
function FitToNearby({ nearby }: { nearby: NearbyStore[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    // 🔴 Fit only to the stores inside South Africa. One rep has a store sitting
    // at 46.88, -110.36 — Montana, USA, from a name that was geocoded to the
    // American state — and a single point like that stretches the bounds to the
    // whole globe, leaving the picker showing the Atlantic Ocean.
    const usable = nearby.filter(
      (n) => checkCoordinate(String(n.lat), String(n.lng)).problem === null
    );
    if (usable.length === 0) return;
    done.current = true;
    map.fitBounds(
      L.latLngBounds(usable.map((n) => [n.lat, n.lng] as [number, number])),
      { padding: [40, 40], maxZoom: 13 }
    );
  }, [map, nearby]);
  return null;
}

export default function PinDropMap({
  storeName,
  nearby,
  initial,
  onPick,
  onCancel,
}: {
  storeName: string;
  /** The rep's other stores, for context and for centring. */
  nearby: NearbyStore[];
  initial: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(initial);

  /**
   * Centre on the rep's own patch. Falls back to the middle of South Africa
   * only when the rep has no placed store at all — which is the one case where
   * there is genuinely nothing better to go on.
   */
  const centre = useMemo((): [number, number] => {
    if (initial) return [initial.lat, initial.lng];
    if (nearby.length > 0) {
      return [
        nearby.reduce((s, n) => s + n.lat, 0) / nearby.length,
        nearby.reduce((s, n) => s + n.lng, 0) / nearby.length,
      ];
    }
    return [-29.0, 24.7];
  }, [initial, nearby]);

  const zoom = initial ? 15 : nearby.length > 0 ? 10 : 6;
  const check = pin ? checkCoordinate(String(pin.lat), String(pin.lng)) : null;
  const usable = !!pin && check?.problem === null;

  const round = (n: number) => Math.round(n * 1e6) / 1e6;

  return (
    <div className="fixed inset-0 z-[2000] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="font-semibold text-gray-900">Drop a pin on {storeName}</div>
          <div className="text-xs text-gray-500">
            Click the map to place it, then drag to fine-tune.
            {nearby.length > 0 && ` The faint dots are this rep's other ${nearby.length} stores.`}
          </div>
        </div>

        <div className="flex-1 min-h-[420px]">
          <MapContainer center={centre} zoom={zoom} style={{ height: "100%", width: "100%", minHeight: 420 }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickToPlace onPlace={(lat, lng) => setPin({ lat: round(lat), lng: round(lng) })} />
            {!initial && <FitToNearby nearby={nearby} />}

            {/* Context, not decoration: this is how you tell a plausible spot
                from one that is thirty kilometres out. */}
            {nearby.map((n, i) => (
              <CircleMarker
                key={`${n.lat},${n.lng},${i}`}
                center={[n.lat, n.lng]}
                radius={4}
                pathOptions={{ color: "#6B7280", fillColor: "#6B7280", opacity: 0.5, fillOpacity: 0.3, weight: 1 }}
              >
                <Popup>{n.name}</Popup>
              </CircleMarker>
            ))}

            {pin && (
              <Marker
                position={[pin.lat, pin.lng]}
                icon={pinIcon}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const p = (e.target as L.Marker).getLatLng();
                    setPin({ lat: round(p.lat), lng: round(p.lng) });
                  },
                }}
              />
            )}
          </MapContainer>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3 flex-wrap">
          {pin ? (
            <span className="text-sm text-gray-700 tabular-nums">
              <span className="text-gray-500">Latitude</span> {pin.lat}
              <span className="text-gray-500 ml-3">Longitude</span> {pin.lng}
            </span>
          ) : (
            <span className="text-sm text-gray-400">Click the map to place the pin</span>
          )}

          {/* The same rule the typed boxes use, so a pin dropped in the sea off
              Namibia is refused here too rather than at save time. */}
          {check?.message && <span className="text-xs text-red-600">{plainDash(check.message)}</span>}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              onClick={() => pin && onPick(pin.lat, pin.lng)}
              disabled={!usable}
              className="px-4 py-1.5 bg-iram-green text-white rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Use this location
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
