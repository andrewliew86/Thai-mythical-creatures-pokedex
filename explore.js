import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

const DATA_URL = "data/creatures.csv";
const WORLD_RADIUS_X = 25;
const WORLD_RADIUS_Z = 22;
const TILE_SIZE = 2;
const MOVE_SPEED = 6.2;
const MEET_DISTANCE = 4.2;

const creatureSpots = {
  macchanu: [-8, -1],
  chalawan: [-14, 3],
  "phra-aphai-mani": [12, 4],
  "nang-phisua-samut": [27, 10],
  "phra-lo": [-7, -14],
  "phra-phuean-phaeng": [-13, -12],
  manora: [5, 15],
  suthon: [10, 17],
  "luang-pu-thuad": [15, 13],
};

const regionCenters = [
  { name: "Central Thailand", x: -10, z: 1, radius: 9 },
  { name: "Eastern / Gulf Coast", x: 18, z: 7, radius: 12 },
  { name: "Northern Thailand", x: -9, z: -13, radius: 10 },
  { name: "Southern Thailand", x: 9, z: 15, radius: 10 },
];

const ui = {
  world: document.querySelector("#world"),
  loading: document.querySelector("#loading"),
  error: document.querySelector("#error-message"),
  found: document.querySelector("#found-count"),
  total: document.querySelector("#total-count"),
  region: document.querySelector("#region-name"),
  regionKicker: document.querySelector("#region-kicker"),
  quest: document.querySelector("#quest-text"),
  meet: document.querySelector("#meet-button"),
  nearbyName: document.querySelector("#nearby-name"),
  reset: document.querySelector("#reset-button"),
  music: document.querySelector("#music-button"),
  dialog: document.querySelector("#legend-dialog"),
  dialogContent: document.querySelector("#legend-content"),
  closeDialog: document.querySelector("#close-dialog"),
};

const state = {
  creatures: [],
  sprites: [],
  found: new Set(),
  nearby: null,
  lastAutoMeet: null,
  activeRegion: "",
  keys: new Set(),
  touch: new Set(),
  started: false,
};

const soundtrack = {
  context: null,
  master: null,
  timer: null,
  nextTime: 0,
  step: 0,
};

let scene;
let camera;
let renderer;
let player;
let clock;
let terrainHeights = new Map();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])),
  );
}

function seededNoise(x, z) {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function biomeAt(x, z) {
  if (z < -7) return "north";
  if (x > 7 && z < 11) return "coast";
  if (z > 9) return "south";
  return "central";
}

function terrainHeight(x, z) {
  const biome = biomeAt(x, z);
  const ripple = Math.sin(x * 0.36) * 0.13 + Math.cos(z * 0.31) * 0.12;
  const random = (seededNoise(Math.round(x), Math.round(z)) - 0.5) * 0.22;
  if (biome === "north") {
    return 1.5 + Math.max(0, (-z - 7) * 0.12) + ripple * 2 + random;
  }
  if (biome === "coast") return 0.55 + ripple + random;
  if (biome === "south") return 0.9 + ripple * 1.4 + random;
  return 0.75 + ripple + random;
}

function groundHeight(x, z) {
  const gridX = Math.round(x / TILE_SIZE) * TILE_SIZE;
  const gridZ = Math.round(z / TILE_SIZE) * TILE_SIZE;
  return terrainHeights.get(`${gridX},${gridZ}`) ?? terrainHeight(x, z);
}

function isOnIsland(x, z) {
  const ellipse = (x * x) / (WORLD_RADIUS_X * WORLD_RADIUS_X) + (z * z) / (WORLD_RADIUS_Z * WORLD_RADIUS_Z);
  return ellipse < 0.93;
}

function isOnPier(x, z) {
  if (x < 14.5 || x > 25.7) return false;
  const pierCenterZ = 6.9 + (x - 14.5) * 0.24;
  return Math.abs(z - pierCenterZ) < 1.25;
}

function isWalkable(x, z) {
  return isOnIsland(x, z) || isOnPier(x, z);
}

function material(color, roughness = 0.9) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

function addMesh(geometry, meshMaterial, x, y, z, parent = scene) {
  const mesh = new THREE.Mesh(geometry, meshMaterial);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ed9e8);
  scene.fog = new THREE.Fog(0xa9dce4, 29, 70);

  camera = new THREE.OrthographicCamera(-14, 14, 9, -9, 0.1, 120);
  camera.position.set(17, 22, 17);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  ui.world.appendChild(renderer.domElement);

  const hemisphere = new THREE.HemisphereLight(0xfff6d4, 0x447c70, 2.3);
  scene.add(hemisphere);

  const sunlight = new THREE.DirectionalLight(0xfff1c9, 3.3);
  sunlight.position.set(-16, 28, 12);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -34;
  sunlight.shadow.camera.right = 34;
  sunlight.shadow.camera.top = 34;
  sunlight.shadow.camera.bottom = -34;
  sunlight.shadow.bias = -0.0008;
  scene.add(sunlight);

  const water = addMesh(
    new THREE.CylinderGeometry(35, 35, 0.7, 64),
    new THREE.MeshPhysicalMaterial({
      color: 0x35aabd,
      roughness: 0.24,
      metalness: 0.05,
      transparent: true,
      opacity: 0.9,
    }),
    0,
    -0.25,
    0,
  );
  water.receiveShadow = true;

  buildTerrain();
  buildRiver();
  addEnvironmentDetails();
  player = createPlayer();
  player.position.set(-5, groundHeight(-5, 1) + 0.65, 1);
  scene.add(player);
  clock = new THREE.Clock();
}

function buildTerrain() {
  const tileGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.98, 1, TILE_SIZE * 0.98);
  const palette = {
    central: [material(0x8ec85c), material(0xa6d469)],
    coast: [material(0xe6c96f), material(0xf1d986)],
    north: [material(0x679d55), material(0x7cac62)],
    south: [material(0x4d9c68), material(0x62b274)],
  };

  for (let x = -24; x <= 24; x += TILE_SIZE) {
    for (let z = -22; z <= 22; z += TILE_SIZE) {
      if (!isOnIsland(x, z)) continue;
      const height = terrainHeight(x, z);
      terrainHeights.set(`${x},${z}`, height);
      const biome = biomeAt(x, z);
      const tileMaterial = palette[biome][seededNoise(x, z) > 0.54 ? 1 : 0];
      const tile = addMesh(tileGeometry, tileMaterial, x, height / 2, z);
      tile.scale.y = height + 0.55;
    }
  }
}

function buildRiver() {
  const riverMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x4bb9c9,
    roughness: 0.18,
    transparent: true,
    opacity: 0.88,
  });
  const river = new THREE.Group();
  for (let z = -6; z <= 10; z += 1.5) {
    const x = -11 + Math.sin(z * 0.42) * 1.25;
    const segment = addMesh(new THREE.CircleGeometry(1.55, 18), riverMaterial, x, groundHeight(x, z) + 0.57, z, river);
    segment.rotation.x = -Math.PI / 2;
    segment.castShadow = false;
  }
  scene.add(river);
}

function createTree(x, z, kind = "round", scale = 1) {
  const y = groundHeight(x, z) + 0.55;
  const tree = new THREE.Group();
  const trunk = addMesh(new THREE.CylinderGeometry(0.16 * scale, 0.24 * scale, 1.6 * scale, 6), material(0x835331), 0, 0.8 * scale, 0, tree);
  trunk.castShadow = true;

  if (kind === "palm") {
    trunk.rotation.z = 0.08;
    for (let index = 0; index < 6; index += 1) {
      const leaf = addMesh(new THREE.ConeGeometry(0.35 * scale, 1.7 * scale, 5), material(0x2d895b), 0, 1.8 * scale, 0, tree);
      leaf.rotation.z = Math.PI / 2.7;
      leaf.rotation.y = (index / 6) * Math.PI * 2;
      leaf.position.x = Math.cos(leaf.rotation.y) * 0.45 * scale;
      leaf.position.z = Math.sin(leaf.rotation.y) * 0.45 * scale;
    }
  } else {
    addMesh(new THREE.IcosahedronGeometry(0.85 * scale, 0), material(kind === "pine" ? 0x2f7650 : 0x3e9560), 0, 1.65 * scale, 0, tree);
    addMesh(new THREE.IcosahedronGeometry(0.62 * scale, 0), material(kind === "pine" ? 0x397f50 : 0x58a966), 0.4 * scale, 1.95 * scale, 0, tree);
  }

  tree.position.set(x, y, z);
  scene.add(tree);
}

function createRock(x, z, color = 0x8b877c, scale = 1) {
  const rock = addMesh(new THREE.DodecahedronGeometry(0.52 * scale, 0), material(color), x, groundHeight(x, z) + 0.8 * scale, z);
  rock.scale.y = 0.75;
  rock.rotation.y = seededNoise(x, z) * Math.PI;
}

function createLantern(x, z) {
  const y = groundHeight(x, z) + 0.62;
  const lantern = new THREE.Group();
  addMesh(new THREE.CylinderGeometry(0.07, 0.1, 1.05, 6), material(0x3b2b27), 0, 0.52, 0, lantern);
  const glow = addMesh(new THREE.BoxGeometry(0.32, 0.42, 0.32), material(0xffbf3d), 0, 1.05, 0, lantern);
  glow.material.emissive = new THREE.Color(0xff8a1d);
  glow.material.emissiveIntensity = 1.2;
  lantern.position.set(x, y, z);
  scene.add(lantern);
}

function createStupa(parent, x, z, scale = 1) {
  const gold = material(0xe8b52d);
  addMesh(new THREE.CylinderGeometry(0.9 * scale, 1.15 * scale, 0.45 * scale, 12), gold, x, 0.42 * scale, z, parent);
  addMesh(new THREE.CylinderGeometry(0.72 * scale, 0.9 * scale, 0.45 * scale, 12), material(0xf7d76b), x, 0.82 * scale, z, parent);
  addMesh(new THREE.SphereGeometry(0.65 * scale, 12, 8), material(0xf0c64f), x, 1.28 * scale, z, parent);
  addMesh(new THREE.ConeGeometry(0.48 * scale, 1.7 * scale, 12), gold, x, 2.3 * scale, z, parent);
  for (let level = 0; level < 3; level += 1) {
    addMesh(
      new THREE.TorusGeometry((0.35 - level * 0.07) * scale, 0.055 * scale, 6, 16),
      material(0xffe59a),
      x,
      (2.86 + level * 0.2) * scale,
      z,
      parent,
    ).rotation.x = Math.PI / 2;
  }
  addMesh(new THREE.ConeGeometry(0.09 * scale, 0.7 * scale, 6), material(0xc93e32), x, 3.55 * scale, z, parent);
}

function createTempleComplex(x, z, scale = 1) {
  const y = groundHeight(x, z) + 0.62;
  const temple = new THREE.Group();
  const ivory = material(0xfff1d2);
  const red = material(0xb93632);
  const gold = material(0xf2c34b);
  const jade = material(0x247c69);

  addMesh(new THREE.BoxGeometry(7.4, 0.42, 5.2), material(0xd9b368), 0, 0.21, 0, temple);
  addMesh(new THREE.BoxGeometry(5.3, 0.35, 3.6), material(0xf4d681), -0.7, 0.55, 0, temple);
  addMesh(new THREE.BoxGeometry(4.7, 1.65, 3), ivory, -0.7, 1.55, -0.1, temple);

  [-2.55, -1.55, 0.15, 1.15].forEach((columnX) => {
    [-1.42, 1.22].forEach((columnZ) => {
      addMesh(new THREE.CylinderGeometry(0.12, 0.16, 2.05, 8), red, columnX, 1.55, columnZ, temple);
      addMesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 8), gold, columnX, 2.55, columnZ, temple);
    });
  });

  const roofLower = addMesh(new THREE.ConeGeometry(3.65, 1.2, 4), red, -0.7, 2.92, -0.1, temple);
  roofLower.rotation.y = Math.PI / 4;
  roofLower.scale.z = 0.76;
  const roofUpper = addMesh(new THREE.ConeGeometry(2.75, 0.95, 4), gold, -0.7, 3.42, -0.1, temple);
  roofUpper.rotation.y = Math.PI / 4;
  roofUpper.scale.z = 0.72;

  [-3.25, 1.85].forEach((finialX) => {
    [-1.42, 1.22].forEach((finialZ) => {
      const finial = addMesh(new THREE.ConeGeometry(0.12, 0.95, 6), gold, finialX, 3.4, finialZ, temple);
      finial.rotation.z = finialX < 0 ? -0.42 : 0.42;
    });
  });

  for (let step = 0; step < 3; step += 1) {
    addMesh(
      new THREE.BoxGeometry(2.15 - step * 0.28, 0.18, 0.55),
      material(0xe2c58e),
      -0.7,
      0.1 + step * 0.18,
      2.75 - step * 0.38,
      temple,
    );
  }

  addMesh(new THREE.BoxGeometry(0.9, 1.35, 0.12), jade, -0.7, 1.2, 1.46, temple);
  createStupa(temple, 2.45, -0.7, 0.82);
  createStupa(temple, 2.6, 1.35, 0.42);

  temple.position.set(x, y, z);
  temple.scale.setScalar(scale);
  scene.add(temple);
}

function createPier() {
  const pier = new THREE.Group();
  const wood = material(0x95613b);
  const darkWood = material(0x60402f);
  const gold = material(0xf3c34d);
  const length = 11.5;
  const angle = Math.atan2(2.75, 11.5);

  for (let index = 0; index < 11; index += 1) {
    const x = 15 + index * 1.02;
    const z = 7 + index * 0.245;
    const deck = addMesh(new THREE.BoxGeometry(1.08, 0.28, 2.25), wood, x, 0.48, z, pier);
    deck.rotation.y = -angle;
    [-0.88, 0.88].forEach((side) => {
      addMesh(new THREE.CylinderGeometry(0.09, 0.12, 1.2, 6), darkWood, x, -0.02, z + side, pier);
    });
    if (index % 3 === 0) {
      const lamp = addMesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), gold, x, 1.45, z - 0.88, pier);
      lamp.material.emissive = new THREE.Color(0xf08b22);
      lamp.material.emissiveIntensity = 1.1;
      addMesh(new THREE.CylinderGeometry(0.045, 0.06, 0.9, 6), darkWood, x, 0.9, z - 0.88, pier);
    }
  }

  const pavilion = new THREE.Group();
  addMesh(new THREE.BoxGeometry(3.1, 0.3, 3), wood, 0, 0.12, 0, pavilion);
  [-1.1, 1.1].forEach((postX) => {
    [-1.05, 1.05].forEach((postZ) => addMesh(new THREE.CylinderGeometry(0.09, 0.12, 2.2, 6), gold, postX, 1.2, postZ, pavilion));
  });
  const pavilionRoof = addMesh(new THREE.ConeGeometry(2.25, 1.2, 4), material(0xc84234), 0, 2.45, 0, pavilion);
  pavilionRoof.rotation.y = Math.PI / 4;
  pavilionRoof.scale.z = 0.8;
  pavilion.position.set(25, 0.55, 9.4);
  pier.add(pavilion);
  scene.add(pier);
}

function addEnvironmentDetails() {
  for (let index = 0; index < 52; index += 1) {
    const angle = seededNoise(index, 1) * Math.PI * 2;
    const radius = 7 + seededNoise(index, 2) * 15;
    const x = Math.cos(angle) * radius * 1.08;
    const z = Math.sin(angle) * radius * 0.9;
    if (!isOnIsland(x, z) || Math.abs(x + 11) < 2.4) continue;
    const biome = biomeAt(x, z);
    if (biome === "coast") createTree(x, z, "palm", 0.8 + seededNoise(index, 3) * 0.45);
    else if (biome === "north") createTree(x, z, "pine", 0.8 + seededNoise(index, 3) * 0.55);
    else createTree(x, z, "round", 0.75 + seededNoise(index, 3) * 0.45);
  }

  for (let index = 0; index < 24; index += 1) {
    const x = -20 + seededNoise(index, 8) * 40;
    const z = -18 + seededNoise(index, 9) * 36;
    if (isOnIsland(x, z)) createRock(x, z, biomeAt(x, z) === "coast" ? 0xa79978 : 0x7a8275, 0.55 + seededNoise(index, 10));
  }

  [
    [-4, 1], [-7, 0], [-12, -7], [-10, -11],
    [3, 3], [7, 4], [11, 5], [2, 8],
    [5, 11], [8, 14], [12, 15],
  ].forEach(([x, z]) => createLantern(x, z));

  createTempleComplex(-2, -17, 0.92);
  createTempleComplex(0, 15, 0.82);
  createPier();

  const trailArch = new THREE.Group();
  addMesh(new THREE.BoxGeometry(0.42, 3.1, 0.42), material(0xf0b933), -1.35, 1.55, 0, trailArch);
  addMesh(new THREE.BoxGeometry(0.42, 3.1, 0.42), material(0xf0b933), 1.35, 1.55, 0, trailArch);
  const lowerRoof = addMesh(new THREE.BoxGeometry(3.7, 0.34, 0.75), material(0xc83f32), 0, 2.75, 0, trailArch);
  lowerRoof.rotation.z = -0.03;
  addMesh(new THREE.BoxGeometry(2.7, 0.25, 0.9), material(0xf0b933), 0, 3.08, 0, trailArch);
  addMesh(new THREE.ConeGeometry(0.24, 0.8, 6), material(0xf5d368), -1.35, 3.33, 0, trailArch);
  addMesh(new THREE.ConeGeometry(0.24, 0.8, 6), material(0xf5d368), 1.35, 3.33, 0, trailArch);
  trailArch.position.set(-3, groundHeight(-3, -7) + 0.6, -7);
  scene.add(trailArch);
}

function createPlayer() {
  const group = new THREE.Group();
  group.userData.limbs = [];

  const skin = material(0xe6a36f);
  const shirt = material(0xf3d044);
  const shorts = material(0x315f83);
  const hair = material(0x35231e);
  const shoe = material(0xf4ede2);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.58, 20),
    new THREE.MeshBasicMaterial({ color: 0x263b34, transparent: true, opacity: 0.24, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.58;
  group.add(shadow);

  addMesh(new THREE.BoxGeometry(0.82, 1.05, 0.48), shirt, 0, 0.6, 0, group);
  addMesh(new THREE.SphereGeometry(0.46, 8, 6), skin, 0, 1.48, 0, group);
  const hairCap = addMesh(new THREE.SphereGeometry(0.48, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 1.62, 0, group);
  hairCap.scale.y = 0.72;

  const createLimb = (x, y, limbMaterial, isLeg = false) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const limb = addMesh(
      new THREE.BoxGeometry(isLeg ? 0.28 : 0.22, isLeg ? 0.72 : 0.64, isLeg ? 0.3 : 0.22),
      limbMaterial,
      0,
      isLeg ? -0.34 : -0.28,
      0,
      pivot,
    );
    if (isLeg) addMesh(new THREE.BoxGeometry(0.32, 0.2, 0.48), shoe, 0, -0.73, 0.08, pivot);
    group.add(pivot);
    group.userData.limbs.push(pivot);
    return limb;
  };

  createLimb(-0.28, 0.1, shorts, true);
  createLimb(0.28, 0.1, shorts, true);
  createLimb(-0.55, 0.95, skin);
  createLimb(0.55, 0.95, skin);

  const scarf = addMesh(new THREE.BoxGeometry(0.7, 0.17, 0.58), material(0xe84e45), 0, 1.08, 0, group);
  scarf.rotation.z = 0.05;
  group.scale.setScalar(0.95);
  return group;
}

function addEyes(parent, y, z, spacing = 0.16, scale = 1) {
  const eyeWhite = material(0xfff9eb, 0.48);
  const pupil = material(0x35282a, 0.48);
  [-spacing, spacing].forEach((x) => {
    addMesh(new THREE.SphereGeometry(0.065 * scale, 8, 6), eyeWhite, x, y, z, parent);
    addMesh(new THREE.SphereGeometry(0.026 * scale, 8, 6), pupil, x, y, z + 0.05 * scale, parent);
  });
}

function addCrown(parent, y, color = 0xf3c43f, scale = 1) {
  addMesh(new THREE.TorusGeometry(0.34 * scale, 0.07 * scale, 6, 14), material(color), 0, y, 0, parent).rotation.x = Math.PI / 2;
  for (let index = -2; index <= 2; index += 1) {
    addMesh(
      new THREE.ConeGeometry(0.09 * scale, (0.42 + (2 - Math.abs(index)) * 0.08) * scale, 6),
      material(index === 0 ? 0xef5a47 : color),
      index * 0.14 * scale,
      y + 0.24 * scale,
      0,
      parent,
    );
  }
}

function createHumanoid(options = {}) {
  const group = new THREE.Group();
  const skin = material(options.skin || 0xd99868);
  const outfit = material(options.outfit || 0x3f8f78);
  const trim = material(options.trim || 0xf1c94b);
  const hair = material(options.hair || 0x2c2024);
  const robe = options.robe !== false;

  addMesh(new THREE.CylinderGeometry(0.3, 0.34, 0.65, 8), outfit, 0, 0.76, 0, group);
  if (robe) addMesh(new THREE.ConeGeometry(0.5, 0.82, 8), outfit, 0, 0.35, 0, group);
  addMesh(new THREE.TorusGeometry(0.31, 0.055, 6, 14), trim, 0, 0.96, 0, group).rotation.x = Math.PI / 2;
  addMesh(new THREE.SphereGeometry(0.38, 10, 8), skin, 0, 1.42, 0, group);
  addEyes(group, 1.48, 0.34);

  if (!options.bald) {
    const hairCap = addMesh(new THREE.SphereGeometry(0.4, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 1.58, 0, group);
    hairCap.scale.y = options.longHair ? 1.2 : 0.78;
    if (options.longHair) addMesh(new THREE.SphereGeometry(0.34, 9, 7), hair, 0, 1.2, -0.18, group);
  }

  [-0.43, 0.43].forEach((x) => {
    const arm = addMesh(new THREE.CylinderGeometry(0.075, 0.09, 0.72, 7), skin, x, 0.85, 0, group);
    arm.rotation.z = x < 0 ? -0.35 : 0.35;
  });
  [-0.19, 0.19].forEach((x) => addMesh(new THREE.CylinderGeometry(0.1, 0.11, 0.48, 7), material(0x6f4633), x, -0.12, 0, group));

  if (options.crown) addCrown(group, 1.78, options.crownColor || 0xf3c43f);
  return group;
}

function addTrident(parent, x = 0.62) {
  addMesh(new THREE.CylinderGeometry(0.035, 0.045, 2, 6), material(0xd5a72c), x, 0.85, 0, parent);
  [-0.14, 0, 0.14].forEach((offset) => {
    addMesh(new THREE.ConeGeometry(0.07, 0.35, 6), material(0xf0ca50), x + offset, 1.92 - Math.abs(offset), 0, parent);
  });
}

function addWings(parent, color = 0xf2c64d) {
  [-1, 1].forEach((side) => {
    const wing = addMesh(new THREE.ConeGeometry(0.42, 1.45, 7), material(color), side * 0.53, 0.85, -0.23, parent);
    wing.rotation.z = side * 0.7;
    wing.rotation.x = -0.25;
    for (let index = 0; index < 3; index += 1) {
      const feather = addMesh(new THREE.ConeGeometry(0.15, 0.75, 6), material(index % 2 ? 0x38a58a : 0xf7d769), side * (0.62 + index * 0.11), 0.45 - index * 0.1, -0.28, parent);
      feather.rotation.z = side * (0.65 + index * 0.08);
    }
  });
}

function createMacchanuModel() {
  const group = createHumanoid({ skin: 0xe2b08a, outfit: 0x2b9f8d, trim: 0xf1c447, crown: true, hair: 0xf4e7cf });
  [-1, 1].forEach((side) => addMesh(new THREE.SphereGeometry(0.14, 8, 6), material(0xe2b08a), side * 0.4, 1.48, 0, group));
  const tail = addMesh(new THREE.ConeGeometry(0.32, 1.35, 8), material(0x39a9a6), 0, -0.45, -0.05, group);
  tail.rotation.x = Math.PI;
  const fin = addMesh(new THREE.ConeGeometry(0.28, 0.62, 6), material(0xf08a78), 0, -1.05, -0.05, group);
  fin.scale.x = 1.7;
  addTrident(group);
  return group;
}

function createChalawanModel() {
  const group = new THREE.Group();
  const green = material(0x397e57);
  const belly = material(0xd7b95f);
  const body = addMesh(new THREE.CylinderGeometry(0.55, 0.72, 2.2, 8), green, 0, 0.65, 0, group);
  body.rotation.x = Math.PI / 2;
  const head = addMesh(new THREE.BoxGeometry(0.95, 0.62, 1.15), green, 0, 0.85, 1.05, group);
  head.scale.x = 1.05;
  addMesh(new THREE.BoxGeometry(0.78, 0.22, 0.7), belly, 0, 0.67, 1.62, group);
  addEyes(group, 1.12, 1.46, 0.25, 1.1);
  const tail = addMesh(new THREE.ConeGeometry(0.5, 2.1, 8), green, 0, 0.62, -1.55, group);
  tail.rotation.x = -Math.PI / 2;
  [-0.52, 0.52].forEach((x) => {
    [-0.15, 0.9].forEach((z) => addMesh(new THREE.BoxGeometry(0.42, 0.22, 0.65), green, x, 0.35, z, group));
  });
  addCrown(group, 1.42, 0xe7b83f, 0.8);
  return group;
}

function createPhraAphaiModel() {
  const group = createHumanoid({ outfit: 0x4a84b5, trim: 0xf2c34b, crown: true, crownColor: 0xe9bb36 });
  const flute = addMesh(new THREE.CylinderGeometry(0.045, 0.045, 1.18, 8), material(0xd7a42e), 0, 0.98, 0.46, group);
  flute.rotation.z = Math.PI / 2;
  return group;
}

function createSeaOgreModel() {
  const group = createHumanoid({ skin: 0x77b693, outfit: 0x5154a1, trim: 0xf0c54a, crown: true, longHair: true, hair: 0x212039 });
  addMesh(new THREE.ConeGeometry(0.07, 0.26, 6), material(0xf8f2dd), -0.16, 1.22, 0.34, group).rotation.x = Math.PI;
  addMesh(new THREE.ConeGeometry(0.07, 0.26, 6), material(0xf8f2dd), 0.16, 1.22, 0.34, group).rotation.x = Math.PI;
  [-1, 1].forEach((side) => {
    const shell = addMesh(new THREE.SphereGeometry(0.18, 8, 6), material(0xf48a8a), side * 0.58, 0.75, 0, group);
    shell.scale.set(1, 1.3, 0.45);
  });
  return group;
}

function createPhraLoModel() {
  const group = createHumanoid({ outfit: 0xb84b45, trim: 0xf2c44a, crown: true });
  for (let index = -2; index <= 2; index += 1) {
    const feather = addMesh(new THREE.ConeGeometry(0.15, 0.8, 7), material(index % 2 ? 0x2f8c78 : 0x378ab2), index * 0.18, 1.1 + Math.abs(index) * 0.03, -0.38, group);
    feather.rotation.z = index * -0.16;
  }
  return group;
}

function createTwinsModel() {
  const group = new THREE.Group();
  const first = createHumanoid({ outfit: 0xe67f9a, trim: 0xf6d15b, crown: true, longHair: true });
  const second = createHumanoid({ outfit: 0x7a78bd, trim: 0xf6d15b, crown: true, longHair: true });
  first.position.x = -0.52;
  second.position.x = 0.52;
  first.scale.setScalar(0.82);
  second.scale.setScalar(0.82);
  group.add(first, second);
  return group;
}

function createManoraModel() {
  const group = createHumanoid({ outfit: 0xf0b73f, trim: 0x2b9b80, crown: true, longHair: true });
  addWings(group);
  const tail = addMesh(new THREE.ConeGeometry(0.3, 1.3, 8), material(0x38a58a), 0, -0.4, -0.16, group);
  tail.rotation.x = Math.PI;
  return group;
}

function createSuthonModel() {
  const group = createHumanoid({ outfit: 0x3f7a9e, trim: 0xe6b83d, crown: true });
  const bow = addMesh(new THREE.TorusGeometry(0.48, 0.045, 6, 18, Math.PI), material(0x85522f), 0.62, 0.75, 0, group);
  bow.rotation.z = Math.PI / 2;
  return group;
}

function createLuangPuThuadModel() {
  const group = createHumanoid({ outfit: 0xd9822b, trim: 0xf1c35a, bald: true });
  addMesh(new THREE.SphereGeometry(0.4, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), material(0xd99868), 0, 1.57, 0, group).scale.y = 0.72;
  const beads = material(0x6b3d27);
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 1.25 - 0.35;
    addMesh(new THREE.SphereGeometry(0.045, 6, 5), beads, Math.cos(angle) * 0.34, 0.95 + Math.sin(angle) * 0.24, 0.3, group);
  }
  return group;
}

function createCharacterModel(creature) {
  const factories = {
    macchanu: createMacchanuModel,
    chalawan: createChalawanModel,
    "phra-aphai-mani": createPhraAphaiModel,
    "nang-phisua-samut": createSeaOgreModel,
    "phra-lo": createPhraLoModel,
    "phra-phuean-phaeng": createTwinsModel,
    manora: createManoraModel,
    suthon: createSuthonModel,
    "luang-pu-thuad": createLuangPuThuadModel,
  };
  return (factories[creature.id] || createHumanoid)();
}

function addCreatureModels() {
  state.creatures.forEach((creature) => {
    const [x, z] = creatureSpots[creature.id] || [0, 0];
    const model = createCharacterModel(creature);
    const baseY = creature.id === "nang-phisua-samut" ? 0.35 : groundHeight(x, z) + 0.65;
    const baseScale = creature.id === "nang-phisua-samut" ? 1.65 : creature.id === "chalawan" ? 1.25 : 1.1;
    model.position.set(x, baseY, z);
    model.scale.setScalar(baseScale);
    model.userData.creature = creature;
    model.userData.baseY = baseY;
    model.userData.baseScale = baseScale;
    scene.add(model);
    state.sprites.push(model);

    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.8 * baseScale, 1.02 * baseScale, 28),
      new THREE.MeshBasicMaterial({
        color: 0xf8c84a,
        transparent: true,
        opacity: 0.84,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(x, creature.id === "nang-phisua-samut" ? 0.14 : groundHeight(x, z) + 0.62, z);
    scene.add(marker);

    if (creature.id === "nang-phisua-samut") {
      [1.45, 2.15, 2.85].forEach((radius, index) => {
        const ripple = new THREE.Mesh(
          new THREE.RingGeometry(radius, radius + 0.08, 36),
          new THREE.MeshBasicMaterial({
            color: index % 2 ? 0xd7fbff : 0x5bc4d1,
            transparent: true,
            opacity: 0.72 - index * 0.14,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        ripple.rotation.x = -Math.PI / 2;
        ripple.position.set(x, 0.13 + index * 0.015, z);
        scene.add(ripple);
      });
    }
  });
}

function setCameraSize() {
  const aspect = window.innerWidth / window.innerHeight;
  const viewHeight = aspect < 0.8 ? 22 : aspect < 1.35 ? 18 : 16;
  camera.left = (-viewHeight * aspect) / 2;
  camera.right = (viewHeight * aspect) / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
}

function movementVector() {
  const up = state.keys.has("w") || state.keys.has("arrowup") || state.touch.has("up");
  const down = state.keys.has("s") || state.keys.has("arrowdown") || state.touch.has("down");
  const left = state.keys.has("a") || state.keys.has("arrowleft") || state.touch.has("left");
  const right = state.keys.has("d") || state.keys.has("arrowright") || state.touch.has("right");

  const forwardAmount = Number(up) - Number(down);
  const rightAmount = Number(right) - Number(left);
  const forward = new THREE.Vector3(-1, 0, -1).normalize();
  const rightVector = new THREE.Vector3(1, 0, -1).normalize();
  return forward.multiplyScalar(forwardAmount).add(rightVector.multiplyScalar(rightAmount)).normalize();
}

function updatePlayer(delta, elapsed) {
  if (ui.dialog.open) return;
  const direction = movementVector();
  const moving = direction.lengthSq() > 0;

  if (moving) {
    const nextX = player.position.x + direction.x * MOVE_SPEED * delta;
    const nextZ = player.position.z + direction.z * MOVE_SPEED * delta;
    if (isWalkable(nextX, nextZ)) {
      player.position.x = nextX;
      player.position.z = nextZ;
    }
    player.rotation.y = Math.atan2(direction.x, direction.z);
  }

  const groundedY = groundHeight(player.position.x, player.position.z) + 0.65;
  const bob = moving ? Math.abs(Math.sin(elapsed * 10)) * 0.08 : 0;
  player.position.y = THREE.MathUtils.lerp(player.position.y, groundedY + bob, Math.min(1, delta * 12));

  player.userData.limbs.forEach((limb, index) => {
    const directionSign = index % 2 === 0 ? 1 : -1;
    limb.rotation.x = moving ? Math.sin(elapsed * 10) * 0.55 * directionSign : THREE.MathUtils.lerp(limb.rotation.x, 0, delta * 8);
  });
  ui.world.dataset.playerX = player.position.x.toFixed(2);
  ui.world.dataset.playerZ = player.position.z.toFixed(2);
}

function updateCamera(delta) {
  const target = new THREE.Vector3(player.position.x, player.position.y + 0.4, player.position.z);
  const desired = target.clone().add(new THREE.Vector3(17, 22, 17));
  camera.position.lerp(desired, 1 - Math.pow(0.001, delta));
  camera.lookAt(target);
}

function updateCreatures(elapsed) {
  state.sprites.forEach((model, index) => {
    model.position.y = model.userData.baseY + Math.sin(elapsed * 1.8 + index) * 0.06;
    const distance = model.position.distanceTo(player.position);
    const scalePulse = distance < MEET_DISTANCE ? 1 + Math.sin(elapsed * 5) * 0.025 : 1;
    const scale = model.userData.baseScale * scalePulse;
    model.scale.setScalar(scale);
    model.rotation.y = Math.atan2(player.position.x - model.position.x, player.position.z - model.position.z);
  });
}

function findNearbyCreature() {
  let nearest = null;
  let nearestDistance = Infinity;
  state.sprites.forEach((sprite) => {
    const dx = sprite.position.x - player.position.x;
    const dz = sprite.position.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = sprite.userData.creature;
    }
  });

  state.nearby = nearestDistance < MEET_DISTANCE ? nearest : null;
  ui.meet.hidden = !state.nearby;
  if (state.nearby) {
    ui.nearbyName.textContent = state.nearby.name_en;
    ui.quest.textContent = `${state.nearby.name_en} is nearby. Go say hello!`;
    if (state.lastAutoMeet !== state.nearby.id && nearestDistance < 2.5) {
      state.lastAutoMeet = state.nearby.id;
      openLegend(state.nearby);
    }
  } else {
    state.lastAutoMeet = null;
    ui.quest.textContent = state.found.size === state.creatures.length
      ? "Field guide complete. Thailand's legends remember you!"
      : "Follow the lanterns and meet a local legend.";
  }
}

function updateRegion() {
  let nearest = regionCenters[0];
  let distance = Infinity;
  regionCenters.forEach((region) => {
    const regionDistance = Math.hypot(player.position.x - region.x, player.position.z - region.z);
    if (regionDistance < distance) {
      nearest = region;
      distance = regionDistance;
    }
  });
  if (nearest.name !== state.activeRegion) {
    state.activeRegion = nearest.name;
    ui.region.textContent = nearest.name;
    ui.regionKicker.textContent = "Now exploring";
    ui.region.parentElement.animate(
      [{ transform: "translateX(-50%) translateY(-8px)", opacity: 0 }, { transform: "translateX(-50%) translateY(0)", opacity: 1 }],
      { duration: 420, easing: "ease-out" },
    );
  }
}

function openLegend(creature) {
  if (!creature) return;
  state.found.add(creature.id);
  ui.found.textContent = state.found.size;

  const stats = [
    ["Charm", creature.stat_charm],
    ["Mystic", creature.stat_mystic],
    ["Courage", creature.stat_courage],
    ["Chaos", creature.stat_chaos],
  ];
  const powers = [creature.power_1, creature.power_2, creature.power_3].filter(Boolean);

  ui.dialogContent.innerHTML = `
    <section class="legend-hero">
      <div class="legend-image-wrap">
        <img class="legend-image" src="${creature.image}" alt="${creature.name_en}">
      </div>
      <div>
        <span class="legend-number">MY-${creature.number} · New encounter</span>
        <h2>${creature.name_en}</h2>
        <p class="legend-thai">${creature.name_th}</p>
        <div class="legend-tags">
          <span>${creature.type}</span>
          <span>${creature.element}</span>
          <span>${creature.region}</span>
        </div>
      </div>
    </section>
    <section class="legend-body">
      <div>
        <h3>Origin story</h3>
        <p class="legend-story">${creature.origin_story}</p>
        <div class="legend-facts">
          <div class="legend-fact"><span>Home turf</span><strong>${creature.locality}</strong></div>
          <div class="legend-fact"><span>Lore age</span><strong>${creature.lore_age}</strong></div>
          <div class="legend-fact"><span>Estimated height</span><strong>${creature.height_estimate}</strong></div>
          <div class="legend-fact"><span>Estimated weight</span><strong>${creature.weight_estimate}</strong></div>
        </div>
      </div>
      <div>
        <h3>Folklore stats</h3>
        <div class="legend-stats">
          ${stats.map(([label, value]) => `
            <div class="legend-stat">
              <span>${label}</span>
              <span class="legend-track"><span class="legend-fill" style="width: ${value}%"></span></span>
              <strong>${value}</strong>
            </div>
          `).join("")}
        </div>
        <ul class="power-list">
          ${powers.map((power) => `<li>✦ ${power}</li>`).join("")}
        </ul>
      </div>
    </section>
  `;

  if (!ui.dialog.open) ui.dialog.showModal();
}

function resetPlayer() {
  player.position.set(-5, groundHeight(-5, 1) + 0.65, 1);
  state.keys.clear();
  state.touch.clear();
}

function midiToFrequency(note) {
  return 440 * (2 ** ((note - 69) / 12));
}

function schedulePluck(frequency, when, duration = 0.24, volume = 0.08) {
  const oscillator = soundtrack.context.createOscillator();
  const filter = soundtrack.context.createBiquadFilter();
  const gain = soundtrack.context.createGain();

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency * 1.018, when);
  oscillator.frequency.exponentialRampToValueAtTime(frequency, when + 0.035);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(2200, when);
  filter.frequency.exponentialRampToValueAtTime(780, when + duration);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(volume, when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(soundtrack.master);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.03);
}

function scheduleBass(frequency, when, duration = 0.45) {
  const oscillator = soundtrack.context.createOscillator();
  const gain = soundtrack.context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.055, when + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  oscillator.connect(gain);
  gain.connect(soundtrack.master);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.03);
}

function scheduleGong(when) {
  const oscillator = soundtrack.context.createOscillator();
  const overtone = soundtrack.context.createOscillator();
  const gain = soundtrack.context.createGain();
  oscillator.type = "sine";
  overtone.type = "triangle";
  oscillator.frequency.setValueAtTime(196, when);
  oscillator.frequency.exponentialRampToValueAtTime(174, when + 0.8);
  overtone.frequency.setValueAtTime(392, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.07, when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
  oscillator.connect(gain);
  overtone.connect(gain);
  gain.connect(soundtrack.master);
  oscillator.start(when);
  overtone.start(when);
  oscillator.stop(when + 0.95);
  overtone.stop(when + 0.7);
}

function scheduleSoundtrack() {
  if (!soundtrack.context || soundtrack.context.state === "closed") return;
  const stepDuration = 60 / 112 / 2;
  const melodies = [
    [0, 2, 4, 7, 9, 7, 4, 2, 4, 7, 9, 12, 9, 7, 4, null],
    [7, 9, 12, 14, 12, 9, 7, 4, 2, 4, 7, 9, 7, 4, 2, null],
  ];
  const bassNotes = [48, 48, 43, 43, 45, 45, 40, 43];

  while (soundtrack.nextTime < soundtrack.context.currentTime + 0.22) {
    const pattern = melodies[Math.floor(soundtrack.step / 16) % melodies.length];
    const patternStep = soundtrack.step % 16;
    const offset = pattern[patternStep];

    if (offset !== null) {
      if ([4, 10].includes(patternStep)) {
        schedulePluck(midiToFrequency(72 + offset - 2), soundtrack.nextTime, 0.08, 0.035);
        schedulePluck(midiToFrequency(72 + offset), soundtrack.nextTime + 0.055, 0.2, 0.07);
      } else {
        schedulePluck(midiToFrequency(72 + offset), soundtrack.nextTime, 0.22, 0.068);
      }
    }

    if (patternStep % 2 === 0) {
      scheduleBass(midiToFrequency(bassNotes[(soundtrack.step / 2) % bassNotes.length]), soundtrack.nextTime);
    }
    if (patternStep === 0 || patternStep === 8) {
      scheduleGong(soundtrack.nextTime);
    }

    soundtrack.step += 1;
    soundtrack.nextTime += stepDuration;
  }
}

function setMusicButton(isPlaying) {
  ui.music.classList.toggle("active", isPlaying);
  ui.music.setAttribute("aria-pressed", String(isPlaying));
  ui.music.setAttribute("aria-label", isPlaying ? "Turn music off" : "Turn music on");
  ui.music.title = isPlaying ? "Turn music off" : "Turn music on";
}

async function startMusic() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  soundtrack.context = new AudioContextClass();
  soundtrack.master = soundtrack.context.createGain();
  soundtrack.master.gain.value = 0.58;
  soundtrack.master.connect(soundtrack.context.destination);
  soundtrack.nextTime = soundtrack.context.currentTime + 0.08;
  soundtrack.step = 0;
  await soundtrack.context.resume();
  scheduleSoundtrack();
  soundtrack.timer = window.setInterval(scheduleSoundtrack, 90);
  setMusicButton(true);
}

function stopMusic() {
  if (soundtrack.timer) window.clearInterval(soundtrack.timer);
  soundtrack.timer = null;
  if (soundtrack.context && soundtrack.context.state !== "closed") {
    const contextToClose = soundtrack.context;
    soundtrack.master.gain.cancelScheduledValues(contextToClose.currentTime);
    soundtrack.master.gain.setValueAtTime(Math.max(soundtrack.master.gain.value, 0.0001), contextToClose.currentTime);
    soundtrack.master.gain.exponentialRampToValueAtTime(0.0001, contextToClose.currentTime + 0.12);
    window.setTimeout(() => contextToClose.close(), 160);
  }
  soundtrack.context = null;
  soundtrack.master = null;
  setMusicButton(false);
}

async function toggleMusic() {
  if (soundtrack.context) {
    stopMusic();
  } else {
    await startMusic();
  }
}

function bindControls() {
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "e", "r", "escape"].includes(key)) {
      event.preventDefault();
    }
    state.keys.add(key);
    if (key === "e" && state.nearby) openLegend(state.nearby);
    if (key === "r" && !ui.dialog.open) resetPlayer();
    if (key === "escape" && ui.dialog.open) ui.dialog.close();
  });

  window.addEventListener("keyup", (event) => state.keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => state.keys.clear());
  window.addEventListener("resize", setCameraSize);

  document.querySelectorAll("[data-move]").forEach((button) => {
    const direction = button.dataset.move;
    const start = (event) => {
      event.preventDefault();
      state.touch.add(direction);
      button.setPointerCapture?.(event.pointerId);
    };
    const stop = (event) => {
      event.preventDefault();
      state.touch.delete(direction);
    };
    button.addEventListener("pointerdown", start);
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("lostpointercapture", stop);
  });

  ui.meet.addEventListener("click", () => openLegend(state.nearby));
  ui.reset.addEventListener("click", resetPlayer);
  ui.music.addEventListener("click", toggleMusic);
  ui.closeDialog.addEventListener("click", () => ui.dialog.close());
  ui.dialog.addEventListener("click", (event) => {
    if (event.target === ui.dialog) ui.dialog.close();
  });
  window.addEventListener("pagehide", stopMusic);
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  updatePlayer(delta, elapsed);
  updateCamera(delta);
  updateCreatures(elapsed);
  findNearbyCreature();
  updateRegion();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

async function start() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Could not load ${DATA_URL}`);
    state.creatures = parseCsv(await response.text());
    ui.total.textContent = state.creatures.length;
    buildWorld();
    bindControls();
    setCameraSize();
    addCreatureModels();
    state.started = true;
    ui.loading.classList.add("done");
    animate();
  } catch (error) {
    ui.loading.classList.add("done");
    ui.error.hidden = false;
    ui.error.textContent = `The folklore world could not start: ${error.message}`;
    console.error(error);
  }
}

start();
