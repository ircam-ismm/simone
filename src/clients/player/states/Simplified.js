import '@ircam/sc-components/sc-slider.js';
import '@ircam/sc-components/sc-transport';
import '@ircam/sc-components/sc-record.js';
import decibelToLinear from '../math/decibelToLinear.js';
import WaveformDisplay from '../../utils/WaveformDisplay';
import createKDTree from 'static-kdtree';
import AnalyzerEngine from '../synth/AnalyzerEngine';
import SynthEngine from '../synth/SynthEngine';
import { Scheduler } from 'waves-masters';
import State from './State.js';
import { html } from 'lit/html.js';
import mfccWorkerString from '../../utils/mfcc.worker.js?inline';

export default class Simplified extends State {
  constructor(name, context) {
    super(name, context);

    this.currentSource = null;
    this.currentTarget = null;

    // parameters for audio analysis
    this.frameSize = 2048;
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

    this.cleanBuffer = this.context.audioContext.createBuffer(1, 4000, this.context.audioContext.sampleRate);
    const cleanBufferData = this.cleanBuffer.getChannelData(0);
    for (let i = 0; i < this.cleanBuffer.length; i++) {
      cleanBufferData[i] = 0;
    }
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
      if ("sourceFilename" in updates) {
        this.setSourceFile(this.context.audioBufferLoader.data[updates.sourceFilename]);
      }
      if ('mosaicingData' in updates) {
        //this is received as an object
        // console.log('receiving', updates.mosaicingSynth)
        this.synthEngine.postData(Object.values(updates.mosaicingData));
      }
      if ('clean' in updates) {
        this.analyzerEngine.setTarget(this.cleanBuffer);
        this.targetDisplay.setBuffer(this.cleanBuffer);
        this.recorderDisplay.setBuffer(this.cleanBuffer);
      }
    });

    // Waveforms display
    this.targetDisplay = new WaveformDisplay(this.waveformHeightTarget, this.waveformWidth, true, true);
    this.recorderDisplay = new WaveformDisplay(this.waveformHeightTarget, this.waveformWidth, false, false);

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
    const now = Date.now();
    switch (state) {
      case 'play':
        this.analyzerEngine.start();
        this.synthEngine.start();
        break;
      case 'stop':
        this.analyzerEngine.stop();
        this.synthEngine.stop();
        break;
    }
  }


  render() {
    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.checkinId}]</h1>
        </div>

        <div style="
            width: ${this.waveformWidth}px;
            margin-right: auto;
            margin-left: auto;
          "
        >
          <div style="margin-bottom: 5px; position: relative; height: 50px;">
            <sc-record
              style="
                float: left;
                height: 50px;
              "
              @change="${e => e.detail.value ? this.context.mediaRecorder.start() : this.context.mediaRecorder.stop()}"
            ></sc-record>

            <h2 style="position: absolute; left: 60px">
              1. Record sound
            </h2>
          </div>

          <div style="position: relative">
            ${this.recorderDisplay.render()}
          </div>

          <div style="
              height: 100px;
              position: relative;
            "
          >
            <sc-button
              style="
                height: 40px;
                width: 150px;
              "
              @input="${e => {
                this.setTargetFile(this.recordedBuffer);
              }}"
            >2. load sound</sc-button>

            <div style="
              position: absolute;
              left:50px;
            ">
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                height="70px" 
                width="40px" 
                viewBox="0 0 100 100"
              >
                <line x1="50" y1="-30" x2="50" y2="80" stroke="white" stroke-width="10"/>
                <polygon points="20,60 50,100 80,60" fill="white"/>
              </svg>
            </div>

          
            <div style="width: 400px; position: absolute; top: 0; left: 40%; margin-top: 20px">
              <sc-transport
                style="
                  float: left;
                  margin-right: 10px;
                  width: 50px;
                "
                id="transport-mosaicing"
                .buttons=${["play", "stop"]}
                @change="${e => this.transportMosaicing(e.detail.value)}"
              ></sc-transport>
              <h2>3. Play</h2>
            </div>

          </div>

          <div style="position: relative">
            ${this.targetDisplay.render()}
          </div>

          <div style="font-size: small;">
            <p>select a loop by right-clicking on the waveform</p>
          </div>

          <div style="display: flex; margin-top: 20px">
            <div style="margin-right: 40px">
              <h2>volume</h2>
              <sc-slider
                style="width: 240px;"
                id="slider-volume"
                min="-70"
                max="0"
                value="${this.context.participant.get('volume')}"
                @input="${e => {
                  this.synthEngine.volume = decibelToLinear(e.detail.value);
                  this.context.participant.set({volume: e.detail.value});
                }}"
              ></sc-slider>
            </div>

            <div style="margin-right: 40px">
              <h2>pitch</h2>
              <sc-slider
                style="width: 240px;"
                id="slider-detune"
                min="-12"
                max="12"
                value="${this.context.participant.get('detune')}"
                @input="${e => {
                  this.synthEngine.detune = e.detail.value * 100;
                  this.context.participant.set({ detune: e.detail.value });
                }}"
              ></sc-slider>
              <div style="
                  display: flex;
                  justify-content: space-between;
                  font-size: small;
                "
              >
                <p>low-pitched</p>
                <p>high-pitched</p>
              </div>
            </div>

            <div style="margin-right: 30px">
              <h2>density</h2>
              <sc-slider
                style="width: 240px;"
                id="slider-density"
                min="0"
                max="1"
                value="0.5"
                @input="${e => {
                  const duration = 0.48*e.detail.value + 0.02;
                  const period = -0.18*e.detail.value + 0.2;
                  const densityGain = 1 - 0.5*e.detail.value;
                  const now = this.context.audioContext.currentTime;
                  this.analyzerEngine.setPeriod(period);
                  this.synthEngine.setGrainPeriod(period);
                  this.synthEngine.setGrainDuration(duration);
                  this.densityGain.gain.setTargetAtTime(densityGain, now, 0.02);
                  this.context.participant.set({ grainDuration: duration });
                  this.context.participant.set({ grainPeriod: period });
                }}"
              ></sc-slider>
              <div style="
                  display: flex;
                  justify-content: space-between;
                  font-size: small;
                "
              >
                <p>- dense</p>
                <p>+ dense</p>
              </div>
            </div>
          </div>

        </div>

      `
  }
}

