import 'source-map-support/register';
import { Server } from '@soundworks/core/server';
import path from 'path';
import serveStatic from 'serve-static';
import compile from 'template-literal';

import PlayerExperience from './PlayerExperience.js';
import ControllerExperience from './ControllerExperience.js';
import ThingExperience from './ThingExperience.js';

import pluginPlatformFactory from '@soundworks/plugin-platform/server';
import pluginSyncFactory from '@soundworks/plugin-sync/server';
import pluginFilesystemFactory from '@soundworks/plugin-filesystem/server';
import pluginAudioBufferLoaderFactory from '@soundworks/plugin-audio-buffer-loader/server';
import pluginCheckinFactory from '@soundworks/plugin-checkin/server';
import pluginLoggerFactory from '@soundworks/plugin-logger/server';

import participantSchema from './schemas/participant.js';
import globalSchema from './schemas/global.js';


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
server.pluginManager.register('filesystem', pluginFilesystemFactory, {
  directories: [
    {
      name: 'soundbank',
      path: path.join(process.cwd(), 'soundbank'),
      publicDirectory: 'soundbank',
    },
    {
      name: 'user-files',
      path: path.join(process.cwd(), 'soundbank', 'user-files'),
      publicDirectory: 'user-files',
    },
  ],
}, []);
server.pluginManager.register('checkin', pluginCheckinFactory, {
  capacity: config.app.nPlayers,
}, []);
server.pluginManager.register('audio-buffer-loader', pluginAudioBufferLoaderFactory, {}, []);
server.pluginManager.register('logger', pluginLoggerFactory, {
  directory: 'logs',
}, []);


// -------------------------------------------------------------------
// register schemas
// -------------------------------------------------------------------
// server.stateManager.registerSchema(name, schema);
server.stateManager.registerSchema('participant', participantSchema);
server.stateManager.registerSchema('global', globalSchema);

(async function launch() {
  try {
    await server.init(config, (clientType, config, httpRequest) => {
      return {
        clientType: clientType,
        app: {
          name: config.app.name,
          author: config.app.author,
          system: config.app.system,
        },
        env: {
          type: config.env.type,
          websockets: config.env.websockets,
          subpath: config.env.subpath,
        }
      };
    });


    const global = await server.stateManager.create('global', {
      system: server.config.app.system,
      nPlayers: server.config.app.nPlayers,
    });

    const players = new Set(); 

    server.stateManager.observe(async (schemaName, stateId, nodeId) => {
      switch (schemaName) {
        case 'participant':
          const playerState = await server.stateManager.attach(schemaName, stateId);

          playerState.onDetach(() => {
            // Once a player leaves, their name is put back in the pool
            const name = playerState.get('name');
            if (name !== 'Ω' && name !== 'Ω*' && name !== null) {
              const availableNames = global.get('availableNames');
              availableNames.unshift(name);
              global.set({ availableNames: availableNames });
            }

            // In clone mode only : one less player ready
            const state = playerState.get('state');
            if (state === 'clone-waiting' || state === 'clone-playing') {
              const nPlayersReady = global.get('clonePlayersReady');
              global.set({ clonePlayersReady: nPlayersReady - 1});
            }
            // clean things
            players.delete(playerState);
          });
          // store the player state into a list
          players.add(playerState);
          break;
      }
    });


    const playerExperience = new PlayerExperience(server, 'player');
    const controllerExperience = new ControllerExperience(server, 'controller');
    const thingExperience = new ThingExperience(server, 'thing');

    // start all the things
    await server.start();
    playerExperience.start();
    controllerExperience.start();
    thingExperience.start();

  } catch (err) {
    console.error(err.stack);
  }
})();

process.on('unhandledRejection', (reason, p) => {
  console.log('> Unhandled Promise Rejection');
  console.log(reason);
});
