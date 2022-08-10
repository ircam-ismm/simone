import Mfcc from './Mfcc.js';

class MosaicingSynth {
  constructor(audioContext, grainPeriod, grainDuration, scheduler, sampleRate) {
    this.audioContext = audioContext;
    this.grainPeriod = grainPeriod;
    this.grainDuration = grainDuration;
    this.scheduler = scheduler;
    this.sampleRate = sampleRate;

    this.mfccBands = 24;
    this.mfccCoefs = 12;
    this.mfccMinFreq = 50;
    this.mfccMaxFreq = 8000;

    this.mfcc = new Mfcc(this.mfccBands, this.mfccCoefs, this.mfccMinFreq, this.mfccMaxFreq, this.frameSize, this.sourceSampleRate);

    this.active = false // whether or not data is sent out

    // this.loop = true;
    // this._startIndex = 0;
    // this._endIndex = 0;
    // this._maxIndex = 0;

    this.periodRand = 0.004;

    this.nextData = [];
    this.targetPlayerState = null;

    this._detune = 0;
    this.output = new GainNode(this.audioContext);
    this.output.gain.value = 0.5;

    this.scheduler.add(this, this.audioContext.currentTime);
  }

  setSearchSpace(kdTree, times) {
    this.kdTree = kdTree;
    this.times = times;
  }

  // setModel(model, bufferDuration) {
  //   this.model = model;
  //   this._maxIndex = model.length - 1;
  //   this._endIndex = this._maxIndex;
  //   this.targetDuration = bufferDuration;
  // }

  setNorm(means, std) {
    this.means = means;
    this.std = std;
  }

  setTarget(targetBuffer) {
    this.target = targetBuffer;
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
    this.grainDuration = grainDuration / this.sampleRate;
    this.mfcc.initStream({
      frameSize: grainDuration,
      frameType: 'signal',
      sourceSampleRate: this.sampleRate,
    });
  }

  setGrainPeriod(grainPeriod) {
    this.grainPeriod = grainPeriod;
  }

  //Looping functions
  // set startIndex(value) {
  //   if (Number.isInteger(value) && value >= 0 && value < this._maxIndex) {
  //     this._startIndex = value;
  //     // this.index = this._startIndex;
  //   }
  // }

  // set endIndex(value) {
  //   if (Number.isInteger(value) && value >= 0 && value <= this._maxIndex) {
  //     this._endIndex = value;
  //     // this.index = this._startIndex;
  //   }
  // }

  setLoopLimits(startTime, endTime) {
    if (endTime - startTime > 0) {
      this.startTime = startTime;
      this.endTime = endTime;
    }
    // this.startTime = startTime;
    // this.endTime = endTime;
    // console.log(this.startTime, this.endTime, this.endTime-this.startTime);
    // this.startIndex = this.timeToIndex(startTime);
    // this.endIndex = this.timeToIndex(endTime);
  }
  
  pushData(x) {
    this.nextData.push(x);
  }
  
  // timeToIndex(t) {
  //   return Math.round(t/this.grainPeriod);
  // }

  // indexToTimeSource(i) {
  //   return this.times[i];
  // }

  connect(dest) {
    this.output.connect(dest);
  }

  start() {
    // this.index = this._startIndex;
    this.transportTime = this.startTime;

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

    if (this.active && this.target) {
      // if (this.targetPlayerState) {
      //   this.targetPlayerState.set({ mosaicingData: this.model[this.index] })
      // } else {
      //   this.nextData.push(this.model[this.index]);
      // }
      // this.index += 1;
      const targetData = this.target.getChannelData(0);
      const idx = Math.floor(this.transportTime*this.sampleRate);
      const length = this.grainDuration*this.sampleRate;
      const grain = targetData.slice(idx, idx+length);
      const grainMfcc = this.mfcc.get(grain);
      for (let j = 0; j < 12; j++) {
        grainMfcc[j] = (grainMfcc[j] - this.means[j]) / this.std[j];
      }
      if (this.targetPlayerState) {
        this.targetPlayerState.set({ mosaicingData: grainMfcc });
      } else {
        this.nextData.push(grainMfcc);
      }
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
      source.detune.value = this._detune;
      source.start(time, timeOffset, this.grainDuration);
      source.stop(time + this.grainDuration);

      if (this.advanceCallback) {
        this.advanceCallback(this.transportTime / this.target.duration, target / this.times.length);
      }
      
    }

    // if (this.index <= this._endIndex && this.index >= this._startIndex) {
    // } else if (this.loop) {
    //   this.index = this._startIndex;
    // } else {
    //   // this.clearCallback();
    //   if (this.active) {
    //     // this.clearCallback();
    //   }
    //   this.active = false;
    //   // return undefined; // remove from scheduler
    // }

    

    const rand = Math.random() * this.periodRand - (this.periodRand / 2);
    this.transportTime += this.grainPeriod + rand;
    const loopDuration = this.endTime - this.startTime;
    if (this.transportTime < this.startTime) {
      while (this.transportTime < this.startTime) {
        this.transportTime += loopDuration;
      }
    }
    if (this.transportTime > this.endTime) {
      while (this.transportTime > this.endTime) {
        this.transportTime -= loopDuration;
      }
    }

    return time + this.grainPeriod + rand;
  }
};

export default MosaicingSynth;
