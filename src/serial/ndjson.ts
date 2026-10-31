/**
 * Incremental NDJSON line parser for the serial stream.
 * - Handles partial lines split across chunks and many lines per chunk.
 * - Bounds memory: an over-long line is dropped until the next newline.
 * - Malformed lines are counted and skipped, never thrown.
 */
export class NdjsonParser {
  private buffer = '';
  private skipping = false;
  malformed = 0;
  overflowed = 0;

  constructor(private readonly maxLineLength = 512) {}

  push(chunk: string, onRecord: (value: Record<string, unknown>) => void): void {
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf('\n', start);
      if (nl === -1) break;
      const piece = chunk.slice(start, nl);
      start = nl + 1;
      if (this.skipping) {
        this.skipping = false;
        this.buffer = '';
        continue;
      }
      const line = this.buffer + piece;
      this.buffer = '';
      this.handleLine(line, onRecord);
    }
    if (start < chunk.length) {
      if (this.skipping) return;
      this.buffer += chunk.slice(start);
      if (this.buffer.length > this.maxLineLength) {
        this.buffer = '';
        this.skipping = true;
        this.overflowed++;
      }
    }
  }

  reset(): void {
    this.buffer = '';
    this.skipping = false;
  }

  /** Bytes currently held while waiting for a newline (for tests/diagnostics). */
  get pending(): number {
    return this.buffer.length;
  }

  private handleLine(raw: string, onRecord: (value: Record<string, unknown>) => void): void {
    const line = raw.trim();
    if (line.length === 0) return;
    if (line.length > this.maxLineLength) {
      this.overflowed++;
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.malformed++;
      return;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.malformed++;
      return;
    }
    onRecord(value as Record<string, unknown>);
  }
}
