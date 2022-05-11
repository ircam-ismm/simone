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

  set loop(flag) {
    this._loop = flag;
    if (this.playing) { // if playing we want to change loop status without disrupting playback
      const now = this.audioContext.currentTime; 
      const selectionLength = this._loopEnd - this._loopStart;
      let currentBufferTime = now - this.timeLastStart + this._loopStart; // get position in time in buffer
      while (currentBufferTime - this._loopStart > selectionLength) {
        currentBufferTime -= selectionLength; // modulo if needed
      }
      // Stop and restart with loop status changed
      clearTimeout(this.nextStop);
      this.bufferPlayerNode.stop(now); // not using this.stop bc this would trigger the 'ended' callback 
      this.play(now, currentBufferTime, true);
    }
  }


  setSelectionLimits(startPos, endPos) {
    const now = this.audioContext.currentTime
    const currentPlayingPos = now - this.timeLastStart + this._loopStart;
    this._selectionStartPos = startPos;
    this._loopStart = Math.max(0, this._duration * startPos / this._wvWidth);
    this._selectionEndPos = endPos;
    this._loopEnd = Math.max(0, this._duration * endPos / this._wvWidth);

    if (this.playing && this._loop) {
      const now = this.audioContext.currentTime; 
      const selectionLength = this._loopEnd - this._loopStart;
      let currentBufferTime = now - this.timeLastStart + this._loopStart; // get position in time in buffer
      while (now - this.timeLastStart > selectionLength) {
        this.timeLastStart += selectionLength; // modulo if needed
      }
      if (currentBufferTime >= this._loopStart && currentBufferTime <= this._loopEnd) {
        this.bufferPlayerNode.stop(now); // not using this.stop bc this would trigger the 'ended' callback
        this.play(now, currentBufferTime, true);
      } else {
        this.bufferPlayerNode.stop(now);
        this.play(now);
      }
    }
  }

  // setSelectionLimits(startPos, endPos) {
  //   const now = this.audioContext.currentTime
  //   const currentPlayingPos = now - this.timeLastStart + this._loopStart;
  //   this._selectionStartPos = startPos;
  //   this._loopStart = Math.max(0, this._duration * startPos / this._wvWidth);
  //   this._selectionEndPos = endPos;
  //   this._loopEnd = Math.max(0, this._duration * endPos / this._wvWidth);

  //   if (this.playing) {
  //     this.bufferPlayerNode.stop(now); // not using this.stop bc this would trigger the 'ended' callback
  //     this.play(now, undefined, true);
  //   }
  // }


  connect(dest) {
    this.output.connect(dest);
  }

  play(time, offset, notResetTime) {
    notResetTime = notResetTime ? true : false; // if not specified
    offset = offset ? offset : this._loopStart;
    this.bufferPlayerNode = new AudioBufferSourceNode(this.audioContext);
    this.bufferPlayerNode.buffer = this._buffer;
    this.bufferPlayerNode.connect(this.output);
    if (this._loop) {
      this.bufferPlayerNode.loop = true;
      this.bufferPlayerNode.loopStart = this._loopStart;
      this.bufferPlayerNode.loopEnd = this._loopEnd;
      this.start(time, offset);
    } else {
      this.start(time, offset, this._loopEnd - offset);
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
    this.bufferPlayerNode.addEventListener('ended', event => {
      this.playing = false;
      const cb = this.callbacks['ended'];
      cb(event);
    });

    this.bufferPlayerNode.stop(time);
  }

  addEventListener(name, callback) {
    this.callbacks[name] = callback;
  }
};

export default BufferSynth;
