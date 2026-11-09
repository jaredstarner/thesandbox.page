// The audio thread. The signal is computed here, sample-accurately, and sent two ways: to the
// speakers, and to the page, which draws exactly the same numbers.

import { Signal, type Command } from './_signal';

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

// About 190 packets a second, whatever rate the device runs at.
const PACKET = sampleRate > 60000 ? 512 : 256;

class SignalProcessor extends AudioWorkletProcessor {
  private readonly signal = new Signal(sampleRate);
  private packet = new Float32Array(PACKET * 2);
  private fill = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Command>) => this.signal.apply(e.data);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] ?? out[0];
    const input = inputs[0];
    this.signal.render(left, right, left.length, input?.[0], input?.[1]);
    for (let i = 0; i < left.length; i++) {
      this.packet[this.fill++] = left[i];
      this.packet[this.fill++] = right[i];
      if (this.fill === this.packet.length) {
        const send = this.packet;
        this.port.postMessage({ samples: send, status: this.signal.status() }, [send.buffer]);
        this.packet = new Float32Array(PACKET * 2);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('xy-signal', SignalProcessor);
