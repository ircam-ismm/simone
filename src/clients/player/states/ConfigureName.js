import State from './State.js';
import { html } from 'lit/html.js';
import slugify from 'slugify';
import '@ircam/simple-components/sc-button.js';

export function pad(prefix, radical) {
  const string = typeof radical === 'string' ? radical : radical.toString();
  const slice = string.length > prefix.length ? prefix.length : -prefix.length;

  return (prefix + string).slice(slice);
}

export default class ConfigureName extends State {

  async setName(name) {
    if (name !== '') {
      console.log('name is', name);
      await this.context.participant.set({
        name: name,
        state: 'mosaicing',
      });
    }
  }

  render() {
    return html`
      <div
        style="
          position: absolute;
          width: 100%;
          top: 50%;
          transform: translateY(-50%);
        "  
      >
        <p
          style="
            width: 90%;
            display: block;
            margin: auto;
            margin-bottom: 10px;
            text-align: center;
            font-size: xx-large;
          "
        >Participant name:</p>
        <input 
          id="input-name"
          style="
            display: block;
            margin: auto;
            width: 400px;
            height: 30px;
          " 
          type="text"
        ></input>
        <div 
          style="
            width: 400px;
            display: block;
            margin: auto;
          "
        >
        <sc-button
          text="submit"
          width="400"
          @input="${e => {
            const $input = document.querySelector('#input-name');
            this.setName($input.value);
          }}"
        >Submit</sc-button>
        </div>
      </div>
    `;
  }
}
