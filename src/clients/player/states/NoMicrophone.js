import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import Mfcc from '../Mfcc.js';
import WaveformDisplay from '../WaveformDisplay';
import createKDTree from 'static-kdtree';
import AnalyzerEngine from '../AnalyzerEngine';
import SynthEngine from '../SynthEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';

export default class NoMicrophone extends State {
  constructor(name, context) {
    super(name, context);

    this.currentSource = null;
    this.currentTarget = null;

    // audio analysis
    this.frameSize = 4096;
    this.hopSize = 512;
    this.sampleRate = this.context.audioContext.sampleRate;
    this.mfccBands = 24;
    this.mfccCoefs = 12;
    this.mfccMinFreq = 50;
    this.mfccMaxFreq = 8000;

    // Mosaicing
    this.bpm = 120;
    this.nFramesBeat = 8; // length of the looping section (in number of frames)
    this.selectionLength = this.nFramesBeat * this.frameSize / 44100;
    this.maxNFramesBeat = 64 // maximum length of looping section (in n of frames)

    // Waveform display
    this.waveformWidth = 800;
    this.waveformHeight = 200;
  }

  async enter() {
    // Waveform display
    this.sourceDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, false, true);
    this.targetDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, true, true, false);

    this.targetDisplay.setCallbackSelectionChange((start, end) => {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.analyzerEngine.setLoopLimits(start, end);
    });


    // Analyzer 
    this.mfcc = new Mfcc(this.mfccBands, this.mfccCoefs, this.mfccMinFreq, this.mfccMaxFreq, this.frameSize, this.sampleRate);

    // Synth
    const getTimeFunction = () => this.context.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);


    this.grainPeriod = 0.05;
    this.grainDuration = this.frameSize / this.sampleRate;
    this.sharedArray = [];
    this.analyzerEngine = new AnalyzerEngine(this.context.audioContext, this.sharedArray, this.grainPeriod, this.frameSize, this.sampleRate);
    this.synthEngine = new SynthEngine(this.context.audioContext, this.sharedArray, this.grainPeriod, this.grainDuration, this.sampleRate);
    this.synthEngine.connect(this.context.globalVolume);
    this.scheduler.add(this.analyzerEngine, this.context.audioContext.currentTime);
    this.scheduler.add(this.synthEngine, this.context.audioContext.currentTime);

    // Callback for displaying cursors
    this.analyzerEngine.setAdvanceCallback(targetPosPct => {
      this.targetDisplay.setCursorTime(this.currentTarget.duration * targetPosPct);
    });
    this.synthEngine.setAdvanceCallback(sourcePosPct => {
      this.sourceDisplay.setCursorTime(this.currentSource.duration * sourcePosPct);
    });
  }

  setSourceFile(sourceBuffer) {
    console.log("loading source");
    this.currentSource = sourceBuffer;
    if (sourceBuffer) {
      const [mfccFrames, times] = this.mfcc.computeBufferMfcc(sourceBuffer, this.hopSize);
      const searchTree = createKDTree(mfccFrames);
      console.log("Tree created");
      this.synthEngine.setBuffer(sourceBuffer);
      this.synthEngine.setSearchSpace(searchTree, times);
      this.sourceDisplay.setBuffer(sourceBuffer);
    }
  }

  setTargetFile(targetBuffer) {
    if (targetBuffer) {
      this.currentTarget = targetBuffer;
      // const [mfccFrames, times] = this.computeMfcc(targetBuffer);
      // console.log(mfccFrames, targetBuffer);
      // this.mosaicingSynth.setModel(mfccFrames, targetBuffer.duration);
      const analysis = this.mfcc.computeBufferMfcc(targetBuffer, this.hopSize);
      this.analyzerEngine.setTarget(targetBuffer);
      this.analyzerEngine.setNorm(analysis[2], analysis[3]); // values for normalization of data
      this.targetDisplay.setBuffer(targetBuffer);
      this.targetDisplay.setSelectionStartTime(0);
      this.targetDisplay.setSelectionLength(this.nFramesBeat * this.frameSize / this.sampleRate);
      this.selectionLength = this.nFramesBeat * this.frameSize / this.sampleRate;
    }
  }

  transportSourceFile(state) {
    switch (state) {
      case 'play':
        this.sourcePlayerNode = new AudioBufferSourceNode(this.context.audioContext);
        this.sourcePlayerNode.buffer = this.currentSource;
        this.sourcePlayerNode.connect(this.context.globalVolume);

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

  transportMosaicing(state) {
    switch (state) {
      case 'play':
        const beatLength = this.nFramesBeat * this.frameSize / this.sampleRate;
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
        this.selectionLength = this.nFramesBeat * this.frameSize / this.sampleRate;
        this.targetDisplay.setSelectionLength(this.selectionLength);
      }
    } else {
      // New looping section must not last less than a frame long
      if (this.nFramesBeat / 2 >= 1) {
        this.nFramesBeat /= 2;
        this.selectionLength = this.nFramesBeat * this.frameSize / this.sampleRate;
        this.targetDisplay.setSelectionLength(this.selectionLength);
      }
    }
  }


  render() {
    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.client.id}]</h1>
        </div>

        <div style="padding-left: 20px; padding-right: 20px">
          <h3>Target</h3>

          <sc-file-tree
            value="${JSON.stringify(this.context.soundbankTreeRender)}";
            @input="${e => this.setTargetFile(this.context.audioBufferLoader.data[e.detail.value.name])}"
          ></sc-file-tree>

          <div style="
            display: inline;
            margin: 20px;
            position: relative;"
          >
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
                  this.analyzerEngine.setPeriod(e.detail.value);
                  this.synthEngine.setGrainPeriod(e.detail.value);
                }}"
              ></sc-slider>

              <h3>grain duration</h3>
              <sc-slider
                min="0.02"
                max="0.5"
                value="0.25"
                width="300"
                display-number
                @input="${e => this.synthEngine.setGrainDuration(e.detail.value)}"
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

