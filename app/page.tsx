"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { t, detectLang, type Lang } from "@/lib/i18n";

interface StationData {
  station: {
    id: string;
    name: string;
    lat: number;
    lon: number;
  };
  nextDepartures: {
    towards: string;
    departures: { time: string; minutes: number }[];
  }[];
}

interface Alert {
  id: string;
  headerText: string;
  descriptionText: string;
  url: string;
  activeLabel: string;
}

interface TrainPosition {
  tripId: string;
  routeId: string;
  headsign: string;
  directionId: number;
  fromStationId: string;
  toStationId: string;
  progress: number;
  atStation: boolean;
  segStartMin: number;
  segEndMin: number;
}

interface ScheduleResponse {
  updatedAt: string;
  nowMinutes: number;
  stations: StationData[];
  trains: TrainPosition[];
}

// Station positions on the SVG map (x, y) — schematic layout
// Trunk: Brossard (south) up to Côte-de-Liesse, then branch northwest to Deux-Montagnes
const STATION_POSITIONS: Record<string, { x: number; y: number; labelSide: "left" | "right" }> = {
  ST_RIV_1: { x: 200, y: 880, labelSide: "right" },   // Brossard
  ST_DUQ_1: { x: 200, y: 800, labelSide: "right" },   // Du Quartier
  ST_PAN_1: { x: 200, y: 720, labelSide: "right" },   // Panama
  ST_IDS_1: { x: 200, y: 640, labelSide: "right" },   // Île-des-Soeurs
  ST_GCT_1: { x: 200, y: 550, labelSide: "right" },   // Gare Centrale
  ST_MCG_1: { x: 200, y: 470, labelSide: "right" },   // McGill
  ST_EDM_1: { x: 200, y: 390, labelSide: "right" },   // Édouard-Montpetit
  ST_CAN_1: { x: 200, y: 310, labelSide: "right" },   // Canora
  ST_MRL_1: { x: 200, y: 230, labelSide: "right" },   // Ville-de-Mont-Royal
  ST_A40_1: { x: 200, y: 150, labelSide: "right" },   // Côte-de-Liesse (branch)
  // Branch to Deux-Montagnes — goes upper-left
  ST_MPE_1: { x: 170, y: 80, labelSide: "right" },    // Montpellier
  ST_RUI_1: { x: 140, y: 20, labelSide: "right" },    // Du-Ruisseau
  ST_BFC_1: { x: 100, y: -40, labelSide: "right" },   // Bois-Franc
  ST_SUN_1: { x: 60, y: -100, labelSide: "right" },   // Sunnybrooke
  ST_ROX_1: { x: 20, y: -160, labelSide: "right" },   // Pierrefonds-Roxboro
  ST_ILB_1: { x: -20, y: -220, labelSide: "right" },  // Île-Bigras
  ST_SDR_1: { x: -60, y: -280, labelSide: "right" },  // Sainte-Dorothée
  ST_GRM_1: { x: -100, y: -340, labelSide: "right" }, // Grand-Moulin
  ST_DEM_1: { x: -140, y: -400, labelSide: "right" }, // Deux-Montagnes
};

const LINE_ORDER = [
  "ST_RIV_1", "ST_DUQ_1", "ST_PAN_1", "ST_IDS_1", "ST_GCT_1",
  "ST_MCG_1", "ST_EDM_1", "ST_CAN_1", "ST_MRL_1", "ST_A40_1",
  "ST_MPE_1", "ST_RUI_1", "ST_BFC_1", "ST_SUN_1", "ST_ROX_1",
  "ST_ILB_1", "ST_SDR_1", "ST_GRM_1", "ST_DEM_1",
];

export default function Home() {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [trains, setTrains] = useState<TrainPosition[]>([]);
  const [liveTrains, setLiveTrains] = useState<TrainPosition[]>([]);
  const serverTimeRef = useRef(0); // server nowMinutes at last fetch
  const fetchTimeRef = useRef(0);  // Date.now() at last fetch
  const [countdown, setCountdown] = useState(15);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const [nearestStation, setNearestStation] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [lang, setLang] = useState<Lang>("fr");

  const fetchData = useCallback(async () => {
    try {
      const [schedRes, alertRes] = await Promise.all([
        fetch("/api/schedule"),
        fetch("/api/alerts"),
      ]);
      const schedData = await schedRes.json();
      const alertData = await alertRes.json();
      setData(schedData);
      setTrains(schedData.trains ?? []);
      serverTimeRef.current = schedData.nowMinutes;
      fetchTimeRef.current = Date.now();
      setAlerts(alertData.alerts ?? []);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Failed to fetch:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const locateNearest = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        let minDist = Infinity;
        let closest: string | null = null;
        for (const id of LINE_ORDER) {
          const sp = STATION_POSITIONS[id];
          if (!sp) continue;
          // Find real lat/lon from data or hardcoded station list
          const stData = data?.stations.find((s) => s.station.id === id);
          if (!stData) continue;
          const dlat = stData.station.lat - latitude;
          const dlon = stData.station.lon - longitude;
          const dist = dlat * dlat + dlon * dlon;
          if (dist < minDist) { minDist = dist; closest = id; }
        }
        if (closest) {
          setNearestStation(closest);
          setSelectedStation(closest);
        }
        setLocating(false);
      },
      () => { setLocating(false); },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, [data]);

  useEffect(() => {
    setMounted(true);
    setLang(detectLang());
    setLoading(true);
    fetchData();
    const interval = setInterval(() => { fetchData(); setCountdown(15); }, 15000);
    const countdownTick = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => { clearInterval(interval); clearInterval(countdownTick); };
  }, [fetchData]);

  // Separate effect: interpolate train positions every second (no API calls)
  useEffect(() => {
    if (trains.length === 0) return;
    const tick = setInterval(() => {
      const elapsed = (Date.now() - fetchTimeRef.current) / 60000;
      const nowMin = serverTimeRef.current + elapsed;
      setLiveTrains(trains.map((t) => {
        if (t.atStation) return t;
        const total = t.segEndMin - t.segStartMin;
        if (total <= 0) return t;
        const p = Math.min(1, Math.max(0, (nowMin - t.segStartMin) / total));
        return { ...t, progress: p };
      }));
    }, 1000);
    return () => clearInterval(tick);
  }, [trains]);

  // Auto-locate on first data load
  const locatedOnce = useRef(false);
  useEffect(() => {
    if (data && !locatedOnce.current) {
      locatedOnce.current = true;
      locateNearest();
    }
  }, [data, locateNearest]);

  const stationMap = new Map(data?.stations.map((s) => [s.station.id, s]) ?? []);
  const selectedData = selectedStation ? stationMap.get(selectedStation) : null;

  // Dual-track offset: perpendicular to the line direction

  function offsetPath(ids: string[], side: number): string {
    const pts = ids.map((id) => STATION_POSITIONS[id]);
    const offset: { x: number; y: number }[] = [];
    for (let i = 0; i < pts.length; i++) {
      // Compute direction vector
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      // Perpendicular: (-dy, dx) normalized
      const nx = (-dy / len) * TG * side;
      const ny = (dx / len) * TG * side;
      offset.push({ x: pts[i].x + nx, y: pts[i].y + ny });
    }
    return offset.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }

  const trunkIds = LINE_ORDER.slice(0, 10);
  const branchIds = LINE_ORDER.slice(9);

  // Left track = northbound (towards Deux-Montagnes), Right track = southbound (towards Brossard)
  const trunkLeftPath = offsetPath(trunkIds, -1);
  const trunkRightPath = offsetPath(trunkIds, 1);
  const branchLeftPath = offsetPath(branchIds, -1);
  const branchRightPath = offsetPath(branchIds, 1);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {mounted && loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950">
          <div className="text-center">
            <div className="h-10 w-10 mx-auto mb-4 rounded-full border-4 border-green-500 border-t-transparent animate-spin" />
            <p className="text-gray-400">{t("loading", lang)}</p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="sticky top-0 z-20 bg-gray-950/90 backdrop-blur border-b border-gray-800 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-green-600 flex items-center justify-center font-bold text-xs">R</div>
            <span className="font-semibold">{t("title", lang)}</span>
          </div>
          <div className="flex items-center gap-3">
            {trains.length > 0 && (
              <span className="text-xs text-green-400 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                {trains.length} {t("trains", lang)}
              </span>
            )}
            <button
              onClick={() => setLang((l) => l === "en" ? "fr" : "en")}
              className="text-xs text-gray-400 hover:text-white bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 font-medium uppercase"
            >
              {lang === "en" ? "FR" : "EN"}
            </button>
            <span className="text-xs text-gray-500">
              {lastRefresh?.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="max-w-3xl mx-auto px-4 pt-3 space-y-1.5">
          {alerts.map((alert) => (
            <div key={alert.id} className="bg-amber-900/20 border border-amber-800/40 rounded-lg overflow-hidden">
              <button
                className="w-full px-3 py-2 text-left flex items-start gap-2"
                onClick={() => setExpandedAlerts((prev) => {
                  const next = new Set(prev);
                  if (next.has(alert.id)) next.delete(alert.id); else next.add(alert.id);
                  return next;
                })}
              >
                <span className="text-amber-400 text-sm">⚠</span>
                <div className="flex-1 text-xs">
                  <span className="text-amber-200 font-medium">{alert.headerText}</span>
                  <span className="text-amber-500/70 ml-2">{alert.activeLabel}</span>
                </div>
                <span className="text-amber-600 text-xs">{expandedAlerts.has(alert.id) ? "▲" : "▼"}</span>
              </button>
              {expandedAlerts.has(alert.id) && alert.descriptionText && (
                <div className="px-3 pb-2 pl-8">
                  <p className="text-xs text-amber-300/80 whitespace-pre-line">{alert.descriptionText}</p>
                  {alert.url && (
                    <a href={alert.url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-400 underline mt-1 inline-block">
                      {t("moreInfo", lang)}
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Map + Detail */}
      <div className="max-w-3xl mx-auto flex flex-col md:flex-row gap-0 md:gap-4 px-4 py-4">
        {/* SVG Map with zoom/pan */}
        <MapView
          selectedStation={selectedStation}
          setSelectedStation={setSelectedStation}
          stationMap={stationMap}
          trains={liveTrains.length > 0 ? liveTrains : trains}
          trunkIds={trunkIds}
          branchIds={branchIds}
          trunkLeftPath={trunkLeftPath}
          trunkRightPath={trunkRightPath}
          branchLeftPath={branchLeftPath}
          branchRightPath={branchRightPath}
          offsetPath={offsetPath}
          nearestStation={nearestStation}
          onLocate={locateNearest}
          locating={locating}
          lang={lang}
        />
        {/* Detail panel — desktop sidebar */}
        <div className="hidden md:block md:w-72 shrink-0">
          <div className="sticky top-16">
            {selectedData && (
              <StationDetail data={selectedData} onClose={() => setSelectedStation(null)} lang={lang} />
            )}
          </div>
        </div>
      </div>

      {/* Detail panel — mobile bottom sheet */}
      {selectedData && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setSelectedStation(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[60vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <StationDetail data={selectedData} onClose={() => setSelectedStation(null)} lang={lang} />
          </div>
        </div>
      )}

      {/* Legend + Footer */}
      <div className="max-w-3xl mx-auto px-4 pb-6">
        <div className="flex items-center justify-center gap-6 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-4 rounded-sm bg-green-500" />
            <span className="text-xs text-gray-400">{t("northbound", lang)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-4 rounded-sm bg-blue-400" />
            <span className="text-xs text-gray-400">{t("southbound", lang)}</span>
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-gray-600">
          <span>{t("estimated", lang)}</span>
          <span>·</span>
          <span className="inline-flex items-center gap-1.5">
            <svg className="w-3 h-3" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="7" fill="none" stroke="#374151" strokeWidth="2" />
              <circle
                cx="8" cy="8" r="7" fill="none"
                stroke="#22c55e"
                strokeWidth="2"
                strokeDasharray={`${(countdown / 15) * 44} 44`}
                strokeLinecap="round"
                transform="rotate(-90 8 8)"
                style={{ transition: "stroke-dasharray 0.3s" }}
              />
            </svg>
            <span className="tabular-nums w-4 text-right">{countdown}s</span>
          </span>
        </div>
      </div>
    </div>
  );
}

const TG = 7;

// ── Zoomable Map ──

const FULL_VB = { x: -280, y: -440, w: 760, h: 1380 };
const ZOOMED_VB = { x: 50, y: 100, w: 320, h: 600 }; // centered on trunk

function MapView({
  selectedStation, setSelectedStation, stationMap, trains,
  trunkIds, branchIds, trunkLeftPath, trunkRightPath, branchLeftPath, branchRightPath, offsetPath,
  nearestStation, onLocate, locating, lang,
}: {
  selectedStation: string | null;
  setSelectedStation: (id: string | null) => void;
  stationMap: Map<string, StationData>;
  trains: TrainPosition[];
  trunkIds: string[];
  branchIds: string[];
  trunkLeftPath: string;
  trunkRightPath: string;
  branchLeftPath: string;
  branchRightPath: string;
  offsetPath: (ids: string[], side: number) => string;
  nearestStation: string | null;
  onLocate: () => void;
  locating: boolean;
  lang: Lang;
}) {
  const [vb, setVb] = useState(ZOOMED_VB);
  const [isZoomed, setIsZoomed] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const dragMoved = useRef(false);
  const pinchDist = useRef(0);
  const centeredOnNearest = useRef(false);

  // Center on nearest station when GPS locates
  useEffect(() => {
    if (nearestStation && !centeredOnNearest.current) {
      centeredOnNearest.current = true;
      const pos = STATION_POSITIONS[nearestStation];
      if (pos) {
        setVb((v) => ({ ...v, x: pos.x - v.w / 2, y: pos.y - v.h / 2 }));
      }
    }
  }, [nearestStation]);

  const toggleZoom = useCallback(() => {
    if (isZoomed) {
      setVb(FULL_VB);
      setIsZoomed(false);
    } else {
      setVb(ZOOMED_VB);
      setIsZoomed(true);
    }
  }, [isZoomed]);

  // Scroll to zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    setVb((v) => {
      const nw = Math.min(FULL_VB.w, Math.max(150, v.w * factor));
      const nh = Math.min(FULL_VB.h, Math.max(280, v.h * factor));
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    });
    setIsZoomed(false);
  }, []);

  // Mouse drag to pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragMoved.current = false;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    const rect = containerRef.current.getBoundingClientRect();
    setVb((v) => ({
      ...v,
      x: v.x - (dx / rect.width) * v.w,
      y: v.y - (dy / rect.height) * v.h,
    }));
  }, []);

  const handleMouseUp = useCallback(() => { dragging.current = false; }, []);

  // Touch: single finger pan + two finger pinch zoom
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      dragging.current = true;
      dragMoved.current = false;
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.touches.length === 2) {
      dragging.current = false;
      pinchDist.current = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault(); // prevent browser scroll
    if (e.touches.length === 1 && dragging.current && containerRef.current) {
      const dx = e.touches[0].clientX - lastPos.current.x;
      const dy = e.touches[0].clientY - lastPos.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved.current = true;
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      const rect = containerRef.current.getBoundingClientRect();
      setVb((v) => ({
        ...v,
        x: v.x - (dx / rect.width) * v.w,
        y: v.y - (dy / rect.height) * v.h,
      }));
    }
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (pinchDist.current > 0) {
        const factor = pinchDist.current / dist;
        setVb((v) => {
          const nw = Math.min(FULL_VB.w, Math.max(150, v.w * factor));
          const nh = Math.min(FULL_VB.h, Math.max(280, v.h * factor));
          const cx = v.x + v.w / 2;
          const cy = v.y + v.h / 2;
          return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
        });
      }
      pinchDist.current = dist;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    dragging.current = false;
    pinchDist.current = 0;
  }, []);

  // Click station → pan to it
  const selectAndPan = useCallback((id: string) => {
    if (dragMoved.current) return; // ignore tap after drag
    const pos = STATION_POSITIONS[id];
    if (!pos) return;
    setSelectedStation(selectedStation === id ? null : id);
    setVb((v) => ({ ...v, x: pos.x - v.w / 2, y: pos.y - v.h / 2 }));
  }, [selectedStation, setSelectedStation]);

  const viewBox = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;

  return (
    <div className="flex-1 relative" ref={containerRef}>
      {/* Map controls */}
      <div className="absolute top-2 right-2 z-10 flex gap-1.5">
        <button
          onClick={() => {
            centeredOnNearest.current = false;
            onLocate();
          }}
          disabled={locating}
          className="bg-gray-800/80 hover:bg-gray-700 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 backdrop-blur disabled:opacity-50"
        >
          {locating ? "⏳" : "📍"}
        </button>
        <button
          onClick={toggleZoom}
          className="bg-gray-800/80 hover:bg-gray-700 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 backdrop-blur"
        >
          {isZoomed ? t("fullMap", lang) : t("zoomIn", lang)}
        </button>
      </div>

      <div
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="touch-none"
      >
        <svg
          viewBox={viewBox}
          className="w-full max-w-md mx-auto"
          style={{ minHeight: "70vh", transition: isZoomed || !dragging.current ? "none" : "none" }}
        >
          {/* Dual track paths */}
          <path d={trunkLeftPath} fill="none" stroke="#166534" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d={branchLeftPath} fill="none" stroke="#166534" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d={trunkRightPath} fill="none" stroke="#166534" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d={branchRightPath} fill="none" stroke="#166534" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d={offsetPath(trunkIds, 0)} fill="none" stroke="#0a2e14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2,6" />
          <path d={offsetPath(branchIds, 0)} fill="none" stroke="#0a2e14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2,6" />

          {/* Stations */}
          {LINE_ORDER.map((id) => {
            const pos = STATION_POSITIONS[id];
            const station = stationMap.get(id);
            if (!pos || !station) return null;
            const isSelected = selectedStation === id;
            const isNearest = nearestStation === id;
            const dirDeps = getDirectionalDepartures(station);
            return (
              <g key={id} className="cursor-pointer" onClick={() => selectAndPan(id)}>
                <rect x={pos.x - 20} y={pos.y - 20} width={40} height={40} fill="transparent" />
                {/* Nearest station pulse ring */}
                {isNearest && (
                  <>
                    <circle cx={pos.x} cy={pos.y} r={18} fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.5}>
                      <animate attributeName="r" values="14;20;14" dur="2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.6;0.1;0.6" dur="2s" repeatCount="indefinite" />
                    </circle>
                    <text x={pos.x} y={pos.y + 28} textAnchor="middle" fill="#fbbf24" fontSize="8" fontFamily="system-ui, sans-serif">{t("nearest", lang)}</text>
                  </>
                )}
                <line x1={pos.x - TG - 2} y1={pos.y} x2={pos.x + TG + 2} y2={pos.y}
                  stroke={isSelected ? "#86efac" : "#22c55e"} strokeWidth={isSelected ? 3 : 2} strokeLinecap="round" />
                <circle cx={pos.x - TG} cy={pos.y} r={isSelected ? 5 : 4}
                  fill={isSelected ? "#22c55e" : "#1a1a2e"} stroke={isSelected ? "#86efac" : "#22c55e"} strokeWidth={2} />
                <circle cx={pos.x + TG} cy={pos.y} r={isSelected ? 5 : 4}
                  fill={isSelected ? "#22c55e" : "#1a1a2e"} stroke={isSelected ? "#86efac" : "#22c55e"} strokeWidth={2} />
                <text x={pos.x} y={pos.y - 16} className="select-none" textAnchor="middle"
                  fill={isSelected ? "#e2e8f0" : "#94a3b8"} fontSize="11" fontWeight={isSelected ? "600" : "400"} fontFamily="system-ui, sans-serif">
                  {station.station.name}
                </text>
                {/* North badge (left) */}
                {dirDeps.north !== null && (() => {
                  const m = dirDeps.north!; const label = m <= 0 ? t("now", lang) : `${m}${t("m", lang)}`;
                  const w = label.length * 6.5 + 10; const bx = pos.x - TG - 14 - w;
                  return (
                    <g>
                      <rect x={bx} y={pos.y - 8} width={w} height={16} rx={4}
                        fill={m <= 2 ? "#065f46" : "#1e293b"} stroke={m <= 2 ? "#10b981" : "#334155"} strokeWidth={0.5} />
                      <text x={bx + 5} y={pos.y + 4} fill={m <= 2 ? "#6ee7b7" : "#86efac"} fontSize="9"
                        fontFamily="ui-monospace, monospace" fontWeight="600">↑{label}</text>
                    </g>
                  );
                })()}
                {/* South badge (right) */}
                {dirDeps.south !== null && (() => {
                  const m = dirDeps.south!; const label = m <= 0 ? t("now", lang) : `${m}${t("m", lang)}`;
                  const w = label.length * 6.5 + 10; const bx = pos.x + TG + 14;
                  return (
                    <g>
                      <rect x={bx} y={pos.y - 8} width={w} height={16} rx={4}
                        fill={m <= 2 ? "#172554" : "#1e293b"} stroke={m <= 2 ? "#3b82f6" : "#334155"} strokeWidth={0.5} />
                      <text x={bx + 5} y={pos.y + 4} fill={m <= 2 ? "#93c5fd" : "#93c5fd"} fontSize="9"
                        fontFamily="ui-monospace, monospace" fontWeight="600">↓{label}</text>
                    </g>
                  );
                })()}
                {id === "ST_RIV_1" && (
                  <text x={pos.x} y={pos.y + 30} fill="#64748b" fontSize="10" fontFamily="system-ui, sans-serif" textAnchor="middle">{t("southTerminal", lang)}</text>
                )}
                {id === "ST_DEM_1" && (
                  <text x={pos.x} y={pos.y - 30} fill="#64748b" fontSize="10" fontFamily="system-ui, sans-serif" textAnchor="middle">{t("northTerminal", lang)}</text>
                )}
              </g>
            );
          })}

          {/* Trains */}
          {trains.map((train) => {
            const pos = getTrainPosition(train);
            if (!pos) return null;
            const isNorth = train.headsign.includes("Deux-Montagnes") || train.headsign.includes("Liesse");
            const color = isNorth ? "#22c55e" : "#60a5fa";
            const light = isNorth ? "#bbf7d0" : "#bfdbfe";
            const d = isNorth ? -1 : 1;
            const cx = pos.x, cy = pos.y;
            return (
              <g key={train.tripId}>
                <ellipse cx={cx} cy={cy} rx={7} ry={10} fill={color} opacity={0.1}>
                  <animate attributeName="opacity" values="0.08;0.15;0.08" dur="2s" repeatCount="indefinite" />
                </ellipse>
                <rect x={cx-5} y={cy-8} width={10} height={16} rx={4} fill={color} stroke={light} strokeWidth={0.8} />
                <rect x={cx-3.5} y={cy-6+(isNorth?0:8)} width={7} height={3} rx={1.5} fill={light} opacity={0.5} />
                <rect x={cx-3} y={cy-2} width={2.5} height={2.5} rx={0.8} fill="#0f172a" opacity={0.7} />
                <rect x={cx+0.5} y={cy-2} width={2.5} height={2.5} rx={0.8} fill="#0f172a" opacity={0.7} />
                <circle cx={cx} cy={cy+d*9.5} r={1.2} fill="#fef08a" opacity={0.9}>
                  <animate attributeName="opacity" values="0.7;1;0.7" dur="1.5s" repeatCount="indefinite" />
                </circle>
                <circle cx={cx-3} cy={cy+(isNorth?7:-7)} r={1} fill="#334155" />
                <circle cx={cx+3} cy={cy+(isNorth?7:-7)} r={1} fill="#334155" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function getTrainPosition(train: TrainPosition): { x: number; y: number } | null {
  const from = STATION_POSITIONS[train.fromStationId];
  const to = STATION_POSITIONS[train.toStationId];
  if (!from) return null;

  // Center line position (interpolate between stations)
  let cx: number, cy: number;
  if (train.atStation || !to) {
    cx = from.x;
    cy = from.y;
  } else {
    const p = train.progress;
    cx = from.x + (to.x - from.x) * p;
    cy = from.y + (to.y - from.y) * p;
  }

  // Always compute perpendicular using LINE direction (Brossard→Deux-Montagnes = ascending index)
  // This ensures both directions offset consistently relative to the track
  const fromIdx = LINE_ORDER.indexOf(train.fromStationId);
  const idx = Math.max(0, Math.min(LINE_ORDER.length - 1, fromIdx));
  const prevIdx = Math.max(0, idx - 1);
  const nextIdx = Math.min(LINE_ORDER.length - 1, idx + 1);
  const prev = STATION_POSITIONS[LINE_ORDER[prevIdx]];
  const next = STATION_POSITIONS[LINE_ORDER[nextIdx]];

  // Line direction vector (always northward along route)
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  const isNorthbound = train.headsign.includes("Deux-Montagnes") || train.headsign.includes("Liesse");
  const side = isNorthbound ? -1 : 1;
  const nx = (-dy / len) * TG * side;
  const ny = (dx / len) * TG * side;

  return { x: cx + nx, y: cy + ny };
}

function getDirectionalDepartures(station: StationData): { north: number | null; south: number | null } {
  let north: number | null = null;
  let south: number | null = null;
  for (const dir of station.nextDepartures) {
    if (dir.departures.length === 0) continue;
    const m = dir.departures[0].minutes;
    const isNorth = dir.towards.includes("Deux-Montagnes") || dir.towards.includes("Liesse");
    if (isNorth) {
      if (north === null || m < north) north = m;
    } else {
      if (south === null || m < south) south = m;
    }
  }
  return { north, south };
}

function StationDetail({ data, onClose, lang }: { data: StationData; onClose: () => void; lang: Lang }) {
  const hasService = data.nextDepartures.length > 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-green-900/30 border-b border-green-800/30 px-4 py-3 flex items-center justify-between">
        <h2 className="font-semibold text-sm text-green-100">{data.station.name}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">×</button>
      </div>

      {/* Departures */}
      <div className="p-4">
        {!hasService ? (
          <p className="text-sm text-gray-500 text-center py-4">{t("noTrains", lang)}</p>
        ) : (
          <div className="space-y-4">
            {data.nextDepartures.map((dir) => (
              <div key={dir.towards}>
                <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
                  <span className="text-green-500">→</span> {dir.towards}
                </div>
                <div className="space-y-1">
                  {dir.departures.map((dep, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-3 py-1.5 rounded-md ${
                        i === 0 ? "bg-green-900/30 border border-green-800/30" : "bg-gray-800/50"
                      }`}
                    >
                      <span className={`text-sm font-mono ${i === 0 ? "text-green-300 font-semibold" : "text-gray-400"}`}>
                        {dep.time}
                      </span>
                      <span className={`text-xs ${i === 0 ? "text-green-400" : "text-gray-500"}`}>
                        {dep.minutes <= 0 ? t("now", lang) : `${dep.minutes} ${t("min", lang)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
