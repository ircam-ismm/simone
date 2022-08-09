import { AbstractExperience } from '@soundworks/core/client.js';


class ThingExperience extends AbstractExperience {
  constructor(client, config) {
    super(client);

    this.config = config;

    // require plugins if needed
  }

  async start() {
    super.start();

    console.log(`> ${this.client.type} [${this.client.id}]`);
  }
}

export default ThingExperience;
