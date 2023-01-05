class BufferSynth {
  constructor(audioContext, waveformWidth) {
    this.audioContext = audioContext;

    this._buffer = null;
    this._wvWidth = waveformWidth; 
    this._duration = null;

    this._selectionStartPos = null; // in px
    this._selectionEndPos = null; // in px
    
    this._loop = false;
    this._loopStart = null; // in s
    this._loopEnd = null; // in s

    this._detune = 0;

    this.timeLastStart = 0;
    this.playing = false;

    this.output = new GainNode(this.audioContext);
    this.output.gain.value = 0.5;

    this.callbacks = {};
  }

  set buffer(buf) {
    this._buffer = buf;
    this._duration = buf.duration;
  }

  set volume(value) {
    this.output.gain.linearRampToValueAtTime(value, this.audioContext.currentTime+0.05);
  }

  set detune(value) {
    this._detune = value;
    if (this.playing) {
      const now = this.audioContext.currentTime;
      this.bufferPlayerNode.detune.setTargetAtTime(value, now, 0.1);
    }
  }

  set loop(flag) {
    this._loop = flag;
    if (this.playing) { // if playing we want to change loop status without disrupting playback
      const now = this.audioContext.currentTime; 
      const selectionLength = this.endTime - this.start;
      let currentBufferTime = now - this.timeLastStart + this.startTime; // get position in time in buffer
      while (currentBufferTime - this.startTime > selectionLength) {
        currentBufferTime -= selectionLength; // modulo if needed;
      }
      // Stop and restart with loop status changed
      clearTimeout(this.nextStop);
      this.bufferPlayerNode.stop(now); // not using this.stop bc this would trigger the 'ended' callback 
      this.play(now, currentBufferTime, true);
    }
  }


  setSelectionLimits(startPos, endPos) {
    const now = this.audioContext.currentTime
    const newSel = startPos !== this._selectionStartPos && endPos !== this._selectionEndPos;
    this._selectionStartPos = startPos;
    this._loopStart = Math.max(0, this._duration * startPos / this._wvWidth);
    this._selectionEndPos = endPos;
    this._loopEnd = Math.max(0, this._duration * endPos / this._wvWidth);
    this._loopEnd = Math.min(this._loopEnd, this._duration);

    if (this.playing && this._loop) {
      if (newSel) {
        this.bufferPlayerNode.stop(now);
        this.play(now);
      } else {
        this.bufferPlayerNode.loopStart = this._loopStart;
        this.bufferPlayerNode.loopEnd = this._loopEnd;
      }
    }
  }

  setLoopLimits(startTime, endTime) {
    const now = this.audioContext.currentTime
    const newSel = startTime !== this.startTime && endTime !== this.endTime;
    this.startTime = startTime;
    this.endTime = endTime;
    if (this.playing && this._loop) {
      if (newSel) {
        this.bufferPlayerNode.stop(now);
        this.play(now);
      } else {
        this.bufferPlayerNode.loopStart = this.startTime;
        this.bufferPlayerNode.loopEnd = this.endTime;
      }
    }
    // this.startIndex = this.timeToIndex(startTime);
    // this.endIndex = this.timeToIndex(endTime);
  }


  connect(dest) {
    this.output.connect(dest);
  }

  play(time, offset, notResetTime) {
    notResetTime = notResetTime ? true : false; // if not specified
    offset = offset ? offset : this.startTime;
    this.bufferPlayerNode = new AudioBufferSourceNode(this.audioContext);
    this.bufferPlayerNode.buffer = this._buffer;
    this.bufferPlayerNode.detune.value = this._detune;
    this.bufferPlayerNode.connect(this.output);
    if (this._loop) {
      this.bufferPlayerNode.loop = true;
      this.bufferPlayerNode.loopStart = this.startTime;
      this.bufferPlayerNode.loopEnd = this.endTime;
      this.start(time, offset);
    } else {
      const dur = this.endTime ? this.endTime - offset : this._duration - offset;

      this.start(time, offset, dur);
    } 
    if (!notResetTime) {
      this.timeLastStart = time;
    }
  }


  start(time, offset, duration) {
    this.playing = true;
    this.bufferPlayerNode.start(time, offset);
    if (duration) {
      const now = this.audioContext.currentTime;
      this.nextStop = setTimeout(() => this.stop(time), (time-now + duration)*1000);
      // this.stop(time+duration);
    }
  }

  stop(time) {
    // this.bufferPlayerNode.addEventListener('ended', event => {
    //   this.playing = false;
    //   const cb = this.callbacks['ended'];
    //   console.log('hello')
    //   cb(event);
    // });

    this.playing = false;
    const cb = this.callbacks['ended'];
    cb();

    this.bufferPlayerNode.stop(time);
  }

  addEventListener(name, callback) {
    this.callbacks[name] = callback;
  }
};

export default BufferSynth;
