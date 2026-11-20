// The lab's receiver, on the audio rendering thread.
import "./kinds.js";
class LabReceiver extends AudioWorkletProcessor {
  constructor() { super(); labReceive(this.port, "audio worklet"); }
  process() { return true; }
}
registerProcessor("lab-receiver", LabReceiver);
