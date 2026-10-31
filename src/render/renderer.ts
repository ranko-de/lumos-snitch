import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  BufferGeometry,
  BufferAttribute,
  AdditiveBlending,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  MeshStandardMaterial,
} from 'three';
import { CONFIG, PLAYER_COLORS } from '../config';
import { BOOTH, groundHeight } from '../game/arena';
import type { SimEvent, Simulation } from '../game/simulation';
import { clothTime, createDumbledoreFigure, createRider, createSnitchMesh, type DumbledoreParts, type RiderParts, type SnitchParts } from './characters';
import { Crowd } from './crowd';
import { Particles, WindStreaks } from './effects';
import { buildStadium, type StadiumParts } from './stadium';
import { RainSheet, StormCloud } from './storm';
import { rainOn } from '../game/eggs';
import { makeGlowTexture } from './textures';

const CAM = CONFIG.camera;

interface LightLook {
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  dirColor: Color;
  dirIntensity: number;
  dirPos: Vector3;
  skyTop: Color;
  skyHorizon: Color;
  skyBottom: Color;
  fog: Color;
  fogNear: number;
  fogFar: number;
  cloud: Color;
}

const DAY: LightLook = {
  hemiSky: new Color('#d6ebff'),
  hemiGround: new Color('#6f9450'),
  hemiIntensity: 1.25,
  dirColor: new Color('#fff0d6'),
  dirIntensity: 2.6,
  dirPos: new Vector3(-380, 330, -520).normalize(),
  skyTop: new Color('#3f8fe6'),
  skyHorizon: new Color('#d3ebff'),
  skyBottom: new Color('#a9d39b'),
  fog: new Color('#cbe2f5'),
  fogNear: 280,
  fogFar: 1500,
  cloud: new Color('#ffffff'),
};

const NIGHT: LightLook = {
  hemiSky: new Color('#6a86da'),
  hemiGround: new Color('#1c2a50'),
  hemiIntensity: 0.95,
  dirColor: new Color('#a8c0ff'),
  dirIntensity: 1.25,
  dirPos: new Vector3(360, 300, -560).normalize(),
  skyTop: new Color('#050a28'),
  skyHorizon: new Color('#22346c'),
  skyBottom: new Color('#0e1834'),
  fog: new Color('#1a2852'),
  fogNear: 190,
  fogFar: 1200,
  cloud: new Color('#34437a'),
};

export interface ViewInfo {
  /** Snitch position in viewport pixels (relative to the viewport), or null. */
  reticle: { x: number; y: number } | null;
  /** Where the catch zone points (default reticle position), viewport pixels. */
  aim: { x: number; y: number };
}

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly cameras: [PerspectiveCamera, PerspectiveCamera];
  readonly attractCamera: PerspectiveCamera;
  private readonly stadium: StadiumParts;
  private readonly crowd: Crowd;
  private readonly riders: [RiderParts, RiderParts];
  private readonly shadows: Mesh[] = [];
  private readonly dumbledore: DumbledoreParts;
  private readonly snitch: SnitchParts;
  private readonly snitchGlow: Sprite;
  private readonly trail: Points;
  private readonly trailGeo: BufferGeometry;
  private readonly trailPos: Float32Array;
  private readonly bolt: Group;
  private readonly particles: Particles;
  private readonly streaks: [WindStreaks, WindStreaks];
  private readonly stormCloud: StormCloud;
  private readonly rainSheets: [RainSheet, RainSheet];
  private readonly hemi: HemisphereLight;
  private readonly dir: DirectionalLight;
  private readonly fog: Fog;
  private readonly look: LightLook;
  private width = 1;
  private height = 1;
  cheer = 0;
  private attractAngle = 0;
  private boothProximity: [number, number] = [0, 0];
  reducedMotion = false;
  readonly viewInfo: [ViewInfo, ViewInfo] = [
    { reticle: null, aim: { x: 0, y: 0 } },
    { reticle: null, aim: { x: 0, y: 0 } },
  ];

  // Interpolation snapshots (previous fixed step).
  private readonly prevPos = [new Vector3(), new Vector3()];
  private readonly prevYaw = [0, 0];
  private readonly prevSnitch = new Vector3();
  private readonly camPos = [new Vector3(), new Vector3()];
  private readonly camLook = [new Vector3(), new Vector3()];
  private camInit = [false, false];

  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tmp3 = new Vector3();
  private readonly reticleScratch = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];

  constructor(
    readonly canvas: HTMLCanvasElement,
    private lowQuality: boolean,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: !lowQuality, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.applyPixelRatio();

    this.look = cloneLook(DAY);
    this.fog = new Fog(DAY.fog.clone(), DAY.fogNear, DAY.fogFar);
    this.scene.fog = this.fog;

    this.hemi = new HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiIntensity);
    this.scene.add(this.hemi);
    this.dir = new DirectionalLight(DAY.dirColor, DAY.dirIntensity);
    this.scene.add(this.dir);
    this.scene.add(this.dir.target);

    this.stadium = buildStadium(lowQuality);
    this.scene.add(this.stadium.root);
    this.crowd = new Crowd(this.stadium.seats);
    this.scene.add(this.crowd.group);

    const accents = [0xf2c94c, 0xd9dde3];
    this.riders = [createRider(PLAYER_COLORS[0], accents[0]), createRider(PLAYER_COLORS[1], accents[1])];
    const shadowMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
    for (const r of this.riders) {
      this.scene.add(r.root);
      const sh = new Mesh(new CircleGeometry(0.9, 20), shadowMat);
      sh.rotation.x = -Math.PI / 2;
      sh.renderOrder = 1;
      this.scene.add(sh);
      this.shadows.push(sh);
    }

    this.dumbledore = createDumbledoreFigure();
    this.scene.add(this.dumbledore.root);

    this.snitch = createSnitchMesh(CONFIG.snitch.radius);
    this.scene.add(this.snitch.root);
    this.snitchGlow = new Sprite(
      new SpriteMaterial({ map: makeGlowTexture(), blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false }),
    );
    this.snitchGlow.renderOrder = 6;
    this.scene.add(this.snitchGlow);

    this.trailPos = new Float32Array(CONFIG.snitch.trailLength * 3);
    this.trailGeo = new BufferGeometry();
    this.trailGeo.setAttribute('position', new BufferAttribute(this.trailPos, 3));
    this.trail = new Points(
      this.trailGeo,
      new PointsMaterial({
        color: 0xffd36a,
        size: 0.45,
        map: makeGlowTexture(),
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        fog: false,
      }),
    );
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

    const glow = makeGlowTexture('rgba(240,220,255,1)', 'rgba(150,80,255,0)');
    this.particles = new Particles(lowQuality ? 400 : 800, glow);
    this.scene.add(this.particles.points);

    this.bolt = new Group();
    const boltCore = new Mesh(new SphereGeometry(0.35, 12, 8), new MeshStandardMaterial({ color: 0xe8d4ff, emissive: 0xa45cff, emissiveIntensity: 3 }));
    const boltGlow = new Sprite(new SpriteMaterial({ map: glow, blending: AdditiveBlending, transparent: true, depthWrite: false }));
    boltGlow.scale.setScalar(3.2);
    this.bolt.add(boltCore, boltGlow);
    this.bolt.visible = false;
    this.scene.add(this.bolt);

    this.cameras = [this.makeCamera(1), this.makeCamera(2)];
    this.streaks = [new WindStreaks(), new WindStreaks()];
    this.rainSheets = [new RainSheet(lowQuality ? 140 : 220), new RainSheet(lowQuality ? 140 : 220)];
    this.stormCloud = new StormCloud(lowQuality);
    this.scene.add(this.stormCloud.root);
    this.cameras.forEach((cam, i) => {
      this.streaks[i].lines.layers.set(i + 1);
      cam.add(this.streaks[i].lines);
      this.rainSheets[i].lines.layers.set(i + 1);
      cam.add(this.rainSheets[i].lines);
      this.scene.add(cam);
    });
    this.attractCamera = new PerspectiveCamera(55, 1, 0.5, 3000);
  }

  private makeCamera(layer: number): PerspectiveCamera {
    const c = new PerspectiveCamera(CAM.baseFov, 1, CAM.near, CAM.far);
    c.layers.enable(layer);
    return c;
  }

  setLowQuality(low: boolean): void {
    this.lowQuality = low;
    this.applyPixelRatio();
  }

  private applyPixelRatio(): void {
    const max = this.lowQuality ? CONFIG.render.lowQualityPixelRatio : CONFIG.render.maxPixelRatio;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, max));
  }

  resize(w: number, h: number): void {
    this.width = Math.max(2, w);
    this.height = Math.max(2, h);
    this.applyPixelRatio();
    this.renderer.setSize(this.width, this.height, false);
    const half = Math.floor(this.width / 2);
    this.cameras[0].aspect = half / this.height;
    this.cameras[1].aspect = (this.width - half) / this.height;
    for (const c of this.cameras) c.updateProjectionMatrix();
    this.attractCamera.aspect = this.width / this.height;
    this.attractCamera.updateProjectionMatrix();
    this.particles.setViewportHeight(this.height * this.renderer.getPixelRatio());
  }

  /** Makes the crowd jump and wave for a moment (0..1). */
  cheerBurst(level: number): void {
    this.cheer = Math.max(this.cheer, level);
  }

  /** Call before each fixed simulation step so rendering can interpolate. */
  capture(sim: Simulation): void {
    for (let i = 0; i < 2; i++) {
      this.prevPos[i].copy(sim.players[i].pos);
      this.prevYaw[i] = sim.players[i].yaw;
    }
    this.prevSnitch.copy(sim.snitch.pos);
  }

  /** Snaps cameras (after a reset/teleport). */
  snapCameras(sim: Simulation): void {
    this.capture(sim);
    this.camInit[0] = this.camInit[1] = false;
    this.particles.clear();
  }

  handleEvents(events: readonly SimEvent[], sim: Simulation): void {
    for (const e of events) {
      switch (e.type) {
        case 'catch':
        case 'practiceCatch':
          this.particles.emit(e.at, 70, 0xffd25a, 9, { life: 1.2, size: 0.45, gravity: 2 });
          this.particles.emit(e.at, 30, 0xffffff, 5, { life: 0.8, size: 0.3 });
          if (e.type === 'catch') this.cheer = 1;
          break;
        case 'ring':
          this.particles.emit(e.at, 40, 0xffe28a, 6, { life: 0.8, size: 0.4, spread: new Vector3(0.5, 4, 4) });
          break;
        case 'spellHit':
          this.cheer = Math.max(this.cheer, 0.6);
          this.particles.emit(sim.players[e.victim].pos, 60, 0xb06bff, 7, { life: 1.0, size: 0.45 });
          break;
        case 'tie':
          this.particles.emit(e.at, 40, 0xfff2c0, 7, { life: 0.8, size: 0.35 });
          break;
        case 'boost': {
          const p = sim.players[e.player];
          this.tmp.copy(p.pos).addScaledVector(p.forward, -1.6);
          this.particles.emit(this.tmp, 24, 0xbfe3ff, 4, { life: 0.5, size: 0.35, dir: this.tmp2.copy(p.forward).negate() });
          break;
        }
        case 'respawn':
          this.particles.emit(e.at, 30, 0xffd25a, 4, { life: 1.0, size: 0.35 });
          break;
        case 'hint':
          this.particles.emit(e.at, 18, 0xffe9a0, 2.5, { life: 0.9, size: 0.3 });
          break;
        case 'bump': {
          const p = sim.players[e.player];
          this.particles.emit(p.pos, 12, 0xd8e6c8, 3, { life: 0.5, size: 0.4 });
          break;
        }
        case 'stormSummon':
          this.particles.emit(sim.storm.pos, 50, 0x9fb3d9, 5, { life: 1.2, size: 0.6, spread: new Vector3(3, 1, 3) });
          break;
        case 'dumbledoreTrigger':
          this.particles.emit(BOOTH.seat, 40, 0xc58bff, 4, { life: 1.0, size: 0.4, spread: new Vector3(1, 2, 1) });
          break;
        case 'dumbledoreLeave':
          this.particles.emit(e.at, 50, 0xe0c8ff, 3.5, { life: 1.1, size: 0.5, spread: new Vector3(1, 1.5, 1) });
          break;
        case 'dumbledoreHome':
          this.particles.emit(BOOTH.seat, 60, 0xe0c8ff, 3, { life: 1.3, size: 0.55, spread: new Vector3(1.5, 2, 1.5) });
          break;
        default:
          break;
      }
    }
  }

  /** Updates all scene objects from the shared simulation. alpha = interpolation 0..1. */
  sync(sim: Simulation, alpha: number, dt: number): void {
    const time = sim.clock;
    this.stadium.flagTime.value = time;
    clothTime.value = time;
    this.cheer = Math.max(0, this.cheer - dt / 2.5);
    this.crowd.update(time, sim.ghosts.blend, Math.min(1, this.cheer * 1.5));
    this.particles.update(dt);

    for (let i = 0; i < 2; i++) {
      const p = sim.players[i];
      const r = this.riders[i];
      r.root.position.lerpVectors(this.prevPos[i], p.pos, alpha);
      r.root.rotation.set(p.pitch, lerpAngle(this.prevYaw[i], p.yaw, alpha), 0, 'YXZ');
      r.bank.rotation.z = -p.bank;
      const crazy = p.crazyTime > 0 ? Math.min(1, p.crazyTime / 0.5) : 0;
      r.wobble.rotation.z = Math.sin(p.crazyPhase * 1.7) * 0.32 * crazy;
      r.wobble.rotation.x = Math.sin(p.crazyPhase * 3.1) * 0.12 * crazy;
      r.wobble.position.y = Math.sin(time * 31) * 0.03 * crazy;
      r.body.rotation.x = -p.pitch * 0.25;
      r.body.rotation.z = -p.turnInput * 0.12;
      const grab = p.grabAnim > 0 ? Math.sin((1 - p.grabAnim / 0.45) * Math.PI) : 0;
      r.rightArm.rotation.x = -1.15 - grab * 1.1;
      r.scarfTail.rotation.y = Math.sin(time * 9 + i) * 0.25;
      r.scarfTail.rotation.x = 0.15 + Math.sin(time * 7 + i) * 0.1;
      const g = groundHeight(r.root.position.x, r.root.position.z);
      const sh = this.shadows[i];
      sh.position.set(r.root.position.x, g + 0.05, r.root.position.z);
      const hgt = r.root.position.y - g;
      sh.visible = hgt < 40 && sim.phase !== 'attract' && sim.active[i];
      sh.scale.setScalar(1 + hgt * 0.02);
      (sh.material as MeshBasicMaterial).opacity = Math.max(0.05, 0.3 - hgt * 0.006);
      r.root.visible = sim.phase !== 'attract' && sim.active[i];
      this.boothProximity[i] = Math.max(0, 1 - p.pos.distanceTo(BOOTH.zoneCenter) / CONFIG.dumbledore.hintRadius);
    }

    // Snitch.
    const s = sim.snitch;
    const sm = this.snitch;
    sm.root.position.lerpVectors(this.prevSnitch, s.pos, alpha);
    sm.root.lookAt(this.tmp.copy(sm.root.position).add(s.dir));
    const flap = Math.sin(s.wingPhase) * 0.9;
    sm.wingL.rotation.z = flap;
    sm.wingR.rotation.z = -flap;
    const appear = s.visible ? easeOutBack(s.anim) : 1 - s.anim;
    sm.root.scale.setScalar(Math.max(0.001, appear));
    sm.root.visible = s.visible || s.anim < 1;
    if (!s.visible) sm.root.rotation.y += dt * 18;
    let n = 0;
    for (let k = 0; k < s.trailCount; k++) {
      const idx = ((s.trailHead - k + CONFIG.snitch.trailLength) % CONFIG.snitch.trailLength) * 3;
      this.trailPos[n * 3] = s.trail[idx];
      this.trailPos[n * 3 + 1] = s.trail[idx + 1];
      this.trailPos[n * 3 + 2] = s.trail[idx + 2];
      n++;
    }
    this.trailGeo.setDrawRange(0, s.visible ? n : 0);
    this.trailGeo.attributes.position.needsUpdate = true;
    this.snitchGlow.position.copy(sm.root.position);

    // Dumbledore.
    const d = sim.dumbledore;
    const fig = this.dumbledore.root;
    if (d.attached && d.caster >= 0) {
      const slot = this.riders[d.caster as 0 | 1].passengerSlot;
      if (fig.parent !== slot) slot.add(fig);
      fig.position.set(0, 0, 0);
      fig.rotation.set(0, 0, 0);
    } else {
      if (fig.parent !== this.scene) this.scene.add(fig);
      fig.position.copy(d.pos);
      fig.rotation.set(0, d.yaw, 0);
    }
    const waving = d.phase === 'notice' || d.phase === 'projectile' || (d.phase === 'ride' && d.phaseTime > 0.3);
    this.dumbledore.wandArm.rotation.x = waving ? -1.6 + Math.sin(time * 14) * 0.5 : -0.5;
    if (d.phase === 'fly' || d.phase === 'return') {
      this.tmp.copy(d.pos);
      this.particles.emit(this.tmp, 2, 0xd9b8ff, 1, { life: 0.6, size: 0.35 });
    }
    this.bolt.visible = d.projectileActive;
    if (d.projectileActive) {
      this.bolt.position.copy(d.projectile);
      this.particles.emit(d.projectile, 3, 0xb06bff, 1.2, { life: 0.5, size: 0.5 });
    }

    // Wind streaks per player (only that player's camera layer).
    for (let i = 0; i < 2; i++) {
      const p = sim.players[i];
      const k = this.reducedMotion ? 0 : Math.max(0, Math.min(1, (p.speed - 12) / 10)) * 0.35;
      this.streaks[i].update(dt, p.speed, sim.phase === 'attract' ? 0 : k);
    }

    // Rain cloud (easter egg 3): world cloud + rain sheet in the victim's camera only.
    const st = sim.storm;
    const showStorm = sim.phase === 'playing';
    this.stormCloud.update(st.pos.x, st.pos.y, st.pos.z, showStorm ? st.cloud : 0, showStorm ? st.rain : 0, time, dt);
    for (let i = 0; i < 2; i++) this.rainSheets[i].update(dt, showStorm ? rainOn(st, i) : 0);

    // Booth hint sparkle flicker is per view (see applyView).
    this.attractAngle += dt * 0.06;
  }

  updateCameras(sim: Simulation, dt: number): void {
    for (let i = 0; i < 2; i++) {
      const p = sim.players[i];
      const cam = this.cameras[i];
      const r = this.riders[i].root.position;
      const yaw = this.riders[i].root.rotation.y;
      const camPitch = p.pitch * CAM.pitchFollow;
      const cp = Math.cos(camPitch);
      const fx = -Math.sin(yaw) * cp;
      const fy = Math.sin(camPitch);
      const fz = -Math.cos(yaw) * cp;
      this.tmp.set(r.x - fx * CAM.distance, r.y - fy * CAM.distance + CAM.height, r.z - fz * CAM.distance);
      const gMin = groundHeight(this.tmp.x, this.tmp.z) + 0.6;
      if (this.tmp.y < gMin) this.tmp.y = gMin;
      this.tmp2.set(r.x + fx * CAM.lookAhead, r.y + fy * CAM.lookAhead + CAM.lookUp, r.z + fz * CAM.lookAhead);
      if (!this.camInit[i]) {
        this.camPos[i].copy(this.tmp);
        this.camLook[i].copy(this.tmp2);
        this.camInit[i] = true;
      } else {
        this.camPos[i].lerp(this.tmp, 1 - Math.exp(-CAM.followResponse * dt));
        this.camLook[i].lerp(this.tmp2, 1 - Math.exp(-CAM.rotationResponse * dt));
      }
      cam.position.copy(this.camPos[i]);
      const roll = this.reducedMotion ? 0 : -p.bank * CAM.rollFollow;
      this.tmp3.set(fx, 0, fz).normalize();
      cam.up.set(0, 1, 0).applyAxisAngle(this.tmp3, roll);
      cam.lookAt(this.camLook[i]);
      const speedK = Math.max(0, Math.min(1, (p.speed - CONFIG.flight.cruiseSpeed * 0.5) / CONFIG.flight.cruiseSpeed));
      const fov = CAM.baseFov + (this.reducedMotion ? 0 : CAM.speedFov * speedK);
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov += (fov - cam.fov) * (1 - Math.exp(-4 * dt));
        cam.updateProjectionMatrix();
      }
    }
    // Title-screen orbit.
    const a = this.attractAngle;
    this.attractCamera.position.set(Math.cos(a) * 215, 62 + Math.sin(a * 2.3) * 10, Math.sin(a) * 165);
    this.attractCamera.lookAt(0, 8, 0);
  }

  /**
   * Applies one view's complete lighting/visibility state. Every value that can
   * differ between views is written here, before every render pass, so nothing
   * leaks from one half of the screen to the other.
   */
  private applyView(blend: number, camera: PerspectiveCamera, viewHeightPx: number, boothProx: number, time: number): void {
    const b = smooth(blend);
    const L = this.look;
    lerpLook(DAY, NIGHT, b, L);
    this.hemi.color.copy(L.hemiSky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemiIntensity;
    this.dir.color.copy(L.dirColor);
    this.dir.intensity = L.dirIntensity;
    this.dir.position.copy(L.dirPos).multiplyScalar(200);
    this.fog.color.copy(L.fog);
    this.fog.near = L.fogNear;
    this.fog.far = L.fogFar;
    const su = this.stadium.skyMaterial.uniforms;
    (su.uTop.value as Color).copy(L.skyTop);
    (su.uHorizon.value as Color).copy(L.skyHorizon);
    (su.uBottom.value as Color).copy(L.skyBottom);
    this.stadium.sky.position.copy(camera.position);
    this.stadium.stars.position.copy(camera.position);

    const sunMat = this.stadium.sun.material as SpriteMaterial;
    sunMat.opacity = 1 - b;
    this.stadium.sun.visible = b < 0.99;
    const moonMat = this.stadium.moon.material as MeshBasicMaterial;
    moonMat.opacity = b;
    this.stadium.moon.visible = b > 0.01;
    const starMat = this.stadium.stars.material as PointsMaterial;
    starMat.opacity = b * 0.9;
    this.stadium.stars.visible = b > 0.01;
    this.stadium.cloudMaterial.color.copy(L.cloud);

    for (const g of this.stadium.nightGlow) g.material.emissiveIntensity = g.day + (g.night - g.day) * b;

    // Snitch: same object, same place — only its presentation changes.
    this.snitch.ballMaterial.emissiveIntensity = b * 2.4;
    const wingMat = this.snitch.root.userData.wingMaterial as MeshStandardMaterial;
    wingMat.emissiveIntensity = b * 0.9;
    const glowMat = this.snitchGlow.material as SpriteMaterial;
    const visibleSnitch = this.snitch.root.visible && this.snitch.root.scale.x > 0.2;
    glowMat.opacity = visibleSnitch ? b * (0.85 + 0.15 * Math.sin(time * 13)) : 0;
    this.snitchGlow.visible = glowMat.opacity > 0.01;
    const dist = camera.position.distanceTo(this.snitchGlow.position);
    this.snitchGlow.scale.setScalar(Math.max(1.6, dist * 0.035));
    const trailMat = this.trail.material as PointsMaterial;
    trailMat.opacity = b * 0.85;
    this.trail.visible = b > 0.01;

    // Booth hint: only the approaching player's view sees the lanterns brighten.
    const twinkle = 0.6 + 0.4 * Math.sin(time * 3.1);
    this.stadium.boothLantern.emissiveIntensity = 0.25 + boothProx * (1.6 + b) * twinkle;
    const spMat = this.stadium.boothSparkle.material as SpriteMaterial;
    spMat.opacity = boothProx * 0.55 * twinkle;
    this.stadium.boothSparkle.visible = spMat.opacity > 0.01;

    this.particles.setViewportHeight(viewHeightPx);
  }

  /** In the caster's own view the passenger would block the camera: fade him. */
  private applyPassengerFade(viewer: number, sim: Simulation): void {
    const d = sim.dumbledore;
    const fade = d.attached && d.caster === viewer;
    for (const m of this.dumbledore.materials) {
      const want = fade ? 0.28 : 1;
      m.opacity = want;
      m.depthWrite = !fade;
    }
    for (const o of this.dumbledore.outlines) o.visible = !fade;
  }

  render(sim: Simulation, splitScreen: boolean): void {
    const r = this.renderer;
    const pr = r.getPixelRatio();
    const time = sim.clock;
    if (!splitScreen) {
      r.setScissorTest(false);
      r.setViewport(0, 0, this.width, this.height);
      const blend = 0.5 + 0.5 * Math.sin(time * 0.25 - 1.2);
      this.applyView(blend, this.attractCamera, this.height * pr, 0, time);
      this.applyPassengerFade(-1, sim);
      r.render(this.scene, this.attractCamera);
      return;
    }
    const half = Math.floor(this.width / 2);
    const solo = sim.singlePlayer ? sim.soloIndex : -1;
    r.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      if (solo >= 0 && i !== solo) {
        this.viewInfo[i].reticle = null;
        continue;
      }
      const x = solo >= 0 ? 0 : i === 0 ? 0 : half;
      const w = solo >= 0 ? this.width : i === 0 ? half : this.width - half;
      const aspect = w / this.height;
      if (Math.abs(this.cameras[i].aspect - aspect) > 1e-3) {
        this.cameras[i].aspect = aspect;
        this.cameras[i].updateProjectionMatrix();
      }
      r.setViewport(x, 0, w, this.height);
      r.setScissor(x, 0, w, this.height);
      this.applyView(sim.players[i].darkBlend, this.cameras[i], this.height * pr, this.boothProximity[i], time);
      this.applyPassengerFade(i, sim);
      r.render(this.scene, this.cameras[i]);
      this.updateReticle(sim, i, w);
    }
    r.setScissorTest(false);
  }

  private updateReticle(sim: Simulation, i: number, w: number): void {
    const p = sim.players[i];
    const info = this.viewInfo[i];
    const cam = this.cameras[i];
    // Aim marker: a point inside the catch zone, straight ahead of the raised hand.
    const r = this.riders[i].root.position;
    this.tmp.set(r.x, r.y + CONFIG.catch.originHeight, r.z).addScaledVector(p.forward, CONFIG.catch.radius * 0.8).project(cam);
    info.aim.x = ((this.tmp.x + 1) / 2) * w;
    info.aim.y = ((1 - this.tmp.y) / 2) * this.height;
    if (!p.canCatch || !sim.snitch.visible) {
      info.reticle = null;
      return;
    }
    this.tmp.copy(this.snitch.root.position).project(cam);
    if (this.tmp.z > 1) {
      info.reticle = null;
      return;
    }
    info.reticle = this.reticleScratch[i];
    info.reticle.x = ((this.tmp.x + 1) / 2) * w;
    info.reticle.y = ((1 - this.tmp.y) / 2) * this.height;
  }

  /** Debug/test helper: reads the colour of a pixel (CSS px, top-left origin). */
  samplePixel(x: number, y: number): [number, number, number] {
    const gl = this.renderer.getContext();
    const pr = this.renderer.getPixelRatio();
    const buf = new Uint8Array(4);
    gl.readPixels(Math.floor(x * pr), Math.floor((this.height - y) * pr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return [buf[0], buf[1], buf[2]];
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

function cloneLook(l: LightLook): LightLook {
  return {
    hemiSky: l.hemiSky.clone(),
    hemiGround: l.hemiGround.clone(),
    hemiIntensity: l.hemiIntensity,
    dirColor: l.dirColor.clone(),
    dirIntensity: l.dirIntensity,
    dirPos: l.dirPos.clone(),
    skyTop: l.skyTop.clone(),
    skyHorizon: l.skyHorizon.clone(),
    skyBottom: l.skyBottom.clone(),
    fog: l.fog.clone(),
    fogNear: l.fogNear,
    fogFar: l.fogFar,
    cloud: l.cloud.clone(),
  };
}

function lerpLook(a: LightLook, b: LightLook, t: number, out: LightLook): void {
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
  out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;
  out.dirColor.lerpColors(a.dirColor, b.dirColor, t);
  out.dirIntensity = a.dirIntensity + (b.dirIntensity - a.dirIntensity) * t;
  out.dirPos.lerpVectors(a.dirPos, b.dirPos, t).normalize();
  out.skyTop.lerpColors(a.skyTop, b.skyTop, t);
  out.skyHorizon.lerpColors(a.skyHorizon, b.skyHorizon, t);
  out.skyBottom.lerpColors(a.skyBottom, b.skyBottom, t);
  out.fog.lerpColors(a.fog, b.fog, t);
  out.fogNear = a.fogNear + (b.fogNear - a.fogNear) * t;
  out.fogFar = a.fogFar + (b.fogFar - a.fogFar) * t;
  out.cloud.lerpColors(a.cloud, b.cloud, t);
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
