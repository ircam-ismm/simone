import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import Mfcc from 'waves-lfo/common/operator/Mfcc';
import WaveformDisplay from '../WaveformDisplay';
import MosaicingSynth from '../MosaicingSynth';
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
    this.sourceSampleRate = this.context.audioContext.sampleRate;
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
    });

    // Waveform display
    this.targetDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, true, true, true);
    this.recorderDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, false, false);

    // Callback for when selection on the display is changed
    this.targetDisplay.setCallbackSelectionChange((start, end) => {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.mosaicingSynth.setLoopLimits(start, end);
    });

    // Analyzer 
    this.mfcc = new Mfcc({
      nbrBands: this.mfccBands,
      nbrCoefs: this.mfccCoefs,
      minFreq: this.mfccMinFreq,
      maxFreq: this.mfccMaxFreq,
    });
    this.mfcc.initStream({
      frameSize: this.frameSize,
      frameType: 'signal',
      sourceSampleRate: this.sourceSampleRate,
    });

    // Synth (does not produce sound here)
    const getTimeFunction = () => this.context.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);

    // grain period for synthesis is here set to the maximum value by default.
    // Indeed if the default value was lower, going above it would mean that
    // this player's period would be longer than the other players and then data
    // sent by omega would then start accumulating without being processed fast enough
    // leading to progressive desynchronization of this player. 
    this.grainPeriod = 0.1;
    this.grainDuration = this.frameSize / this.sourceSampleRate;
    this.mosaicingSynth = new MosaicingSynth(this.context.audioContext, this.grainPeriod, this.grainDuration, this.scheduler, this.sourceSampleRate);
    this.mosaicingSynth.targetPlayerState = this.context.participant;
    
    // Callback for displaying cursors
    this.mosaicingSynth.setAdvanceCallback((targetPosPct, sourcePosPct) => {
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
      const analysis = this.computeMfcc(targetBuffer);
      this.mosaicingSynth.setTarget(targetBuffer);
      this.mosaicingSynth.setNorm(analysis[2], analysis[3]);
      // this.mosaicingSynth.setLoopLimits(0, targetBuffer.duration);
      this.mosaicingSynth.start();
      this.targetDisplay.setBuffer(targetBuffer);
      this.targetDisplay.setSelectionStartTime(0);
      this.targetDisplay.setSelectionLength(targetBuffer.duration);
    }
  }

  computeMfcc(buffer) { // make aynchronous ?
    console.log("analysing file");
    const mfccFrames = [];
    const times = [];
    const means = new Float32Array(this.mfccCoefs);
    const std = new Float32Array(this.mfccCoefs);
    const channelData = buffer.getChannelData(0);

    for (let i = 0; i < buffer.length; i += this.hopSize) {
      const frame = channelData.subarray(i, i + this.frameSize);
      times.push(i / this.sourceSampleRate);
      const cepsFrame = this.mfcc.inputSignal(frame);
      mfccFrames.push(Array.from(cepsFrame));
      for (let j = 0; j < this.mfccCoefs; j++) {
        means[j] += cepsFrame[j];
      }
    }
    // get means and std
    for (let j = 0; j < this.mfccCoefs; j++) {
      means[j] /= mfccFrames.length;
    }
    for (let i = 0; i < mfccFrames.length; i++) {
      const cepsFrame = mfccFrames[i];
      for (let j = 0; j < this.mfccCoefs; j++) {
        std[j] += (cepsFrame[j] - means[j]) ** 2
      }
    }
    for (let j = 0; j < this.mfccCoefs; j++) {
      std[j] /= mfccFrames.length;
      std[j] = Math.sqrt(std[j]);
    }

    // normalize
    for (let i = 0; i < mfccFrames.length; i++) {
      for (let j = 0; j < this.mfccCoefs; j++) {
        mfccFrames[i][j] = (mfccFrames[i][j] - means[j]) / std[j];
      }
    }
    console.log('analysis done');
    return [mfccFrames, times, means, std];
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
              @input="${e => this.setTargetFile(this.recordedBuffer)}"
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
                      @change="${e => e.detail.value === 'play' 
                        ? state.set({ mosaicingActive: true })
                        : state.set({ mosaicingActive: false })
                      }"
                    ></sc-transport>

                    <select 
                      style="
                        width: 200px;
                        height: 30px
                      "
                      @change="${e => {
                        if (e.target.value !== "") {
                          state.set({ sourceFilename: e.target.value })
                        }
                      }}"  
                    >
                      <option value="">select a source file</option>
                      ${Object.keys(this.context.audioBufferLoader.data).map(filename => {
                        return html`
                          <option value="${filename}">${filename}</option>
                        `
                      })}
                    </select>
                  </div>
                `;
              })}
            </div>
          </div>

        </div>
      `
  }
}

