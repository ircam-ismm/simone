import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-transport';
import '@ircam/simple-components/sc-loop.js';
import '@ircam/simple-components/sc-record.js';
import WaveformDisplay from '../../utils/WaveformDisplay';
import State from './State.js';
import { html } from 'lit/html.js';
import toWav from 'audiobuffer-to-wav';

export default class CloneRecording extends State {
  constructor(name, context) {
    super(name, context);

    // Waveform display
    this.waveformWidth = 700;
    this.waveformHeight = 200;

    this.targetPlayerState = this.context.participant;
  }

  async enter() {
    // Microphone handling
    this.mediaRecorderCb = e => {
      if (e.data.size > 0) {
        this.currentRecording = e.data;
        this.context.fileReader.readAsArrayBuffer(e.data);
      }
    }

    this.fileReaderCb = async () => {
      const audioBuffer = await this.context.audioContext.decodeAudioData(this.context.fileReader.result);
      this.currentRecordingDecoded = audioBuffer;
      this.recordDisplay.setBuffer(audioBuffer);
      this.cropStart = 0;
      this.cropEnd = audioBuffer.duration;
    }

    this.context.mediaRecorder.addEventListener('dataavailable', this.mediaRecorderCb);
    this.context.fileReader.addEventListener('loadend', this.fileReaderCb);

    // Waveform display
    this.recordDisplay = new WaveformDisplay(this.waveformHeight, this.waveformWidth, true);
    this.recordDisplay.setCallbackSelectionChange((start, end) => {
      this.cropStart = start;
      this.cropEnd = end;
    });
  }

  exit() {
    this.context.mediaRecorder.removeEventListener('dataavailable', this.mediaRecorderCb);
    this.context.fileReader.removeEventListener('loadend', this.fileReaderCb);
  }


  async uploadRecordedFile() {
    if (this.currentRecordingDecoded) {
      // crop 
      const sampleRate = this.context.audioContext.sampleRate;
      const nChannels = this.currentRecordingDecoded.numberOfChannels
      
      const startIdx = this.cropStart*sampleRate;
      const endIdx = this.cropEnd*sampleRate;
      const croppedBuffer = this.context.audioContext.createBuffer(
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
      const filename = `recording-player-${this.context.checkinId}.wav`;
      const file = [];
      file[filename] = recordingBlob;
      this.context.filesystem.upload('user-files', file);

      // updates number of players ready and proceed to waiting state
      const nPlayersReady = this.context.global.get('clonePlayersReady');
      await this.context.global.set({ clonePlayersReady: nPlayersReady + 1 });
      await this.context.participant.set({ state: 'clone-waiting' });
    }
  }

  transportRecordedFile(state) {
    // callback for handling transport buttons on recording sound display
    switch (state) {
      case 'play':
        this.recPlayerNode = new AudioBufferSourceNode(this.context.audioContext);
        this.recPlayerNode.buffer = this.currentRecordingDecoded;
        this.recPlayerNode.connect(this.context.audioContext.destination);

        const now = this.context.audioContext.currentTime;
        this.recPlayerNode.start(now, this.cropStart, this.cropEnd - this.cropStart);

        this.recPlayerNode.addEventListener('ended', event => {
          const $transportSource = document.querySelector('#transport-source');
          $transportSource.state = 'stop';
        });
        break;
      case 'stop':
        this.recPlayerNode.stop();
        break;
    }
  }



  render() {
    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.checkinId}]</h1>
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
            <h2 style="
                width: 50%;
                text-align: center;
              "
            >
              Please record at least 30 seconds of audio. 
              You can retry recording as much as you want and preview the sound.
              You can also crop your recordings by selecting only a section on the waveform
            </h2>
            <div style="
                position: relative;
              "
            >
              ${this.recordDisplay.render()}

              <sc-record
                style="
                  position: absolute;
                  bottom: 0;
                  left: 0px;
                "
                @change="${e => e.detail.value ? this.context.mediaRecorder.start() : this.context.mediaRecorder.stop() }"
              ></sc-record>
              <sc-transport
                id="transport-source"
                style="
                  position: absolute;
                  bottom: 0;
                  left: 35px;
                "
                buttons="[play, stop]"
                @change="${e => this.transportRecordedFile(e.detail.value)}"
              ></sc-transport>

            </div>

            
            <sc-button
              style="margin: 20px;"
              width="${this.waveformWidth/2}"
              height="40"
              text="submit"
              @input="${e => this.uploadRecordedFile()}"
            ></sc-button>
          </div>
        </div>
      `
  }
}
