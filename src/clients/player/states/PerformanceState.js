import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import Mfcc from '../Mfcc.js';
import WaveformDisplay from '../WaveformDisplay';
import createKDTree from 'static-kdtree';
import BufferSynth from '../BufferSynth.js';
import AnalyzerEngine from '../AnalyzerEngine';
import SynthEngine from '../SynthEngine';;
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';

export default class PerformanceState extends State {
  constructor(name, context) {
    super(name, context);

    this.currentSource = null;
    this.currentTarget = null;

    // audio analysis
    this.frameSize = 1024;
    this.hopSize = 256;
    this.sampleRate = this.context.audioContext.sampleRate;
    this.mfccBands = 24;
    this.mfccCoefs = 12;
    this.mfccMinFreq = 50;
    this.mfccMaxFreq = 8000;

    // Waveform display
    this.waveformWidth = 800;
    this.waveformHeight = 200;
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
      this.recordedBuffer = audioBuffer;
      this.recorderDisplay.setBuffer(audioBuffer);
    });

    // Waveform display
    this.sourceDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, false, true);
    this.targetDisplay = new WaveformDisplay(150, this.waveformWidth, true, true, true);
    this.recorderDisplay = new WaveformDisplay(150, this.waveformWidth, false, false);

    this.targetDisplay.setCallbackSelectionChange((start, end) => {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.analyzerEngine.setLoopLimits(start, end);
      this.targetBufferSynth.setLoopLimits(start, end);
    });

    // Analyzer 
    this.mfcc = new Mfcc(this.mfccBands, this.mfccCoefs, this.mfccMinFreq, this.mfccMaxFreq, this.frameSize, this.sampleRate);

    // Synth
    this.filter = new BiquadFilterNode(this.context.audioContext);
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 5000;

    this.compressor = new DynamicsCompressorNode(this.context.audioContext);

    this.bus = new GainNode(this.context.audioContext);

    this.output = new GainNode(this.context.audioContext);

    this.bus.connect(this.filter);
    this.filter.connect(this.compressor);
    this.compressor.connect(this.output);
    this.output.connect(this.context.audioContext.destination);

    const getTimeFunction = () => this.context.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);

    this.grainPeriod = 0.05;
    this.grainDuration = this.frameSize / this.sampleRate;
    this.sharedArray = [];
    this.analyzerEngine = new AnalyzerEngine(this.context.audioContext, this.sharedArray, this.grainPeriod, this.frameSize, this.sampleRate);
    this.synthEngine = new SynthEngine(this.context.audioContext, this.sharedArray, this.grainPeriod, this.grainDuration, this.sampleRate);
    this.synthEngine.connect(this.bus);
    this.scheduler.add(this.analyzerEngine, this.context.audioContext.currentTime);
    this.scheduler.add(this.synthEngine, this.context.audioContext.currentTime);

    this.analyzerEngine.setAdvanceCallback(targetPosPct => {
      this.targetDisplay.setCursorTime(this.currentTarget.duration * targetPosPct);
    });
    this.synthEngine.setAdvanceCallback(sourcePosPct => {
      this.sourceDisplay.setCursorTime(this.currentSource.duration * sourcePosPct);
    });

    this.targetBufferSynth = new BufferSynth(this.context.audioContext, this.waveformWidth);
    this.targetBufferSynth.connect(this.context.audioContext.destination);
  }

  setSourceFile(sourceBuffer) {
    console.log("loading source");
    this.currentSource = sourceBuffer;
    if (sourceBuffer) {
      const [mfccFrames, times] = this.mfcc.computeBufferMfcc(sourceBuffer, this.hopSize);
      const searchTree = createKDTree(mfccFrames);
      console.log("Tree created")
      this.synthEngine.setBuffer(sourceBuffer);
      this.synthEngine.setSearchSpace(searchTree, times);
      this.sourceDisplay.setBuffer(sourceBuffer);
    }
  }

  setTargetFile(targetBuffer) {
    if (targetBuffer) {
      this.currentTarget = targetBuffer;
      this.targetBufferSynth.buffer = targetBuffer;
      // const [mfccFrames, times] = this.computeMfcc(targetBuffer);
      // console.log(mfccFrames, targetBuffer);
      // this.mosaicingSynth.setModel(mfccFrames, targetBuffer.duration);
      const analysis = this.mfcc.computeBufferMfcc(targetBuffer, this.hopSize);
      this.analyzerEngine.setTarget(targetBuffer);
      this.analyzerEngine.setNorm(analysis[2], analysis[3]); // values for normalization of data
      this.targetDisplay.setBuffer(targetBuffer);
      this.targetDisplay.setSelectionStartTime(0);
      this.targetDisplay.setSelectionLength(targetBuffer.duration);
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

  transportRecordFile(state) {
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
    switch (state) {
      case 'play':
        this.analyzerEngine.start();
        break;
      case 'stop':
        this.analyzerEngine.stop();
        break;
    }
  }


  render() {
    const now = this.context.audioContext.currentTime;
    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.client.id}]</h1>
        </div>

        <div style="padding-left: 20px; padding-right: 20px">
          <h3>Target</h3>

          <sc-file-tree
            value="${JSON.stringify(this.context.soundbankTreeRender)}";
            @input="${e => this.setTargetFile(this.context.audioBufferLoader.data[e.detail.value.name])}"
            height="200"
          ></sc-file-tree>

          <div style="position: relative">
            ${this.targetDisplay.render()}
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
                  this.targetBufferSynth.loop = e.detail.value;
                }}"
            ></sc-loop>
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
              <h3>volume (target)</h3>
              <sc-slider
                min="0"
                max="1"
                value="0.5"
                width="300"
                display-number
                @input="${e => this.targetBufferSynth.volume = e.detail.value}"
              ></sc-slider>

              <h3>volume (mosaicing)</h3>
              <sc-slider
                min="0"
                max="1"
                value="0.5"
                width="300"
                display-number
                @input="${e => this.synthEngine.volume = e.detail.value}"
              ></sc-slider>

            </div>

            <div
              style="
                position: absolute;
                top: 0;
                left: 480px;
              "
            >
              <h3>detune (target)</h3>
              <sc-slider
                min="-24"
                max="24"
                value="0"
                width="300"
                display-number
                @input="${e => this.targetBufferSynth.detune = e.detail.value * 100}"
              ></sc-slider>

              <h3>detune (mosaicing)</h3>
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
                left: 810px;
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

            <div
              style="
                position: absolute;
                top: 0;
                left: 1140px;
              "
            >

              <h3>filter freq</h3>
              <sc-slider
                min="20"
                max="5000"
                value="5000"
                width="300"
                display-number
                @input="${e => this.filter.frequency.setTargetAtTime(e.detail.value, now, 0.1)}"
              ></sc-slider>

              <h3>filter Q</h3>
              <sc-slider
                min="0.001"
                max="30"
                value="1"
                width="300"
                display-number
                @input="${e => this.filter.Q.setTargetAtTime(e.detail.value, now, 0.1) }"
              ></sc-slider>

              <h3>global volume</h3>
              <sc-slider
                min="0"
                max="1"
                value="1"
                width="300"
                display-number
                @input="${e => this.output.gain.setTargetAtTime(e.detail.value, now, 0.1) }"
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

