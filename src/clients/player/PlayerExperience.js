import { AbstractExperience } from '@soundworks/core/client';
import { render, html, nothing } from 'lit/html.js';
import renderInitializationScreens from '@soundworks/template-helpers/client/render-initialization-screens.js';
import StateMachine from './states/StateMachine.js';
import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';


class PlayerExperience extends AbstractExperience {
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

    this.stateMachine = new StateMachine(this);

    this.players = {};

    this.participant = await this.client.stateManager.create('participant');
    this.participant.subscribe(async updates => {
      if ('state' in updates) {
        this.stateMachine.setState(updates.state);
      }
      this.render();
    });


    this.client.stateManager.observe(async (schemaName, stateId, nodeId) => {
      switch (schemaName) {
        case 'participant':
          const playerState = await this.client.stateManager.attach(schemaName, stateId);
          playerState.subscribe(updates => {
            if ('name' in updates) {
              this.render();
            }
          })
          playerState.onDetach(() => {
            delete this.players[playerState.id];
            this.render();
          });
          // this.players.add(playerState);
          this.players[playerState.id] = playerState;
          break;
      }
    });

    //Audio file loading 

    this.soundbankTreeRender = {
      "path": "soundbank",
      "name": "soundbank",
      "children": [],
      "type": "directory"
    };

    this.filesystem.subscribe(async () => {
      await this.loadSoundbank();
      this.render();
    });
    await this.loadSoundbank();

    // Microphone

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseReduction: false, autoGainControl: false }, video: false });
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



    const SKIP_NAME = true;

    if (SKIP_NAME) {
      await this.participant.set({
        name: 'user',
        state: 'mosaicing',
      });
    } else {
      this.participant.set({ state: 'configure-name' });
    }


    window.addEventListener('resize', () => this.render());
    this.render();
  }

  async loadSoundbank() {
    const soundbankTree = this.filesystem.get('soundbank');
    this.soundbankTreeRender["children"] = [];
    // format tree to create a simple data object
    const defObj = {};

    soundbankTree.children.forEach(leaf => {
      if (leaf.type === 'file') {
        defObj[leaf.name] = leaf.url;
        this.soundbankTreeRender["children"].push({
          "path": leaf.url,
          "name": leaf.name,
          "type": "file"
        });
      }
    });
    // load files and clear old cached buffers
    await this.audioBufferLoader.load(defObj, true);
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
      <div class="main">
        ${this.stateMachine.state ?
        this.stateMachine.state.render() :
        nothing
      }
      </div>
    `, this.$container);
  }
}

export default PlayerExperience;
