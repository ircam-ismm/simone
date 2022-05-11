import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import Mfcc from 'waves-lfo/common/operator/Mfcc';
import WaveformSvgBuilder from '../WaveformSvgBuilder';
import createKDTree from 'static-kdtree';
import Synth from '../Synth';
import BufferSynth from '../BufferSynth';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';

export default class Mosaicing extends State {
  constructor(name, context) {
    super(name, context);

    this.currentSource = null;
    this.currentTarget = null;

    // audio analysis
    this.frameSize = 4096;
    this.hopSize = 512;
    this.sourceSampleRate = 44100;
    this.mfccBands = 24;
    this.mfccCoefs = 12;
    this.mfccMinFreq = 50;
    this.mfccMaxFreq = 8000;

    // Waveform display
    this.waveformWidth = 800;
    this.waveformHeight = 200;

    this.mouseDownTarget = this.mouseDownTarget.bind(this);
    this.mouseMoveTarget = this.mouseMoveTarget.bind(this);
    this.mouseUpTarget = this.mouseUpTarget.bind(this);
  }

  async enter() {
    // Microphone

    this.context.mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) {
        this.context.fileReader.readAsArrayBuffer(e.data);
      };
    });

    this.context.fileReader.addEventListener('loadend', async () => {
      const audioBuffer = await this.context.audioContext.decodeAudioData(this.context.fileReader.result);
      this.selectTargetFile(audioBuffer);
    });


    // Waveform display
    this.waveformBuilder = new WaveformSvgBuilder(this.waveformWidth, this.waveformHeight);

    this.$wvSvgSource = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.$wvSvgSource.setAttributeNS(null, 'fill', 'none');
    this.$wvSvgSource.setAttributeNS(null, 'shape-rendering', 'crispEdges');
    this.$wvSvgSource.setAttributeNS(null, 'stroke', 'white');
    this.$wvSvgSource.style.opacity = 1;

    this.$wvSvgTarget = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.$wvSvgTarget.setAttributeNS(null, 'fill', 'none');
    this.$wvSvgTarget.setAttributeNS(null, 'shape-rendering', 'crispEdges');
    this.$wvSvgTarget.setAttributeNS(null, 'stroke', 'white');
    this.$wvSvgTarget.style.opacity = 1;

    this.$cursorSource = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.$cursorSource.setAttributeNS(null, 'fill', 'none');
    this.$cursorSource.setAttributeNS(null, 'shape-rendering', 'crispEdges');
    this.$cursorSource.setAttributeNS(null, 'stroke', 'red');
    this.$cursorSource.style.opacity = 1;

    this.$cursorTarget = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.$cursorTarget.setAttributeNS(null, 'fill', 'none');
    this.$cursorTarget.setAttributeNS(null, 'shape-rendering', 'crispEdges');
    this.$cursorTarget.setAttributeNS(null, 'stroke', 'red');
    this.$cursorTarget.style.opacity = 1;

    this.$loopSelection = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    this.$loopSelection.setAttributeNS(null, 'fill', 'white');
    this.$loopSelection.setAttributeNS(null, 'y', '0');
    this.$loopSelection.setAttributeNS(null, 'height', `${this.waveformHeight}`);
    this.$loopSelection.style.opacity = 0.4;


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
    const scheduler = new Scheduler(getTimeFunction);

    const grainPeriod = this.hopSize / this.sourceSampleRate;
    const grainDuration = this.frameSize / this.sourceSampleRate;
    this.mosaicingSynth = new Synth(this.context.audioContext, grainPeriod, grainDuration, scheduler);
    this.mosaicingSynth.connect(this.context.audioContext.destination);
    this.targetBufferSynth = new BufferSynth(this.context.audioContext, this.waveformWidth);
    this.targetBufferSynth.connect(this.context.audioContext.destination);


    this.mosaicingSynth.setAdvanceCallback((sourcePos, targetPos) => {
      this.displayCursor(sourcePos * this.waveformWidth, this.$cursorSource);
      this.displayCursor(targetPos * this.waveformWidth, this.$cursorTarget);
    });

    setTimeout(() => {
      // Select played section on target waveform
      // this.$loopStartPos = 0;
      const $svgWaveform = document.querySelector("#target-waveform");
      $svgWaveform.addEventListener('mousedown', this.mouseDownTarget);
      // $svgWaveform.addEventListener('touchstart', eventClick => {
      //   const dim = $svgWaveform.getBoundingClientRect();
      //   if (eventClick.buttons === 1) { // NOT WORKING
      //     $svgWaveform.addEventListener('touchmove', eventMove => this.selectLimits(eventMove, eventClick.clientX, dim));
      //     eventClick.preventDefault(); // Prevent selection
      //   }
      // });
    }, 200);
    
    
  }

  selectSourceFile(sourceBuffer) {
    console.log("loading source");
    this.currentSource = sourceBuffer;
    if (sourceBuffer) {
      const [mfccFrames, times] = this.computeMfcc(sourceBuffer);
      this.displayWaveform(sourceBuffer, this.$wvSvgSource);
      const searchTree = createKDTree(mfccFrames);
      console.log("Tree created")
      this.mosaicingSynth.setBuffer(sourceBuffer);
      this.mosaicingSynth.setSearchSpace(searchTree, times);
    }
  }

  selectTargetFile(targetBuffer) {
    console.log("loading target");
    this.targetBufferSynth.buffer = targetBuffer
    // this.currentTarget = targetBuffer;
    if (targetBuffer) {
      const [mfccFrames, times] = this.computeMfcc(targetBuffer);
      this.displayWaveform(targetBuffer, this.$wvSvgTarget);
      this.mosaicingSynth.setModel(mfccFrames);
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
    return [mfccFrames, times];
  }

  displayWaveform(buffer, container) { // make aynchronous ?
    this.waveformBuilder.loadBuffer(buffer);
    const waveformLimits = this.waveformBuilder.getWaveformLimits();
    let instructions = waveformLimits.map((datum, index) => {
      const x = index;
      let y1 = Math.round(datum[0]);
      let y2 = Math.round(datum[1]);
      // return `${x},${ZERO}L${x},${y1}L${x},${y2}L${x},${ZERO}`;
      return `${x},${y1}L${x},${y2}`;
    });
    const d = 'M' + instructions.join('L');
    container.setAttributeNS(null, 'd', d);
    this.render();
  }

  displayCursor(hPos, container) {
    const d = `M ${hPos}, 0 L ${hPos}, ${this.waveformHeight}`;
    container.setAttributeNS(null, 'd', d);
    this.render();
  }

  transportTargetFile(state) {
    switch (state) {
      case 'play':
        this.targetBufferSynth.play(this.context.audioContext.currentTime);

        this.targetBufferSynth.addEventListener('ended', () => {
          const $transportTarget = document.querySelector('#transport-target');
          $transportTarget.state = 'stop';
        });

        break;
      case 'stop':
        this.targetBufferSynth.stop(this.context.audioContext.currentTime);
        break;
    }
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

  mouseDownTarget(eventDown) {    

    eventDown.preventDefault(); // Prevent selection
    this.clickXPos = eventDown.clientX;
    this.clickTargetDim = eventDown.currentTarget.getBoundingClientRect();
    window.addEventListener('mousemove', this.mouseMoveTarget);
    window.addEventListener('mouseup', this.mouseUpTarget);

  }

  mouseMoveTarget(eventMove) {
    eventMove.preventDefault(); // Prevent selection
    this.selectLimits(eventMove, this.clickXPos, this.clickTargetDim);
  }

  mouseUpTarget(eventUp) {
    window.removeEventListener('mousemove', this.mouseMoveTarget);
    window.removeEventListener('mouseup', this.mouseUpTarget);
  }

  selectLimits(event, clickX, dim) {
    const clickPos = clickX - dim.left;
    const movePos = event.clientX - dim.left;
    this.$loopStartPos = Math.min(clickPos, movePos);
    this.$loopEndPos = Math.max(clickPos, movePos);
    this.$loopSelection.setAttributeNS(null, 'x', `${this.$loopStartPos}`);
    this.$loopSelection.setAttributeNS(null, 'width', `${this.$loopEndPos-this.$loopStartPos}`);
    if (this.$loopEndPos - this.$loopStartPos > 0) {
      this.mosaicingSynth.setLoopLimits(this.$loopStartPos, this.$loopEndPos, this.waveformWidth);
      this.targetBufferSynth.setSelectionLimits(this.$loopStartPos, this.$loopEndPos);
    } 
    // this.targetPlayerNode.loopStart = this.currentTarget.duration * this.$loopStartPos/this.waveformWidth;
    // this.targetPlayerNode.loopEnd = this.currentTarget.duration * this.$loopEndPos/this.waveformWidth;
  }


  render() {

    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.client.id}]</h1>
        </div>

        <div>
          <h3>Source</h3>

          <sc-file-tree
            value="${JSON.stringify(this.context.soundbankTreeRender)}";
            @input="${e => this.selectSourceFile(this.context.audioBufferLoader.data[e.detail.value.name])}"
          ></sc-file-tree>

          <div style="
            display: inline;
            position: relative;"
          >
            <svg
              width=${this.waveformWidth}
              height=${this.waveformHeight}
              style="
                background-color: black
              "
            >
              ${this.$wvSvgSource}
              ${this.$cursorSource}
            </svg>

            <sc-transport
              id="transport-source"
              style="
                position: absolute;
                bottom: 0;
                left: 0;
              "
              buttons="[play, stop]"
              @change="${e => this.transportSourceFile(e.detail.value)}"
            ></sc-transport>
            <sc-slider
              style="
                position: absolute;
                left: ${this.waveformWidth + 10}px;
                bottom: 0;
              "
              height="${this.waveformHeight}"
              width="30"
              orientation="vertical"
              @input=${e => this.mosaicingSynth.volume = e.detail.value }
            ></sc-slider>
        </div>

        <div>
            <h3>Target</h3>

            <sc-file-tree
              value="${JSON.stringify(this.context.soundbankTreeRender)}";
              @input="${e => this.selectTargetFile(this.context.audioBufferLoader.data[e.detail.value.name])}"
            ></sc-file-tree>

            <div style="
              display: inline;
              position: relative;"
            >
              <svg
                id="target-waveform";
                width=${this.waveformWidth}
                height=${this.waveformHeight}
                style="
                  background-color: black
                "
              >
                ${this.$loopSelection}
                ${this.$wvSvgTarget}
                ${this.$cursorTarget}
              </svg>
              <sc-transport
                id="transport-target"
                style="
                  position: absolute;
                  bottom: 0;
                  left: 0;
                "
                buttons="[play, stop]"
                @change="${e => this.transportTargetFile(e.detail.value)}"
              ></sc-transport>
              <sc-loop
                style="
                  position: absolute;
                  bottom: 0;
                  left: 65px;
                "
                @change="${e => {
                  this.mosaicingSynth.loop = e.detail.value;
                  this.targetBufferSynth.loop = e.detail.value;
                }}"
              ></sc-loop>
              <sc-record
                style="
                  position: absolute;
                  bottom: 0;
                  left: 97px;
                "
                @change="${e => e.detail.value ? this.context.mediaRecorder.start() : this.context.mediaRecorder.stop()}"
              ></sc-record>
              <sc-slider
                style="
                  position: absolute;
                  left: ${this.waveformWidth + 10}px;
                  bottom: 0;
                "
                height="${this.waveformHeight}"
                width="30"
                orientation="vertical"
                @input=${e => this.targetBufferSynth.volume = e.detail.value }
              ></sc-slider>
            </div>

        </div>

        <div style="margin: 10px">
          <sc-button
            text="start mosaicing"
            @input="${e => this.mosaicingSynth.start()}"
          ></sc-button>
          <sc-button
            text="stop"
            @input="${e => this.mosaicingSynth.stop()}"
          ></sc-button>
        </div>

      `
  }
}

