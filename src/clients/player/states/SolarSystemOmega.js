import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import '@ircam/simple-components/sc-clock.js';
import WaveformDisplay from '../../utils/WaveformDisplay';
import AnalyzerEngine from '../synth/AnalyzerEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';
import mfccWorkerString from '../../utils/mfcc.worker.js?inline';

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
    this.grainPeriod = this.context.participant.get('grainPeriod');
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
          if (playerName !== 'Ω' && playerName !== 'Ω*') {
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
        flex-direction: column;
        margin: 20px 50px;
      "
      >
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
            grid-template-columns: repeat(auto-fit, minmax(196px, 196px));
            grid-gap: 38px;
          "
          >
            ${Object.entries(this.players).map(([name, state]) => { 
              return html`
                <div style="
                  padding: 5px 2px;
                  width: 196px;
                  height: 170px;
                  background-color: #1c1c1c;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: space-between;
                "
                >
                  <h1>${name}</h1>
                  <div style="text-align: center; overflow: hidden;">
                    <p>source: </p>
                    <p>${state.get('sourceFilename')}</p>
                  </div>
                  <sc-transport
                    buttons="[play, stop]"
                    width="50"
                    @change="${e => state.set({ mosaicingActive: e.detail.value === 'play'})}"
                    }}"
                  ></sc-transport>
                </div>
              `  
            })}
          </div>
        </div>
      </div>
    `
  }


}

