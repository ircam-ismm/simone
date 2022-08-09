import { AbstractExperience } from '@soundworks/core/server.js';

class ThingExperience extends AbstractExperience {
  constructor(server, clientTypes, context = {}) {
    super(server, clientTypes);

    this.sync = this.require('sync');
    this.filesystem = this.require('filesystem');
    // this.audioBufferLoader = this.require('audio-buffer-loader');
    this.checkin = this.require('checkin');
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

export default ThingExperience;
