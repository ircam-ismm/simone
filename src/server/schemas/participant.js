export default {
  name: {
    type: 'string',
    default: null,
    nullable: true,
  },
  state: {
    type: 'string',
    default: null,
    nullable: true,
  },
  mosaicingData: {
    type: 'any',
    default: null,
    nullable: true,
    event: true,
  },
  cloneSourceTree: {
    type: 'any',
    default: null,
    nullable: true,
  },
  mosaicingActive: {
    type: 'boolean',
    default: false,
  },
  sourceFilename: {
    type: 'string',
    default: null,
    nullable: true,
  },
  volume: {
    type: 'float',
    default: 0,
  },
  detune: {
    type: 'float',
    default: 0,
  },
  grainPeriod: {
    type: 'float',
    default: 0.05,
  },
  grainDuration: {
    type: 'float',
    default: 0.25,
  },
  sourceFileLoaded: {
    type: 'boolean',
    default: false,
  },
  globalVolume: {
    type: 'float',
    default: 1,
  },
  globalMute: {
    type: 'boolean',
    default: false,
  },
  message: {
    type: 'string',
    default: '',
  }
};