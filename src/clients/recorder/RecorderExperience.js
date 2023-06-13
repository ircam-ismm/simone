import { AbstractExperience } from '@soundworks/core/client';
import { render, html } from 'lit/html.js';
import renderInitializationScreens from '@soundworks/template-helpers/client/render-initialization-screens.js';
import WaveformDisplay from '../utils/WaveformDisplay';
import toWav from 'audiobuffer-to-wav';

import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import '@ircam/simple-components/sc-text.js';

class RecorderExperience extends AbstractExperience {
  constructor(client, config, $container, audioContext) {
    super(client);

    this.config = config;
    this.$container = $container;
    this.rafId = null;
    this.audioContext = audioContext;

    // require plugins if needed
    this.filesystem = this.require('filesystem');
    this.platform = this.require('platform');

    this.filename = null;

    renderInitializationScreens(client, config, $container);
  }

  async start() {
    super.start();

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseReduction: false, 
          autoGainControl: false 
        }, 
        video: false 
      });
      console.log(this.micStream);
      console.log('access to microphone granted');
    } catch (err) {
      console.log('ERROR: could not access microphone');
      console.log(err);
    }

    try {
      this.mediaRecorder = new MediaRecorder(this.micStream);
      console.log('Media recorder successfully created');
    } catch (err) {
      console.log(err);
      console.log('ERROR: could not create mediaRecorder');
    }

    this.fileReader = new FileReader();

    this.mediaRecorderCb = e => {
      if (e.data.size > 0) {
        this.currentRecording = e.data;
        this.fileReader.readAsArrayBuffer(e.data);
        console.log(e.data);
      }
    }

    this.fileReaderCb = async () => {
      const audioBuffer = await this.audioContext.decodeAudioData(this.fileReader.result);
      console.log(audioBuffer);
      this.currentRecordingDecoded = audioBuffer;
      this.recordDisplay.setBuffer(audioBuffer);
      this.cropStart = 0;
      this.cropEnd = audioBuffer.duration;
    }

    this.mediaRecorder.addEventListener('dataavailable', this.mediaRecorderCb);
    this.fileReader.addEventListener('loadend', this.fileReaderCb);

    if (window.innerWidth > 500) {
      this.waveformWidth = window.innerWidth - (100 * 2);
      this.waveformHeight = 250;
      this.buttonHeight = 50;
      this.statusWidth = 400;
    } else {
      this.waveformWidth = window.innerWidth - (20 * 2);
      this.waveformHeight = 200;
      this.buttonHeight = 30;
      this.statusWidth = this.waveformWidth;
    }
    
    this.recordDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, true);
    this.recordDisplay.setCallbackSelectionChange((start, end) => {
      this.cropStart = start;
      this.cropEnd = end;
    });


    this.render();
  }

  async uploadRecordedFile() {
    if (this.filename) {
      if (this.currentRecordingDecoded) {
        let $status = document.querySelector('#status');
        $status.value = "uploading file"
        // crop 
        const sampleRate = this.audioContext.sampleRate;
        const nChannels = this.currentRecordingDecoded.numberOfChannels
  
        const startIdx = this.cropStart * sampleRate;
        const endIdx = this.cropEnd * sampleRate;
        const croppedBuffer = this.audioContext.createBuffer(
          nChannels,
          endIdx - startIdx,
          sampleRate
        );
        const tempArray = new Float32Array(endIdx - startIdx);
        for (let c = 0; c < nChannels; c++) {
          this.currentRecordingDecoded.copyFromChannel(tempArray, c, startIdx);
          croppedBuffer.copyToChannel(tempArray, c);
        }
        //Encode as wav
        const wavBuffer = toWav(croppedBuffer);
        const recordingBlob = new Blob([wavBuffer], { type: 'audio/wav' });
        // upload to server
        const filename = `${this.filename}.wav`;
        const file = [];
        file[filename] = recordingBlob;
        this.filesystem.upload(file);
      }
    } else {
      let $status = document.querySelector('#status');
      $status.value = "please enter a filename before saving"
    }
  }

  transportRecordedFile(state) {
    // callback for handling transport buttons on recording sound display
    switch (state) {
      case 'play':
        if (this.currentRecordingDecoded) {
          this.recPlayerNode = new AudioBufferSourceNode(this.audioContext);
          this.recPlayerNode.buffer = this.currentRecordingDecoded;
          this.recPlayerNode.connect(this.audioContext.destination);
  
          const now = this.audioContext.currentTime;
          this.recPlayerNode.start(now, this.cropStart, this.cropEnd - this.cropStart);
  
          this.recPlayerNode.addEventListener('ended', event => {
            const $transportSource = document.querySelector('#transport-source');
            $transportSource.state = 'stop';
          });
        }
        break;
      case 'stop':
        if (this.recPlayerNode) {
          this.recPlayerNode.stop();
        }
        break;
    }
  }

  /*
  #########################################################
  #                                                       #
  #                       Render                          #
  #                                                       #
  #########################################################
  */

  
  render() {
    render(html`
      <div style="padding: 20px">
        <h1 style="margin: 20px 0">simone recorder</h1>
      </div>

      <div style="padding-left: 20px; padding-right: 20px">
        <div style="
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          flex-direction: column;
          align-content: space-around;
          align-items: center;
          "
        >
          <div style="
              position: relative;
            "
          >
            ${this.recordDisplay.render()}
            <sc-record
              style="
                position: absolute;
                bottom: 2px;
                left: 0px;
              "
              height="${this.buttonHeight}"
              @change="${e => e.detail.value ? this.mediaRecorder.start() : this.mediaRecorder.stop()}"
            ></sc-record>
            <sc-transport
              id="transport-source"
              style="
                position: absolute;
                bottom: 2px;
                left: ${this.buttonHeight+4}px;
              "
              buttons="[play, stop]"
              height="${this.buttonHeight}"
              @change="${e => this.transportRecordedFile(e.detail.value)}"
            ></sc-transport>
            
          </div>

          <p>you can select a section of the recording that you want to keep by clicking/touching and dragging on the waveform</p>

          <h2>filename</h2>
          <sc-text
            width="${this.waveformWidth}"
            height="${this.buttonHeight}"
            @change="${e => this.filename = e.detail.value}"
          ></sc-text>

          <sc-button
            style="margin: 20px;"
            width="${this.waveformWidth}"
            height="40"
            text="submit"
            @input="${e => this.uploadRecordedFile()}"
          ></sc-button>

          <sc-text 
            id="status"
            width="${this.statusWidth}"
            readonly
          ></sc-text>
        </div>
      </div>
    `, this.$container);
  }
  
}

export default RecorderExperience;
