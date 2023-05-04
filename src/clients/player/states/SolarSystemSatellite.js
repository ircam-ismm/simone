import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import decibelToLinear from '../math/decibelToLinear.js';
import WaveformDisplay from '../../utils/WaveformDisplay';
import createKDTree from 'static-kdtree';
import SynthEngine from '../synth/SynthEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';
import mfccWorkerString from '../../utils/mfcc.worker.js?inline';

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
              if ('volume' in updates) {
                this.context.participant.set({ volume: updates.volume });
              }
              if ('detune' in updates) {
                this.context.participant.set({detune: updates.detune});
              }
              if ('grainPeriod' in updates) {
                this.context.participant.set({ grainPeriod: updates.grainPeriod });
              }
              if ('grainDuration' in updates) {
                this.context.participant.set({ grainDuration: updates.grainDuration });
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

  render() {
    let sliderWidth;
    if (window.innerWidth < 1000) {
      sliderWidth = this.controlPanelWidth - 200;
    } else {
      sliderWidth = (this.controlPanelWidth - 400)/2;
    }
    const mosaicingActive = this.context.participant.get('mosaicingActive');
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
            <sc-file-tree
              height="150"
              width="250"
              value="${JSON.stringify(this.context.soundbankTreeRender)}";
              @input="${e => {
                this.setSourceFile(this.context.audioBufferLoader.data[e.detail.value.name]);
                this.context.participant.set({ sourceFilename: e.detail.value.name });
              }}"
            ></sc-file-tree>
            ${this.sourceDisplay.render()}
            <sc-transport
              id="transport-source"
              style="
                position: absolute;
                bottom: 4px;
                left: 260px;
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
          display: flex;
          flex-direction: ${window.innerWidth < 1000 ? 'column' : 'row'};
          justify-content: space-between;
        "
        >
          <div>
            <!-- volume -->
            <div>
              <h3>volume (dB)</h3>
              <div>
                <sc-slider
                  id="slider-volume"
                  min="-70"
                  max="0"
                  value="${this.context.participant.get('volume')}"
                  width="${sliderWidth}"
                  display-number
                  @input="${e => {
                    this.synthEngine.volume = decibelToLinear(e.detail.value);
                    this.context.participant.set({volume: e.detail.value});
                  }}"
                  @change="${e => {
                    if (e.detail.value !== this.currentValues.volume) {
                      this.previousValues.volume = this.currentValues.volume;
                      this.currentValues.volume = e.detail.value;
                    }
                  }}"
                ></sc-slider>
                <sc-button
                  width="150"
                  text="previous value"
                  @input="${e => this.switchValueSlider('volume')}"
                >
              </div>
            </div>
                
            <!-- detune -->
            <div>
              <h3>detune</h3>
              <div>
                <sc-slider
                  id="slider-detune"
                  min="-24"
                  max="24"
                  value="${this.context.participant.get('detune')}"
                  width="${sliderWidth}"
                  display-number
                  @input="${e => {
                    this.synthEngine.detune = e.detail.value * 100;
                    this.context.participant.set({ detune: e.detail.value });
                  }}"
                  @change="${e => {
                    if (e.detail.value !== this.currentValues.detune) {
                      this.previousValues.detune = this.currentValues.detune;
                      this.currentValues.detune = e.detail.value;
                    }
                  }}"
                ></sc-slider>
                <sc-button
                  width="150"
                  text="previous value"
                  @input="${e => this.switchValueSlider('detune')}"
                >
              </div>
            </div>
          </div>

          <div>
            <!-- grain period -->
            <div>
              <h3>grain period</h3>
              <div>
                <sc-slider
                  id="slider-grainPeriod"
                  min="0.01"
                  max="0.3"
                  value="${this.context.participant.get('grainPeriod')}"
                  width="${sliderWidth}"
                  display-number
                  @input="${e => {
                    this.analyzerEngine.setPeriod(e.detail.value);
                    this.synthEngine.setGrainPeriod(e.detail.value);
                    this.context.participant.set({ grainPeriod: e.detail.value });
                  }}"
                  @change="${e => {
                    if (e.detail.value !== this.currentValues.grainPeriod) {
                      this.previousValues.grainPeriod = this.currentValues.grainPeriod;
                      this.currentValues.grainPeriod = e.detail.value;
                    }
                  }}"
                ></sc-slider>
                <sc-button
                  width="150"
                  text="previous value"
                  @input="${e => this.switchValueSlider('grainPeriod')}"
                >
              </div>
            </div>

            <!-- grain duration -->
            <div>
              <h3>grain duration</h3>
              <div>
                <sc-slider
                  id="slider-grainDuration"
                  min="0.02"
                  max="0.5"
                  value="${this.context.participant.get('grainDuration')}"
                  width="${sliderWidth}"
                  display-number
                  @input="${e => {
                    this.synthEngine.setGrainDuration(e.detail.value);
                    this.context.participant.set({ grainDuration: e.detail.value });
                  }}"
                  @change="${e => {
                    if (e.detail.value !== this.currentValues.grainDuration) {
                      this.previousValues.grainDuration = this.currentValues.grainDuration;
                      this.currentValues.grainDuration = e.detail.value;
                    }
                  }}"
                ></sc-slider>
                <sc-button
                  width="150"
                  text="previous value"
                  @input="${e => this.switchValueSlider('grainDuration')}"
                >
              </div>
            </div>
          </div>
        </div> 
      </div>
    `
  }

}

