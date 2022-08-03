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
};