import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALERTS_URL =
  "https://storage.googleapis.com/transit-terminal-alerts-bucket-production/rem_montreal.pb";

// Minimal GTFS-RT alert parser (no full protobuf needed, just parse the JSON fallback)
// Actually, the feed is protobuf. We'll fetch and decode manually with a simple approach.

interface Alert {
  id: string;
  headerText: string;
  descriptionText: string;
  url: string;
  activePeriods: { start?: number; end?: number }[];
  activeLabel: string;
}

export async function GET() {
  try {
    const res = await fetch(ALERTS_URL, { next: { revalidate: 60 } });
    if (!res.ok) {
      return NextResponse.json({ alerts: [], error: "Failed to fetch alerts" });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const allAlerts = parseGtfsRtAlerts(buf);

    // Filter: only show alerts that are currently active or starting today
    const now = Date.now() / 1000;
    const todayStart = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Montreal" })
    );
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = todayStart.getTime() / 1000 + 86400;

    const alerts = allAlerts.filter((a) => {
      if (a.activePeriods.length === 0) return true; // no period = always active
      return a.activePeriods.some((p) => {
        const start = p.start ?? 0;
        const end = p.end ?? Infinity;
        // Active now, or starts today
        return (start <= now && now <= end) || (start >= todayStart.getTime() / 1000 && start < todayEnd);
      });
    });

    // Add human-readable active period label
    for (const a of alerts) {
      const period = a.activePeriods[0];
      if (period?.start) {
        const d = new Date(period.start * 1000);
        const timeStr = d.toLocaleTimeString("en-CA", { timeZone: "America/Montreal", hour: "2-digit", minute: "2-digit" });
        const isToday = period.start >= todayStart.getTime() / 1000 && period.start < todayEnd;
        a.activeLabel = isToday ? `Today ${timeStr}` : d.toLocaleDateString("en-CA", { timeZone: "America/Montreal", month: "short", day: "numeric" }) + ` ${timeStr}`;
      } else {
        a.activeLabel = "Active now";
      }
    }

    return NextResponse.json({ alerts });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ alerts: [], error: msg });
  }
}

// Minimal protobuf decoder for GTFS-RT alerts
// GTFS-RT uses protobuf with known field numbers:
// FeedMessage { header=1, entity=2[] }
// FeedEntity { id=1, alert=5 }
// Alert { active_period=1[], informed_entity=5[], header_text=10, description_text=11, url=13 }
// TranslatedString { translation=1[] } -> Translation { text=1, language=2 }

function parseGtfsRtAlerts(buf: Buffer): Alert[] {
  const alerts: Alert[] = [];

  try {
    // Simple wire-format parser
    const entities = decodeMessage(buf);
    const entityFields = entities.filter((f) => f.fieldNum === 2);

    for (const entity of entityFields) {
      if (entity.type !== "message" || !entity.data) continue;
      const fields = decodeMessage(entity.data as Buffer);

      const id = fields.find((f) => f.fieldNum === 1 && f.type === "string")?.data as string ?? "";
      const alertField = fields.find((f) => f.fieldNum === 5 && f.type === "message");
      if (!alertField || !alertField.data) continue;

      const alertFields = decodeMessage(alertField.data as Buffer);

      const headerText = extractTranslatedString(alertFields, 10);
      const descriptionText = extractTranslatedString(alertFields, 11);
      const url = extractTranslatedString(alertFields, 13);

      const activePeriods: { start?: number; end?: number }[] = [];
      for (const ap of alertFields.filter((f) => f.fieldNum === 1 && f.type === "message")) {
        if (!ap.data) continue;
        const apFields = decodeMessage(ap.data as Buffer);
        const start = apFields.find((f) => f.fieldNum === 1)?.data as number | undefined;
        const end = apFields.find((f) => f.fieldNum === 2)?.data as number | undefined;
        activePeriods.push({ start, end });
      }

      if (headerText) {
        alerts.push({ id, headerText, descriptionText, url, activePeriods });
      }
    }
  } catch {
    // If parsing fails, return empty
  }

  return alerts;
}

interface ProtoField {
  fieldNum: number;
  type: "varint" | "string" | "message" | "fixed64" | "fixed32";
  data: number | string | Buffer;
}

function decodeMessage(buf: Buffer): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = 0;

  while (pos < buf.length) {
    const { value: tag, newPos: p1 } = decodeVarint(buf, pos);
    if (p1 >= buf.length && tag === 0) break;
    pos = p1;

    const fieldNum = tag >> 3;
    const wireType = tag & 0x7;

    if (fieldNum === 0) break;

    switch (wireType) {
      case 0: { // varint
        const { value, newPos } = decodeVarint(buf, pos);
        pos = newPos;
        fields.push({ fieldNum, type: "varint", data: value });
        break;
      }
      case 1: { // 64-bit
        pos += 8;
        fields.push({ fieldNum, type: "fixed64", data: 0 });
        break;
      }
      case 2: { // length-delimited
        const { value: len, newPos: p2 } = decodeVarint(buf, pos);
        pos = p2;
        const data = buf.subarray(pos, pos + len);
        pos += len;
        // Try to detect if it's a string or embedded message
        const isUtf8 = isLikelyString(data);
        if (isUtf8) {
          fields.push({ fieldNum, type: "string", data: data.toString("utf-8") });
        } else {
          fields.push({ fieldNum, type: "message", data });
        }
        break;
      }
      case 5: { // 32-bit
        pos += 4;
        fields.push({ fieldNum, type: "fixed32", data: 0 });
        break;
      }
      default:
        return fields; // Unknown wire type, stop
    }
  }

  return fields;
}

function decodeVarint(buf: Buffer, pos: number): { value: number; newPos: number } {
  let value = 0;
  let shift = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) break;
  }
  return { value, newPos: pos };
}

function isLikelyString(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09) return false;
  }
  return true;
}

function extractTranslatedString(fields: ProtoField[], fieldNum: number): string {
  const tsField = fields.find((f) => f.fieldNum === fieldNum && f.type === "message");
  if (!tsField || !tsField.data) return "";
  const tsFields = decodeMessage(tsField.data as Buffer);
  // Look for translation entries
  for (const t of tsFields.filter((f) => f.fieldNum === 1 && f.type === "message")) {
    if (!t.data) continue;
    const tFields = decodeMessage(t.data as Buffer);
    const text = tFields.find((f) => f.fieldNum === 1 && f.type === "string")?.data as string;
    const lang = tFields.find((f) => f.fieldNum === 2 && f.type === "string")?.data as string;
    if (text && (!lang || lang === "fr" || lang === "en")) return text;
  }
  return "";
}
