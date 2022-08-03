import State from './State.js';
import { html } from 'lit/html.js';

export default class CloneWaiting extends State {
  constructor(name, context) {
    super(name, context);

    this.targetPlayerState = this.context.participant;
  }

  async enter() {
    const nPlayersReady = this.context.global.get('clonePlayersReady');
    const nPlayers = this.context.global.get('nPlayers'); 
    
    if (nPlayersReady === nPlayers) {
      setTimeout(() => {
        this.context.participant.set({
          state: 'clone-playing',
        });
      }, 5000);  //waiting for all files to be loaded
    }

    this.context.global.subscribe(async updates => {
      if ('clonePlayersReady' in updates) {
        if (updates.clonePlayersReady === nPlayers) {
          setTimeout(() => {
            this.context.participant.set({
              state: 'clone-playing',
            });
          }, 5000);   //waiting for all files to be loaded
        }
      }
    });
  }



  render() {
    return html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.context.participant.get('name')} [id: ${this.context.checkinId}]</h1>
        </div>

        <div style="padding-left: 20px; padding-right: 20px">
          <div style="
              display: flex;
              justify-content: center;
            "
          >
            <h2>
                Please wait until everyone has recorded a sound.
            </h2>
          </div>
        </div>
      `
  }
}
