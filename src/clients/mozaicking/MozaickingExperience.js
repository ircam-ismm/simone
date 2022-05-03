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


class MozaickingExperience extends AbstractExperience {
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

    // audio analysis
    this.frameSize = 2048;
    this.hopSize = 1024;
    this.sourceSampleRate = 44100;
    this.mfccBands = 24;
    this.mfccCoefs = 12;
    this.mfccMinFreq = 20;
    this.mfccMaxFreq = 5000;

    

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

    // Waveform display
    this.waveformWidth = 800;
    this.waveformHeight = 200;
    this.waveformBuilder = new WaveformSvgBuilder(this.waveformWidth, this.waveformHeight);

    this.$wvSvgSource = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.$wvSvgSource.setAttributeNS(null, 'fill', 'none');
    this.$wvSvgSource.setAttributeNS(null, 'shape-rendering', 'crispEdges');
    this.$wvSvgSource.setAttributeNS(null, 'stroke', 'white');
    this.$wvSvgSource.style.opacity = 1;

    this.$wvSvgModel = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.$wvSvgModel.setAttributeNS(null, 'fill', 'none');
    this.$wvSvgModel.setAttributeNS(null, 'shape-rendering', 'crispEdges');
    this.$wvSvgModel.setAttributeNS(null, 'stroke', 'white');
    this.$wvSvgModel.style.opacity = 1;


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
    // load files and clear old cached buffers
    await this.audioBufferLoader.load(defObj, true);
  }

  selectSourceFile(filename) {
    console.log("loading file :", filename);
    const loadedFiles = this.audioBufferLoader.data;
    const sourceBuffer = loadedFiles[filename];
    if (sourceBuffer) {
      const [mfccFrames, times] = this.computeMfcc(sourceBuffer);
      this.displayWaveform(sourceBuffer, this.$wvSvgSource);
      const searchTree = createKDTree(mfccFrames);
      console.log("Tree created")
      this.synth.setBuffer(sourceBuffer);
      this.synth.setSearchSpace(searchTree, times);
    }
  }

  selectModelFile(filename) {
    console.log("loading model :", filename);
    const loadedFiles = this.audioBufferLoader.data;
    const modelBuffer = loadedFiles[filename];
    if (modelBuffer) {
      const [mfccFrames, times] = this.computeMfcc(modelBuffer);
      this.displayWaveform(modelBuffer, this.$wvSvgModel);
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
      const frame = channelData.subarray(i, i+this.frameSize);
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
        std[j] += (cepsFrame[j] - means[j])**2
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
          <sc-file-tree
            .value="${this.soundbankTreeRender}";
            @input="${e => this.selectSourceFile(e.detail.value.name)}"
          ></sc-file-tree>

          <svg
            width=${this.waveformWidth}
            height=${this.waveformHeight}
            style="
              position: relative;
              background-color: black
            "
            @click=${e => console.log(e)}
          >
            ${this.$wvSvgSource}
          </svg>
        </div>

        <div>
          <sc-file-tree
            .value="${this.soundbankTreeRender}";
            @input="${e => this.selectModelFile(e.detail.value.name)}"
          ></sc-file-tree>

          <svg
            width=${this.waveformWidth}
            height=${this.waveformHeight}
            style="
              position: relative;
              background-color: black
            "
            @click=${e => console.log(e)}
          >
            ${this.$wvSvgModel}
          </svg>
        </div>

        <div>
          <sc-button
            text="Start"
            @input="${e => this.synth.start()}"
          ></sc-button>
          <sc-button
            text="Stop"
            @input="${e => this.synth.stop()}"
          ></sc-button>
        </div>

      `, this.$container);
    });
  }
}

export default MozaickingExperience;
