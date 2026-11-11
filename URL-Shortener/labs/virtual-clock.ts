/**
 * A manually advanced clock. The labs use this instead of real timers so a
 * 60-second replication lag or a 5-minute clock skew runs instantly and
 * deterministically.
 */
export class VirtualClock {
  private current: number;

  constructor(start = 1_700_000_000_000) {
    this.current = start;
  }

  now = (): number => this.current;

  advance(ms: number): void {
    if (ms < 0) throw new RangeError("time only moves forward");
    this.current += ms;
  }

  set(value: number): void {
    this.current = value;
  }
}
