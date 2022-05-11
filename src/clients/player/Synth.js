class Synth {
  constructor(audioContext, grainPeriod, grainDuration, scheduler) {
    this.audioContext = audioContext;
    this.grainPeriod = grainPeriod;
    this.grainDuration = grainDuration;
    this.scheduler = scheduler;

    this.loop = false;
    this._startIndex = 0;
    this._endIndex = 0;
    this._maxIndex = 0;

    this.periodRand = 0.004;

    this.output = new GainNode(this.audioContext);
    this.output.gain.value = 0.5;
  }

  setSearchSpace(kdTree, times) {
    this.kdTree = kdTree;
    this.times = times;
  }

  setModel(model) {
    this.model = model;
    this._maxIndex = model.length-1;
    this._endIndex = this._maxIndex;
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
    this.output.gain.linearRampToValueAtTime(value, this.audioContext.currentTime+0.05);
  }

  //Looping functions
  set startIndex(value) {
    if (Number.isInteger(value) && value >= 0 && value < this._maxIndex) {
      this._startIndex = value;
      // this.index = this._startIndex;
    }
  }

  set endIndex(value) {
    if (Number.isInteger(value) && value >= 0 && value <= this._maxIndex) {
      this._endIndex = value;
      // this.index = this._startIndex;
    }
  }

  setLoopLimits(posStart, posEnd, wvWidth) {
    this.startIndex = Math.floor(this._maxIndex * posStart / wvWidth);
    this.endIndex = Math.ceil(this._maxIndex * posEnd / wvWidth); 
  }


  connect(dest) {
    this.output.connect(dest);
  }

  start() {
    this.index = this._startIndex;

    if (this.scheduler.has(this)) {
      this.scheduler.remove(this);
    }
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
    env.connect(this.output);
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

    this.advanceCallback(target / this.times.length, this.index / this.model.length);

    if (this.index <= this._endIndex && this.index >= this._startIndex) {
      const rand = Math.random() * this.periodRand - (this.periodRand / 2);
      return time + this.grainPeriod + rand;
    } else if (this.loop) {
      this.index = this._startIndex;
      const rand = Math.random() * this.periodRand - (this.periodRand / 2);
      return time + this.grainPeriod + rand;
    } else {
      // this.clearCallback();
      return undefined; // remove from scheduler
    }
  }
};

export default Synth;
