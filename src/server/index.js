import 'source-map-support/register';
import { Server } from '@soundworks/core/server';
import { StateManagerOsc } from '@soundworks/state-manager-osc';
import path from 'path';
import serveStatic from 'serve-static';
import compile from 'template-literal';

import PlayerExperience from './PlayerExperience.js';
import ControllerExperience from './ControllerExperience.js';
import MozaickingExperience from './MozaickingExperience.js';


import pluginPlatformFactory from '@soundworks/plugin-platform/server';
import pluginSyncFactory from '@soundworks/plugin-sync/server';
import pluginFilesystemFactory from '@soundworks/plugin-filesystem/server';
import pluginScriptingFactory from '@soundworks/plugin-scripting/server';
import pluginAudioBufferLoaderFactory from '@soundworks/plugin-audio-buffer-loader/server';

import micControlSchema from './schemas/micControl';
import dataFromMicSchema from './schemas/dataFromMic.js';
import dataOutOscSchema from './schemas/dataOutOsc.js';
import scriptSchema from './schemas/script.js';

import getConfig from '../utils/getConfig.js';
const ENV = process.env.ENV || 'default';
const config = getConfig(ENV);
const server = new Server();

// html template and static files (in most case, this should not be modified)
server.templateEngine = { compile };
server.templateDirectory = path.join('.build', 'server', 'tmpl');
server.router.use(serveStatic('public'));
server.router.use('build', serveStatic(path.join('.build', 'public')));
server.router.use('vendors', serveStatic(path.join('.vendors', 'public')));
server.router.use('soundbank', serveStatic('soundbank'));

console.log(`
--------------------------------------------------------
- launching "${config.app.name}" in "${ENV}" environment
- [pid: ${process.pid}]
--------------------------------------------------------
`);

// -------------------------------------------------------------------
// register plugins
// -------------------------------------------------------------------
// server.pluginManager.register(pluginName, pluginFactory, [pluginOptions], [dependencies])
server.pluginManager.register('platform', pluginPlatformFactory, {}, []);
server.pluginManager.register('sync', pluginSyncFactory, {}, []);
server.pluginManager.register('synth-scripting', pluginScriptingFactory, {
  // default to `.data/scripts`
  directory: 'src/clients/controller/scripts', 
}, []);
server.pluginManager.register('filesystem', pluginFilesystemFactory, {
  directories: [{
    name: 'soundbank',
    path: 'soundbank',
    publicDirectory: 'soundbank',
  }],
}, []);

server.pluginManager.register('audio-buffer-loader', pluginAudioBufferLoaderFactory, {}, []);

// -------------------------------------------------------------------
// register schemas
// -------------------------------------------------------------------
// server.stateManager.registerSchema(name, schema);
server.stateManager.registerSchema('micControl', micControlSchema);
server.stateManager.registerSchema('dataFromMic', dataFromMicSchema);
server.stateManager.registerSchema('dataOutOsc', dataOutOscSchema);
server.stateManager.registerSchema('synth-script', scriptSchema);

(async function launch() {
  try {
    await server.init(config, (clientType, config, httpRequest) => {
      return {
        clientType: clientType,
        app: {
          name: config.app.name,
          author: config.app.author,
        },
        env: {
          type: config.env.type,
          websockets: config.env.websockets,
          subpath: config.env.subpath,
        }
      };
    });

    const micControl = await server.stateManager.create('micControl');
    const synthScript = await server.stateManager.create('synth-script');
    const dataOutOsc = await server.stateManager.create('dataOutOsc');

    const playerExperience = new PlayerExperience(server, 'player');
    const controllerExperience = new ControllerExperience(server, 'controller');
    const mozaickingExperience = new MozaickingExperience(server, 'mozaicking');


    // start all the things
    await server.start();
    playerExperience.start();
    controllerExperience.start();
    mozaickingExperience.start();

    const oscConfig = { // these are the defaults
      localAddress: '0.0.0.0',
      localPort: 57121,
      remoteAddress: '127.0.0.1',
      remotePort: 57122,
    };

    const oscStateManager = new StateManagerOsc(server.stateManager, oscConfig);
    await oscStateManager.init();

  } catch (err) {
    console.error(err.stack);
  }
})();

process.on('unhandledRejection', (reason, p) => {
  console.log('> Unhandled Promise Rejection');
  console.log(reason);
});
