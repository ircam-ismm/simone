import State from './State.js';
import '@ircam/simple-components/sc-button.js';


export default class SolarSystemDispatch extends State {
  async enter() {
    // Dispatches participants to the right state depending on their role in 
    // the solar system.
    // The omega role is accessed by adding the hash "#omega" to the URL
    const name = this.context.participant.get('name');
    if (name === 'Ω') {
      this.context.participant.set({
        state: 'solar-system-omega',
      });
    } else if (name === 'Ω*') {
      this.context.participant.set({
        state: 'solar-system-omega-solo',
      });
    } else {
      this.context.participant.set({
        state: 'solar-system-satellite',
      });
    }
  }
}
