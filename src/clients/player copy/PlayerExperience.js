import { AbstractExperience } from '@soundworks/core/client';
import { render, html } from 'lit-html';
import renderInitializationScreens from '@soundworks/template-helpers/client/render-initialization-screens.js';
import Mfcc from 'waves-lfo/common/operator/Mfcc';
import WaveformSvgBuilder from './WaveformSvgBuilder';
import createKDTree from 'static-kdtree';
import Synth from './Synth';
import { Scheduler } from 'waves-masters';
import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';


class PlayerExperience extends AbstractExperience {
  constructor(client, config, $container, audioContext) {
    super(client);

    this.config = config;
    this.$container = $container;
    this.rafId = null;
    this.audioContext = audioContext;

    // require plugins if needed

    this.platform = this.require('platform');
    this.sync = this.require('sync');
    this.filesystem = this.require('filesystem');
    this.audioBufferLoader = this.require('audio-buffer-loader');


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


    renderInitializationScreens(client, config, $container);
  }

  async start() {
    super.start();

    //Audio file loading 

    this.soundbankTreeRender = {
      "path": "soundbank",
      "name": "soundbank",
      "children": [],
      "type": "directory"
    };

    this.filesystem.subscribe(async () => {
      await this.loadSoundbank();
      this.render();
    });
    await this.loadSoundbank();

    // Microphone
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseReduction: false, autoGainControl: false }, video: false });
      console.log(this.micStream);
      console.log('access to microphone granted');
    } catch (err) {
      console.log('ERROR: could not access microphone');
      console.log(err);
    }

    try {
      this.mediaRecorder = new MediaRecorder(this.micStream);
      console.log('Media recorder successfully created');
    } catch (err) {
      console.log(err);
      console.log('ERROR: could not create mediaRecorder');
    }

    this.fileReader = new FileReader();

    this.mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) {
        this.fileReader.readAsArrayBuffer(e.data);
      };
    });

    this.fileReader.addEventListener('loadend', async () => {
      const audioBuffer = await this.audioContext.decodeAudioData(this.fileReader.result);
      this.selectTargetFile(audioBuffer);
    });

    const source = new MediaStreamAudioSourceNode(this.audioContext, { mediaStream: this.micStream });

    // Waveform display
    this.waveformWidth = 800;
    this.waveformHeight = 200;
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
    const getTimeFunction = () => this.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);

    const grainPeriod = this.hopSize / this.sourceSampleRate;
    const grainDuration = this.frameSize / this.sourceSampleRate;
    this.synth = new Synth(this.audioContext, grainPeriod, grainDuration, this.scheduler);

    this.synth.setAdvanceCallback((sourcePos, targetPos) => {
      this.displayCursor(sourcePos * this.waveformWidth, this.$cursorSource);
      this.displayCursor(targetPos * this.waveformWidth, this.$cursorTarget);
    })


    window.addEventListener('resize', () => this.render());
    this.render();
  }

  async loadSoundbank() {
    const soundbankTree = this.filesystem.get('soundbank');
    this.soundbankTreeRender["children"] = [];
    // format tree to create a simple data object
    const defObj = {};

    soundbankTree.children.forEach(leaf => {
      if (leaf.type === 'file') {
        defObj[leaf.name] = leaf.url;
        this.soundbankTreeRender["children"].push({
          "path": leaf.url,
          "name": leaf.name,
          "type": "file"
        });
      }
    });
    console.log(this.soundbankTreeRender["children"])
    // load files and clear old cached buffers
    await this.audioBufferLoader.load(defObj, true);
  }

  selectSourceFile(sourceBuffer) {
    console.log("loading source");
    this.currentSource = sourceBuffer;
    if (sourceBuffer) {
      const [mfccFrames, times] = this.computeMfcc(sourceBuffer);
      this.displayWaveform(sourceBuffer, this.$wvSvgSource);
      const searchTree = createKDTree(mfccFrames);
      console.log("Tree created")
      this.synth.setBuffer(sourceBuffer);
      this.synth.setSearchSpace(searchTree, times);
    }
  }

  selectTargetFile(targetBuffer) {
    console.log("loading target");
    this.currentTarget = targetBuffer;
    if (targetBuffer) {
      const [mfccFrames, times] = this.computeMfcc(targetBuffer);
      this.displayWaveform(targetBuffer, this.$wvSvgTarget);
      this.synth.setModel(mfccFrames);
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

  playTargetFile() {
    this.targetPlayerNode = new AudioBufferSourceNode(this.audioContext);
    this.targetPlayerNode.buffer = this.currentTarget;
    this.targetPlayerNode.connect(this.audioContext.destination);

    this.targetPlayerNode.start();
  }

  playSourceFile() {
    this.sourcePlayerNode = new AudioBufferSourceNode(this.audioContext);
    this.sourcePlayerNode.buffer = this.currentSource;
    this.sourcePlayerNode.connect(this.audioContext.destination);

    this.sourcePlayerNode.start();
  }


  /*
  #########################################################
  #                                                       #
  #                       Render                          #
  #                                                       #
  #########################################################
  */


  render() {
    // debounce with requestAnimationFrame
    window.cancelAnimationFrame(this.rafId);

    const now = this.audioContext.currentTime;

    this.rafId = window.requestAnimationFrame(() => {
      render(html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.client.type} [id: ${this.client.id}]</h1>
        </div>

        <div>
          <h3>Source</h3>

          <sc-file-tree
            value="${JSON.stringify(this.soundbankTreeRender)}";
            @input="${e => this.selectSourceFile(this.audioBufferLoader.data[e.detail.value.name])}"
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

            <sc-button
              style="
                position: absolute;
                bottom: 0;
                left: 0;
              "
              text="start"
              width="100"
              @input="${e => this.playSourceFile()}"
            ></sc-button>
            <sc-button
              style="
                position: absolute;
                bottom: 0;
                left: 105px;
              "
              width="100"
              text="stop"
              @input="${e => this.sourcePlayerNode.stop()}"
            ></sc-button>
          </div>

        </div>

        <div>
            <h3>Target</h3>

            <sc-file-tree
              value="${JSON.stringify(this.soundbankTreeRender)}";
              @input="${e => this.selectTargetFile(this.audioBufferLoader.data[e.detail.value.name])}"
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
                ${this.$wvSvgTarget}
                ${this.$cursorTarget}
              </svg>

              <sc-button
                style="
                  position: absolute;
                  bottom: 0;
                  left: 0;
                "
                text="start"
                width="100"
                @input="${e => this.playTargetFile()}"
              ></sc-button>
              <sc-button
                style="
                  position: absolute;
                  bottom: 0;
                  left: 105px;
                "
                width="100"
                text="stop"
                @input="${e => this.targetPlayerNode.stop()}"
              ></sc-button>
              <sc-button
                style="
                  position: absolute;
                  bottom: 0;
                  left: 210px;
                "
                width="100"
                text="rec"
                @input="${e => this.mediaRecorder.start()}"
              ></sc-button>
              <sc-button
                style="
                  position: absolute;
                  bottom: 0;
                  left: 315px;
                "
                width="100"
                text="stop rec"
                @input="${e => this.mediaRecorder.stop()}"
              ></sc-button>
            </div>

        </div>

        <div style="margin: 10px">
          <sc-button
            text="start mosaicing"
            @input="${e => this.synth.start()}"
          ></sc-button>
          <sc-button
            text="stop"
            @input="${e => this.synth.stop()}"
          ></sc-button>
        </div>

      `, this.$container);
    });
  }
}

export default PlayerExperience;
