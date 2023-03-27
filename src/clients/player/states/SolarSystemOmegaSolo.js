import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import WaveformDisplay from '../../utils/WaveformDisplay';
import AnalyzerEngine from '../synth/AnalyzerEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';
import mfccWorkerString from '../../utils/mfcc.worker.js?inline';

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
      const now = Date.now();
      this.context.writer.write(`${now - this.context.startingTime}ms - moved selection : ${start}s, ${end}s`);
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

  render() {
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



      <!-- Recorder -->
      <div style="
        display: flex;
        justify-content: center;
        margin: 20px 50px;
      "
      >
        <div style="width: 1200px">
          <h2>record target</h2>
          <div style="position: relative">
            ${this.recorderDisplay.render()}
            <sc-record
              style="
                position: absolute;
                bottom: 4px; 
                left: 2px;
              "
              height="40"
              @change="${e => e.detail.value ? this.context.mediaRecorder.start() : this.context.mediaRecorder.stop()}"
            ></sc-record>
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

          <h2>satellites</h2>
          <!-- Clients -->
          <div style="
            margin-top: 20px;
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(370px, 370px));
            grid-gap: 38px;
          "
          >
            ${Object.entries(this.players).map(([name, state]) => { 
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
                      width="70"
                      text="reboot"
                      @input="${e => {
                        state.set({reboot: true});
                      }}"
                    ></sc-button>
                  </div>
                  <div style="
                    display: flex;
                    width: inherit;
                    justify-content: space-evenly;
                    align-items: center;
                  ">
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

                  <div style="
                    margin: 10px;
                    display: flex;
                    width: 350px;
                    justify-content: space-between;
                    align-items: center;
                  ">
                    volume
                    <sc-slider
                      min="-60"
                      max="0"
                      value="${state.get('volume')}"
                      width="300"
                      display-number
                      @input="${e => state.set({ volume: e.detail.value})}"
                    ></sc-slider>
                  </div>
                  <div style="
                    margin: 10px;
                    display: flex;
                    width: 350px;
                    justify-content: space-between;
                    align-items: center;
                  ">
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
                  <div style="
                    margin: 10px;
                    display: flex;
                    width: 350px;
                    justify-content: space-between;
                    align-items: center;
                  ">
                    period
                    <sc-slider
                      min="0.01"
                      max="0.1"
                      value="${state.get('grainPeriod')}"
                      width="300"
                      display-number
                      @input="${e => state.set({ grainPeriod: e.detail.value })}"
                    ></sc-slider>
                  </div>
                  <div style="
                    margin: 10px;
                    display: flex;
                    width: 350px;
                    justify-content: space-between;
                    align-items: center;
                  ">
                    duration
                    <sc-slider
                      min="0.02"
                      max="0.5"
                      value="${state.get('grainDuration')}"
                      width="300"
                      display-number
                      @input="${e => state.set({ grainDuration: e.detail.value })}"
                    ></sc-slider>
                  </div>
                  
                  

                </div>
              `  
            })}
          </div>

        </div>
      
      </div>
    `
  }


/*
  render() {
    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.checkinId}]</h1>
        </div>

        <div style="position: relative; padding-left: 20px; padding-right: 20px">
          <h3>target</h3>

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

          <div style="width: ${this.waveformWidth}px">
            <div style="display: flex">
              <div style="margin-right: 20px">
                <h3>global volume</h3>
                <sc-slider
                  min="-60"
                  max="6"
                  width="290"
                  value="${this.context.participant.get('volume')}"
                  display-number
                  @input="${e => this.context.participant.set({ volume: e.detail.value})}"
                ></sc-slider>
              </div>
              <div>
                <h3>global detune</h3>
                <sc-slider
                  min="-24"
                  max="24"
                  width="290"
                  value="${this.context.participant.get('detune')}"
                  display-number
                  @input="${e => this.context.participant.set({ detune: e.detail.value })}"
                ></sc-slider>
              </div> 
            </div>
            <div style="display: flex">
              <div style="margin-right: 20px">
                <h3>global grain period</h3>
                <sc-slider
                  min="0.01"
                  max="0.1"
                  width="290"
                  value="${this.context.participant.get('grainPeriod')}"
                  display-number
                  @input="${e => this.context.participant.set({ grainPeriod: e.detail.value })}"
                ></sc-slider>
              </div>
              <div>
                <h3>global grain duration</h3>
                <sc-slider
                  min="0.02"
                  max="0.5"
                  width="290"
                  value="${this.context.participant.get('grainDuration')}"
                  display-number
                  @input="${e => this.context.participant.set({ grainDuration: e.detail.value })}"
                ></sc-slider>
              </div>
            </div>
          </div>

          <div
            style="
              position: absolute;
              top: 0px;
              left: ${this.waveformWidth + 40}px;
              width: 820px;
            "
          >
            <h3>players</h3>

            <div>
              ${Object.entries(this.players).map(([name, state], j) => {
                return html`
                <div style="
                    position: absolute;
                    top: ${Math.floor(j / 2) * 230 + 40}px;
                    left: ${j%2 * 420}px;
                    width: 400px;
                  "
                >
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

                    <div style="margin:10px">
                      volume
                      <sc-slider
                        min="-60"
                        max="0"
                        value="${state.get('volume')}"
                        width="300"
                        display-number
                        @input="${e => state.set({ volume: e.detail.value})}"
                      ></sc-slider>
                    </div>
                    <div style="margin:10px">
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
                    <div style="margin:10px">
                      grain per.
                      <sc-slider
                        min="0.01"
                        max="0.1"
                        value="${state.get('grainPeriod')}"
                        width="300"
                        display-number
                        @input="${e => state.set({ grainPeriod: e.detail.value })}"
                      ></sc-slider>
                    </div>
                    <div style="margin:10px">
                      grain dur.
                      <sc-slider
                        min="0.02"
                        max="0.5"
                        value="${state.get('grainDuration')}"
                        width="300"
                        display-number
                        @input="${e => state.set({ grainDuration: e.detail.value })}"
                      ></sc-slider>
                    </div>
                  </div>
                `;
              })}
            </div>
          </div>

        </div>
      `
  }
*/

}

