import fs from "fs";
import path from "path";

const GTFS_DIR = path.join(process.cwd(), "gtfs");

function parseCsv(filename: string): Record<string, string>[] {
  const raw = fs.readFileSync(path.join(GTFS_DIR, filename), "utf-8");
  const lines = raw.replace(/^\uFEFF/, "").split("\n").filter(Boolean);
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = vals[i] ?? ""));
    return obj;
  });
}

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  stopIds: string[]; // platform-level stop IDs
}

export interface Departure {
  time: string; // HH:MM:SS
  tripId: string;
  routeId: string;
  headsign: string;
  directionId: number;
}

export interface StationSchedule {
  station: Station;
  departures: Departure[];
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function getActiveServiceIds(date: Date): Set<string> {
  const calendars = parseCsv("calendar.txt");
  const calendarDates = parseCsv("calendar_dates.txt");
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayName = days[date.getDay()];
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");

  const active = new Set<string>();
  for (const cal of calendars) {
    if (cal.start_date <= dateStr && dateStr <= cal.end_date && cal[dayName] === "1") {
      active.add(cal.service_id);
    }
  }
  // Handle exceptions
  for (const ex of calendarDates) {
    if (ex.date === dateStr) {
      if (ex.exception_type === "1") active.add(ex.service_id);
      if (ex.exception_type === "2") active.delete(ex.service_id);
    }
  }
  return active;
}

export function getStations(): Station[] {
  const stops = parseCsv("stops.txt");
  const parents = stops.filter((s) => s.location_type === "1");
  const children = stops.filter((s) => s.location_type === "0");

  return parents
    .map((p) => ({
      id: p.stop_id,
      name: p.stop_name.replace("Station ", ""),
      lat: parseFloat(p.stop_lat),
      lon: parseFloat(p.stop_lon),
      stopIds: children.filter((c) => c.parent_station === p.stop_id).map((c) => c.stop_id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Line order: Brossard -> Deux-Montagnes (direction 0 on S1)
const LINE_ORDER = [
  "ST_RIV_1", // Brossard
  "ST_DUQ_1", // Du Quartier
  "ST_PAN_1", // Panama
  "ST_IDS_1", // Île-des-Soeurs
  "ST_GCT_1", // Gare Centrale
  "ST_MCG_1", // McGill
  "ST_EDM_1", // Édouard-Montpetit
  "ST_CAN_1", // Canora
  "ST_MRL_1", // Ville-de-Mont-Royal
  "ST_A40_1", // Côte-de-Liesse (branch point)
  "ST_MPE_1", // Montpellier
  "ST_RUI_1", // Du-Ruisseau
  "ST_BFC_1", // Bois-Franc
  "ST_SUN_1", // Sunnybrooke
  "ST_ROX_1", // Pierrefonds-Roxboro
  "ST_ILB_1", // Île-Bigras
  "ST_SDR_1", // Sainte-Dorothée
  "ST_GRM_1", // Grand-Moulin
  "ST_DEM_1", // Deux-Montagnes
];

export function getStationsSorted(): Station[] {
  const stations = getStations();
  const order = new Map(LINE_ORDER.map((id, i) => [id, i]));
  return stations.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

export function getSchedules(date: Date): StationSchedule[] {
  const serviceIds = getActiveServiceIds(date);
  const trips = parseCsv("trips.txt");
  const stopTimes = parseCsv("stop_times.txt");
  const stations = getStationsSorted();

  // Build trip lookup
  const activeTrips = new Map<string, { routeId: string; headsign: string; directionId: number }>();
  for (const t of trips) {
    if (serviceIds.has(t.service_id)) {
      activeTrips.set(t.trip_id, {
        routeId: t.route_id,
        headsign: t.trip_headsign,
        directionId: parseInt(t.direction_id),
      });
    }
  }

  // Build stop -> station lookup
  const stopToStation = new Map<string, string>();
  for (const st of stations) {
    for (const sid of st.stopIds) {
      stopToStation.set(sid, st.id);
    }
  }

  // Collect departures per station
  const depsMap = new Map<string, Departure[]>();
  for (const st of stations) depsMap.set(st.id, []);

  for (const st of stopTimes) {
    const trip = activeTrips.get(st.trip_id);
    if (!trip) continue;
    const stationId = stopToStation.get(st.stop_id);
    if (!stationId) continue;
    const deps = depsMap.get(stationId);
    if (!deps) continue;
    deps.push({
      time: st.departure_time,
      tripId: st.trip_id,
      routeId: trip.routeId,
      headsign: trip.headsign,
      directionId: trip.directionId,
    });
  }

  // Sort departures by time
  for (const deps of depsMap.values()) {
    deps.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  }

  return stations.map((st) => ({
    station: st,
    departures: depsMap.get(st.id) ?? [],
  }));
}

export function getNextDepartures(
  schedule: StationSchedule,
  nowMinutes: number,
  count = 4
): { towards: string; departures: { time: string; minutes: number }[] }[] {
  // Group by headsign (direction)
  const byDirection = new Map<string, Departure[]>();
  for (const d of schedule.departures) {
    const key = d.headsign;
    if (!byDirection.has(key)) byDirection.set(key, []);
    byDirection.get(key)!.push(d);
  }

  const results: { towards: string; departures: { time: string; minutes: number }[] }[] = [];
  for (const [headsign, deps] of byDirection) {
    const upcoming = deps
      .filter((d) => timeToMinutes(d.time) >= nowMinutes)
      .slice(0, count)
      .map((d) => ({
        time: d.time.slice(0, 5),
        minutes: timeToMinutes(d.time) - nowMinutes,
      }));
    if (upcoming.length > 0) {
      results.push({ towards: headsign, departures: upcoming });
    }
  }
  return results.sort((a, b) => a.towards.localeCompare(b.towards));
}

// ── Estimate live train positions ──

export interface TrainPosition {
  tripId: string;
  routeId: string;
  headsign: string;
  directionId: number;
  fromStationId: string;
  toStationId: string;
  progress: number; // 0..1 between fromStation and toStation
  atStation: boolean; // true if dwelling at fromStation
  segStartMin: number; // departure time from fromStation (minutes)
  segEndMin: number;   // arrival time at toStation (minutes)
}

interface TripStop {
  stationId: string;
  arrivalMin: number;
  departureMin: number;
}

export function estimateTrainPositions(date: Date, nowMinutes: number): TrainPosition[] {
  const serviceIds = getActiveServiceIds(date);
  const trips = parseCsv("trips.txt");
  const stopTimes = parseCsv("stop_times.txt");
  const stations = getStations();

  // stop -> station lookup
  const stopToStation = new Map<string, string>();
  for (const st of stations) {
    for (const sid of st.stopIds) {
      stopToStation.set(sid, st.id);
    }
  }

  // Build trip info
  const tripInfo = new Map<string, { routeId: string; headsign: string; directionId: number }>();
  for (const t of trips) {
    if (serviceIds.has(t.service_id)) {
      tripInfo.set(t.trip_id, {
        routeId: t.route_id,
        headsign: t.trip_headsign,
        directionId: parseInt(t.direction_id),
      });
    }
  }

  // Build ordered stop list per trip
  const tripStops = new Map<string, TripStop[]>();
  for (const st of stopTimes) {
    if (!tripInfo.has(st.trip_id)) continue;
    const stationId = stopToStation.get(st.stop_id);
    if (!stationId) continue;
    if (!tripStops.has(st.trip_id)) tripStops.set(st.trip_id, []);
    tripStops.get(st.trip_id)!.push({
      stationId,
      arrivalMin: timeToMinutes(st.arrival_time),
      departureMin: timeToMinutes(st.departure_time),
    });
  }

  // Sort each trip's stops by sequence (arrival time)
  for (const stops of tripStops.values()) {
    stops.sort((a, b) => a.arrivalMin - b.arrivalMin);
  }

  // Find trains currently in service
  const positions: TrainPosition[] = [];

  for (const [tripId, stops] of tripStops) {
    const info = tripInfo.get(tripId);
    if (!info || stops.length < 2) continue;

    const firstDep = stops[0].departureMin;
    const lastArr = stops[stops.length - 1].arrivalMin;

    // Skip trips not currently in service
    if (nowMinutes < firstDep - 2 || nowMinutes > lastArr + 1) continue;

    // Find where this train is
    let found = false;

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];

      // At a station (between arrival and departure)
      if (nowMinutes >= stop.arrivalMin && nowMinutes <= stop.departureMin) {
        positions.push({
          tripId,
          ...info,
          fromStationId: stop.stationId,
          toStationId: stop.stationId,
          progress: 0,
          atStation: true,
          segStartMin: stop.arrivalMin,
          segEndMin: stop.departureMin,
        });
        found = true;
        break;
      }

      // Between two stations
      if (i < stops.length - 1) {
        const next = stops[i + 1];
        if (nowMinutes > stop.departureMin && nowMinutes < next.arrivalMin) {
          const total = next.arrivalMin - stop.departureMin;
          const elapsed = nowMinutes - stop.departureMin;
          positions.push({
            tripId,
            ...info,
            fromStationId: stop.stationId,
            toStationId: next.stationId,
            progress: total > 0 ? elapsed / total : 0.5,
            atStation: false,
            segStartMin: stop.departureMin,
            segEndMin: next.arrivalMin,
          });
          found = true;
          break;
        }
      }
    }

    // If approaching first station
    if (!found && nowMinutes >= firstDep - 2 && nowMinutes < firstDep) {
      positions.push({
        tripId,
        ...info,
        fromStationId: stops[0].stationId,
        toStationId: stops[0].stationId,
        progress: 0,
        atStation: true,
        segStartMin: stops[0].departureMin - 2,
        segEndMin: stops[0].departureMin,
      });
    }
  }

  return positions;
}
