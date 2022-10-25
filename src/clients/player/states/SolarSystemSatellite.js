import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import Mfcc from '../Mfcc.js';
import decibelToLinear from '../math/decibelToLinear.js';
import WaveformDisplay from '../WaveformDisplay';
import createKDTree from 'static-kdtree';
import SynthEngine from '../SynthEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';

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

    // Waveform display
    this.waveformWidth = 600;
    this.waveformHeight = 200;

    this.targetPlayerState = this.context.participant;
  }

  async enter() {
    // Waveform display
    this.sourceDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, false, true);

    // Analyzer 
    this.mfcc = new Mfcc(this.mfccBands, this.mfccCoefs, this.mfccMinFreq, this.mfccMaxFreq, this.frameSize, this.sampleRate);

    // Synth
    this.playing = false; // whether or not sound is playing (this is controlled by omega)

    const getTimeFunction = () => this.context.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);

    // grain period for synthesis is here set to the maximum value by default.
    // Indeed if the default value was lower, going above it would mean that
    // this player's period would be longer than the other players and then data
    // sent by omega would then start accumulating without being processed fast enough
    // leading to progressive desynchronization of this player. 
    this.grainPeriod = 0.05;
    this.grainDuration = this.frameSize / this.sampleRate;
    this.synthData = []
    this.synthEngine = new SynthEngine(this.context.audioContext, this.synthData, this.grainPeriod, this.grainDuration, this.sampleRate);
    this.synthEngine.connect(this.context.globalVolume);
    this.scheduler.add(this.synthEngine, this.context.audioContext.currentTime);

    // Callback for displaying cursors
    this.synthEngine.setAdvanceCallback(sourcePosPct => {
      this.sourceDisplay.setCursorTime(this.currentSource.duration * sourcePosPct);
    });

    this.context.participant.subscribe(updates => {
      if ('mosaicingActive' in updates) {
        this.playing = updates.mosaicingActive;
      }
      if ('sourceFilename' in updates) {
        this.setSourceFile(this.context.audioBufferLoader.data[updates.sourceFilename]);
        this.context.participant.set({sourceFileLoaded: true});
      }
      if ('volume' in updates) {
        this.synthEngine.volume = decibelToLinear(updates.volume);
      }
      if ('detune' in updates) {
        this.synthEngine.detune = updates.detune * 100;
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

    // find player Ω and subscribe to incoming data
    this.context.client.stateManager.observe(async (schemaName, stateId, nodeId) => {
      switch (schemaName) {
        case 'participant':
          const playerState = await this.context.client.stateManager.attach(schemaName, stateId);
          const playerName = playerState.get('name');
          if (playerName === 'Ω' || playerName === 'Ω*') {
            playerState.subscribe(updates => {
              if ('mosaicingData' in updates) {
                if (this.playing) {
                  //this is received as an object
                  // console.log('receiving', updates.mosaicingSynth)
                  this.synthData.push(Object.values(updates.mosaicingData));
                }
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
      grainDuration: this.context.participant.get('grainDuration'),
    };
    this.previousValues = {...this.currentValues};

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
      case 'grainDuration':
        this.synthEngine.setGrainDuration(temp);
        this.context.participant.set({ grainDuration: temp });
        break;
    }
    this.render();
  }


  render() {
    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.checkinId}]</h1>
        </div>

        <div style="padding-left: 20px; padding-right: 20px">
          <div style="display: flex;">
            <div>
              <h3>Source</h3>

              <sc-file-tree
                value="${JSON.stringify(this.context.soundbankTreeRender)}";
                @input="${e => {
                  this.context.participant.set({ sourceFileLoaded: false});
                  this.setSourceFile(this.context.audioBufferLoader.data[e.detail.value.name]);
                  this.context.participant.set({ sourceFilename : e.detail.value.name});
                  const now = Date.now();
                  this.context.writer.write(`${now - this.context.startingTime}ms - set source file : ${e.detail.value.name}`);
                }}"
              ></sc-file-tree>

              <div style="
                display: inline;
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
            <div style="margin-left: 20px">
              <h3>Message from experimenter</h3>
              <p id="messageBox"></p>
            </div>
          </div>

          <div style="margin: 20px; padding: 20px; position: relative">

            <div
              style="
                position: absolute;
                top: 0;
                left: 0px;
              "
            >
              <h3>volume (dB)</h3>
              <sc-slider
                min="-60"
                max="0"
                value="${this.context.participant.get('volume')}"
                width="300"
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
                width="90"
                text="prev value"
                @input="${e => this.switchValueSlider('volume')}"
              >
              </sc-button>

              <h3>detune</h3>
              <sc-slider
                min="-24"
                max="24"
                value="${this.context.participant.get('detune')}"
                width="300"
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
                  const now = Date.now();
                  this.context.writer.write(`${now - this.context.startingTime}ms - set detune : ${e.detail.value}`);
                }}"
              ></sc-slider>

              <sc-button
                width="90"
                text="prev value"
                @input="${e => this.switchValueSlider('detune')}"
              >
              </sc-button>

            </div>

            <div
              style="
                position: absolute;
                top: 0;
                left: 420px;
              "
            >
              <h3>grain duration</h3>
              <sc-slider
                min="0.02"
                max="0.5"
                value="${this.context.participant.get('grainDuration')}"
                width="300"
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
                  const now = Date.now();
                  this.context.writer.write(`${now - this.context.startingTime}ms - set grain duration : ${e.detail.value}`);
                }}"
              ></sc-slider>

              <sc-button
                width="90"
                text="prev value"
                @input="${e => this.switchValueSlider('grainDuration')}"
              >
              </sc-button>
            </div>
          </div>
          

        </div>
      `
  }
}

