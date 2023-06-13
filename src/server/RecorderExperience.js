import { AbstractExperience } from '@soundworks/core/server';

class RecorderExperience extends AbstractExperience {
  constructor(server, clientTypes, options = {}) {
    super(server, clientTypes);

    this.filesystem = this.require('filesystem');
    this.platform = this.require('platform');
  }

  start() {
    super.start();
  }

  enter(client) {
    super.enter(client);
  }

  exit(client) {
    super.exit(client);
  }
}

export default RecorderExperience;
