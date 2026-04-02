/**
 * Loadcell Sample Simulator
 *
 * Generates synthetic 4-channel load cell readings at 40 Hz for a fixed
 * duration, feeds them through a dedicated Pipeline instance, and broadcasts
 * both processed frame messages and raw loadcell value messages via the
 * WebSocket broadcaster.
 *
 * Used when the dashboard is connected to an ESP32 that has zero physical
 * load cells wired, allowing users to verify the full processing pipeline
 * (COP trajectory, force distribution chart, all metric cards) without
 * real hardware.
 *
 * The simulator uses its own Pipeline configured with warmupMs: 0 so that
 * metrics appear immediately rather than after a 2-second warmup.
 */

import { Pipeline, RawForceData, DEFAULT_CONFIG } from '@force-plate/processing';
import { WsBroadcaster } from './ws-server.js';

export class LoadcellSampleSimulator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private pipeline: Pipeline;
  private sampleIndex = 0;
  private startTime = 0;

  private readonly sampleRate = 40;
  /** Duration of one sample run in ms */
  private readonly durationMs = 10_000;

  constructor(
    private ws: WsBroadcaster,
    private channelCount: number = 4,
  ) {
    // Fresh pipeline with no warmup — metrics appear on the first window fill
    this.pipeline = new Pipeline({
      ...DEFAULT_CONFIG,
      sampleRate: this.sampleRate,
      warmupMs: 0,
    });
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Start a simulation run.
   * @param onDone Called when the run completes naturally (after durationMs).
   */
  start(onDone: () => void): void {
    if (this.isRunning()) return;

    this.pipeline.reset();
    this.pipeline.startSession(Date.now());
    this.startTime = Date.now();
    this.sampleIndex = 0;

    this.intervalId = setInterval(() => {
      if (Date.now() - this.startTime >= this.durationMs) {
        this._finish(onDone);
        return;
      }

      const data = this._generateSample();
      const frame = this.pipeline.processSample(data);

      this.ws.broadcastFrame(frame);
      this.ws.broadcastLoadcellValues(0, this.channelCount, [data.f0, data.f1, data.f2, data.f3]);
    }, 1000 / this.sampleRate);
  }

  /** Stop the simulation early. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.pipeline.stopSession();
  }

  private _finish(onDone: () => void): void {
    this.stop();
    onDone();
  }

  /**
   * Generate one synthetic RawForceData frame.
   *
   * Simulates natural postural sway as a Lissajous-like COP trajectory,
   * then distributes the total load across the 4 corners accordingly.
   */
  private _generateSample(): RawForceData {
    const t = Date.now() - this.startTime;
    const time = this.sampleIndex++ / this.sampleRate;

    // ~50 kg standing load expressed in HX711 raw counts (calibrated scale)
    const baseLoad = 125_000;

    // Smooth Lissajous sway (irrational frequency ratio avoids repeating loops)
    const copX = 0.04 * Math.sin(2 * Math.PI * 0.30 * time)
               + 0.01 * Math.sin(2 * Math.PI * 0.73 * time);
    const copY = 0.04 * Math.cos(2 * Math.PI * 0.21 * time)
               + 0.01 * Math.cos(2 * Math.PI * 0.51 * time);

    // Small sensor noise
    const noise = () => (Math.random() - 0.5) * baseLoad * 0.004;

    return {
      t,
      f0: baseLoad * (1 - copX + copY) / 4 + noise(),  // front-left
      f1: baseLoad * (1 + copX + copY) / 4 + noise(),  // front-right
      f2: baseLoad * (1 - copX - copY) / 4 + noise(),  // back-left
      f3: baseLoad * (1 + copX - copY) / 4 + noise(),  // back-right
    };
  }
}
