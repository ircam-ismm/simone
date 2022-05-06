import State from './State.js';
import { html } from 'lit-html';
import slugify from 'slugify';

export function pad(prefix, radical) {
  const string = typeof radical === 'string' ? radical : radical.toString();
  const slice = string.length > prefix.length ? prefix.length : -prefix.length;

  return (prefix + string).slice(slice);
}

export default class ConfigureName extends State {

  async setName(name) {
    if (name !== '') {
      await this.context.participant.set({
        name,
        folder,
        state: 'mosaicing',
      });
    }
  }

  render() {
    return html`
      <p>Participant name:</p>
      <input type="text" />
      <button
        @click="${e => this.setName(e.target.previousElementSibling.value)}"
      >Submit</button>
    `;
  }
}
