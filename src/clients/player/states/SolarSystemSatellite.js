import '@ircam/sc-components/sc-filetree.js';
import '@ircam/sc-components/sc-button.js';
import '@ircam/sc-components/sc-slider.js';
import '@ircam/sc-components/sc-transport';
import decibelToLinear from '../math/decibelToLinear.js';
import WaveformDisplay from '../../utils/WaveformDisplay';
import createKDTree from 'static-kdtree';
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

export default class SolarSystemSatellite extends State {
  constructor(name, context) {
    super(name, context);

    this.currentSource = null;
    this.currentTarget = null;
 
    // parameters for audio analysis
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


    this.targetPlayerState = this.context.participant;
  }

  async enter() {
    // Waveform display
    this.controlPanelWidth = window.innerWidth - (150 * 2);
    this.waveformWidthSource = this.controlPanelWidth - 250;
    this.waveformHeightSource = 150;
    this.sourceDisplay = new WaveformDisplay(this.waveformHeightSource, this.waveformWidthSource, false, true);

    // MFCC analyzer worker
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
        this.context.participant.set({ sourceFileLoaded: true });
      }
    });

    this.worker.postMessage({
      type: 'message',
      data: "worker says hello",
    });

    //Audio bus 
    this.outputNode = new GainNode(this.context.audioContext);
    this.busNode = new GainNode(this.context.audioContext);
    this.sunVolume = new GainNode(this.context.audioContext);
    
    this.outputNode.connect(this.context.globalVolume);
    this.sunVolume.connect(this.outputNode);
    this.busNode.connect(this.sunVolume);

    // synth
    const getTimeFunction = () => this.context.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);
    this.grainPeriod = this.context.participant.get('grainPeriod');
    this.grainDuration = this.context.participant.get('grainDuration');
    this.synthEngine = new SynthEngine(this.context.audioContext, this.grainPeriod, this.grainDuration, this.sampleRate);
    this.synthEngine.connect(this.busNode);
    this.scheduler.add(this.synthEngine, this.context.audioContext.currentTime);

    // Callback for displaying cursors
    this.synthEngine.setAdvanceCallback(sourcePosPct => {
      this.sourceDisplay.setCursorTime(this.currentSource.duration * sourcePosPct);
    });

    this.context.participant.subscribe(updates => {
      if ('mosaicingActive' in updates) {
        updates.mosaicingActive ? this.synthEngine.start() : this.synthEngine.stop();
      }
      if ('sourceFilename' in updates) {
        this.setSourceFile(this.context.audioBufferLoader.data[updates.sourceFilename]);
      }
      if ('volume' in updates) {
        this.synthEngine.volume = decibelToLinear(updates.volume);
      }
      if ('detune' in updates) {
        this.synthEngine.detune = updates.detune * 100;
      }
      if ('grainPeriod' in updates) {
        this.synthEngine.setGrainPeriod(updates.grainPeriod);
      }
      if ('grainDuration' in updates) {
        this.synthEngine.setGrainDuration(updates.grainDuration);
      }
      if ("message" in updates) {
        const $messageBox = document.getElementById("messageBox");
        $messageBox.innerText = updates.message;
      }
      this.render();
    });

    // subscribe to controls from omega
    this.context.client.stateManager.observe(async (schemaName, stateId, nodeId) => {
      switch (schemaName) {
        case 'participant':
          const playerState = await this.context.client.stateManager.attach(schemaName, stateId);
          const playerName = playerState.get('name');
          if (playerName === 'Ω' || playerName === 'Ω*') {
            playerState.subscribe(updates => {
              if ('mosaicingData' in updates) {
                //this is received as an object
                // console.log('receiving', updates.mosaicingSynth)
                this.synthEngine.postData(Object.values(updates.mosaicingData));
              }
            });
          }
          break;
      }
    });

    // Previous values sliders
    this.currentValues = {
      volume: this.context.participant.get('volume'),
      detune: this.context.participant.get('detune'),
      grainPeriod: this.context.participant.get('grainPeriod'),
      grainDuration: this.context.participant.get('grainDuration'),
    };
    this.previousValues = {...this.currentValues};

  }

  setSourceFile(sourceBuffer) {
    console.log("loading source");
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
      sliderWidth = this.controlPanelWidth - 200;
    } else {
      sliderWidth = (this.controlPanelWidth - 400)/2;
    }
    const mosaicingActive = this.context.participant.get('mosaicingActive');
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


      <!-- Source -->
      <div style="
        display: flex;
        justify-content: center;
        margin: 20px 50px;
      "
      >
        <div>
          <h2>select source</h2>
          <div style="position: relative;">
            <sc-filetree
              style="
                height: 150px;
                width: 250px;
              "
              value="${JSON.stringify(this.context.soundbankTreeRender)}";
              @input="${e => {
                this.setSourceFile(this.context.audioBufferLoader.data[e.detail.value.name]);
                this.context.participant.set({ sourceFilename: e.detail.value.name });
              }}"
            ></sc-filetree>
            ${this.sourceDisplay.render()}
            <sc-transport
              id="transport-source"
              style="
                position: absolute;
                bottom: 4px;
                left: 260px;
                height: 40px;
              "
              .buttons=${["play", "stop"]}
              @change="${e => this.transportSourceFile(e.detail.value)}"
            ></sc-transport>
          </div>    
        </div>
      </div>

      <!-- Control panel -->
      <div style="
        margin: auto;
        padding: 10px 20px 30px;
        background-color: #525c68;
        width: ${this.controlPanelWidth}px
      "
      >
        <h2 style="
          color: ${mosaicingActive ? '#099309' : '#921515'}
        ">
          ${mosaicingActive ? 'playing' : 'stopped'}
        </h2>
        <div style="
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
                    style="width: ${sliderWidth}px;"
                    id="slider-${param}"
                    min="${schema[param].min}"
                    max="${schema[param].max}"
                    value="${this.context.participant.get(param)}"
                    number-box
                    @input="${e => this.updateParamValue(param, e.detail.value)}"
                    @change="${e => this.updateParamPrevValue(param, e.detail.value)}"
                  ></sc-slider>
                  <sc-button
                    style="width: 150px;"
                    @input="${e => this.switchValueSlider(param)}"
                  >previous value</sc-button>
                </div>
              </div>
            `
          })}
        </div> 
      </div>
    `
  }

}

