import { AbstractExperience } from '@soundworks/core/client.js';
import decibelToLinear from './math/decibelToLinear.js';
import createKDTree from 'static-kdtree';
import { Scheduler } from 'waves-masters';
import SynthEngineNode from './SynthEngineNode';
import Loader from './LoaderNode.js'
import fs from 'node:fs';
import path from 'node:path';
import Worker from 'web-worker';

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

    this.bufferLoader = new Loader(audioContext);

    // parameters for audio analysis
    this.frameSize = 4096;
    this.hopSize = 512;
    this.sampleRate = this.audioContext.sampleRate;
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
  }

  async start() {
    super.start();

    let script = fs.readFileSync(path.join(process.cwd(), 'src', 'clients', 'utils', 'mfcc.worker.js'));
    script = script.toString().replace(/\n/g, '');

    this.worker = new Worker(`data:application/javascript,${script}`);

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
        this.participant.set({ sourceFileLoaded: true });
      }
    });

    this.worker.postMessage({
      type: 'message',
      data: "worker says hello",
    });


    console.log(`> ${this.client.type} [${this.client.id}]`);

    this.checkinId = this.checkin.get('index');

    this.global = await this.client.stateManager.attach('global');
    const availableNames = this.global.get('availableNames');
    const name = availableNames.shift();
    this.global.set({ availableNames: availableNames });

    this.participant = await this.client.stateManager.create('participant', {
      name: name
    });

    // Synth
    const getTimeFunction = () => this.sync.getLocalTime();
    this.scheduler = new Scheduler(getTimeFunction);
    this.grainPeriod = 0.05;
    this.grainDuration = this.frameSize / this.sampleRate;
    this.synthEngine = new SynthEngineNode(this.audioContext, this.grainPeriod, this.grainDuration, this.sampleRate);
    this.synthEngine.connect(this.audioContext.destination);
    this.scheduler.add(this.synthEngine, this.audioContext.currentTime);

    this.participant.subscribe(async updates => {
      if ('mosaicingActive' in updates) {
        updates.mosaicingActive ? this.synthEngine.start() : this.synthEngine.stop();
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
          this.worker.postMessage({
            type: 'analyze',
            data: {
              analysisInitData: this.analysisData,
              buffer: buffer.getChannelData(0),
            }
          });
        }
      }
      if ('volume' in updates) {
        this.synthEngine.volume = decibelToLinear(updates.volume);
      }
      if ('detune' in updates) {
        this.synthEngine.detune = updates.detune * 100;
      }
      if ('grainDuration' in updates) {
        this.synthEngine.setGrainDuration(updates.grainDuration);
      }
    });

    this.client.stateManager.observe(async (schemaName, stateId, nodeId) => {
      switch (schemaName) {
        case 'participant':
          const playerState = await this.client.stateManager.attach(schemaName, stateId);
          const playerName = playerState.get('name');
          if (playerName === 'Ω' || playerName === 'Ω*') {
            playerState.subscribe(updates => {
              if ('mosaicingData' in updates) {
                //this is received as an object
                // console.log('receiving', updates.mosaicingSynth)
                this.synthEngine.postData(Object.values(updates.mosaicingData));
              }
            });
          }
          break;
      }
    });
  }
}

export default ThingExperience;
