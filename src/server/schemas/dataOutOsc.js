export default {
  frequency: {
    type: 'float',
    default: null,
    nullable: true,
    event : true,
  },
  rms: {
    type: 'float',
    default: null,
    nullable: true,
    event: true,
  },
  zeroCrossingRate: {
    type: 'float',
    default: null,
    nullable: true,
    event: true,
  },
  mfcc: {
    type: 'any',
    default: null,
    nullable: true,
    event: true,
  }
};