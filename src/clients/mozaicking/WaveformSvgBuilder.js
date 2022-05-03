class WaveformSvgBuilder {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  loadBuffer(buffer){
    this.buffer = buffer;
    this.bufferDuration = this.buffer.getChannelData(0).length / this.buffer.sampleRate;
    this.startTime = 0;
    this.endTime = this.bufferDuration;
  }

  getFileDuration() {
    return this.bufferDuration;
  }

  setTimeLimits(start, end) {
    this.startTime = start;
    this.endTime = end;
  }

  ordinateToPix(y) {
    return (1 - y)*this.height/2;
  }

  getWaveformLimits() {
    //average and normalize
    let maxVal = 0;
    const avgBuffer = [];


    if (this.buffer.numberOfChannels > 1) {
      const chan1 = this.buffer.getChannelData(0);
      const chan2 = this.buffer.getChannelData(1);
      for (let i = 0; i < chan1.length; i++) {
        const val1 = chan1[i];
        const val2 = chan2[i];
        const avg = (val1 + val2) / 2;
        if (maxVal < Math.abs(avg)) {
          maxVal = Math.abs(avg);
        }
        avgBuffer.push(avg);
      }
    } else {
      const chan1 = this.buffer.getChannelData(0);
      for (let i = 0; i < chan1.length; i++) {
        const val = chan1[i];
        if (maxVal < Math.abs(val)) {
          maxVal = Math.abs(val);
        }
        avgBuffer.push(val);
      }
    }
    
    const normBuffer = avgBuffer.map(val => {
      return val/maxVal;
    });

    const startIdx = this.startTime * this.buffer.sampleRate;
    const endIdx = this.endTime * this.buffer.sampleRate;
    const idxStep = Math.floor((endIdx-startIdx)/this.width);
    
    const waveformLimits = [];
    
    for (let pix = 0; pix < this.width; pix++) {
      let sliceData
    
      if (pix === this.width-1){
        sliceData = normBuffer.slice(startIdx + pix*idxStep, endIdx);
      } else {
        sliceData = normBuffer.slice(startIdx + pix*idxStep, startIdx + (pix+1)*idxStep);
      }

      let min = 1;
      let max = -1;

      //get min/max of average
      for (let i = 0; i<sliceData.length; i++) {
        const val = sliceData[i];
        if (val < min) {
          min = val;
        }
        if (val > max) {
          max = val;
        }
      }

      waveformLimits.push([this.ordinateToPix(min), this.ordinateToPix(max)]);
    }

    return waveformLimits;
  }
}

export default WaveformSvgBuilder;