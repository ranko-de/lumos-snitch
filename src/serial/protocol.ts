/**
 * Browser side of the micro:bit protocol. See docs/PROTOCOL.md.
 *
 * Receiver → browser NDJSON record (one per radio packet):
 *   {"v":1,"p":1,"s":1234,"pi":-125,"ro":40,"l":143,"b":1,"a":7,"r":-58}
 */
export const PROTOCOL_VERSION = 1;

export interface ControllerPacket {
  version: number;
  player: 0 | 1;
  seq: number;
  /** Degrees. */
  pitch: number;
  roll: number;
  light: number;
  buttonA: boolean;
  buttonB: boolean;
  /** 8-bit wrapping counter of A press-down events. */
  aCount: number;
  rssi: number | null;
}

function int(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return null;
  return v;
}

/** Validates one decoded record. Returns null for anything unexpected. */
export function parseRecord(obj: Record<string, unknown>): ControllerPacket | null {
  const v = int(obj.v, 0, 255);
  if (v !== PROTOCOL_VERSION) return null;
  const p = int(obj.p, 1, 2);
  const s = int(obj.s, 0, 0xffff);
  const pi = int(obj.pi, -900, 900);
  const ro = int(obj.ro, -900, 900);
  const l = int(obj.l, 0, 255);
  const b = int(obj.b, 0, 255);
  const a = int(obj.a, 0, 255);
  if (p === null || s === null || pi === null || ro === null || l === null || b === null || a === null) return null;
  const r = obj.r === undefined ? null : int(obj.r, -128, 0);
  return {
    version: v,
    player: (p - 1) as 0 | 1,
    seq: s,
    pitch: pi / 10,
    roll: ro / 10,
    light: l,
    buttonA: (b & 1) !== 0,
    buttonB: (b & 2) !== 0,
    aCount: a,
    rssi: r,
  };
}

/** Per-player link state: sequence tracking, press counting, freshness. */
export class PlayerLink {
  lastSeq = -1;
  lastACount = -1;
  /** Monotonic number of A presses since this link was created. */
  aTotal = 0;
  lastReceiveMs = -Infinity;
  received = 0;
  dropped = 0;
  duplicates = 0;
  packetsSinceBoot = 0;
  latest: ControllerPacket | null = null;

  /** Returns true when the packet was accepted as new data. */
  accept(pkt: ControllerPacket, nowMs: number): boolean {
    const gapMs = nowMs - this.lastReceiveMs;
    if (this.lastSeq >= 0) {
      const diff = (pkt.seq - this.lastSeq) & 0xffff;
      if (diff === 0) {
        this.duplicates++;
        return false;
      }
      const rebooted = diff > 0x8000 && gapMs > 1000;
      if (diff > 0x8000 && !rebooted) {
        // Older than what we already have (reordered) — ignore.
        this.duplicates++;
        return false;
      }
      if (rebooted) {
        this.lastACount = pkt.aCount;
        this.packetsSinceBoot = 0;
      } else {
        this.dropped += diff - 1;
        const aDelta = (pkt.aCount - this.lastACount) & 0xff;
        // A sane cap guards against a controller reset making the counter jump.
        if (aDelta > 0 && aDelta <= 12) this.aTotal += aDelta;
        this.lastACount = pkt.aCount;
      }
    } else {
      this.lastACount = pkt.aCount;
    }
    this.lastSeq = pkt.seq;
    this.lastReceiveMs = nowMs;
    this.received++;
    this.packetsSinceBoot++;
    this.latest = pkt;
    return true;
  }

  ageMs(nowMs: number): number {
    return nowMs - this.lastReceiveMs;
  }

  reset(): void {
    this.lastSeq = -1;
    this.lastACount = -1;
    this.lastReceiveMs = -Infinity;
    this.received = 0;
    this.dropped = 0;
    this.duplicates = 0;
    this.packetsSinceBoot = 0;
    this.latest = null;
  }
}

/** Routes validated records to the right player's link. */
export class ProtocolRouter {
  readonly links: [PlayerLink, PlayerLink] = [new PlayerLink(), new PlayerLink()];
  rejected = 0;
  /** Optional observer (calibration screens listen to raw packets). */
  onPacket: ((pkt: ControllerPacket) => void) | null = null;

  handle(obj: Record<string, unknown>, nowMs: number): void {
    const pkt = parseRecord(obj);
    if (!pkt) {
      this.rejected++;
      return;
    }
    if (this.links[pkt.player].accept(pkt, nowMs)) this.onPacket?.(pkt);
  }
}
