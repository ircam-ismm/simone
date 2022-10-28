import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import Mfcc from '..//Mfcc.js';
import decibelToLinear from '../math/decibelToLinear.js';
import WaveformDisplay from '../WaveformDisplay';
import createKDTree from 'static-kdtree';
import AnalyzerEngine from '../AnalyzerEngine';
import SynthEngine from '../SynthEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';
import mfccWorkerString from '../../utils/mfcc.worker.js?inline';

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

    // Waveform display
    this.waveformWidth = 800;
    this.waveformHeightSource = 200;
    this.waveformHeightTarget = 150;

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
    this.sourceDisplay = new WaveformDisplay(this.waveformHeightSource, this.waveformWidth, false, true);
    this.targetDisplay = new WaveformDisplay(this.waveformHeightTarget, this.waveformWidth, true, true, true);
    this.recorderDisplay = new WaveformDisplay(this.waveformHeightTarget, this.waveformWidth, false, false);

    // Callback for when selection on the display is modified
    this.targetDisplay.setCallbackSelectionChange((start, end) => {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.analyzerEngine.setLoopLimits(start, end);
      const now = Date.now();
      this.context.writer.write(`${now - this.context.startingTime}ms - moved selection : ${start}s, ${end}s`);
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
        this.analyzerEngine.setNorm(data.means, data.std); // values for normalization of data
        this.targetDisplay.setBuffer(this.currentTarget);
        // setting looping section back to 0
        this.targetDisplay.setSelectionStartTime(0);
        this.targetDisplay.setSelectionLength(this.currentTarget.duration);
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
      const now = Date.now();
      this.context.writer.write(`${now - this.context.startingTime}ms - set source file : recording-player-${idSourceToGet}.wav`);
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
        this.context.writer.write(`${now - this.context.startingTime}ms - started mosaicing`);
        break;
      case 'stop':
        this.analyzerEngine.stop();
        this.synthEngine.stop();
        this.context.writer.write(`${now - this.context.startingTime}ms - stopped mosaicing`);
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

  render() {
    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.checkinId}]</h1>
        </div>

        <div style="padding-left: 20px; padding-right: 20px">
          <div style="display: flex">
            <div>
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
            </div>
            <div style="margin-left: 20px">
              <h3>Message from experimenter</h3>
              <p id="messageBox"></p>
            </div>
          </div>



          <div style="margin: 20px; padding: 20px; position: relative">

            <div>
              <h3>start mosaicing</h3>
              <sc-transport
                style="display: block"
                id="transport-mosaicing"
                buttons="[play, stop]"
                width="50"
                @change="${e => this.transportMosaicing(e.detail.value)}"
              ></sc-transport>
            </div>

            <div
              style="
                position: absolute;
                top: 0;
                left: 150px;
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
                  this.context.participant.set({ volume: e.detail.value });
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
                left: 570px;
              "
            >

              <h3>grain period</h3>
              <sc-slider
                min="0.01"
                max="0.1"
                value="${this.context.participant.get('grainPeriod')}"
                width="300"
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
                  const now = Date.now();
                  this.context.writer.write(`${now - this.context.startingTime}ms - set grain period : ${e.detail.value}`);
                }}"
              ></sc-slider>

              <sc-button
                width="90"
                text="prev value"
                @input="${e => this.switchValueSlider('grainPeriod')}"
              >
              </sc-button>

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

          <h3>Source</h3>
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

      `
  }
}

