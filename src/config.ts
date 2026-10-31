/**
 * All gameplay tuning values live here.
 * Distances are in metres, times in seconds, angles in radians unless noted.
 */
const DEG = Math.PI / 180;

export const CONFIG = {
  sim: {
    /** Fixed simulation step. */
    step: 1 / 60,
    /** Max real time consumed per frame (prevents jumps after tab switch / pause). */
    maxFrameDelta: 0.1,
    maxStepsPerFrame: 6,
  },

  match: {
    duration: 180,
    catchesToWin: 3,
    countdown: 3,
    respawnDelay: 3,
    /** Respawn candidate must be at least this far from every player (if possible). */
    respawnMinDistance: 45,
    respawnCandidates: 24,
  },

  arena: {
    /** Field ellipse semi-axes (x = length, z = width). Stands start here. */
    fieldA: 132,
    fieldB: 80,
    /** Stands occupy normalised ellipse radius 1.0 .. standsOuter. */
    standsOuter: 1.32,
    standsLow: 3,
    standsHigh: 24,
    /** Back wall rim height at the outer edge of the stands. */
    standsRim: 27,
    /** Flight boundary ellipse (lets players loop around the outside of the stadium). */
    boundsA: 235,
    boundsB: 180,
    ceiling: 70,
    minClearance: 0.8,
    ringHeights: [13, 17, 11],
    ringRadii: [2.6, 3.0, 2.4],
    ringTube: 0.28,
    ringOffsetsZ: [-12, 0, 12],
    ringX: 112,
    postRadius: 0.35,
    towerCount: 12,
    towerRadius: 3.2,
    towerHeight: 34,
  },

  flight: {
    cruiseSpeed: 22,
    /** Night is for searching: the broom flies slower in the dark (multiplier). */
    nightSpeedFactor: 0.7,
    /** Boost (catch button no longer catches — catching is automatic). */
    boostSpeed: 14,
    boostTime: 1.4,
    boostCooldown: 3.5,
    hoverSpeed: 1.6,
    diveBonus: 6,
    climbPenalty: 4,
    /** How quickly speed approaches its target (1/s). */
    accel: 1.6,
    brakeDecel: 2.4,
    /** Holding brake (B) slows the broom to this share of cruise speed... */
    brakeSpeedFactor: 0.55,
    /** ...and turns harder: yaw rate multiplier while braking. */
    brakeTurnBoost: 1.6,
    /** While braking, heading/velocity react this much faster (less drift, sharper carve). */
    brakeGrip: 2.2,
    /** Extra lean while carving a braked turn (multiplier on maxBank). */
    brakeBank: 1.35,
    maxYawRate: 1.55,
    /** Extra yaw rate multiplier at hover speed (tight turns while braking). */
    slowTurnBoost: 0.9,
    yawResponse: 6,
    maxPitch: 38 * DEG,
    pitchResponse: 3.2,
    /** Velocity follows the heading with this response (gentle inertia/drift). */
    velocityResponse: 4.5,
    maxBank: 38 * DEG,
    bankResponse: 6,
    collisionSlowdown: 0.55,
    collisionPush: 6,
    riderRadius: 0.7,
  },

  camera: {
    distance: 4.8,
    height: 2.0,
    lookAhead: 14,
    lookUp: 1.7,
    followResponse: 9,
    rotationResponse: 7,
    pitchFollow: 0.55,
    rollFollow: 0.12,
    baseFov: 68,
    speedFov: 9,
    near: 0.1,
    far: 2200,
  },

  input: {
    /** Keyboard: how quickly analog axes ramp toward held keys (1/s). */
    keyRamp: 7,
    deadzone: 0.08,
    /** Tilt (degrees) that gives full turn / full climb, before sensitivity. */
    fullRollDeg: 28,
    fullPitchDeg: 24,
    /** Exponential smoothing time constant for tilt (s). */
    tiltSmoothing: 0.09,
    defaultSensitivity: 1,
    minSensitivity: 0.5,
    maxSensitivity: 2,
    /** Controller data older than this is treated as neutral. */
    staleAfter: 0.4,
    /** Controller silent this long during play = disconnected → pause. */
    disconnectAfter: 1.5,
    lightDebounce: 0.12,
    /** Hysteresis band as fraction of (open - covered). */
    lightHysteresis: 0.18,
    /** Minimum light separation required by calibration (0..255 units). */
    minLightSeparation: 14,
    minLightSeparationRatio: 0.25,
    calibrationSampleTime: 1.2,
    minCalibrationTiltDeg: 10,
  },

  lighting: {
    transition: 0.5,
  },

  snitch: {
    radius: 0.22,
    cruiseSpeed: 11,
    dartSpeed: 23,
    hoverSpeed: 1.2,
    turnRate: 2.4,
    dartChance: 0.18,
    hoverChance: 0.22,
    evadeRadius: 9,
    evadeBoost: 5,
    /** Seconds of evasion before the snitch tires and slows for a while. */
    evadeStamina: 2.2,
    tiredTime: 2.4,
    tiredSpeed: 6,
    minY: 3,
    maxY: 28,
    /** Snitch stays within this fraction of the field ellipse. */
    fieldFraction: 0.9,
    hintAfter: 20,
    trailLength: 26,
  },

  catch: {
    /** The catch zone is centred on the rider's raised hand, above the head. */
    originHeight: 1.15,
    /** Catching is automatic: get this close (with nothing in between). */
    radius: 4,
    /** Distances closer than this are treated as an exact tie. */
    tieTolerance: 0.05,
  },

  dumbledore: {
    /** Fly into this sphere in front of the booth balcony to pick him up. */
    zoneRadius: 11,
    /** Time inside the zone needed (short, so simply flying past works). */
    dwellTime: 0.15,
    /** While riding, he casts as soon as the opponent is this close. */
    castRange: 32,
    /** If the opponent is never reached, he flies home after this long. */
    maxRideTime: 30,
    /** Starts when he is back in the booth. */
    sharedCooldown: 15,
    spellDuration: 5,
    noticeTime: 0.5,
    flyTime: 0.9,
    projectileTime: 0.8,
    rideAfterCast: 0.8,
    returnTime: 1.2,
    /** Crazy broom lateral drift amplitude (m/s) and frequency (Hz). */
    crazyAmplitude: 4.2,
    crazyFrequency: 0.65,
    hintRadius: 45,
  },

  ghosts: {
    requiredOverlap: 1.0,
    /** Short grace before the haunting ends (absorbs sensor flicker). */
    releaseDelay: 0.25,
    fade: 1.0,
    soundCooldown: 8,
    messageTime: 2.2,
  },

  render: {
    maxPixelRatio: 1.75,
    lowQualityPixelRatio: 1,
    crowdPerRow: 120,
    crowdRows: 7,
    crowdRowsLow: 4,
  },

  audio: {
    defaultVolume: 0.7,
    defaultMusicVolume: 0.55,
    /** The snitch's wing buzz is audible within this distance. */
    snitchHearRadius: 26,
  },
} as const;

export type Config = typeof CONFIG;

export const PLAYER_COLORS = [0xd8382f, 0x2f7fd8] as const;
export const PLAYER_CSS_COLORS = ['#e2493f', '#3f8ce2'] as const;
