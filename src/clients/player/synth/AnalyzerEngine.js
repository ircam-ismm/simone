import Mfcc from '../../utils/Mfcc.js';

class AnalyzerEngine {
  constructor(audioContext, dataDestination, period, frameSize, sampleRate) {
    this.audioContext = audioContext;
    // where analyzed data will be sent. Either an array (in local mode) 
    // or a shared state (in remote mode)
    this.dataDestination = dataDestination;
    this.period = period;
    this.frameSize = Math.pow(2, Math.round(Math.log2(frameSize))); // clamp to nearest power of 2
    this.sampleRate = sampleRate;

    this.mfccBands = 24;
    this.mfccCoefs = 12;
    this.mfccMinFreq = 50;
    this.mfccMaxFreq = 8000;

    this.mfcc = new Mfcc(this.mfccBands, this.mfccCoefs, this.mfccMinFreq, this.mfccMaxFreq, this.frameSize, this.sampleRate);

    this.active = false // whether or not data is sent out

    this.periodRand = 0.004;
  }

  setNorm(means, std, minRms, maxRms) {
    this.means = means;
    this.std = std;
    this.minRms = minRms;
    this.maxRms = maxRms;
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

  setPeriod(period) {
    this.period = period;
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
    time = Math.max(time, this.audioContext.currentTime);
    //sending data/parsing target part
    if (this.active && this.target) {
      const targetData = this.target.getChannelData(0);
      const idx = Math.floor(this.transportTime*this.sampleRate);
      const grain = targetData.slice(idx, idx+this.frameSize);
      // compute mfcc
      const grainMfcc = this.mfcc.get(grain);
      for (let j = 0; j < 12; j++) {
        grainMfcc[j] = (grainMfcc[j] - this.means[j]) / this.std[j];
      }
      //compute rms
      let grainRms = 0;
      for (let j = 0; j < grain.length; j++) {
        grainRms += grain[j]**2;
      }
      grainRms = Math.sqrt(grainRms/grain.length);
      if (this.maxRms === 0) {
        grainRms = 0;
      } else {
        grainRms = (grainRms - this.minRms)/(this.maxRms - this.minRms);
      }
      
      grainRms = Math.max(Math.min(grainRms, 1), 0);


      this.dataDestination.set({ mosaicingData: [grainMfcc, grainRms] });

      if (this.advanceCallback) {
        this.advanceCallback(this.transportTime / this.target.duration);
      }
    }


    this.transportTime += this.period;
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

    return time + this.period;
  }
};

export default AnalyzerEngine;
