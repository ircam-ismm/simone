import ConfigureName from './ConfigureName.js';
import DrumMachine from './DrumMachine.js';
import SolarSystem from './SolarSystem.js';
import SolarSystemOmega from './SolarSystemOmega.js';
import NoMicrophone from './NoMicrophone.js';
import PerformanceState from './PerformanceState.js';

const states = {
  'configure-name': ConfigureName,
  'drum-machine': DrumMachine,
  'solar-system': SolarSystem,
  'solar-system-omega': SolarSystemOmega,
  'no-microphone': NoMicrophone,
  'performance': PerformanceState,
};

class StateMachine {
  constructor(context) {
    this.context = context;
    this.state = null;
  }

  async setState(name) {
    if (name === this.name) {
      return;
    }

    if (this.state !== null) {
      console.log(`> exit ${this.state.name}`);
      this.state.status = 'exited';
      await this.state.exit();
      this.state = null;
      this.context.render();
    }

    const ctor = states[name];
    const state = new ctor(name, this.context);

    console.log(`> enter ${name}`);
    await state.enter();
    state.status = 'entered';
    this.state = state;

    this.context.render();
  }
}

export default StateMachine;
