// script de
function getSynth() {
  return class CustomSynth {
    constructor(audioContext) {
      this.audioContext = audioContext;

      // Array to store all sound sources
      this.sources = [];

      // Create nodes 
      this.output = new GainNode(audioContext); 
      this.gain = new GainNode(this.audioContext);
      this.gain.gain.setValueAtTime(0, this.audioContext.currentTime);
      this.osc = new OscillatorNode(audioContext);
      this.osc.type = 'sine';
      this.osc.frequency.setValueAtTime(0, this.audioContext.currentTime);
      this.sources.push(this.osc);

      // Connect nodes to output
      this.gain.connect(this.output);
      this.osc.connect(this.gain);
    }

    inMicFreq(value) {
      this.osc.frequency.setTargetAtTime(value, this.audioContext.currentTime, 0.05);
    }

    inMicRms(value) {
      this.gain.gain.setTargetAtTime(value * 10, this.audioContext.currentTime, 0.05)
    }

    connect(dest) {
      this.output.connect(dest);
    }

    disconnect(dest) {
      this.output.disconnect(dest);
    }

    start(time) {
      this.sources.forEach(src => {src.start(time)});
    }

    stop(time) {
      this.sources.forEach(src => {src.stop(time)});
    }
  }
}