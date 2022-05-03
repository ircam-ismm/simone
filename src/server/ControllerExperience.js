import { AbstractExperience } from '@soundworks/core/server';

class ControllerExperience extends AbstractExperience {
  constructor(server, clientTypes, options = {}) {
    super(server, clientTypes);

    this.platform = this.require('platform');
    this.sync = this.require('sync');
    this.synthScripting = this.require('synth-scripting');
    this.filesystem = this.require('filesystem');
    this.audioBufferLoader = this.require('audio-buffer-loader');
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

export default ControllerExperience;
