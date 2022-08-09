import 'source-map-support/register.js';
import { Client } from '@soundworks/core/client.js';
import getConfig from '../../utils/getConfig.js';

import ThingExperience from './ThingExperience.js';

// emulate several bugs for testing purposes
const ENV = process.env.ENV || 'default';
const NUM_CLIENTS = process.env.NUM_CLIENTS || 1;
const config = {
  ...getConfig(ENV),
  clientType: 'thing',
};

console.log(`
--------------------------------------------------------
- running ${NUM_CLIENTS} "${config.clientType}" in "${ENV}" environment
- connecting to server: ${config.env.serverIp}:${config.env.port}
- [pid: ${process.pid}]
--------------------------------------------------------
`);

async function launch(index) {
  try {
    const client = new Client();

    // -------------------------------------------------------------------
    // register plugins
    // -------------------------------------------------------------------

    // -------------------------------------------------------------------
    // launch application
    // -------------------------------------------------------------------
    console.log(config)
    await client.init(config);
    initQoS(client);

    const experience = new ThingExperience(client, config);

    // start all the things
    await client.start();
    experience.start();

  } catch(err) {
    console.log(err);
  }
}


// -------------------------------------------------------------------
// helpers & bootstrapping
// -------------------------------------------------------------------
function exitHandler(msg) {
  console.log(msg);

  if (NUM_CLIENTS === 1) {
    // https://www.gnu.org/software/libc/manual/html_node/Termination-Signals.html
    console.log('------------------------- TERM');
    process.kill(process.pid, 'SIGKILL');
  }
}

function initQoS(client) {
  client.socket.addListener('close', () => {
    console.log('---------------------------- Disconnected from server');
    exitHandler();
  });

  process.on('exit', () => exitHandler('none'));
  process.on('uncaughtException', err => exitHandler(err));
  process.on('unhandledRejection', err => exitHandler(err));
}

if (NUM_CLIENTS > 1) {
  console.clear();
}

for (let i = 0; i < NUM_CLIENTS; i++) {
  try {
    launch(i);
  } catch(err) {
    console.log(err.message);
  }
}
