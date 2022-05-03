class Synth {
  constructor(audioContext, grainPeriod, grainDuration, scheduler) {
    this.audioContext = audioContext;
    this.grainPeriod = grainPeriod;
    this.grainDuration = grainDuration;
    this.scheduler = scheduler;

    this.periodRand = 0.004;
  }

  setSearchSpace(kdTree, times) {
    this.kdTree = kdTree;
    this.times = times;
  }

  setModel(model) {
    this.model = model;
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

  start() {
    this.index = 0;

    this.scheduler.add(this, this.audioContext.currentTime);
  }

  stop() {
    if (this.scheduler.has(this)) {
      this.scheduler.remove(this);
    }
  }

  advanceTime(time) {
    // get closest grain index from kdTree
    const desc = this.model[this.index];
    const target = this.kdTree.nn(desc);
    const timeOffset = this.times[target];

    time = Math.max(time, this.audioContext.currentTime);

    const env = this.audioContext.createGain();
    env.connect(this.audioContext.destination);
    env.gain.value = 0;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(1, time + (this.grainDuration / 2));
    env.gain.linearRampToValueAtTime(0, time + this.grainDuration);

    const source = this.audioContext.createBufferSource();
    source.connect(env);
    source.buffer = this.buffer;
    source.start(time, timeOffset, this.grainDuration);
    source.stop(time + this.grainDuration);

    this.index += 1;

    if (this.index < this.model.length) {
      // this.advanceCallback(this.index * this.grainPeriod, timeOffset);

      const rand = Math.random() * this.periodRand - (this.periodRand / 2);
      return time + this.grainPeriod + rand;
    } else {
      // this.clearCallback();
      return undefined; // remove from scheduler
    }
  }
};

export default Synth;
