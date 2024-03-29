class SynthEngine {
  constructor(audioContext, grainPeriod, grainDuration, random, sampleRate) {
    this.audioContext = audioContext;
    this.grainPeriod = grainPeriod;
    this.grainDuration = grainDuration;
    this.random = random;
    this.sampleRate = sampleRate;

    this.jitter = 0.004;

    this.playing = false;

    this._randomizer = 1;
    this._detune = 0;
    this.rmsGain = new GainNode(this.audioContext);
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

  set randomizer(value) {
    this._randomizer = value;
  }

  setGrainDuration(grainDuration) {
    // grainDuration = grainDuration * this.sampleRate;
    // grainDuration = Math.pow(2,Math.round(Math.log2(grainDuration)));
    this.grainDuration = grainDuration;
  }

  setGrainPeriod(grainPeriod) {
    this.grainPeriod = grainPeriod;
  }
  
  pushData(x) {
    this.nextData.push(x);
  }

  postData(x) {
    this.currGrainMfcc = x[0];
    this.currGrainRms = x[1];
  }

  connect(dest) {
    this.output.connect(dest);
  }

  start() {
    this.playing = true;
  }

  stop() {
    this.playing = false;
  }

  advanceTime(time) {
    time = Math.max(time, this.audioContext.currentTime);
    // playing sound part
    // get closest grain index from kdTree
    if (this.currGrainMfcc && this.playing && this.kdTree) {
      // const target = this.kdTree.nn(this.currGrainMfcc);
      const targets = this.kdTree.knn(this.currGrainMfcc, this._randomizer);
      const randK = Math.floor(Math.random() * this._randomizer);
      const target = targets[randK];
      const timeOffset = this.times[target];

      const rand = Math.random() * this.jitter;
      const now = time + rand;

      const rmsGain = new GainNode(this.audioContext);
      rmsGain.connect(this.output);
      rmsGain.gain.value = this.currGrainRms;

      const env = this.audioContext.createGain();
      env.connect(rmsGain);
      env.gain.value = 0;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(1, now + (this.grainDuration / 2));
      env.gain.linearRampToValueAtTime(0, now + this.grainDuration);

      const source = this.audioContext.createBufferSource();
      source.connect(env);
      source.buffer = this.buffer;
      source.detune.value = this._detune;
      source.start(now, timeOffset, this.grainDuration);
      source.stop(now + this.grainDuration);

      if (this.advanceCallback) {
        this.advanceCallback(target / this.times.length);
      }
      
    }
    
    return time + this.grainPeriod;
  }
};

export default SynthEngine;
