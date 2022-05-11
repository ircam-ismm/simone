import { AbstractExperience } from '@soundworks/core/client';
import { render, html } from 'lit/html.js';
import renderInitializationScreens from '@soundworks/template-helpers/client/render-initialization-screens.js';
import '@ircam/simple-components/sc-bang.js';
import '@ircam/simple-components/sc-number.js';
import '@ircam/simple-components/sc-text.js';
import '@ircam/simple-components/sc-editor.js';
import '@ircam/simple-components/sc-toggle.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-button.js';

class ControllerExperience extends AbstractExperience {
  constructor(client, config, $container, audioContext) {
    super(client);

    this.config = config;
    this.$container = $container;
    this.rafId = null;
    this.audioContext = audioContext;

    // require plugins if needed

    this.platform = this.require('platform');
    this.sync = this.require('sync');
    this.filesystem = this.require('filesystem');
    this.audioBufferLoader = this.require('audio-buffer-loader');

    renderInitializationScreens(client, config, $container);
  }

  async start() {
    super.start();


    // Scripting
    this.synthScriptState = await this.client.stateManager.attach('synth-script');

    this.synthCtor = null;
    this.currentSynth = null;
    this.currentSynthName = null;

    // this.synthScriptState.subscribe(async updates => {
    //   console.log(updates);
    //   if ('currentScript' in updates) {
    //     if (updates.currentScript === null) {
    //       if (this.currentSynthScript) {
    //         await this.currentSynthScript.detach();
    //         this.render();
    //       }
    //     } else {
    //       this.updateCurrentSynthScript(updates.currentScript);
    //     }
    //   }
    // });

    this.synthScripting.observe(() => this.render());


    // Audio path
    this.muted = true;
    this.muteNode = new GainNode(this.audioContext);
    this.muteNode.gain.value = 0;
    this.volumeNode = new GainNode(this.audioContext);
    this.volumeNode.gain.setValueAtTime(0, this.audioContext.currentTime);

    this.muteNode.connect(this.audioContext.destination);
    this.volumeNode.connect(this.muteNode);


    //Mic data reception
    this.micDataMode = 'all';
    this.playersMicData = {};

    this.micControl = await this.client.stateManager.attach('micControl');
    this.dataOutOsc = await this.client.stateManager.attach('dataOutOsc');
    this.dataFromMic1 = await this.client.stateManager.create('dataFromMic'); //for testing purpose
    this.dataFromMic2 = await this.client.stateManager.create('dataFromMic'); //for testing purpose

    this.client.stateManager.observe(async (schemaName, stateId, nodeId) => {
      if (schemaName === 'dataFromMic') {
        const playerAnalysisState = await this.client.stateManager.attach(schemaName, stateId);
        this.playersMicData[stateId] = playerAnalysisState;

        playerAnalysisState.onDetach(() => {
          delete this.playersMicData[stateId];
          this.render();
        });

        playerAnalysisState.subscribe(updates => {
          // console.log(updates.frequency, updates.energy);
          const $freqDisplay = document.getElementById(`frequency-display-${stateId}`);
          $freqDisplay.setAttribute('value', updates.frequency);
          const $rmsDisplay = document.getElementById(`rms-display-${stateId}`);
          $rmsDisplay.setAttribute('value', updates.rms);

          switch (this.micDataMode) {
            case 'all': {
              if (this.currentSynth) {
                this.currentSynth.inMicFreq(updates.frequency); //Rename these functions
                this.currentSynth.inMicRms(updates.rms * 10);
                this.currentSynth.inMicZcr(updates.zeroCrossingRate);
                this.currentSynth.inMicMfcc(updates.mfcc);
              }
              this.dataOutOsc.set({ 
                frequency: updates.frequency,
                rms: updates.rms,
                zeroCrossingRate: updates.zeroCrossingRate,
                mfcc: updates.mfcc});
              break;
            }
            case 'add': {
              let newFreq = 0;
              Object.keys(this.playersMicData).map(id => {
                newFreq += this.playersMicData[id].get('frequency');
              });
              if (this.currentSynth) {
                this.currentSynth.inMicFreq(newFreq);
                this.currentSynth.inMicRms(updates.rms * 10);
              }
              this.dataOutOsc.set({ frequency: newFreq, rms: updates.rms });
              break;
            }
            case 'average':
              let newFreq = 0;
              Object.keys(this.playersMicData).map(id => {
                newFreq += this.playersMicData[id].get('frequency');
              });
              newFreq /= Object.keys(this.playersMicData).length;
              if (this.currentSynth) {
                this.currentSynth.inMicFreq(newFreq);
                this.currentSynth.inMicRms(updates.rms * 10);
              }
              this.dataOutOsc.set({ frequency: newFreq, rms: updates.rms });
              break;

          }
          
          // gain.gain.linearRampToValueAtTime(updates.energy * 10, this.audioContext.currentTime + 0.05);
          // osc.frequency.linearRampToValueAtTime(updates.frequency, this.audioContext.currentTime + 0.05);
        });

        this.render();
      }
    });



    // this.dataFromMic.subscribe(updates => {
    //   console.log(updates.frequency, updates.energy);
    //   gain.gain.linearRampToValueAtTime(updates.energy*10, this.audioContext.currentTime + 0.05);
    //   osc.frequency.linearRampToValueAtTime(updates.frequency, this.audioContext.currentTime + 0.05);
    // });


    window.addEventListener('resize', () => this.render());
    this.render();
  }

  muteControl(flag) {
    this.muted = flag;
    const gainVal = flag ? 0 : 1
    this.muteNode.gain.linearRampToValueAtTime(gainVal, this.audioContext.currentTime + 0.05);
  }

  startSynth() {
    if (this.synthCtor) {
      this.currentSynth = new this.synthCtor(this.audioContext);
      this.currentSynth.connect(this.volumeNode);
      this.currentSynth.start(this.audioContext.currentTime);
    }
  }

  sendTestData1() {
    this.dataFromMic1.set({ frequency: 110, rms: 0.05 });
  }
  sendTestData2() {
    this.dataFromMic2.set({ frequency: 220, rms: 0.10 });
  }

  
  /*
  #########################################################
  #                                                       #
  #           Mic recording controls functions            #
  #                                                       #
  #########################################################
  */

  record() {
    const now = this.audioContext.currentTime;
    const syncNow = this.sync.getSyncTime(now + 0.1);

    this.micControl.set({ startMic: syncNow });
  }

  stopRecording() {
    const now = this.audioContext.currentTime;
    const syncNow = this.sync.getSyncTime(now + 0.1);

    this.micControl.set({ stopMic: syncNow });
  }

  playBuffer() {
    const now = this.audioContext.currentTime;
    const syncNow = this.sync.getSyncTime(now + 0.1);

    this.micControl.set({ playBuffer: syncNow });
  }

  sendTest() {
    const now = this.audioContext.currentTime;
    const syncNow = this.sync.getSyncTime(now + 0.1);

    this.micControl.set({ test: syncNow });
  }

  /*
  #########################################################
  #                                                       #
  #                Scripting functions                    #
  #                                                       #
  #########################################################
  */


  async selectSynthScript(scriptName) {
    this.currentSynthName = scriptName;
    if (scriptName === null) {
      this.synthCtor = null;
      if (this.currentSynthScript) {
        await this.currentSynthScript.detach();
        this.render();
      }
    } else {
      this.updateCurrentSynthScript(scriptName);
    }
    this.render();
  }

  async createSynthScript(scriptName) {
    if (scriptName !== '') {
      const defaultValue = `// script ${scriptName}
function getSynth() {
  return class CustomSynth {
    constructor(audioContext) {
      this.audioContext = audioContext;

      // Array to store all sound sources
      this.sources = [];

      // Create nodes 
      this.output = new GainNode(audioContext); 
      this.gain = new GainNode(this.audioContext);
      this.gain.gain.setValueAtTime(0, this.audioContext.currentTime);
      this.osc = new OscillatorNode(audioContext);
      this.osc.frequency.setValueAtTime(0, this.audioContext.currentTime);
      this.sources.push(this.osc);

      // Connect nodes to output
      this.gain.connect(this.output);
      this.osc.connect(this.gain);
    }

    inMicFreq(value) {
      this.osc.frequency.linearRampToValueAtTime(value, this.audioContext.currentTime + 0.05);
    }

    inMicRms(value) {
      this.gain.gain.linearRampToValueAtTime(value * 10, this.audioContext.currentTime + 0.05)
    }

    connect(dest) {
      this.output.connect(dest);
    }

    disconnect(dest) {
      this.output.disconnect(dest);
    }

    start(time) {
      this.sources.forEach(src => {src.start(time)});
    }

    stop(time) {
      this.sources.forEach(src => {src.stop(time)});
    }
  }
}`
      // create the script, it will be available to all node
      await this.synthScripting.create(scriptName, defaultValue);

      this.selectSynthScript(scriptName);
    }
  }

  async deleteSynthScript(scriptName) {
    await this.synthScripting.delete(scriptName);

    if (this.currentSynthName === scriptName) {
      this.selectSynthScript(null);
    }

    this.render();
  }

  setSynthScriptValue(value) {
    if (this.currentSynthScript) {
      this.currentSynthScript.setValue(value);
    }
  }

  async updateCurrentSynthScript(scriptName) {
    if (this.currentSynthScript) {
      await this.currentSynthScript.detach();
    }

    this.currentSynthScript = await this.synthScripting.attach(scriptName);

    // subscribe to update and re-execete the script
    this.currentSynthScript.subscribe(updates => {
      if (updates.error) {
        const error = updates.error;
        console.log(error);
        // you may display errors on the screen
      }
      else {
        this.synthCtor = this.currentSynthScript.execute();
        if (this.currentSynth) {this.currentSynth.stop()};
        this.startSynth();
        this.render();
      }
    });

    this.currentSynthScript.onDetach(() => {
      this.currentSynthScript = undefined;
      if (this.currentSynth) { this.currentSynth.stop() }
      this.render();
    });

    this.synthCtor = this.currentSynthScript.execute();

    this.render();
  }


  /*
  #########################################################
  #                                                       #
  #                       Render                          #
  #                                                       #
  #########################################################
  */


  render() {
    // debounce with requestAnimationFrame
    window.cancelAnimationFrame(this.rafId);

    const now = this.audioContext.currentTime;

    this.rafId = window.requestAnimationFrame(() => {
      render(html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.client.type} [id: ${this.client.id}]</h1>
        </div>

        <div style="
          padding: 10px;
          float: left;
        ">
          <h1>Mic recording controls</h1>
          <div>
            <h3>Start recording</h3>
            <sc-bang
              @input="${e => this.record()}"
            ></sc-bang>
          </div>
          <div>
            <h3>Stop recording</h3>
            <sc-bang
              @input="${e => this.stopRecording()}"
            ></sc-bang>
          </div>
          <div>
            <h3>Play buffer</h3>
            <sc-bang
              @input="${e => this.playBuffer()}"
            ></sc-bang>
          </div>
          <div>
            <h3>test</h3>
            <sc-bang
              @input="${e => this.sendTest()}"
            ></sc-bang>
          </div>

          <h1>Microphone mode</h1>
          ${['all', 'add', 'average'].map(mode => {
            return html`
            <div style="margin-top: 10px">
              <sc-button
                text="${mode}"
                @press="${e => this.micDataMode = mode}"
              ></sc-button>
            </div>`
          })}
          

          <h1>Synth controls</h1>
          <div>
            <h3>Mute</h3>
            <sc-toggle
              ?active="${this.muted}"
              @change="${e => this.muteControl(e.detail.value)}"
            ></sc-toggle>
          </div>
          <div>
            <h3>Volume</h3>
            <sc-slider
              min="0"
              max="1"
              value="0"
              @input="${e => this.volumeNode.gain.setTargetAtTime(e.detail.value, now, 0.1)}"
            ></sc-slider>
          </div>
          <div style="margin-top: 20px">
            <sc-button
              text="Start synth"
              @press="${e => this.startSynth()}"
            ></sc-button>
            <sc-button
              text="Stop synth"
              @press="${e => this.currentSynth.stop()}"
            ></sc-button>
          </div>
          <div style="margin-top: 20px">
            <sc-bang
              @input="${e => this.sendTestData1()}"
            ></sc-bang>
            <sc-bang
              @input="${e => this.sendTestData2()}"
            ></sc-bang>
          </div>

        </div>

        <div id="mic-analysis" style="
          padding: 10px;
          float: left;
          margin-left: 20px;
        ">
          <h1>Mic analysis results</h1>
          ${Object.keys(this.playersMicData).map(id => {
        return html`
            <div style="margin: 20px">
              <h3>Mic n°${id}</h3>
              <div>
                <sc-text
                  value="mute mic"
                  width="80"
                ></sc-text>
                <sc-toggle 
                  ?active="${this.playersMicData[id].get('muted')}"
                  @change="${e => this.playersMicData[id].set({muted: e.detail.value})}"
                ></sc-toggle>
              </div>
              <div>
                <sc-text
                  value="frequency"
                  width="80"
                ></sc-text>
                <sc-number id="frequency-display-${id}"></sc-number>
              </div>
              <div>
                <sc-text
                  value="RMS"
                  width="80"
                ></sc-text>
                <sc-number id="rms-display-${id}"></sc-number>
              </div>
            </div>
            `;
      })}
        </div>

        <!-- scripting -->
        <div style="
          width: 500px;
          height: 90vh;
          /*background-color: red;*/
          float: left;
          margin-left: 20px;
        ">
          <h1 style="padding: 0; margin: 20px 0px">Synth scripting</h1>

          <section style="margin: 8px 0">
            <sc-text
              value="create script (cmd + s):"
              readonly
            ></sc-text>
            <sc-text
              @change="${e => this.createSynthScript(e.detail.value)}"
            ></sc-text>
          </section>
          ${this.synthScripting.getList().map((scriptName) => {
        return html`
              <section style="margin: 4px 0">
                <sc-button
                  value="${scriptName}"
                  text="select ${scriptName}" 
                  @input="${() => this.selectSynthScript(scriptName)}"
                ></sc-button>
                <sc-button
                  value="${scriptName}"
                  text="delete ${scriptName}"
                  @input="${() => this.deleteSynthScript(scriptName)}"
                ></sc-button>
              </section>
            `;
      })}
          <sc-text
            readonly
            width="500"
            value="open the console to see possible syntax errors when editing"
          ></sc-text>
          <sc-editor
            style="display:block"
            width="500"
            height="500"
            .value="${(this.currentSynthScript && this.currentSynthScript.getValue() || '')}"
            @change="${e => this.setSynthScriptValue(e.detail.value)}"
          ></sc-editor>
        </div>

      `, this.$container);
    });
  }
}

export default ControllerExperience;
