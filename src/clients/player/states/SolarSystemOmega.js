import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import Mfcc from '../Mfcc.js';
import WaveformDisplay from '../WaveformDisplay';
import AnalyzerEngine from '../AnalyzerEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';

export default class SolarSystemOmega extends State {
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

    // Waveform display
    this.waveformWidth = 600;
    this.waveformHeight = 150;

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
      const now = Date.now();
      this.context.writer.write(`${now - this.context.startingTime}ms - recorded new file`);
    });

    // Waveform display
    this.targetDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, true, true, true);
    this.recorderDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, false, false);

    // Callback for when selection on the display is changed
    this.targetDisplay.setCallbackSelectionChange((start, end) => {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.analyzerEngine.setLoopLimits(start, end);
      const now = Date.now();
      this.context.writer.write(`${now - this.context.startingTime}ms - moved selection : ${start}s, ${end}s`);
    });

    // Analyzer 
    this.mfcc = new Mfcc(this.mfccBands, this.mfccCoefs, this.mfccMinFreq, this.mfccMaxFreq, this.frameSize, this.sampleRate);

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
          if (playerName !== 'Ω') {
            playerState.onDetach(() => {
              delete this.players[playerName];
              this.context.render();
            });
            playerState.subscribe(updates => {
              this.context.render();
            });

            this.players[playerName] = playerState;
            this.context.render();
          }
          break;
      }
    });
  }


  setTargetFile(targetBuffer) {
    if (targetBuffer) {
      this.currentTarget = targetBuffer;
      const analysis = this.mfcc.computeBufferMfcc(targetBuffer, this.hopSize);
      this.analyzerEngine.setTarget(targetBuffer);
      this.analyzerEngine.setNorm(analysis[2], analysis[3]);
      // this.mosaicingSynth.setLoopLimits(0, targetBuffer.duration);
      this.targetDisplay.setBuffer(targetBuffer);
      this.targetDisplay.setSelectionStartTime(0);
      this.targetDisplay.setSelectionLength(targetBuffer.duration);
      this.analyzerEngine.start();
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


  render() {
    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.checkinId}]</h1>
        </div>

        <div style="position: relative; padding-left: 20px; padding-right: 20px">
          <h3>Target</h3>

          <div style="position: relative">
            ${this.targetDisplay.render()}
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
              @input="${e => {
                this.setTargetFile(this.recordedBuffer);
                const now = Date.now();
                this.context.writer.write(`${now - this.context.startingTime}ms - set new target sound`);
              }}"
            ></sc-button>
          </div>

          <div
            style="
              position: absolute;
              top: 0px;
              left: ${this.waveformWidth + 40}px;
              width: 400px;
            "
          >
            <h3>Players</h3>

            <div>
              ${Object.entries(this.players).map(([name, state]) => {
                return html`
                  <div style="
                      display: flex;
                      justify-content: space-around;
                      align-items: center;
                      margin-bottom: 20px;
                    "
                  >
                    <h2>
                      ${name}
                    </h2>

                    <sc-transport
                      buttons="[play, stop]"
                      width="50"
                      @change="${e => {
                        if (e.detail.value === 'play') {
                          state.set({ mosaicingActive: true });
                          const now = Date.now();
                          this.context.writer.write(`${now - this.context.startingTime}ms - started mosaicing player ${name}`);
                        } else {
                          state.set({ mosaicingActive: false });
                          const now = Date.now();
                          this.context.writer.write(`${now - this.context.startingTime}ms - stopped mosaicing player ${name}`);
                        }
                      }}"
                    ></sc-transport>

                    <select 
                      style="
                        width: 200px;
                        height: 30px
                      "
                      @change="${e => {
                        if (e.target.value !== "") {
                          state.set({ sourceFilename: e.target.value, sourceFileLoaded: false});
                          const now = Date.now();
                          this.context.writer.write(`${now - this.context.startingTime}ms - set source player ${name} : ${e.target.value}`);
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
                  <div>
                    volume
                    <sc-slider
                      min="0"
                      max="1"
                      value="${state.get('volume')}"
                      width="300"
                      display-number
                      @input="${e => state.set({ volume: e.detail.value})}"
                    ></sc-slider>
                  </div>
                  <div>
                    detune
                    <sc-slider
                      min="-24"
                      max="24"
                      value="${state.get('detune')}"
                      width="300"
                      display-number
                      @input="${e => state.set({ detune: e.detail.value })}"
                    ></sc-slider>
                  </div>
                  <div>
                    grain dur.
                    <sc-slider
                      min="0.02321995"
                      max="0.37"
                      value="${state.get('grainDuration')}"
                      width="300"
                      display-number
                      @input="${e => state.set({ grainDuration: e.detail.value })}"
                    ></sc-slider>
                  </div>
                `;
              })}
            </div>
          </div>

        </div>
      `
  }
}

