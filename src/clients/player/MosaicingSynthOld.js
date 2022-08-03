class MosaicingSynth {
  constructor(audioContext, grainPeriod, grainDuration, scheduler) {
    this.audioContext = audioContext;
    this.grainPeriod = grainPeriod;
    this.grainDuration = grainDuration;
    this.scheduler = scheduler;

    this.active = false // whether or not data is sent out

    this.loop = true;
    this._startIndex = 0;
    this._endIndex = 0;
    this._maxIndex = 0;

    this.periodRand = 0.004;

    this.nextData = [];
    this.targetPlayerState = null;

    this.output = new GainNode(this.audioContext);
    this.output.gain.value = 0.5;

    this.scheduler.add(this, this.audioContext.currentTime);
  }

  setSearchSpace(kdTree, times) {
    this.kdTree = kdTree;
    this.times = times;
  }

  setModel(model, bufferDuration) {
    this.model = model;
    this._maxIndex = model.length - 1;
    this._endIndex = this._maxIndex;
    this.targetDuration = bufferDuration;
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

  //Looping functions
  set startIndex(value) {
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

  setLoopLimits(startTime, endTime) {
    this.startIndex = this.timeToIndex(startTime);
    this.endIndex = this.timeToIndex(endTime);
  }
  

  pushData(x) {
    this.nextData.push(x);
  }
  
  timeToIndex(t) {
    return Math.round(t/this.grainPeriod);
  }

  indexToTimeSource(i) {
    return this.times[i];
  }
  

  connect(dest) {
    this.output.connect(dest);
  }

  start() {
    this.index = this._startIndex;

    this.active = true;

    // if (this.scheduler.has(this)) {
    //   this.scheduler.remove(this);
    // }

  }

  stop() {

    this.active = false;
    // if (this.scheduler.has(this)) {
    //   this.scheduler.remove(this);
    // }
  }

  advanceTime(time) {

    //sending data/parsing target part

    if (this.active) {
      if (this.targetPlayerState) {
        this.targetPlayerState.set({ mosaicingData: this.model[this.index] })
      } else {
        this.nextData.push(this.model[this.index]);
      }
      this.index += 1;
    }

    // playing sound part

    // get closest grain index from kdTree
    // const desc = this.model[this.index];
    const desc = this.nextData.shift();
    if (desc) {
      console.log(desc)
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


      this.advanceCallback(this.index / this.model.length, target / this.times.length);

    }

    if (this.index <= this._endIndex && this.index >= this._startIndex) {
    } else if (this.loop) {
      this.index = this._startIndex;
    } else {
      // this.clearCallback();
      if (this.active) {
        // this.clearCallback();
      }
      this.active = false;
      // return undefined; // remove from scheduler
    }

    const rand = Math.random() * this.periodRand - (this.periodRand / 2);
    return time + this.grainPeriod + rand;
  }
};

export default MosaicingSynth;
