import { NextResponse } from "next/server";
import { getSchedules, getNextDepartures, estimateTrainPositions } from "@/lib/gtfs";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Montreal" })
  );
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowSeconds = nowMinutes + now.getSeconds() / 60;

  const schedules = getSchedules(now);
  const data = schedules.map((s) => ({
    station: s.station,
    nextDepartures: getNextDepartures(s, nowMinutes, 4),
  }));

  const trains = estimateTrainPositions(now, nowSeconds);

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    nowMinutes,
    stations: data,
    trains,
  });
}
