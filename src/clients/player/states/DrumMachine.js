import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import Mfcc from 'waves-lfo/common/operator/Mfcc';
import WaveformDisplay from '../WaveformDisplay';
import createKDTree from 'static-kdtree';
import MosaicingSynth from '../MosaicingSynth';
import AnalyzerEngine from '../AnalyzerEngine';
import SynthEngine from '../SynthEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';

export default class DrumMachine extends State {
  constructor(name, context) {
    super(name, context);

    this.currentSource = null;
    this.currentTarget = null;

    // parameters for audio analysis
    this.frameSize = 4096;
    this.hopSize = 512;
    this.sourceSampleRate = this.context.audioContext.sampleRate;
    this.mfccBands = 24;
    this.mfccCoefs = 12;
    this.mfccMinFreq = 50;
    this.mfccMaxFreq = 8000;

    // Mosaicing
    this.bpm = 120; 
    this.nFramesBeat = 8; // length of the looping section (in number of frames)
    this.maxNFramesBeat = 32 // maximum length of looping section (in n of frames)

    // Waveform display
    this.waveformWidth = 800;
    this.waveformHeightSource = 200;
    this.waveformHeightTarget = 150;

    this.targetPlayerState = this.context.participant;
  }

  async enter() {
    // Microphone handling
    this.context.mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) {
        this.context.fileReader.readAsArrayBuffer(e.data);
      };
    });

    this.context.fileReader.addEventListener('loadend', async () => {
      const audioBuffer = await this.context.audioContext.decodeAudioData(this.context.fileReader.result);
      this.recordedBuffer = audioBuffer;
      this.recorderDisplay.setBuffer(audioBuffer);
    });

    // Waveforms display
    this.sourceDisplay = new WaveformDisplay(this.waveformHeightSource, this.waveformWidth, false, true);
    this.targetDisplay = new WaveformDisplay(this.waveformHeightTarget, this.waveformWidth, true, true, false);
    this.recorderDisplay = new WaveformDisplay(this.waveformHeightTarget, this.waveformWidth, false, false);

    // Callback for when selection on the display is moved
    this.targetDisplay.setCallbackSelectionChange((start, end) => {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.analyzerEngine.setLoopLimits(start, end);
    });

    // MFCC analyzer 
    this.mfcc = new Mfcc({
      nbrBands: this.mfccBands,
      nbrCoefs: this.mfccCoefs,
      minFreq: this.mfccMinFreq,
      maxFreq: this.mfccMaxFreq,
    });
    this.mfcc.initStream({
      frameSize: this.frameSize,
      frameType: 'signal',
      sourceSampleRate: this.sourceSampleRate,
    });

    // Mosaicing synth
    const getTimeFunction = () => this.context.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);

    this.grainPeriod = this.hopSize / this.sourceSampleRate;
    this.grainDuration = this.frameSize / this.sourceSampleRate;
    this.sharedArray = []; 
    this.analyzerEngine = new AnalyzerEngine(this.context.audioContext, this.sharedArray, this.grainPeriod, this.grainDuration, this.sourceSampleRate);
    this.synthEngine = new SynthEngine(this.context.audioContext, this.sharedArray, this.grainPeriod, this.grainDuration, this.sourceSampleRate);
    this.synthEngine.connect(this.context.audioContext.destination);
    this.scheduler.add(this.analyzerEngine, this.context.audioContext.currentTime);
    this.scheduler.add(this.synthEngine, this.context.audioContext.currentTime);
    // this.mosaicingSynth = new MosaicingSynth(this.context.audioContext, this.grainPeriod, this.grainDuration, this.scheduler, this.sourceSampleRate);
    // this.mosaicingSynth.connect(this.context.audioContext.destination);

    // Callback for displaying cursors
    // this.mosaicingSynth.setAdvanceCallback((targetPosPct, sourcePosPct) => {
      // this.targetDisplay.setCursorTime(this.currentTarget.duration * targetPosPct);
      // this.sourceDisplay.setCursorTime(this.currentSource.duration * sourcePosPct);
    // });

  }

  setSourceFile(sourceBuffer) {
    console.log("loading source");
    this.currentSource = sourceBuffer;
    if (sourceBuffer) {
      const [mfccFrames, times] = this.computeMfcc(sourceBuffer);
      const searchTree = createKDTree(mfccFrames);
      console.log("Tree created")
      this.synthEngine.setBuffer(sourceBuffer);
      this.synthEngine.setSearchSpace(searchTree, times);
      this.sourceDisplay.setBuffer(sourceBuffer);
    }
  }

  setTargetFile(targetBuffer) {
    this.currentTarget = targetBuffer;
    if (targetBuffer) {
      const analysis = this.computeMfcc(targetBuffer);
      this.analyzerEngine.setTarget(targetBuffer);
      this.analyzerEngine.setNorm(analysis[2], analysis[3]); // values for normalization of data
      this.targetDisplay.setBuffer(targetBuffer);
      // setting looping section back to 0
      this.targetDisplay.setSelectionStartTime(0);
      this.targetDisplay.setSelectionLength(this.nFramesBeat * this.frameSize / this.sourceSampleRate);
      this.selectionLength = this.nFramesBeat * this.frameSize / this.sourceSampleRate;
    }
  }

  computeMfcc(buffer) { // make aynchronous ?
    console.log("analysing file");
    const mfccFrames = [];
    const times = [];
    const means = new Float32Array(this.mfccCoefs);
    const std = new Float32Array(this.mfccCoefs);
    const channelData = buffer.getChannelData(0);

    for (let i = 0; i < buffer.length; i += this.hopSize) {
      const frame = channelData.subarray(i, i + this.frameSize);
      times.push(i / this.sourceSampleRate);
      const cepsFrame = this.mfcc.inputSignal(frame);
      mfccFrames.push(Array.from(cepsFrame));
      for (let j = 0; j < this.mfccCoefs; j++) {
        means[j] += cepsFrame[j];
      }
    }
    // get means and std
    for (let j = 0; j < this.mfccCoefs; j++) {
      means[j] /= mfccFrames.length;
    }
    for (let i = 0; i < mfccFrames.length; i++) {
      const cepsFrame = mfccFrames[i];
      for (let j = 0; j < this.mfccCoefs; j++) {
        std[j] += (cepsFrame[j] - means[j]) ** 2
      }
    }
    for (let j = 0; j < this.mfccCoefs; j++) {
      std[j] /= mfccFrames.length;
      std[j] = Math.sqrt(std[j]);
    }

    // normalize
    for (let i = 0; i < mfccFrames.length; i++) {
      for (let j = 0; j < this.mfccCoefs; j++) {
        mfccFrames[i][j] = (mfccFrames[i][j] - means[j]) / std[j];
      }
    }
    console.log('analysis done');
    return [mfccFrames, times, means, std];
  }

  transportSourceFile(state) {
    // callback for handling transport buttons on source sound display
    switch (state) {
      case 'play':
        this.sourcePlayerNode = new AudioBufferSourceNode(this.context.audioContext);
        this.sourcePlayerNode.buffer = this.currentSource;
        this.sourcePlayerNode.connect(this.context.audioContext.destination);

        this.sourcePlayerNode.start();

        this.sourcePlayerNode.addEventListener('ended', event => {
          const $transportSource = document.querySelector('#transport-source');
          $transportSource.state = 'stop';
        });
        break;
      case 'stop':
        this.sourcePlayerNode.stop();
        break;
    }
  }

  transportRecordFile(state) {
    // callback for handling transport buttons on transport sound display
    switch (state) {
      case 'play':
        this.recorderPlayerNode = new AudioBufferSourceNode(this.context.audioContext);
        this.recorderPlayerNode.buffer = this.recordedBuffer;
        this.recorderPlayerNode.connect(this.context.audioContext.destination);

        this.recorderPlayerNode.start();

        this.recorderPlayerNode.addEventListener('ended', event => {
          const $transportSource = document.querySelector('#transport-recorder');
          $transportSource.state = 'stop';
        });
        break;
      case 'stop':
        this.recorderPlayerNode.stop();
        break;
    }
  }

  transportMosaicing(state) {
    // Callback for handling transport buttons for mosaicing
    switch (state) {
      case 'play':
        // Mosaicing must start at a time synced with the other players
        const beatLength = this.nFramesBeat * this.frameSize / this.sourceSampleRate;
        const currentSyncTime = this.context.sync.getSyncTime();
        const nextStartTime = Math.ceil(currentSyncTime / beatLength) * beatLength;
        const nextStartTimeLocal = this.context.sync.getLocalTime(nextStartTime);
        this.scheduler.defer(() => this.analyzerEngine.start(), nextStartTimeLocal);
        break;
      case 'stop':
        this.analyzerEngine.stop();
        break;
    }
  }

  changeSelectionLength(type) {
    // Callback for changing length of looping section (*2 or /2)
    if (type === 'longer') {
      const newLength = this.selectionLength * 2;
      // New looping section must not go out of bounds and is cannot exceed max value
      if (this.nFramesBeat * 2 <= this.maxNFramesBeat && this.selectionStart + newLength < this.currentTarget.duration) {
        this.nFramesBeat *= 2;
        this.selectionLength = this.nFramesBeat * this.frameSize / this.sourceSampleRate;
        this.targetDisplay.setSelectionLength(this.selectionLength);
      }
    } else {
      // New looping section must not last less than a frame long
      if (this.nFramesBeat / 2 >= 1) {
        this.nFramesBeat /= 2;
        this.selectionLength = this.nFramesBeat * this.frameSize / this.sourceSampleRate;
        this.targetDisplay.setSelectionLength(this.selectionLength);
      }

    }

  }


  render() {
    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.checkinId}]</h1>
        </div>

        <div style="padding-left: 20px; padding-right: 20px">
          <h3>Target</h3>

          <div style="position: relative">
            ${this.targetDisplay.render()}
            <sc-button
              style="
                position: absolute;
                bottom: 10px;
                left: 10px;
              "
              width="40";
              text="*2"
              @input="${e => this.changeSelectionLength("longer")}"
            ></sc-button>
            <sc-button
              style="
                position: absolute;
                bottom: 10px;
                left: 55px;
              "
              width="40";
              text="/2"
              @input="${e => this.changeSelectionLength("smaller")}"
            ></sc-button>
          </div>

          <div style="position: relative">
            ${this.recorderDisplay.render()}
            <sc-record
              style="
                position: absolute;
                bottom: 10px;
                left: 10px;
              "
              @change="${e => e.detail.value ? this.context.mediaRecorder.start() : this.context.mediaRecorder.stop()}"
            ></sc-record>
            <sc-transport
              id="transport-recorder"
              style="
                position: absolute;
                bottom: 10px;
                left: 45px;
              "
              buttons="[play, stop]"
              @change="${e => this.transportRecordFile(e.detail.value)}"
            ></sc-transport>
            <sc-button
              style="
                position: absolute;
                bottom: 10px;
                left: 110px;
              "
              height="29";
              width="140";
              text="send to target"
              @input="${e => this.setTargetFile(this.recordedBuffer)}"
            ></sc-button>
          </div>



          <div style="margin: 20px; padding: 20px; position: relative">

            <div>
              <h3>start mosaicing</h3>
              <sc-transport
                style="display: block"
                id="transport-mosaicing"
                buttons="[play, stop]"
                width="50"
                @change="${e => this.transportMosaicing(e.detail.value)}"
              ></sc-transport>
            </div>

            <div
              style="
                position: absolute;
                top: 0;
                left: 150px;
              "
            >
              <h3>volume</h3>
              <sc-slider
                min="0"
                max="1"
                value="0.5"
                width="300"
                display-number
                @input="${e => this.synthEngine.volume = e.detail.value}"
              ></sc-slider>

              <h3>detune</h3>
              <sc-slider
                min="-24"
                max="24"
                value="0"
                width="300"
                display-number
                @input="${e => this.synthEngine.detune = e.detail.value * 100}"
              ></sc-slider>

            </div>

            <div
              style="
                position: absolute;
                top: 0;
                left: 480px;
              "
            >

              <h3>grain period</h3>
              <sc-slider
                min="0.0058"
                max="0.046"
                value="0.0116"
                width="300"
                display-number
                @input="${e => {
                  this.analyzerEngine.setGrainPeriod(e.detail.value);
                  this.synthEngine.setGrainPeriod(e.detail.value);
                }}"
              ></sc-slider>

              <h3>grain duration</h3>
              <sc-slider
                min="0.02321995"
                max="0.19"
                value="0.0928"
                width="300"
                display-number
                @input="${e => {
                  this.analyzerEngine.setGrainDuration(e.detail.value);
                  this.synthEngine.setGrainDuration(e.detail.value);
                }}"
              ></sc-slider>
            </div>
          </div>

          <h3>Source</h3>

          <sc-file-tree
            value="${JSON.stringify(this.context.soundbankTreeRender)}";
            @input="${e => this.setSourceFile(this.context.audioBufferLoader.data[e.detail.value.name])}"
          ></sc-file-tree>

          <div style="
            display: inline;
            margin: 20px;
            position: relative;"
          >
            ${this.sourceDisplay.render()}
            <p
              style="
                position: absolute;
                bottom: 0;
                left: 0;
              " 
            >
              preview :
            </p>
            <sc-transport
              id="transport-source"
              style="
                position: absolute;
                bottom: 0;
                left: 70px;
              "
              buttons="[play, stop]"
              @change="${e => this.transportSourceFile(e.detail.value)}"
            ></sc-transport>
          </div>
        </div>

      `
  }
}

