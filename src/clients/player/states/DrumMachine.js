import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import '@ircam/simple-components/sc-clock.js';
import decibelToLinear from '../math/decibelToLinear.js';
import WaveformDisplay from '../../utils/WaveformDisplay';
import createKDTree from 'static-kdtree';
import AnalyzerEngine from '../synth/AnalyzerEngine';
import SynthEngine from '../synth/SynthEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';
import mfccWorkerString from '../../utils/mfcc.worker.js?inline';

export default class DrumMachine extends State {
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

    this.recording = false;
    this.recTime = 0;

    // Mosaicing
    this.bpm = 120; 
    this.nFramesBeat = 8; // initial length of the looping section (in number of frames)
    this.selectionLength = this.nFramesBeat*this.frameSize/44100;
    this.maxNFramesBeat = 64 // maximum length of looping section (in n of frames)
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
      if ('mosaicingData' in updates) {
        //this is received as an object
        // console.log('receiving', updates.mosaicingSynth)
        this.synthEngine.postData(Object.values(updates.mosaicingData));
      }
    });

    // Waveforms display
    this.waveformWidthLarge = window.innerWidth - (100 * 2);
    if (window.innerWidth < 1000) {
      this.waveformWidthRecorder = window.innerWidth - 100;
      this.waveformWidthSource = window.innerWidth - 360;
    } else {
      this.waveformWidthRecorder = this.waveformWidthLarge / 2;
      this.waveformWidthSource = this.waveformWidthLarge / 2 - 260;
    }
    this.waveformHeightLarge = 250;
    this.waveformHeightRecorder = 100;
    this.waveformHeightSource = 140;
    this.sourceDisplay = new WaveformDisplay(this.waveformHeightSource, this.waveformWidthSource, false, true);
    this.targetDisplay = new WaveformDisplay(this.waveformHeightLarge, this.waveformWidthLarge, true, true, false);
    this.recorderDisplay = new WaveformDisplay(this.waveformHeightRecorder, this.waveformWidthRecorder, false, false);

    // Callback for when selection on the display is moved
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
      if (type === "analyze-source") {
        const searchTree = createKDTree(data.mfccFrames);
        console.log("Tree created")
        this.synthEngine.setBuffer(this.currentSource);
        this.synthEngine.setSearchSpace(searchTree, data.times);
        this.sourceDisplay.setBuffer(this.currentSource);
      }
      if (type === "analyze-target") {
        this.analyzerEngine.setTarget(this.currentTarget);
        this.analyzerEngine.setNorm(data.means, data.std, data.minRms, data.maxRms); // values for normalization of data
        this.targetDisplay.setBuffer(this.currentTarget);
        // setting looping section back to 0
        this.targetDisplay.setSelectionStartTime(0);
        this.targetDisplay.setSelectionLength(this.nFramesBeat * this.frameSize / this.sampleRate);
      }
    });

    this.worker.postMessage({
      type: 'message',
      data: "worker says hello",
    });

    // Mosaicing synth
    const getTimeFunction = () => this.context.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);

    this.densityGain = new GainNode(this.context.audioContext);
    this.densityGain.connect(this.context.globalVolume);

    this.grainPeriod = this.context.participant.get('grainPeriod');
    this.grainDuration = this.context.participant.get('grainDuration');
    this.analyzerEngine = new AnalyzerEngine(this.context.audioContext, this.context.participant, this.grainPeriod, this.frameSize, this.sampleRate);
    this.synthEngine = new SynthEngine(this.context.audioContext, this.grainPeriod, this.grainDuration, this.sampleRate);
    this.synthEngine.connect(this.densityGain);
    this.scheduler.add(this.analyzerEngine, this.context.audioContext.currentTime);
    this.scheduler.add(this.synthEngine, this.context.audioContext.currentTime);

    // Callback for displaying cursors
    this.analyzerEngine.setAdvanceCallback(targetPosPct => {
      this.targetDisplay.setCursorTime(this.currentTarget.duration * targetPosPct);
    });
    this.synthEngine.setAdvanceCallback(sourcePosPct => {
      this.sourceDisplay.setCursorTime(this.currentSource.duration * sourcePosPct);
    });

    // Previous values sliders
    this.currentValues = {
      volume: this.context.participant.get('volume'),
      detune: this.context.participant.get('detune'),
      grainPeriod: this.context.participant.get('grainPeriod'),
      grainDuration: this.context.participant.get('grainDuration'),
      density: this.context.participant.get('density'),
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
    // callback for handling transport buttons on source sound display
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
    // callback for handling transport buttons on transport sound display
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
    // Callback for handling transport buttons for mosaicing
    const now = Date.now();
    switch (state) {
      case 'play':
        // Mosaicing must start at a time synced with the other players
        const beatLength = this.nFramesBeat * this.frameSize / this.sampleRate;
        const currentSyncTime = this.context.sync.getSyncTime();
        const nextStartTime = Math.ceil(currentSyncTime / beatLength) * beatLength;
        const nextStartTimeLocal = this.context.sync.getLocalTime(nextStartTime);
        this.scheduler.defer(() => {
          this.analyzerEngine.start();
          this.synthEngine.start();
        }, nextStartTimeLocal);
        break;
      case 'stop':
        this.analyzerEngine.stop();
        this.synthEngine.stop();
        break;
    }
  }

  changeSelectionLength(type) {
    // Callback for changing length of looping section (*2 or /2)
    if (type === 'longer') {
      const newLength = this.selectionLength * 2;
      // New looping section must not go out of bounds and is cannot exceed max value
      if (this.nFramesBeat * 2 <= this.maxNFramesBeat && this.selectionStart + newLength < this.currentTarget.duration) {
        this.nFramesBeat *= 2;
        this.selectionLength = this.nFramesBeat * this.frameSize / this.sampleRate;
        this.targetDisplay.setSelectionLength(this.selectionLength);
      }
    } else {
      // New looping section must not last less than a frame long
      if (this.nFramesBeat / 2 >= 1) {
        this.nFramesBeat /= 2;
        this.selectionLength = this.nFramesBeat * this.frameSize / this.sampleRate;
        this.targetDisplay.setSelectionLength(this.selectionLength);
      }

    }
  }

  densityToGrain(density) {
    const period = -0.18 * density + 0.2;
    const duration = 0.48 * density + 0.02;
    const densityGain = 1 - 0.5 * density;
    return [period, duration, densityGain];
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
      case 'density': 
        const [period, duration, densityGain] = this.densityToGrain(temp);
        const now = this.context.audioContext.currentTime;
        this.analyzerEngine.setPeriod(period);
        this.synthEngine.setGrainPeriod(period);
        this.synthEngine.setGrainDuration(duration);
        this.densityGain.gain.setTargetAtTime(densityGain, now, 0.02);
        this.context.participant.set({ density: temp});
        break;
    }
    this.render();
  }



  render() {
    let sliderWidth;
    if (window.innerWidth < 1000) {
      sliderWidth = this.waveformWidthLarge - 160;
    } else {
      sliderWidth = (this.waveformWidthLarge - 30) / 2 - 160;
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
        <div style="margin-left: 20px; width: 300px;">
          <h3>Message from experimenter</h3>
          <p id="messageBox"></p>
        </div>
      </div>


      <!-- Recorder and source -->
      <div style="
        display: flex;
        justify-content: space-between;
        flex-direction: ${window.innerWidth < 1000 ? 'column' : 'row'};
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
        
        <div>
          <h2>select source</h2>
          <div style="position: relative;">
            <sc-file-tree
              height="140"
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
            <sc-transport
              style="
                position: absolute;
                bottom: 4px;
                left: 2px;
              "
              id="transport-mosaicing"
              buttons="[play, stop]"
              width="60"
              @change="${e => this.transportMosaicing(e.detail.value)}"
            ></sc-transport>
            <sc-button
              style="
                position: absolute;
                bottom: 4px;
                left: ${this.waveformWidthLarge - 130}px;
              "
              width="60"
              height="60"
              text="*2"
              @input="${e => this.changeSelectionLength("longer")}"
            ></sc-button>
            <sc-button
              style="
                position: absolute;
                bottom: 4px;
                left: ${this.waveformWidthLarge - 65}px;
              "
              width="60"
              height="60"
              text="/2"
              @input="${e => this.changeSelectionLength("smaller")}"
            ></sc-button>
          </div>

          <!-- Sliders -->
          <div style="
            margin-top: 20px;
            display: flex;
            justify-content: space-between;
            flex-direction: ${window.innerWidth < 1000 ? 'column' : 'row'};
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
                    min="-12"
                    max="12"
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
      </div>

    `
  }

}
