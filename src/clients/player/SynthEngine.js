class SynthEngine {
  constructor(audioContext, dataArray, grainPeriod, grainDuration, sampleRate) {
    this.audioContext = audioContext;
    this.dataArray = dataArray;
    this.grainPeriod = grainPeriod;
    this.grainDuration = grainDuration;
    this.sampleRate = sampleRate;

    this.periodRand = 0.004;

    this._detune = 0;
    this.output = new GainNode(this.audioContext);
    this.output.gain.value = 0.5;
  }

  setSearchSpace(kdTree, times) {
    this.kdTree = kdTree;
    this.times = times;
  }

  setBuffer(buffer) {
    this.buffer = buffer;
  }

  setStartCallback(callback) {
    this.startCallback = callback;
  }

  setAdvanceCallback(callback) {
    this.advanceCallback = callback;
  }

  setClearCallback(callback) {
    this.clearCallback = callback;
  }

  set volume(value) {
    this.output.gain.linearRampToValueAtTime(value, this.audioContext.currentTime + 0.05);
  }

  set detune(value) {
    this._detune = value;
  }

  setGrainDuration(grainDuration) {
    grainDuration = grainDuration * this.sampleRate;
    grainDuration = Math.pow(2,Math.round(Math.log2(grainDuration)));
  }

  setGrainPeriod(grainPeriod) {
    this.grainPeriod = grainPeriod;
  }
  
  pushData(x) {
    this.nextData.push(x);
  }

  connect(dest) {
    this.output.connect(dest);
  }

  start() {
  }

  stop() {
  }

  advanceTime(time) {
    // playing sound part
    // get closest grain index from kdTree
    console.log(this.dataArray.length);
    const desc = this.dataArray.shift();
    if (desc) {
      const target = this.kdTree.nn(desc);
      const timeOffset = this.times[target];

      time = Math.max(time, this.audioContext.currentTime);

      const env = this.audioContext.createGain();
      env.connect(this.output);
      env.gain.value = 0;
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(1, time + (this.grainDuration / 2));
      env.gain.linearRampToValueAtTime(0, time + this.grainDuration);

      const source = this.audioContext.createBufferSource();
      source.connect(env);
      source.buffer = this.buffer;
      source.detune.value = this._detune;
      source.start(time, timeOffset, this.grainDuration);
      source.stop(time + this.grainDuration);

      // if (this.advanceCallback) {
      //   this.advanceCallback(this.transportTime / this.target.duration, target / this.times.length);
      // }
      
    }
    
    const rand = Math.random() * this.periodRand - (this.periodRand / 2);
    return time + this.grainPeriod + rand;
  }
};

export default SynthEngine;
