
import '@ircam/sc-components/sc-button.js';
import '@ircam/sc-components/sc-slider.js';
import '@ircam/sc-components/sc-transport';
import '@ircam/sc-components/sc-loop.js';
import '@ircam/sc-components/sc-record.js';
import '@ircam/sc-components/sc-clock.js';
import '@ircam/sc-components/sc-midi.js';
import WaveformDisplay from '../../utils/WaveformDisplay';
import AnalyzerEngine from '../synth/AnalyzerEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';
import mfccWorkerString from '../../utils/mfcc.worker.js?inline';

const paramLabels = {
  volume: 'volume',
  detune: 'detune',
  grainPeriod: 'period',
  grainDuration: 'duration',
  randomizer: 'random',
};

export default class SolarSystemOmegaSolo extends State {
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
    this.analysisData = {
      frameSize: this.frameSize,
      hopSize: this.hopSize,
      sampleRate: this.sampleRate,
      mfccBands: this.mfccBands,
      mfccCoefs: this.mfccCoefs,
      mfccMinFreq: this.mfccMinFreq,
      mfccMaxFreq: this.mfccMaxFreq,
    };


    this.recording = false;
    this.recTime = 0;

    // panel displays
    this.panelType = 'satellite';
    this.renderSatellites = this.renderSatellites.bind(this);
    this.renderParameters = this.renderParameters.bind(this);
    this.panelRenders = {
      'satellite': this.renderSatellites,
      'parameters': this.renderParameters,
    }

    // presets
    this.presetMode = 'save';
    this.nPresets = 16;
    this.presets = {};

    // selected participants for global/group control
    this.groupControlStates = {};

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

    // Waveform display
    this.waveformWidthLarge = window.innerWidth - (100 * 2);
    this.waveformHeightLarge = 250;
    this.waveformWidthRecorder = window.innerWidth - 100;
    this.waveformHeightRecorder = 100;
    this.targetDisplay = new WaveformDisplay(this.waveformHeightLarge, this.waveformWidthLarge, true, true, true);
    this.recorderDisplay = new WaveformDisplay(this.waveformHeightRecorder, this.waveformWidthRecorder, false, false);

    // Callback for when selection on the display is changed
    this.targetDisplay.setCallbackSelectionChange((start, end) => {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.analyzerEngine.setLoopLimits(start, end);
    });

    // MFCC analyzer worker
    const workerBlob = new Blob([mfccWorkerString], { type: 'text/javascript' });
    const workerUrl = URL.createObjectURL(workerBlob);
    this.worker = new Worker(workerUrl);

    this.worker.addEventListener('message', e => {
      const { type, data } = e.data;
      if (type === "message") {
        console.log(data);
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
        this.analyzerEngine.start();
      }
    });

    this.worker.postMessage({
      type: 'message',
      data: "worker says hello",
    });

    // Synth (does not produce sound here)
    const getTimeFunction = () => this.context.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);

    // grain period for synthesis is here set to the maximum value by default.
    // Indeed if the default value was lower, going above it would mean that
    // this player's period would be longer than the other players and then data
    // sent by omega would then start accumulating without being processed fast enough
    // leading to progressive desynchronization of this player. 
    this.grainPeriod = 0.05;
    this.analyzerEngine = new AnalyzerEngine(this.context.audioContext, this.context.participant, this.grainPeriod, this.frameSize, this.sampleRate);
    this.scheduler.add(this.analyzerEngine, this.context.audioContext.currentTime);
    
    // Callback for displaying cursors
    this.analyzerEngine.setAdvanceCallback(targetPosPct => {
      this.targetDisplay.setCursorTime(this.currentTarget.duration * targetPosPct);
    });


    //Other players
    this.players = {};

    this.context.client.stateManager.observe(async (schemaName, stateId, nodeId) => {
      switch (schemaName) {
        case 'participant':
          const playerState = await this.context.client.stateManager.attach(schemaName, stateId);
          const playerName = playerState.get('name');
          if (playerName !== 'Ω' && playerName !== 'Ω*' ) {
            playerState.onDetach(() => {
              this.players[playerName] = null;
              delete this.groupControlStates[playerName];
              this.context.render();
            });
            playerState.subscribe(updates => {
              this.context.render();
            });

            this.players[playerName] = playerState;
            this.groupControlStates[playerName] = playerState;
            this.context.render();
          }
          break;
      }
    });

    // presets 
    this.presets = this.context.global.get('presets');

    this.context.render();
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

  setGroupParam(param, value) {
    Object.values(this.groupControlStates).forEach(state => {
      const update = {}
      update[param] = value;
      state.set(update);
    });
  }


  savePreset(i) {
    const newPreset = {};
    Object.entries(this.players).forEach(([name, state]) => {
      if (state) {
        const values = state.getValues();
        const params = {
          volume: values.volume,
          detune: values.detune,
          grainPeriod: values.grainPeriod,
          grainDuration: values.grainDuration,
          randomizer: values.randomizer,
        };
        newPreset[name] = params;
      }
    });
    this.presets[i] = newPreset;
    this.context.global.set({presets: this.presets});
  }

  loadPreset(i) {
    const preset = this.presets[i];
    if (preset) {
      Object.entries(this.players).forEach(([name, state]) => {
        if (state && name in preset) {
          const playerValues = preset[name];
          state.set(playerValues);
        }
      });
    }
  }


  renderParameters() {
    const nPlayers = Object.keys(this.players).length;

    return html`
      <div style="
          margin-top: 20px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(0px, ${nPlayers * 50 + 50}px));
          grid-gap: 38px;
          justify-content: space-between;
        "
      >
      ${
        ['volume', 'detune', 'grainPeriod', 'grainDuration', 'randomizer'].map(param => {
          return html`
            <div style="width: ${nPlayers * 50}px">
              <h3>${paramLabels[param]}</h3>
              <div
                style="
                  display: flex;
                "
              >
                ${Object.entries(this.players).map(([name, state]) => {
                  if (state) {
                    const schema = state.getSchema();
                    return html`
                      <div
                        style="
                          display: flex;
                          flex-direction: column;
                          align-items: center;
                          margin-right: 30px;
                        "
                      >
                        <p>${name}</p>
                        <sc-slider
                          id="slider-params-${name}-${param}"
                          style="
                            height: 200px;
                            width: 40px;
                          "
                          min="${schema[param].min}"
                          max="${schema[param].max}"
                          value="${state.get(param)}"
                          orientation="vertical"
                          @input="${e => {
                            const update = {};
                            update[param] = e.detail.value;
                            state.set(update);
                          }}"
                        ></sc-slider>
                      </div>
                    `
                  }
                })}
              </div>
            </div>
          `
        })
      }
    `
  } 

  renderSatellites() {
    return html`
      <!-- Clients -->
      <div style="
        margin-top: 20px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(370px, 370px));
        grid-gap: 38px;
      "
      >
        ${Object.entries(this.players).map(([name, state]) => {
          if (state) {
            return html`
              <div style="
                position: relative;
                padding: 5px 2px;
                width: 370px;
                background-color: #1c1c1c;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: space-between;
              "
              >
                <h1>${name}</h1>
                <div style="
                  position:absolute;
                  top: 10px;
                  right: 10px;
                "
                >
                  <sc-button
                    id="button-reboot-${name}"
                    style="width: 70px;"
                    @input="${e => {
                      state.set({ reboot: true });
                    }}"
                  >reboot</sc-button>
                </div>
                <div style="
                  display: flex;
                  width: inherit;
                  justify-content: space-evenly;
                  align-items: center;
                ">
                  <sc-transport
                    id="transport-mosaicing-${name}"
                    style="width: 50px;"
                    .buttons=${["play", "stop"]}
                    state="${state.get('mosaicingActive') ? 'play' : 'stop'}"
                    @change="${e => state.set({ mosaicingActive: e.detail.value === 'play' })}"
                  ></sc-transport>
                  <select 
                    style="
                      width: 200px;
                      height: 30px
                    "
                    @change="${e => {
                      if (e.target.value !== "") {
                        state.set({ sourceFilename: e.target.value, sourceFileLoaded: false });
                      }
                    }}"  
                  >
                    <option value="">select a source file</option>
                    ${Object.keys(this.context.audioBufferLoader.data).map(filename => {
                      if (state.get('sourceFilename') === filename) {
                        return html`
                                <option value="${filename}" selected>${filename}</option>
                              `
                      } else {
                        return html`
                                <option value="${filename}">${filename}</option>
                              `
                      }
                    })}
                  </select>

                  <div id="readyCircle-player${name}" style="
                    height: 10px;
                    width: 10px;
                    background: ${state.get('sourceFileLoaded') ? "green" : "red"};
                    clip-path: circle(5px at center);
                  ">
                  </div>
                </div>

                ${['volume', 'detune', 'grainPeriod', 'grainDuration', 'randomizer'].map(param => {
                  const schema = state.getSchema();
                  return html`
                    <div style="
                      margin: 10px;
                      display: flex;
                      width: 350px;
                      justify-content: space-between;
                      align-items: center;
                    ">
                      ${paramLabels[param]}
                      <sc-slider
                        id="slider-satellite-${name}-${param}"
                        style="width: 300px;"
                        min="${schema[param].min}"
                        max="${schema[param].max}"
                        value="${state.get(param)}"
                        number-box
                        @input="${e => {
                          const update = {};
                          update[param] = e.detail.value;
                          state.set(update);
                        }}"
                      ></sc-slider>
                    </div>
                  `
                })}
              </div>
            `
          } else {
            return html`
              <div style="
                position: relative;
                padding: 5px 2px;
                width: 370px;
                background-color: #1c1c1c;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: space-between;
              "
              >
                <h1>${name}</h1>
              </div>
            `
          }
        })}
      </div>
    `
  }

  render() {
    let groupSliderWidth;
    if (window.innerWidth < 1000) {
      groupSliderWidth = this.waveformWidthLarge;
    } else {
      groupSliderWidth = (this.waveformWidthLarge - 200) / 5;
    }

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
      </div>

      <sc-midi></sc-midi>

      <!-- Recorder -->
      <div style="
        display: flex;
        justify-content: center;
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
                bottom: 4px; 
                left: 2px;
                width: 40px;
                height: 40px;
              "
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
                height: 20px;
                width: 150px;
              "
              .getTimeFunction="${() => {
                if (this.recording) {
                  this.recTime = this.context.sync.getSyncTime() - this.startRecTime;
                }
                return this.recTime;
            }}"
            ></sc-clock>
          </div>
          <sc-button
            id="button-set-target"
            style="
              width: ${this.waveformWidthRecorder}px;
              height: 39px;
            "
            selected
            @input="${e => {
              this.setTargetFile(this.recordedBuffer);
            }}"
          >↓ use as target ↓</sc-button>
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
          </div>

          <h2>group controls</h2>
          <div style="
            display: flex;
            justify-content: space-between;
            flex-direction: ${window.innerWidth < 1000 ? 'column' : 'row'};
            align-items: ${window.innerWidth < 1000 ? 'flex-start' : 'flex-end'}
          ">
            <sc-transport
              style="height: 50px;"
              .buttons=${["play", "stop"]}
              @change="${e => this.setGroupParam('mosaicingActive', e.detail.value === 'play')}"
            ></sc-transport>
            ${['volume', 'detune', 'grainPeriod', 'grainDuration', 'randomizer'].map(param => {
              const schema = this.context.participant.getSchema();
              return html`
                <div>
                  <h3>${param}</h3>
                  <sc-slider
                    id="slider-group-${param}"
                    style="width: ${groupSliderWidth}px;"
                    min="${schema[param].min}"
                    max="${schema[param].max}"
                    number-box
                    @input="${e => this.setGroupParam(param, e.detail.value)}"
                  ></sc-slider>
                </div>
              `
            })}
          </div>

          <div style="margin-top: 10px">
              <sc-button
                id="button-group-all"
                style="width: 70px;"
                @input="${e => {
                  this.groupControlStates = {...this.players};
                  this.context.render();
                }}"
              >all</sc-button>
              <sc-button
                id="button-group-none"
                style="width: 70px;"
                @input="${e => {
                  this.groupControlStates = {};
                  this.context.render();
                }}"
              >none</sc-button>
              ${Object.entries(this.players).map(([name, state]) => {
                if (state) {
                  return html`
                    <sc-button
                      id="button-group-${name}"
                      style="width: 40px;"
                      .selected="${name in this.groupControlStates}"
                      @input="${e => {
                        if (name in this.groupControlStates) {
                          delete this.groupControlStates[name];
                        } else {
                          this.groupControlStates[name] = state;
                        }
                        this.context.render();
                      }}"
                    >${name}</sc-button>
                  `
                }
              })}
            </div>

          <div style="margin-top: 20px">
            <h2>panel type</h2>
            ${Object.keys(this.panelRenders).map(panelType => {
              return html`
                <sc-button
                  id="button-panel-${panelType}"
                  .selected="${panelType === this.panelType}"
                  @input="${e => {
                    this.panelType = panelType;
                    this.context.render();
                  }}"
                >${panelType}</sc-button>
              `
            })}
            
          </div>
          
          ${this.panelRenders[this.panelType]()}

        </div>
      </div>

      <!-- Presets -->
      <div style="
        margin: 20px 50px;
        padding-bottom: 20px;
      ">
        <h2>presets</h2>
        <sc-button
          id="button-preset-save"
          style="width: 70px;"
          .selected="${this.presetMode === 'save'}"
          @input="${e => {
            this.presetMode = 'save';
            this.context.render();
          }}"
        >save</sc-button>
        <sc-button
          id="button-preset-load"
          style="width: 70px;"
          .selected="${this.presetMode === 'load'}"
          @input="${e => {
            this.presetMode = 'load';
            this.context.render();
          }}"
        >load</sc-button>
        ${Array(this.nPresets).fill().map((_, i) => {
          return html`
            <sc-button
              id="button-preset-${i+1}"
              style="width: 70px;"
              .selected="${i+1 in this.presets}"
              @input="${e => {
                this.presetMode === 'save' ? this.savePreset(i+1) : this.loadPreset(i+1);
                this.context.render();
              }}"
            >${i + 1}</sc-button>
          `
        })}

      </div>
      
    `
  }

}

