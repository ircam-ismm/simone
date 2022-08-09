import { AbstractExperience } from '@soundworks/core/client.js';


class ThingExperience extends AbstractExperience {
  constructor(client, config) {
    super(client);

    this.config = config;
    console.log('stuff')
    // require plugins if needed
  }

  async start() {
    super.start();

    console.log(`> ${this.client.type} [${this.client.id}]`);
    console.log('hello');
  }
}

export default ThingExperience;
