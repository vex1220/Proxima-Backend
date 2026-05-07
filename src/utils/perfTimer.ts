interface TimerMark {
  label: string;
  timestamp: number;
}

interface SegmentStats {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

interface PerfStats {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  recentMs: number[];
  segments: { [label: string]: SegmentStats };
}

const statsMap = new Map<string, PerfStats>();
let enabled = process.env.PERF_TIMING === "true" || process.env.NODE_ENV !== "production";

export class PerfTimer {
  private name: string;
  private startNs: bigint;
  private marks: TimerMark[] = [];
  private ended = false;

  constructor(name: string) {
    this.name = name;
    this.startNs = process.hrtime.bigint();
  }

  mark(label: string): void {
    if (!enabled || this.ended) return;
    this.marks.push({
      label,
      timestamp: Number(process.hrtime.bigint() - this.startNs) / 1_000_000,
    });
  }

  end(): number {
    if (!enabled || this.ended) return 0;
    this.ended = true;
    const totalMs = Number(process.hrtime.bigint() - this.startNs) / 1_000_000;

    let prev = 0;
    const segments = this.marks.map(({ label, timestamp }) => {
      const delta = timestamp - prev;
      prev = timestamp;
      return `${label}=${delta.toFixed(2)}ms`;
    });
    console.log(`[perf] ${this.name} total=${totalMs.toFixed(2)}ms | ${segments.join(" → ")}`);

    let prevTs = 0;
    for (const { label, timestamp } of this.marks) {
      const segMs = timestamp - prevTs;
      prevTs = timestamp;
      this.updateSegmentStats(label, segMs);
    }

    this.updateAggregateStats(totalMs);
    return totalMs;
  }

  private updateSegmentStats(label: string, ms: number): void {
    let stats = statsMap.get(this.name);
    if (!stats) {
      stats = { count: 0, totalMs: 0, minMs: Infinity, maxMs: -Infinity, recentMs: [], segments: {} };
      statsMap.set(this.name, stats);
    }
    if (!stats.segments[label]) {
      stats.segments[label] = { count: 0, totalMs: 0, minMs: Infinity, maxMs: -Infinity };
    }
    const seg = stats.segments[label];
    seg.count++;
    seg.totalMs += ms;
    seg.minMs = Math.min(seg.minMs, ms);
    seg.maxMs = Math.max(seg.maxMs, ms);
  }

  private updateAggregateStats(totalMs: number): void {
    let stats = statsMap.get(this.name);
    if (!stats) {
      stats = { count: 0, totalMs: 0, minMs: Infinity, maxMs: -Infinity, recentMs: [], segments: {} };
      statsMap.set(this.name, stats);
    }
    stats.count++;
    stats.totalMs += totalMs;
    stats.minMs = Math.min(stats.minMs, totalMs);
    stats.maxMs = Math.max(stats.maxMs, totalMs);
    stats.recentMs.push(totalMs);
    if (stats.recentMs.length > 100) stats.recentMs.shift();
  }

  static enable(): void { enabled = true; }
  static disable(): void { enabled = false; }
  static isEnabled(): boolean { return enabled; }

  static getStats(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [name, stats] of statsMap) {
      const sorted = [...stats.recentMs].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p95 = sorted[p95Index] ?? null;
      result[name] = {
        count: stats.count,
        avgMs: stats.count > 0 ? +(stats.totalMs / stats.count).toFixed(3) : 0,
        minMs: stats.minMs === Infinity ? null : +stats.minMs.toFixed(3),
        maxMs: stats.maxMs === -Infinity ? null : +stats.maxMs.toFixed(3),
        p95Ms: p95 !== null ? +p95.toFixed(3) : null,
        segments: Object.fromEntries(
          Object.entries(stats.segments).map(([label, seg]) => [
            label,
            {
              count: seg.count,
              avgMs: seg.count > 0 ? +(seg.totalMs / seg.count).toFixed(3) : 0,
              minMs: seg.minMs === Infinity ? null : +seg.minMs.toFixed(3),
              maxMs: seg.maxMs === -Infinity ? null : +seg.maxMs.toFixed(3),
            },
          ]),
        ),
      };
    }
    return result;
  }

  static reset(): void {
    statsMap.clear();
  }
}
