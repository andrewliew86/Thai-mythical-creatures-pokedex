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
  "nang-phisua-samut": [17, 8],
  "phra-lo": [-7, -14],
  "phra-phuean-phaeng": [-13, -12],
  manora: [5, 15],
  suthon: [10, 17],
  "luang-pu-thuad": [15, 13],
};

const regionCenters = [
  { name: "Central Thailand", x: -10, z: 1, radius: 9 },
  { name: "Eastern / Gulf Coast", x: 14, z: 5, radius: 9 },
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

function createShrine(x, z) {
  const y = groundHeight(x, z) + 0.62;
  const shrine = new THREE.Group();
  addMesh(new THREE.BoxGeometry(2.6, 0.35, 2.3), material(0xf3c655), 0, 0.18, 0, shrine);
  addMesh(new THREE.BoxGeometry(1.65, 1.4, 1.4), material(0xf7eee0), 0, 1.05, 0, shrine);
  const roof = addMesh(new THREE.ConeGeometry(1.55, 1.1, 4), material(0xc84035), 0, 2.05, 0, shrine);
  roof.rotation.y = Math.PI / 4;
  addMesh(new THREE.CylinderGeometry(0.22, 0.28, 0.75, 8), material(0xf0b933), 0, 2.85, 0, shrine);
  shrine.position.set(x, y, z);
  scene.add(shrine);
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

  createShrine(-9, -17);
  createShrine(13, 15);

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

async function addCreatureSprites() {
  const textureLoader = new THREE.TextureLoader();

  await Promise.all(
    state.creatures.map(
      (creature) =>
        new Promise((resolve) => {
          const [x, z] = creatureSpots[creature.id] || [0, 0];
          textureLoader.load(
            creature.image,
            (texture) => {
              texture.colorSpace = THREE.SRGBColorSpace;
              const imageRatio = texture.image.width / texture.image.height;
              const spriteMaterial = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                alphaTest: 0.08,
                depthWrite: false,
              });
              const sprite = new THREE.Sprite(spriteMaterial);
              const height = creature.id === "nang-phisua-samut" ? 5.8 : 4.1;
              sprite.scale.set(height * imageRatio, height, 1);
              sprite.position.set(x, groundHeight(x, z) + height / 2 + 0.65, z);
              sprite.userData.creature = creature;
              sprite.userData.baseY = sprite.position.y;
              scene.add(sprite);
              state.sprites.push(sprite);

              const markerMaterial = new THREE.MeshBasicMaterial({
                color: 0xf8c84a,
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide,
                depthWrite: false,
              });
              const marker = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.94, 24), markerMaterial);
              marker.rotation.x = -Math.PI / 2;
              marker.position.set(x, groundHeight(x, z) + 0.65, z);
              marker.userData.forCreature = creature.id;
              scene.add(marker);
              resolve();
            },
            undefined,
            resolve,
          );
        }),
    ),
  );
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
    if (isOnIsland(nextX, nextZ)) {
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
}

function updateCamera(delta) {
  const target = new THREE.Vector3(player.position.x, player.position.y + 0.4, player.position.z);
  const desired = target.clone().add(new THREE.Vector3(17, 22, 17));
  camera.position.lerp(desired, 1 - Math.pow(0.001, delta));
  camera.lookAt(target);
}

function updateCreatures(elapsed) {
  state.sprites.forEach((sprite, index) => {
    sprite.position.y = sprite.userData.baseY + Math.sin(elapsed * 1.8 + index) * 0.12;
    const distance = sprite.position.distanceTo(player.position);
    const scalePulse = distance < MEET_DISTANCE ? 1 + Math.sin(elapsed * 5) * 0.025 : 1;
    sprite.material.opacity = distance < 16 ? 1 : 0.78;
    sprite.scale.multiplyScalar(scalePulse / (sprite.userData.lastPulse || 1));
    sprite.userData.lastPulse = scalePulse;
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
  ui.closeDialog.addEventListener("click", () => ui.dialog.close());
  ui.dialog.addEventListener("click", (event) => {
    if (event.target === ui.dialog) ui.dialog.close();
  });
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
    await addCreatureSprites();
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
