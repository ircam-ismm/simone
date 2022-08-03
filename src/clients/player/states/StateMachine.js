import DrumMachine from './DrumMachine.js';
import SolarSystemSatellite from './SolarSystemSatellite.js';
import SolarSystemOmega from './SolarSystemOmega.js';
import SolarSystemDispatch from './SolarSystemDispatch.js';
import NoMicrophone from './NoMicrophone.js';
import PerformanceState from './PerformanceState.js';
import ClonePlaying from './ClonePlaying.js';
import CloneRecording from './CloneRecording.js';
import CloneWaiting from './CloneWaiting.js';

const states = {
  'drum-machine': DrumMachine,
  'clone': CloneRecording,
  'clone-recording': CloneRecording,
  'clone-waiting': CloneWaiting,
  'clone-playing': ClonePlaying,
  'solar-system': SolarSystemDispatch,
  'solar-system-dispatch': SolarSystemDispatch,
  'solar-system-satellite': SolarSystemSatellite,
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
