import { AbstractExperience } from '@soundworks/core/client.js';
import { AudioContext, OscillatorNode, GainNode } from 'node-web-audio-api';
import Mfcc from 'waves-lfo/common/operator/Mfcc';
import createKDTree from 'static-kdtree';
import { Scheduler } from 'waves-masters';
import SynthEngineNode from './SynthEngineNode';
import Loader from './LoaderNode.js'

// const audioContext = new AudioContext();
// process.audioContext = audioContext;

class ThingExperience extends AbstractExperience {
  constructor(client, config, audioContext) {
    super(client);

    this.config = config;
    this.audioContext = audioContext;
    // require plugins if needed
    this.sync = this.require('sync');
    this.filesystem = this.require('filesystem');
    // this.audioBufferLoader = this.require('audio-buffer-loader');
    this.checkin = this.require('checkin');

    this.bufferLoader = new Loader();

    // parameters for audio analysis
    this.frameSize = 4096;
    this.hopSize = 512;
    this.sourceSampleRate = this.audioContext.sampleRate;
    this.mfccBands = 24;
    this.mfccCoefs = 12;
    this.mfccMinFreq = 50;
    this.mfccMaxFreq = 8000;
  }

  async start() {
    super.start();

    console.log(`> ${this.client.type} [${this.client.id}]`);

    this.checkinId = this.checkin.get('index');

    this.global = await this.client.stateManager.attach('global');
    const availableNames = this.global.get('availableNames');
    const name = availableNames.shift();
    this.global.set({ availableNames: availableNames });

    this.participant = await this.client.stateManager.create('participant', {
      name: name
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
    // Synth
    this.playing = false; // whether or not sound is playing (this is controlled by omega)

    const getTimeFunction = () => this.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);
    this.grainPeriod = 0.05;
    this.grainDuration = this.frameSize / this.sourceSampleRate;
    this.synthData = []
    this.synthEngine = new SynthEngineNode(this.audioContext, this.synthData, this.grainPeriod, this.grainDuration, this.sourceSampleRate);
    this.synthEngine.connect(this.audioContext.destination);
    this.scheduler.add(this.synthEngine, this.audioContext.currentTime);



    this.participant.subscribe(async updates => {
      if ('mosaicingActive' in updates) {
        this.playing = updates.mosaicingActive;
      }
      if ('sourceFilename' in updates) { 
        const files = this.filesystem.get('soundbank').children;

        const {
          useHttps,
          serverIp,
          port,
        } = this.client.config.env;
        let fileUrl, i = 0;
        while (!fileUrl) {
          if (files[i].name === updates.sourceFilename) {
            fileUrl = `${useHttps ? 'https' : 'http'}://${serverIp}:${port}${files[i].url}`;
          } else {
            i++;
          }
        }
        // this.setSourceFile(this.context.audioBufferLoader.data[updates.sourceFilename]);
        const buffer = await this.bufferLoader.load(fileUrl);
        console.log('buffer loaded');

        this.currentSource = buffer;
        if (buffer) {
          const [mfccFrames, times] = this.computeMfcc(buffer);
          const searchTree = createKDTree(mfccFrames);
          console.log("Tree created")
          this.synthEngine.setBuffer(buffer);
          this.synthEngine.setSearchSpace(searchTree, times);
        }
      }
    });

    this.client.stateManager.observe(async (schemaName, stateId, nodeId) => {
      switch (schemaName) {
        case 'participant':
          const playerState = await this.client.stateManager.attach(schemaName, stateId);
          const playerName = playerState.get('name');
          if (playerName === 'Ω') {
            playerState.subscribe(updates => {
              if ('mosaicingData' in updates) {
                if (this.playing) {
                  //this is received as an object
                  // console.log('receiving', updates.mosaicingSynth)
                  this.synthData.push(Object.values(updates.mosaicingData));
                }
              }
            });
          }
          break;
      }
    });
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

  // setSourceFile(sourceBuffer) {
  //   console.log("loading source");
  //   this.currentSource = sourceBuffer;
  //   if (sourceBuffer) {
  //     const [mfccFrames, times] = this.computeMfcc(sourceBuffer);
  //     const searchTree = createKDTree(mfccFrames);
  //     console.log("Tree created")
  //     this.synthEngine.setBuffer(sourceBuffer);
  //     this.synthEngine.setSearchSpace(searchTree, times);
  //     this.sourceDisplay.setBuffer(sourceBuffer);
  //   }
  // }

}

export default ThingExperience;
