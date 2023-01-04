import DrumMachine from './DrumMachine.js';
import DrumMachineContinuous from './DrumMachineContinuous.js';
import SolarSystemSatellite from './SolarSystemSatellite.js';
import SolarSystemOmega from './SolarSystemOmega.js';
import SolarSystemOmegaSolo from './SolarSystemOmegaSolo.js';
import SolarSystemDispatch from './SolarSystemDispatch.js';
import NoMicrophone from './NoMicrophone.js';
import PerformanceState from './PerformanceState.js';
import ClonePlaying from './ClonePlaying.js';
import CloneRecording from './CloneRecording.js';
import CloneWaiting from './CloneWaiting.js';
import Simplified from './Simplified.js';

const states = {
  'drum-machine': DrumMachine,
  'drum-machine-continuous': DrumMachineContinuous,
  'clone': CloneRecording,
  'clone-recording': CloneRecording,
  'clone-waiting': CloneWaiting,
  'clone-playing': ClonePlaying,
  'solar-system': SolarSystemDispatch,
  'solar-system-dispatch': SolarSystemDispatch,
  'solar-system-satellite': SolarSystemSatellite,
  'solar-system-omega': SolarSystemOmega,
  'solar-system-omega-solo': SolarSystemOmegaSolo,
  'no-microphone': NoMicrophone,
  'performance': PerformanceState,
  'simplified': Simplified,
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

    const now = Date.now();
    this.context.writer.write(`${now - this.context.startingTime}ms - > enter ${name}`);
    console.log(`> enter ${name}`);
    await state.enter();
    state.status = 'entered';
    this.state = state;

    this.context.render();
  }
}

export default StateMachine;
