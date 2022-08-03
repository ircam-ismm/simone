import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import Mfcc from 'waves-lfo/common/operator/Mfcc';
import WaveformSvgBuilder from '../WaveformSvgBuilder';
import WaveformDisplay from '../WaveformDisplay';
import createKDTree from 'static-kdtree';
import MosaicingSynth from '../MosaicingSynth';
import BufferSynth from '../BufferSynth';
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
    this.sourceSampleRate = this.context.audioContext.sampleRate;
    this.mfccBands = 24;
    this.mfccCoefs = 12;
    this.mfccMinFreq = 50;
    this.mfccMaxFreq = 8000;

    // Mosaicing
    this.bpm = 120;
    this.lengthFactor = 1;
    this.nFramesBeat = 8;

    // Waveform display
    this.waveformWidth = 800;
    this.waveformHeight = 200;

    // this.mouseDownTargetA = this.mouseDownTargetA.bind(this);
    // this.mouseMoveTarget = this.mouseMoveTarget.bind(this);
    // this.mouseUpTarget = this.mouseUpTarget.bind(this);
    // this.touchStartTarget = this.touchStartTarget.bind(this);
    // this.touchMoveTarget = this.touchMoveTarget.bind(this);
    // this.touchEndTarget = this.touchEndTarget.bind(this);

    // For touch support
    this.activePointers = new Map();
    this.pointerIds = []; // we want to keep the order of appearance consistant

    this.targetPlayerState = this.context.participant;
  }

  async enter() {
    // Waveform display
    this.sourceDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, false, true);
    this.targetDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, true, true, false);

    this.targetDisplay.setCallbackSelectionChange((start, end) => {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.mosaicingSynth.setLoopLimits(start, end);
    });


    // Analyzer 
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

    // Synth
    const getTimeFunction = () => this.context.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);

    this.grainPeriod = this.hopSize / this.sourceSampleRate;
    this.grainDuration = this.frameSize / this.sourceSampleRate;
    this.mosaicingSynth = new MosaicingSynth(this.context.audioContext, this.grainPeriod, this.grainDuration, this.scheduler, this.sourceSampleRate);
    this.mosaicingSynth.connect(this.context.audioContext.destination);

    this.mosaicingSynth.setAdvanceCallback((targetPosPct, sourcePosPct) => {
      this.targetDisplay.setCursorTime(this.currentTarget.duration * targetPosPct);
      this.sourceDisplay.setCursorTime(this.currentSource.duration * sourcePosPct);
    })



    // For testing
    // const numbers = this.context.audioBufferLoader.data['french-numbers.wav'];
    // this.setTargetFile(numbers);
    // this.setSourceFile(numbers);


    this.context.participant.subscribe(updates => {
      if ('mosaicingData' in updates) {
        this.mosaicingSynth.pushData(updates.mosaicingData);
      }
    })
  }

  setSourceFile(sourceBuffer) {
    console.log("loading source");
    this.currentSource = sourceBuffer;
    if (sourceBuffer) {
      const [mfccFrames, times] = this.computeMfcc(sourceBuffer);
      const searchTree = createKDTree(mfccFrames);
      console.log("Tree created")
      this.mosaicingSynth.setBuffer(sourceBuffer);
      this.mosaicingSynth.setSearchSpace(searchTree, times);
      this.sourceDisplay.setBuffer(sourceBuffer);
    }
  }

  setTargetFile(targetBuffer) {
    if (targetBuffer) {
      this.currentTarget = targetBuffer;
      // const [mfccFrames, times] = this.computeMfcc(targetBuffer);
      // console.log(mfccFrames, targetBuffer);
      // this.mosaicingSynth.setModel(mfccFrames, targetBuffer.duration);
      const analysis = this.computeMfcc(targetBuffer);
      this.mosaicingSynth.setTarget(targetBuffer);
      this.mosaicingSynth.setNorm(analysis[2], analysis[3]);
      this.targetDisplay.setBuffer(targetBuffer);
      this.targetDisplay.setSelectionStartTime(0);
      this.targetDisplay.setSelectionLength(this.nFramesBeat * this.frameSize / this.sourceSampleRate);
      this.selectionLength = this.nFramesBeat * this.frameSize / this.sourceSampleRate;
    }
  }

  computeMfcc(buffer) { // make aynchronous ?
    const printIdx = 100;
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

  transportMosaicing(state) {
    switch (state) {
      case 'play':
        const beatLength = this.nFramesBeat * this.frameSize / this.sourceSampleRate;
        const currentSyncTime = this.context.sync.getSyncTime();
        const nextStartTime = Math.ceil(currentSyncTime / beatLength) * beatLength;
        const nextStartTimeLocal = this.context.sync.getLocalTime(nextStartTime);
        this.scheduler.defer(() => this.mosaicingSynth.start(), nextStartTimeLocal);

        console.log(beatLength, currentSyncTime, nextStartTime, nextStartTimeLocal);

        // this.mosaicingSynth.setClearCallback(() => {
        //   const $transportMosaicing = document.querySelector('#transport-mosaicing');
        //   $transportMosaicing.state = 'stop';
        // });
        break;
      case 'stop':
        this.mosaicingSynth.stop();
        break;
    }
  }

  changeSelectionLength(type) {
    if (type === 'longer') {
      const newLength = this.selectionLength * 2;
      if (this.nFramesBeat * 2 <= 32 && this.selectionStart + newLength < this.currentTarget.duration) {
        this.nFramesBeat *= 2;
        this.selectionLength = this.nFramesBeat * this.frameSize / this.sourceSampleRate;
        // this.lengthFactor *= 2;
        this.targetDisplay.setSelectionLength(this.selectionLength);
      }
    } else {
      const newLength = this.selectionLength / 2;
      if (this.nFramesBeat / 2 >= 1) {
        this.nFramesBeat /= 2;
        this.selectionLength = this.nFramesBeat * this.frameSize / this.sourceSampleRate;
        // this.lengthFactor /= 2;
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
                @input="${e => this.mosaicingSynth.volume = e.detail.value}"
              ></sc-slider>

              <h3>detune</h3>
              <sc-slider
                min="-24"
                max="24"
                width="300"
                display-number
                @input="${e => this.mosaicingSynth.detune = e.detail.value * 100}"
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
                @input="${e => this.mosaicingSynth.setGrainPeriod(e.detail.value)}"
              ></sc-slider>

              <h3>grain duration</h3>
              <sc-slider
                min="0.02321995"
                max="0.18575964"
                value="0.0928"
                width="300"
                display-number
                @input="${e => this.mosaicingSynth.setGrainDuration(e.detail.value)}"
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

