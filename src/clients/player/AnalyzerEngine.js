import Mfcc from 'waves-lfo/common/operator/Mfcc';

class AnalyzerEngine {
  constructor(audioContext, dataDestination, grainPeriod, grainDuration, sampleRate) {
    this.audioContext = audioContext;
    // where analyzed data will be sent. Either an array (in local mode) 
    // or a shared state (in remote mode)
    this.dataDestination = dataDestination;
    this.mode = Array.isArray(dataDestination) ? 'local' : 'remote';
    this.grainPeriod = grainPeriod;
    this.grainDuration = grainDuration;
    this.sampleRate = sampleRate;

    this.mfccBands = 24;
    this.mfccCoefs = 12;
    this.mfccMinFreq = 50;
    this.mfccMaxFreq = 8000;

    this.mfcc = new Mfcc({
      nbrBands: this.mfccBands,
      nbrCoefs: this.mfccCoefs,
      minFreq: this.mfccMinFreq,
      maxFreq: this.mfccMaxFreq,
    });

    this.mfcc.initStream({
      frameSize: grainDuration * sampleRate,
      frameType: 'signal',
      sourceSampleRate: this.sampleRate,
    });

    this.active = false // whether or not data is sent out

    this.periodRand = 0.004;
  }

  setNorm(means, std) {
    this.means = means;
    this.std = std;
  }

  setTarget(targetBuffer) {
    this.target = targetBuffer;
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

  setLoopLimits(startTime, endTime) {
    if (endTime - startTime > 0) {
      this.startTime = startTime;
      this.endTime = endTime;
    }
  }
  
  start() {
    this.transportTime = this.startTime;
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  advanceTime(time) {

    //sending data/parsing target part
    if (this.active && this.target) {
      const targetData = this.target.getChannelData(0);
      const idx = Math.floor(this.transportTime*this.sampleRate);
      const length = this.grainDuration*this.sampleRate;
      const grain = targetData.slice(idx, idx+length);
      const grainMfcc = this.mfcc.inputSignal(grain);
      for (let j = 0; j < 12; j++) {
        grainMfcc[j] = (grainMfcc[j] - this.means[j]) / this.std[j];
      }
      if (this.mode === 'remote') {
        this.dataDestination.set({ mosaicingData: grainMfcc });
      } else {
        this.dataDestination.push(grainMfcc);
      }
    }


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

export default AnalyzerEngine;
