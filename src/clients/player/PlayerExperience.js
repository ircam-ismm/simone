import { AbstractExperience } from '@soundworks/core/client';
import { render, html, nothing } from 'lit/html.js';
import renderInitializationScreens from '@soundworks/template-helpers/client/render-initialization-screens.js';
import StateMachine from './states/StateMachine.js';
import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';

const hash = window.location.hash.replace(/^#/, '');


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
    this.checkin = this.require('checkin');
    
    renderInitializationScreens(client, config, $container);
  }

  async start() {
    super.start();

    this.global = await this.client.stateManager.attach('global');
    this.checkinId = this.checkin.get('index');

    this.stateMachine = new StateMachine(this);

    // Players are named following the greek alphabet in lowercase
    // except for the central player in the solar system configuration who is called Ω.
    // You may access the Ω page using the "omega" hash in the url

    this.participant = await this.client.stateManager.create('participant');
    if (hash === 'omega') {
      this.participant.set({ name: 'Ω'});
    } else {
      const availableNames = this.global.get('availableNames');
      const name = availableNames.shift();
      this.global.set({ availableNames: availableNames});
      this.participant.set({ name: name});
    }
    this.participant.subscribe(async updates => {
      if ('state' in updates) {
        this.stateMachine.setState(updates.state);
      }
      this.render();
    });

    //Audio files loading 
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



    // Proceed to the system set in the config
    await this.participant.set({
      state: 'clone'//this.global.get('system'),
    });


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
      } else if (leaf.name = 'userFiles') {
        const userFilesTree = {
          "path": leaf.url,
          "name": leaf.name,
          "children": [],
          "type": "directory",
        };
        leaf.children.forEach(user_leafs => {
          if (user_leafs.type === 'file') {
            defObj[user_leafs.name] = user_leafs.url;
            userFilesTree["children"].push({
              "path": user_leafs.url,
              "name": user_leafs.name,
              "type": "file",
            });
          }
        });
        this.soundbankTreeRender["children"].push(userFilesTree);
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
