import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import '@ircam/simple-components/sc-clock.js';
import decibelToLinear from '../math/decibelToLinear.js';
import WaveformDisplay from '../../utils/WaveformDisplay';
import createKDTree from 'static-kdtree';
import AnalyzerEngine from '../synth/AnalyzerEngine';
import SynthEngine from '../synth/SynthEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';
import mfccWorkerString from '../../utils/mfcc.worker.js?inline';

const paramLabels = {
  volume: 'volume',
  detune: 'detune',
  grainPeriod: 'grain period',
  grainDuration: 'grain duration',
};

export default class ClonePlaying extends State {
  constructor(name, context) {
    super(name, context);

    this.currentSource = null;
    this.currentTarget = null;

    // Parameters for audio analysis
    this.frameSize = 4096;
    this.hopSize = 512;
    this.sampleRate = this.context.audioContext.sampleRate;
    this.mfccBands = 24;
    this.mfccCoefs = 12;
    this.mfccMinFreq = 50;
    this.mfccMaxFreq = 8000;
    this.analysisData = {
      frameSize: this.frameSize,
      hopSize: this.hopSize,
      sampleRate: this.sampleRate,
      mfccBands: this.mfccBands,
      mfccCoefs: this.mfccCoefs,
      mfccMinFreq: this.mfccMinFreq,
      mfccMaxFreq: this.mfccMaxFreq,
    }

    this.recording = false;
    this.recTime = 0;

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

    //
    this.context.participant.subscribe(updates => {
      if ("message" in updates) {
        const $messageBox = document.getElementById("messageBox");
        $messageBox.innerText = updates.message;
      }
      if ('mosaicingData' in updates) {
        //this is received as an object
        // console.log('receiving', updates.mosaicingSynth)
        this.synthEngine.postData(Object.values(updates.mosaicingData));
      }
    });

    // Waveform display
    this.waveformWidthLarge = window.innerWidth - (100 * 2);
    if (window.innerWidth < 1000) {
      this.waveformWidthRecorder = window.innerWidth - 100;
      this.waveformWidthSource = window.innerWidth - 100;
    } else {
      this.waveformWidthRecorder = this.waveformWidthLarge / 2;
      this.waveformWidthSource = this.waveformWidthLarge / 2;
    }
    this.waveformHeightLarge = 250;
    this.waveformHeightRecorder = 100;
    this.waveformHeightSource = 140;
    this.sourceDisplay = new WaveformDisplay(this.waveformHeightSource, this.waveformWidthSource, false, true);
    this.targetDisplay = new WaveformDisplay(this.waveformHeightLarge, this.waveformWidthLarge, true, true, true);
    this.recorderDisplay = new WaveformDisplay(this.waveformHeightRecorder, this.waveformWidthRecorder, false, false);

    // Callback for when selection on the display is modified
    this.targetDisplay.setCallbackSelectionChange((start, end) => {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.analyzerEngine.setLoopLimits(start, end);
    });

    // MFCC analyzer 
    const workerBlob = new Blob([mfccWorkerString], { type: 'text/javascript' });
    const workerUrl = URL.createObjectURL(workerBlob);
    this.worker = new Worker(workerUrl);

    this.worker.addEventListener('message', e => {
      const { type, data } = e.data;
      if (type === "message") {
        console.log(data);
      }
      if (type === "analyze-source") {
        const searchTree = createKDTree(data.mfccFrames);
        console.log("Tree created")
        this.synthEngine.setBuffer(this.currentSource);
        this.synthEngine.setSearchSpace(searchTree, data.times);
        this.sourceDisplay.setBuffer(this.currentSource);
      }
      if (type === "analyze-target") {
        this.analyzerEngine.setTarget(this.currentTarget);
        this.analyzerEngine.setNorm(data.means, data.std, data.minRms, data.maxRms); // values for normalization of data
        this.targetDisplay.setBuffer(this.currentTarget);
        // setting looping section back to 0
        this.selectionStart = 0;
        this.selectionEnd = this.currentTarget.duration;
        this.analyzerEngine.setLoopLimits(this.selectionStart, this.selectionEnd);
        // this.targetDisplay.setSelectionStartTime(0);
        // this.targetDisplay.setSelectionLength(this.currentTarget.duration);
      }
    });

    this.worker.postMessage({
      type: 'message',
      data: "worker says hello",
    });

    // Mosaicing synth
    const getTimeFunction = () => this.context.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);

    this.grainPeriod = this.context.participant.get('grainPeriod');
    this.grainDuration = this.context.participant.get('grainDuration');
    this.analyzerEngine = new AnalyzerEngine(this.context.audioContext, this.context.participant, this.grainPeriod, this.frameSize, this.sampleRate);
    this.synthEngine = new SynthEngine(this.context.audioContext, this.grainPeriod, this.grainDuration, this.sampleRate);
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

    // Fetching recording to use as a source sound from the server
    const nPlayers = this.context.global.get('nPlayers');
    const idSourceToGet = (this.context.checkinId + 1)%nPlayers;
    const sourceBuffer = this.context.audioBufferLoader.data[`recording-player-${idSourceToGet}.wav`];
    this.currentSource = sourceBuffer;
    if (sourceBuffer) {
      this.worker.postMessage({
        type: 'analyze-source',
        data: {
          analysisInitData: this.analysisData,
          buffer: sourceBuffer.getChannelData(0),
        }
      });
    }

    // Previous values sliders
    this.currentValues = {
      volume: this.context.participant.get('volume'),
      detune: this.context.participant.get('detune'),
      grainPeriod: this.context.participant.get('grainPeriod'),
      grainDuration: this.context.participant.get('grainDuration'),
    };
    this.previousValues = { ...this.currentValues };
  }


  setTargetFile(targetBuffer) {
    if (targetBuffer) {
      this.currentTarget = targetBuffer;
      this.worker.postMessage({
        type: 'analyze-target',
        data: {
          analysisInitData: this.analysisData,
          buffer: targetBuffer.getChannelData(0),
        }
      });
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

  transportRecordFile(state) {
    switch (state) {
      case 'play':
        this.recorderPlayerNode = new AudioBufferSourceNode(this.context.audioContext);
        this.recorderPlayerNode.buffer = this.recordedBuffer;
        this.recorderPlayerNode.connect(this.context.globalVolume);

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
    const now = Date.now();
    switch (state) {
      case 'play':
        this.analyzerEngine.start();
        this.synthEngine.start();
        break;
      case 'stop':
        this.analyzerEngine.stop();
        this.synthEngine.stop();
        break;
    }
  }

  switchValueSlider(name) {
    const temp = this.previousValues[name];
    this.previousValues[name] = this.currentValues[name];
    this.currentValues[name] = temp;
    switch (name) {
      case 'volume':
        this.synthEngine.volume = decibelToLinear(temp);
        this.context.participant.set({ volume: temp });
        break;
      case 'detune':
        this.synthEngine.detune = temp * 100;
        this.context.participant.set({ detune: temp });
        break;
      case 'grainPeriod':
        this.analyzerEngine.setPeriod(temp);
        this.synthEngine.setGrainPeriod(temp);
        this.context.participant.set({ grainPeriod: temp });
        break;
      case 'grainDuration':
        this.synthEngine.setGrainDuration(temp);
        this.context.participant.set({ grainDuration: temp });
        break;
    }
    this.render();
  }

  updateParamValue(param, value) {
    switch (param) {
      case 'volume':
        this.synthEngine.volume = decibelToLinear(value);
        this.context.participant.set({ volume: value });
        break;
      case 'detune':
        this.synthEngine.detune = value * 100;
        this.context.participant.set({ detune: value });
        break;
      case 'grainPeriod':
        this.analyzerEngine.setPeriod(value);
        this.synthEngine.setGrainPeriod(value);
        this.context.participant.set({ grainPeriod: value });
        break;
      case 'grainDuration':
        this.synthEngine.setGrainDuration(value);
        this.context.participant.set({ grainDuration: value });
        break;
    }
  }

  updateParamPrevValue(param, value) {
    switch (param) {
      case 'volume':
        if (value !== this.currentValues.volume) {
          this.previousValues.volume = this.currentValues.volume;
          this.currentValues.volume = value;
        }
        break;
      case 'detune':
        if (value !== this.currentValues.detune) {
          this.previousValues.detune = this.currentValues.detune;
          this.currentValues.detune = value;
        }
        break;
      case 'grainPeriod':
        if (value !== this.currentValues.grainPeriod) {
          this.previousValues.grainPeriod = this.currentValues.grainPeriod;
          this.currentValues.grainPeriod = value;
        }
        break;
      case 'grainDuration':
        if (value !== this.currentValues.grainDuration) {
          this.previousValues.grainDuration = this.currentValues.grainDuration;
          this.currentValues.grainDuration = value;
        }
        break;
    }
  }

  render() {
    let sliderWidth;
    if (window.innerWidth < 1000) {
      sliderWidth = this.waveformWidthLarge - 160;
    } else {
      sliderWidth = (this.waveformWidthLarge - 30) / 2 - 160;
    }
    const schema = this.context.participant.getSchema();

    return html`
      <!-- Name and message bar -->
      <div style="
        height: 100px;
        display: flex;
        justify-content: space-between;
        padding: 20px;
      "  
      >
        <h1> ${this.context.participant.get('name')} [id: ${this.context.checkinId}] </h1>
        <div style="margin-left: 20px; width: 300px;">
          <h3>Message from experimenter</h3>
          <p id="messageBox"></p>
        </div>
      </div>


      <!-- Recorder and source -->
      <div style="
        display: flex;
        justify-content: space-between;
        flex-direction: ${window.innerWidth < 1000 ? 'column' : 'row'};
        margin: 20px 50px;
      "
      >
        <div>
          <h2>record target</h2>
          <div style="position: relative">
            ${this.recorderDisplay.render()}
            <sc-record
              style="
                position: absolute;
                bottom: 2px; 
                left: 2px;
              "
              height="40"
              @change="${e => {
                e.detail.value ? this.context.mediaRecorder.start() : this.context.mediaRecorder.stop();
                this.recording = e.detail.value;
                this.startRecTime = this.context.sync.getSyncTime();
              }}"
            ></sc-record>
            <sc-clock
              style="
                position: absolute;
                bottom: 4px; 
                left: 45px;
              "
              height="20"
              width="150"
              .getTimeFunction="${() => {
                if (this.recording) {
                  this.recTime = this.context.sync.getSyncTime() - this.startRecTime;
                }
                return this.recTime;
            }}"
            ></sc-clock>
          </div>
          <sc-button
            width="${this.waveformWidthRecorder}"
            height="39"
            text="↓ use as target ↓"
            selected
            @input="${e => {
              this.setTargetFile(this.recordedBuffer);
            }}"
          ></sc-button>
        </div>
        
        <div>
          <h2>source</h2>
          <div style="position: relative;">
            ${this.sourceDisplay.render()}
            <sc-transport
              id="transport-source"
              style="
                position: absolute;
                bottom: 2px;
                left: 2px;
              "
              buttons="[play, stop]"
              height="40"
              @change="${e => this.transportSourceFile(e.detail.value)}"
            ></sc-transport>
          </div>    
        </div>
      </div>

      <!-- Control panel -->
      <div style="
        margin: 20px 50px;
        padding: 10px 10px 50px 10px;
        background-color: #525c68;
      "
      > 
        <div style="
          margin: 0px auto;
          display: table; 
        "
        >
          <h2>target</h2>
          <div style="position: relative;">
            ${this.targetDisplay.render()}
            <sc-transport
              style="
                position: absolute;
                bottom: 4px;
                left: 2px;
              "
              id="transport-mosaicing"
              buttons="[play, stop]"
              width="60"
              @change="${e => this.transportMosaicing(e.detail.value)}"
            ></sc-transport>
          </div>

          <!-- Sliders -->
          <div style="
            margin-top: 20px;
            display: grid;
            grid-auto-flow: ${window.innerWidth < 1000 ? 'row' : 'column'};
            grid-template-rows: ${window.innerWidth < 1000 ? 'repeat(1, 1fr)' : 'repeat(2, 1fr)'};
            justify-content: space-between;
          "
          >
            ${['volume', 'detune', 'grainPeriod', 'grainDuration'].map(param => {
              return html`
                <div>
                  <h3>${paramLabels[param]}</h3>
                  <div>
                    <sc-slider
                      id="slider-${param}"
                      min="${schema[param].min}"
                      max="${schema[param].max}"
                      value="${this.context.participant.get(param)}"
                      width="${sliderWidth}"
                      display-number
                      @input="${e => this.updateParamValue(param, e.detail.value)}"
                      @change="${e => this.updateParamPrevValue(param, e.detail.value)}"
                    ></sc-slider>
                    <sc-button
                      width="150"
                      text="previous value"
                      @input="${e => this.switchValueSlider(param)}"
                    >
                  </div>
                </div>
              `
            })}
          </div>
        </div>      
      </div>

    `
  }

}

