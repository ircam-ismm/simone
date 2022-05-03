export default {
  muted: {
    type: 'boolean',
    default: false,
  },
  frequency: {
    type: 'float',
    default: null,
    nullable: true,
    param: true,
    filterChange : false,
  },
  rms: {
    type: 'float',
    default: null,
    nullable: true,
    param: true,
    filterChange: false,
  },
  zeroCrossingRate: {
    type: 'float',
    default: null,
    nullable: true,
    param: true,
    filterChange: false,
  },
  mfcc: {
    type: 'any',
    default: null,
    nullable: true,
    param: true,
    filterChange: false,
  },
  minFreq: {
    type: 'float',
    default: null,
    nullable: true,
    param: false,
  },
  maxFreq: {
    type: 'float',
    default: null,
    nullable: true,
    param: false,
  },
  maxRms: {
    type: 'float',
    default: null,
    nullable: true,
    param: false,
  }
};