import { AbstractExperience } from '@soundworks/core/client';
import { render, html } from 'lit-html';
import renderInitializationScreens from '@soundworks/template-helpers/client/render-initialization-screens.js';
import { Scheduler } from 'waves-masters';
import Yin from './yin';
import Mfcc from './Mfcc';
import '@ircam/simple-components/sc-number.js';
import '@ircam/simple-components/sc-text.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';

class PlayerExperience extends AbstractExperience {
  constructor(client, config, $container, audioContext) {
    super(client);

    this.config = config;
    this.$container = $container;
    this.rafId = null;
    this.audioContext = audioContext;

    // microphone stuff
    this.micStream = null
    this.mediaRecorder = null;
    // this.recordedChunks = new Array();
    this.fileReader = new FileReader();
    this.audioBuffer = null;
    this.decodingDuration = 0;

    // Analysis
    this.frameSize = 2048;
    this.sourceSampleRate = 44100;
    // this.frameOverlap = 0.5 // using scriptProcessor means no overlap between frames

    this.currFreq = 0;
    this.currRms = 0;

    // require plugins if needed

    this.platform = this.require('platform');
    this.sync = this.require('sync');
    this.synthScripting = this.require('synth-scripting');

    renderInitializationScreens(client, config, $container);
  }

  async start() {
    super.start();


    // shared states
    this.dataFromMic = await this.client.stateManager.create('dataFromMic');

    // Scheduler 
    const getTimeFunction = () => this.sync.getSyncTime();
    this.scheduler = new Scheduler(getTimeFunction);


    // getting access to microphone
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseReduction: false, autoGainControl: false }, video: false });
      console.log(this.micStream);
      console.log('access to microphone granted');
    } catch (err) {
      console.log('ERROR: could not access microphone');
      console.log(err);
    }

    // audio path : getting source from mic and piping it to analyzer
    const source = new MediaStreamAudioSourceNode(this.audioContext, {mediaStream: this.micStream});
    const analyzer = new AnalyserNode(this.audioContext);
    const scriptNode = this.audioContext.createScriptProcessor(this.frameSize, 1, 0);

    source.connect(scriptNode);

    // Yin alg for f0 detection
    const yin = new Yin();
    yin.initStream({
      frameSize: this.frameSize,
      frameType: 'signal',
      sourceSampleRate: this.sourceSampleRate,
    });

    const numMfccCoefs = 12;
    const mfcc = new Mfcc({
      nbrCoefs: numMfccCoefs,
      maxFreq: 4000,
    });
    mfcc.initStream({
      frameSize: this.frameSize,
      frameType: 'signal',
      sourceSampleRate: this.sourceSampleRate,
    });

    // circular buffers for storing descriptors
    Number.prototype.mod = function (n) {
      var m = ((this % n) + n) % n;
      return m < 0 ? m + Math.abs(n) : m;
    };

    const bufferLength = 20;
    this.avgLength = 3 // nb of frames over which to compute average value for each descriptor
    let framesSinceStart = 0; // can't perform average over the first frames
    const frequencyBuffer = new Array(bufferLength);
    frequencyBuffer[bufferLength-1] = 0; 
    const rmsBuffer = new Array(bufferLength);
    const zcrBuffer = new Array(bufferLength);
    const mfccBuffer = new Array(bufferLength);
    let idxBuffer = 0;

    // Calibration
    this.calibration = {
      'minFreq' : {
        'status': false,
        'value': null,
      },
      'maxFreq': {
        'status': false,
        'value': null,
      },
      'maxRms': {
        'status': false,
        'value': null,
      },
    };

    // Analysis is made every new frame

    scriptNode.onaudioprocess = (audioProcessingEvent) => {
      const inputBuffer = audioProcessingEvent.inputBuffer;
      const input = inputBuffer.getChannelData(0);
      
      //Compute descriptors
      // rms
      const rmsArray = this.rms(input);
      // zero crossing rate
      const zcrArray = this.zeroCrossingRate(input);
      // yin
      const yinRes = yin.inputSignal(input);
      const frequencyArray = yinRes[0];
      // mfcc
      const mfccArray = mfcc.inputSignal(input);


      // Store them in buffers 
      rmsBuffer[idxBuffer] = rmsArray;
      zcrBuffer[idxBuffer] = zcrArray;
      if (frequencyArray < 0) {
        const prevIdx = (idxBuffer - 1).mod(bufferLength);
        frequencyBuffer[idxBuffer] = frequencyBuffer[prevIdx];
      } else {
        frequencyBuffer[idxBuffer] = frequencyArray;
      } 
      mfccBuffer[idxBuffer] = mfccArray;
      // Values are averaged over the last this.avgLength frames
      let avgRms = rmsArray;
      let avgZcr = zcrArray;
      let avgFrequency = frequencyArray;
      let avgMfcc = mfccArray;
      const nFrames = Math.min(framesSinceStart + 1, this.avgLength)
      for (let i = 1; i < nFrames; i++ ) {
        const idx = (idxBuffer - i).mod(bufferLength);
        avgRms += rmsBuffer[idx];
        avgZcr += zcrBuffer[idx];
        avgFrequency += frequencyBuffer[idx];
        for (let c = 0; c < numMfccCoefs; c++){
          avgMfcc[c] += mfccBuffer[idx][c];
        }
      }
      avgRms /= nFrames;
      avgZcr /= nFrames;
      avgFrequency /= nFrames;
      for (let c = 0; c < numMfccCoefs; c++) {
        avgMfcc[c] /= nFrames;
      }

      // Values are sent over the network (or not during calibration)
      this.currRms = avgRms;
      this.currZcr = avgZcr;
      this.currFrequency = avgFrequency;
      this.currMfcc = avgMfcc;
      
      console.log(this.currMfcc);

      const micMuted = this.dataFromMic.get('muted');
      if (this.calibration.minFreq.status) {
        this.calibration.minFreq.value = Math.min(this.calibration.minFreq.value, this.currFreq);
      } else if (this.calibration.maxFreq.status) {
        this.calibration.maxFreq.value = Math.max(this.calibration.maxFreq.value, this.currFreq);
      } else if (this.calibration.maxRms.status) {
        this.calibration.maxRms.value = Math.max(this.calibration.maxRms.value, this.currRms);
      } else if (!micMuted) {
        this.dataFromMic.set({ 
          frequency: this.currFreq, 
          rms: this.currRms,
          zeroCrossingRate: this.currZcr,
          mfcc: this.currMfcc, 
        });
      }

      if (framesSinceStart < bufferLength) {framesSinceStart++};
      idxBuffer++;
      idxBuffer = idxBuffer.mod(bufferLength);
      this.render();

    }
  
    // // Frequency and energy is computed on each frame recorded by microphone
    // const timeAdvancement = (1-this.frameOverlap)*this.frameSize/this.sourceSampleRate;

    // const advanceTime = (currentTime, audioTime, dt) => {
    //   analyzer.getFloatTimeDomainData(dataArray);
    //   const yinRes = yin.inputSignal(dataArray);
    //   const freqDetected = yinRes[0];
    //   const energy = this.rmse(dataArray);
      
    //   if (freqDetected < 0) {nZeroFreq++};  // count number if frames with an actual freq detected
    //   freqArray[idxArray] = yinRes[0];
    //   energyArray[idxArray] = energy;
    //   idxArray++;
    //   if (idxArray === freqArray.length) {
    //     if (nZeroFreq < 1) {
    //       let avgFreq = 0;
    //       let avgEnergy = 0;
    //       for (let i = 0; i < freqArray.length; i++) {
    //         if (freqArray[i] > 0) {
    //           avgFreq += freqArray[i]
    //           avgEnergy += energyArray[i];
    //         }
    //       }
    //       this.currFreq = avgFreq/(freqArray.length-nZeroFreq);
    //       this.currRms = avgEnergy/(freqArray.length - nZeroFreq);
    //       const micMuted = this.dataFromMic.get('muted');
    //       // const $freqDisplay = document.getElementById('frequency-display');
    //       // $freqDisplay.setAttribute('value', avgFreq);
    //       // const $rmsDisplay = document.getElementById('rms-display');
    //       // $rmsDisplay.setAttribute('value', avgEnergy);
    //       if (this.calibration.minFreq.status) {
    //         this.calibration.minFreq.value = Math.min(this.calibration.minFreq.value, this.currFreq);
    //       } else if (this.calibration.maxFreq.status) {
    //         this.calibration.maxFreq.value = Math.max(this.calibration.maxFreq.value, this.currFreq);
    //       } else if (this.calibration.maxRms.status) {
    //         this.calibration.maxRms.value = Math.max(this.calibration.maxRms.value, this.currRms);
    //       } else if (!micMuted){
    //         this.dataFromMic.set({ frequency: this.currFreq, energy: this.currRms});
    //       }
    //       this.render();
    //     }
    //     idxArray = 0;
    //     nZeroFreq = 0;
    //   }


    //   return currentTime + timeAdvancement;
    // }

    // const engine = { advanceTime };
    // this.scheduler.add(engine);

    window.addEventListener('resize', () => this.render());
    this.render();
  }

  startMicrophone() {
    // this.audioBuffer = null;
    this.mediaRecorder.start();
    console.log("recorder started");
    this.render();
  }

  stopMicrophone() {
    if (this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
      console.log("Recording stopped");
      this.render();
    }
  }

  rms(array) {
    // computes rms energy of a frame array
    let energy = 0;
    for (let i = 0; i < array.length; i++) {
      energy += Math.pow(array[i], 2);
    }
    energy /= array.length;
    energy = Math.sqrt(energy);
    return energy;
  }

  zeroCrossingRate(array) {
    // Computes the zero-crossing rate of a frame array
    let zcr = 0;
    let prev;
    let curr = array[0];
    for (let i = 0; i<array.length-1; i++){
      prev = curr;
      curr = array[i + 1];
      if (prev*curr < 0){zcr++};
    }
    zcr = zcr/(array.length-1);
    return zcr;
  }

  setMinFrequency() {
    this.calibration.minFreq.status = true;
    this.render();
    this.calibration.minFreq.value = 20000;
  }

  stopSetMinFrequency() {
    this.calibration.minFreq.status = false;
    this.render();
  }

  setMaxFrequency() {
    this.calibration.maxFreq.status = true;
    this.calibration.maxFreq.value = 0;
    this.render();
  }

  stopSetMaxFrequency() {
    this.calibration.maxFreq.status = false;
    this.render();
  }

  setMaxRms() {
    this.calibration.maxRms.status = true;
    this.calibration.maxRms.value = 0;
    this.render();
  }

  stopSetMaxRms() {
    this.calibration.maxRms.status = false;
    this.render();
  }

  render() {
    // debounce with requestAnimationFrame
    window.cancelAnimationFrame(this.rafId);

    this.rafId = window.requestAnimationFrame(() => {
      render(html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.client.type} [id: ${this.client.id}]</h1>
        </div>
        <div style="padding: 10px">
        <h2>Real-time Analysis (please calibrate beforehand)</h2>
          <div>
            <sc-text
              value="frequency"
              width="80"
            ></sc-text>
            <sc-number 
              id="frequency-display"
              value="${this.currFreq}"
            ></sc-number>
            <sc-slider
              min="0"
              max="127"
              value="${(this.currFreq - this.calibration.minFreq.value)/
                (this.calibration.maxFreq.value - this.calibration.minFreq.value)*127}"
            >
          </div>
          <div>
            <sc-text
              value="RMS"
              width="80"
            ></sc-text>
            <sc-number 
              id="rms-display"
              value="${this.currRms}"
            ></sc-number>
            <sc-slider
              min="0"
              max="127"
              value="${this.currRms/this.calibration.maxRms.value * 127}"
            >
          </div>
        </div>

        <div style="
          margin-top: 30px;
          padding: 10px">
          <h2>Microphone calibration (keep pressing)</h2>
          <div style="margin-bottom: 20px">
            <sc-button
              id="calibrate-min-freq"
              text="Set min frequency"
              ?selected="${this.calibration.minFreq.status}"
              @press="${e => this.setMinFrequency()}"
              @release="${e => this.stopSetMinFrequency()}"
            ></sc-button>
            <sc-number
              value="${this.calibration.minFreq.value ? this.calibration.minFreq.value : 0}"
            ></sc-number>
          </div>
          <div style="margin-bottom: 20px">
            <sc-button
              id="calibrate-max-freq"
              text="Set max frequency"
              ?selected="${this.calibration.maxFreq.status}"
              @press="${e => this.setMaxFrequency()}"
              @release="${e => this.stopSetMaxFrequency()}"
            ></sc-button>
            <sc-number
              value="${this.calibration.maxFreq.value ? this.calibration.maxFreq.value : 0}"
            ></sc-number>
          </div>
          <div style="margin-bottom: 20px">
            <sc-button
              id="calibrate-max-rms"
              text="Set max RMS"
              ?selected="${this.calibration.maxRms.status}"
              @press="${e => this.setMaxRms()}"
              @release="${e => this.stopSetMaxRms()}"
            ></sc-button>
            <sc-number
              value="${this.calibration.maxRms.value ? this.calibration.maxRms.value : 0}"
            ></sc-number>
          </div>
        </div>
      `, this.$container);
    });
  }
}

export default PlayerExperience;
