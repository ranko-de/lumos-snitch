import { NdjsonParser } from './ndjson';

export const BAUD_RATE = 115200;
/** BBC micro:bit USB vendor id (DAPLink / J-Link interface chips). */
const MICROBIT_FILTERS: SerialPortInfo[] = [{ usbVendorId: 0x0d28 }];

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator && !!navigator.serial;
}

export type SerialState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

/**
 * Owns the Web Serial port and feeds decoded NDJSON records to a callback.
 * The port is only requested from a user gesture (Connect button).
 */
export class SerialConnection {
  state: SerialState = 'idle';
  lastError = '';
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readonly parser = new NdjsonParser(512);
  private readonly decoder = new TextDecoder();
  private readonly onPortDisconnect = (e: Event) => {
    if ((e as Event & { target: SerialPort }).target === this.port) this.handleLost('USB disconnected');
  };

  onRecord: ((obj: Record<string, unknown>) => void) | null = null;
  onStateChange: ((state: SerialState) => void) | null = null;

  /** Must be called from a click handler. */
  async connect(): Promise<void> {
    if (!isWebSerialSupported()) throw new Error('Web Serial not supported');
    await this.close();
    this.setState('connecting');
    try {
      const port = await navigator.serial!.requestPort({ filters: MICROBIT_FILTERS });
      await this.openPort(port);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.setState('error');
      throw err;
    }
  }

  /** Tries a previously granted port without a picker (still user-initiated). */
  async reconnect(): Promise<boolean> {
    if (!isWebSerialSupported()) return false;
    const ports = await navigator.serial!.getPorts();
    if (ports.length === 0) return false;
    await this.close();
    this.setState('connecting');
    try {
      await this.openPort(ports[0]);
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.setState('error');
      return false;
    }
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  async close(): Promise<void> {
    const port = this.port;
    this.port = null;
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        /* already closed */
      }
      this.reader = null;
    }
    if (port) {
      try {
        await port.close();
      } catch {
        /* already closed */
      }
    }
    navigator.serial?.removeEventListener('disconnect', this.onPortDisconnect);
    this.parser.reset();
    if (this.state === 'open' || this.state === 'connecting') this.setState('closed');
  }

  private async openPort(port: SerialPort): Promise<void> {
    await port.open({ baudRate: BAUD_RATE, bufferSize: 4096 });
    this.port = port;
    navigator.serial!.addEventListener('disconnect', this.onPortDisconnect);
    this.parser.reset();
    this.setState('open');
    void this.readLoop(port);
  }

  private async readLoop(port: SerialPort): Promise<void> {
    while (this.port === port && port.readable) {
      const reader = port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            if (this.port === port) this.handleLost('stream closed');
            return;
          }
          if (value) {
            const text = this.decoder.decode(value, { stream: true });
            this.parser.push(text, (obj) => this.onRecord?.(obj));
          }
        }
      } catch (err) {
        // Framing/buffer-overrun errors are recoverable; a lost device is not.
        if (this.port !== port) break;
        const msg = err instanceof Error ? err.name : String(err);
        if (msg === 'NetworkError' || msg === 'NotFoundError') {
          this.handleLost(msg);
          break;
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private handleLost(reason: string): void {
    this.lastError = reason;
    void this.close().then(() => this.setState('closed'));
  }

  private setState(s: SerialState): void {
    this.state = s;
    this.onStateChange?.(s);
  }
}
