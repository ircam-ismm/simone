import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import Mfcc from '../Mfcc.js';
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
    this.synthEngine.connect(this.context.audioContext.destination);
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
      }
    });

    // find player Ω and subscribe to incoming data
    this.context.client.stateManager.observe(async (schemaName, stateId, nodeId) => {
      switch (schemaName) {
        case 'participant':
          const playerState = await this.context.client.stateManager.attach(schemaName, stateId);
          const playerName = playerState.get('name');
          if (playerName === 'Ω') {
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



  render() {
    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.checkinId}]</h1>
        </div>

        <div style="padding-left: 20px; padding-right: 20px">

          <h3>Source</h3>

          <sc-file-tree
            value="${JSON.stringify(this.context.soundbankTreeRender)}";
            @input="${e => {
              this.setSourceFile(this.context.audioBufferLoader.data[e.detail.value.name]);
              const now = Date.now();
              this.context.writer.write(`${now - this.context.startingTime}ms - set source file : ${e.detail.value.name}`);
            }}"
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

          <div style="margin: 20px; padding: 20px; position: relative">

            <div
              style="
                position: absolute;
                top: 0;
                left: 0px;
              "
            >
              <h3>volume</h3>
              <sc-slider
                min="0"
                max="1"
                value="0.5"
                width="300"
                display-number
                @input="${e => this.synthEngine.volume = e.detail.value}"
              ></sc-slider>

              <h3>detune</h3>
              <sc-slider
                min="-24"
                max="24"
                value="0"
                width="300"
                display-number
                @input="${e => this.synthEngine.detune = e.detail.value * 100}"
                @change="${e => {
                  const now = Date.now();
                  this.context.writer.write(`${now - this.context.startingTime}ms - set detune : ${e.detail.value}`);
                }}"
              ></sc-slider>

            </div>

            <div
              style="
                position: absolute;
                top: 0;
                left: 330px;
              "
            >
              <h3>grain duration</h3>
              <sc-slider
                min="0.02321995"
                max="0.37"
                value="0.0928"
                width="300"
                display-number
                @input="${e => this.synthEngine.setGrainDuration(e.detail.value)}"
                @change="${e => {
                  const now = Date.now();
                  this.context.writer.write(`${now - this.context.startingTime}ms - set grain duration : ${e.detail.value}`);
                }}"
              ></sc-slider>
            </div>
          </div>
          

        </div>
      `
  }
}

