// Minimal Web Serial typings (only what this game uses).
interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}
interface SerialOptions {
  baudRate: number;
  bufferSize?: number;
}
interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}
interface SerialPortRequestOptions {
  filters?: SerialPortInfo[];
}
interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}
interface Navigator {
  readonly serial?: Serial;
}
