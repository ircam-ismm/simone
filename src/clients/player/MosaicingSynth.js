class MosaicingSynth {
  constructor(audioContext, grainPeriod, grainDuration, scheduler) {
    this.audioContext = audioContext;
    this.grainPeriod = grainPeriod;
    this.grainDuration = grainDuration;
    this.scheduler = scheduler;

    this.model = {};
    this.crossfade = 1; //crossfading between both target buffer

    this.active = false; // whether or not data is sent out

    // this.loop = false;
    // this._startIndex = 0;
    // this._endIndex = 0;
    // this._maxIndex = 0;

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

  setModel(model, which) {
    this.model[which] = {
      data: model,
      maxIndex: model.length-1,
      startIndex: 0,
      endIndex: this._maxIndex,
    }
  }

  setBuffer(buffer) {
    this.buffer = buffer;
  }

  // setStartCallback(callback) {
  //   this.startCallback = callback;
  // }

  setAdvanceCallback(callback) {
    this.advanceCallback = callback;
  }

  // setClearCallback(callback) {
  //   this.clearCallback = callback;
  // }

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

  pushData(x) {
    this.nextData.push(x);
  }

  connect(dest) {
    this.output.connect(dest);
  }

  start() {
    this.model['A'].index = this.model['A'].startIndex;
    this.model['B'].index = this.model['B'].startIndex;
    // this.index = this._startIndex;

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
      const modelA = this.model['A'];
      const modelB = this.model['B'];
      const mosDataA = modelA.data[modelA.index];
      const mosDataB = modelB.data[modelB.index];
      const mosData = [];
      for (let i = 0; i < mosDataA.length; i++) {
        mosData[i] = this.crossfade*mosDataA[i] + (1-this.crossfade)*mosDataB[i];
      }  
      if (this.targetPlayerState) {
        this.targetPlayerState.set({ mosaicingData: mosData })
      } else {
        this.nextData.push(mosData);
      }
      this.model['A'].index += 1;
      this.model['B'].index += 1;
    }
    
    // playing sound part

    // get closest grain index from kdTree
    // const desc = this.model[this.index];
    const desc = this.nextData.shift();
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
      source.start(time, timeOffset, this.grainDuration);
      source.stop(time + this.grainDuration);


      this.advanceCallback(target / this.times.length);

    }
    
    for (bufLetter in ['A', 'B']) {
      const model = this.model[bufLetter];
      if (model.index > model.endIndex || model.index < model.startIndex) {
        this.model[bufLetter].index = model.startIndex;
      }
    }

    // if (this.index <= this._endIndex && this.index >= this._startIndex) {
    // } else if (this.loop) {
    //   this.index = this._startIndex;
    // } else {
    //   // this.clearCallback();
    //   if (this.active) {
    //     this.clearCallback();
    //   }
    //   this.active = false;
    //   // return undefined; // remove from scheduler
    // }

    const rand = Math.random() * this.periodRand - (this.periodRand / 2);
    return time + this.grainPeriod + rand;
  }
};

export default MosaicingSynth;
