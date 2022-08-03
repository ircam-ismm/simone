export default {
  system: {
    type: 'string',
    default: null,
    nullable: true,
  },
  nPlayers: {
    type: 'integer',
    default: null,
    nullable: true,
  },
  clonePlayersReady: {
    type: 'integer',
    default: 0,
  },
  availableNames: {
    type: 'any',
    default: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ'],
  },
};