import { describe, expect, it } from 'vitest';
import { NdjsonParser } from '../src/serial/ndjson';
import { parseRecord, PlayerLink, ProtocolRouter } from '../src/serial/protocol';

const rec = (p: number, s: number, extra: Record<string, number> = {}) =>
  JSON.stringify({ v: 1, p, s, pi: -120, ro: 45, l: 140, b: 0, a: 0, ...extra });

describe('NDJSON parser', () => {
  it('joins partial lines split across chunks', () => {
    const parser = new NdjsonParser();
    const out: Record<string, unknown>[] = [];
    const line = rec(1, 5);
    parser.push(line.slice(0, 10), (o) => out.push(o));
    expect(out).toHaveLength(0);
    parser.push(line.slice(10) + '\n', (o) => out.push(o));
    expect(out).toHaveLength(1);
    expect(out[0].s).toBe(5);
  });

  it('handles several lines in one chunk and CRLF endings', () => {
    const parser = new NdjsonParser();
    const out: Record<string, unknown>[] = [];
    parser.push(`${rec(1, 1)}\r\n${rec(2, 2)}\n${rec(1, 3)}\n`, (o) => out.push(o));
    expect(out.map((o) => o.s)).toEqual([1, 2, 3]);
  });

  it('skips malformed lines without throwing and keeps going', () => {
    const parser = new NdjsonParser();
    const out: Record<string, unknown>[] = [];
    parser.push(`{"v":1,"p":1\nnot json\n[1,2]\n\n${rec(1, 9)}\n`, (o) => out.push(o));
    expect(out).toHaveLength(1);
    expect(parser.malformed).toBe(3);
  });

  it('bounds the buffer: an over-long line is dropped until the next newline', () => {
    const parser = new NdjsonParser(64);
    const out: Record<string, unknown>[] = [];
    parser.push('x'.repeat(200), (o) => out.push(o));
    expect(parser.pending).toBe(0);
    parser.push('yyyy\n' + rec(2, 4) + '\n', (o) => out.push(o));
    expect(out).toHaveLength(1);
    expect(out[0].p).toBe(2);
    expect(parser.overflowed).toBe(1);
  });
});

describe('protocol records', () => {
  it('validates fields and maps player ids 1/2 to 0/1', () => {
    const p = parseRecord(JSON.parse(rec(2, 7, { b: 3, a: 4 })))!;
    expect(p.player).toBe(1);
    expect(p.pitch).toBeCloseTo(-12);
    expect(p.roll).toBeCloseTo(4.5);
    expect(p.buttonA).toBe(true);
    expect(p.buttonB).toBe(true);
  });

  it('rejects wrong version, bad player id and out-of-range values', () => {
    expect(parseRecord(JSON.parse(rec(1, 1, { v: 2 })))).toBeNull();
    expect(parseRecord(JSON.parse(rec(3, 1)))).toBeNull();
    expect(parseRecord(JSON.parse(rec(1, 1, { l: 999 })))).toBeNull();
    expect(parseRecord({ v: 1, p: 1 })).toBeNull();
  });

  it('routes packets to the correct player link', () => {
    const r = new ProtocolRouter();
    r.handle(JSON.parse(rec(1, 1)), 0);
    r.handle(JSON.parse(rec(2, 1, { l: 30 })), 1);
    r.handle(JSON.parse(rec(2, 2, { l: 31 })), 2);
    expect(r.links[0].received).toBe(1);
    expect(r.links[1].received).toBe(2);
    expect(r.links[1].latest!.light).toBe(31);
  });
});

describe('player link sequencing and A presses', () => {
  const pkt = (s: number, a: number) => parseRecord(JSON.parse(rec(1, s, { a })))!;

  it('ignores duplicates and older packets, counts drops', () => {
    const l = new PlayerLink();
    expect(l.accept(pkt(10, 0), 0)).toBe(true);
    expect(l.accept(pkt(10, 0), 10)).toBe(false);
    expect(l.accept(pkt(9, 0), 20)).toBe(false);
    expect(l.accept(pkt(13, 0), 30)).toBe(true);
    expect(l.dropped).toBe(2);
  });

  it('handles 16-bit sequence wrap-around', () => {
    const l = new PlayerLink();
    l.accept(pkt(65535, 0), 0);
    expect(l.accept(pkt(0, 0), 50)).toBe(true);
    expect(l.dropped).toBe(0);
  });

  it('a short A press is never lost and counter wrap is handled', () => {
    const l = new PlayerLink();
    l.accept(pkt(1, 254), 0);
    // Press happened between packets and the packet carrying it was dropped.
    l.accept(pkt(3, 255), 100);
    l.accept(pkt(4, 1), 150);
    expect(l.aTotal).toBe(3);
  });

  it('does not count presses again on repeated packets', () => {
    const l = new PlayerLink();
    l.accept(pkt(1, 0), 0);
    l.accept(pkt(2, 1), 50);
    l.accept(pkt(2, 1), 60);
    l.accept(pkt(3, 1), 100);
    expect(l.aTotal).toBe(1);
  });
});
