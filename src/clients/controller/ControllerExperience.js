import { AbstractExperience } from '@soundworks/core/client';
import { render, html } from 'lit';
import renderInitializationScreens from '@soundworks/template-helpers/client/render-initialization-screens.js';
import '@ircam/sc-components/sc-bang.js';
import '@ircam/sc-components/sc-number.js';
import '@ircam/sc-components/sc-text.js';
import '@ircam/sc-components/sc-editor.js';
import '@ircam/sc-components/sc-toggle.js';
import '@ircam/sc-components/sc-slider.js';
import '@ircam/sc-components/sc-button.js';
import '@ircam/sc-components/sc-transport.js';

class ControllerExperience extends AbstractExperience {
  constructor(client, config, $container, audioContext) {
    super(client);

    this.config = config;
    this.$container = $container;
    this.rafId = null;
    this.audioContext = audioContext;

    // require plugins if needed
    this.filesystem = this.require('filesystem');

    renderInitializationScreens(client, config, $container);
  }

  async start() {
    super.start();

    //Other players
    this.players = {};

    this.client.stateManager.observe(async (schemaName, stateId, nodeId) => {
      switch (schemaName) {
        case 'participant':
          const playerState = await this.client.stateManager.attach(schemaName, stateId);
          const playerName = playerState.get('name');
          playerState.onDetach(() => {
            delete this.players[playerName];
            this.render();
          });
          playerState.subscribe(updates => {
            this.render();
          });

          this.players[playerName] = playerState;
          this.render();
          break;
      }
    });


    // soundbank 
    

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
    const soundfiles = this.filesystem.get('soundbank').children;

    render(html`
      <h1 style="margin: 20px;"> Controller </h1>
      <div style="margin: 20px;">
        <h2>Send message to participants</h2>
        <sc-text
          style="
            height: 60px;
            width: 400px;
          "
          editable
          @change="${e => {
          Object.values(this.players).map(state => {
            state.set({ message: e.detail.value });
          });
        }}"
        ></sc-text>
      </div>

      <sc-button
          style="margin-left: 20px;"
          @input="${e => {
            Object.entries(this.players).forEach(([name, state]) => {
              state.set({clean: 'clean'});
            })
          }}"
      >clean all</sc-button>
      
      <div style="
        display: flex;
      ">
        ${Object.entries(this.players).map(([name, state]) => {
          const playerName = state.get('name');
          if (playerName !== 'Ω' && playerName !== 'Ω*') {
            return html`
              <div style="
                  width: 450px;
                  margin: 20px;
                  border: 2px solid grey;
                  padding: 0 20px 20px;
                  position: relative;
                "
              >
                <h2>
                  ${name}
                </h2>
                <div style="border-bottom: 2px solid grey;" >
                  <div style="display: flex; margin-bottom: 10px;">
                    <p style="padding-right: 20px">mute</p>
                    <sc-toggle
                      style="
                        position: absolute;
                        left: 150px;
                      "
                      ?active=${state.get('globalMute')}
                      @change=${e => state.set({ globalMute: e.detail.value})}
                    ></sc-toggle>
                  </div>
                  <div style="display: flex; margin-bottom: 10px;">
                    <p style="padding-right: 20px">volume</p>
                    <sc-slider
                      style="
                        position: absolute;
                        left: 150px;
                      "
                      min="0"
                      max="1"
                      value=${state.get('globalVolume')}
                      @input=${e => state.set({ globalVolume: e.detail.value })}
                    ></sc-slider>
                  </div>
                </div>
                <div style="padding-top: 10px">
                  <div style="display: flex; margin-bottom: 10px;">
                    <p style="padding-right: 20px">current source</p>
                    <select 
                      style="
                        width: 280px;
                        height: 30px;
                        position: absolute;
                        left: 150px;
                      "
                      @change="${e => {
                        if (e.target.value !== "") {
                          state.set({ sourceFilename: e.target.value, sourceFileLoaded: false});
                        }
                      }}"  
                    >
                      <option value="">select a source file</option>
                      ${soundfiles.map(el => {
                        if (el.type === 'file') {
                          if (state.get('sourceFilename') === el.name) {
                            return html`
                            <option value="${el.name}" selected>${el.name}</option>
                          `
                          } else {
                            return html`
                            <option value="${el.name}">${el.name}</option>
                          `
                          }
                        }
                      })}
                    </select>
                  </div>
                  <div style="display: flex; margin-bottom: 10px;">
                    <p style="padding-right: 20px">player volume (dB)</p>
                    <sc-slider
                      style="
                        position: absolute;
                        left: 150px;
                      "
                      number-box
                      min="-70"
                      max="0"
                      value=${state.get('volume')}
                    ></sc-slider>
                  </div>
                  <div style="display: flex; margin-bottom: 10px;">
                    <p style="padding-right: 20px">detune</p>
                    <sc-slider
                      style="
                        position: absolute;
                        left: 150px;
                      "
                      number-box
                      min="-12"
                      max="12"
                      value=${state.get('detune')}
                    ></sc-slider>
                  </div>
                  <div style="display: flex; margin-bottom: 10px;">
                    <p style="padding-right: 20px">grain period</p>
                    <sc-slider
                      style="
                        position: absolute;
                        left: 150px;
                      "
                      number-box
                      min="0.01"
                      max="0.1"
                      value=${state.get('grainPeriod')}
                    ></sc-slider>
                  </div>
                  <div style="display: flex; margin-bottom: 10px;">
                    <p style="padding-right: 20px">grain duration</p>
                    <sc-slider
                      style="
                        position: absolute;
                        left: 150px;
                      "
                      number-box
                      min="0.02"
                      max="0.25"
                      value=${state.get('grainDuration')}
                    ></sc-slider>
                  </div>
                </div>
                <sc-button
                  @input="${e => {
                    state.set({clean: 'clean'});
                  }}"
                >clean</sc-button>
      
              </div>
            `;
          }
        })}
      </div>
    `, this.$container);
  }
}

export default ControllerExperience;
