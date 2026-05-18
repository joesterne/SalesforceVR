import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { VRButton } from "three/addons/webxr/VRButton.js";

const defaultSchema = {
  objects: [
    { name: "Account", fields: [{ name: "OwnerId", type: "Lookup", referenceTo: "User" }, { name: "PrimaryContactId", type: "Lookup", referenceTo: "Contact" }] },
    { name: "Opportunity", fields: [{ name: "AccountId", type: "Lookup", referenceTo: "Account" }, { name: "Primary_Quote__c", type: "Lookup", referenceTo: "Quote" }] },
    { name: "Contact", fields: [{ name: "AccountId", type: "Lookup", referenceTo: "Account" }, { name: "ReportsToId", type: "Lookup", referenceTo: "Contact" }] },
    { name: "Case", fields: [{ name: "AccountId", type: "Lookup", referenceTo: "Account" }, { name: "ContactId", type: "Lookup", referenceTo: "Contact" }] },
    { name: "User", fields: [{ name: "ManagerId", type: "Lookup", referenceTo: "User" }] },
    { name: "Quote", fields: [{ name: "OpportunityId", type: "Lookup", referenceTo: "Opportunity" }] }
  ]
};

const canvasRoot = document.getElementById("canvas-root");
const schemaInput = document.getElementById("schema-input");
const rebuildButton = document.getElementById("rebuild");
const vrButtonEl = document.getElementById("enter-vr");
const fitRoomBtn = document.getElementById("fit-room");
const roomStatus = document.getElementById("room-status");
const toggleTranslucency = document.getElementById("toggle-translucency");
const toggleMenus = document.getElementById("toggle-menus");
const nodeColorInput = document.getElementById("node-color");
const linkColorInput = document.getElementById("link-color");
const applyColorsBtn = document.getElementById("apply-colors");
const startMinigameBtn = document.getElementById("start-minigame");
const stopMinigameBtn = document.getElementById("stop-minigame");
const minigameStatus = document.getElementById("minigame-status");

schemaInput.value = JSON.stringify(defaultSchema, null, 2);

const SF_TOKEN_KEY = "sfvr_token";
const SF_STATE_KEY = "sfvr_oauth_state";
const SF_VERIFIER_KEY = "sfvr_pkce_verifier";

const loginUrlInput = document.getElementById("login-url");
const clientIdInput = document.getElementById("client-id");
const apiVersionInput = document.getElementById("api-version");
const objectLimitInput = document.getElementById("object-limit");
const connectSfBtn = document.getElementById("connect-sf");
const loadSchemaBtn = document.getElementById("load-schema");
const logoutSfBtn = document.getElementById("logout-sf");
const authStatus = document.getElementById("auth-status");
const sfWindow = document.getElementById("sf-window");
const sfWindowHeader = document.getElementById("sf-window-header");
const sfWindowContent = document.getElementById("sf-window-content");
const sfSearchInput = document.getElementById("sf-search");
const sfWindowRefreshBtn = document.getElementById("sf-window-refresh");

let currentSchema = defaultSchema;
let roomBounds = null;
let roomScaleFactor = 1;
let nodeBaseColor = nodeColorInput.value;
let linkBaseColor = linkColorInput.value;
let spiders = [];
let spiderCooldown = 0;
let minigameActive = false;
let score = 0;
let lostLinks = 0;
setupMovableWindow();
sfSearchInput.addEventListener("input", () => renderSalesforceBrowser(currentSchema));
sfWindowRefreshBtn.addEventListener("click", () => renderSalesforceBrowser(currentSchema));
renderSalesforceBrowser(defaultSchema);
fitRoomBtn.addEventListener("click", () => applyRoomScale(roomBounds));
applyColorsBtn.addEventListener("click", applyThemeColors);
startMinigameBtn.addEventListener("click", startMinigame);
stopMinigameBtn.addEventListener("click", stopMinigame);

const UI_PREFS_KEY = "sfvr_ui_prefs";
initAccessibilityMenu();




let sfSession = loadSfSession();
setAuthStatus();
hydrateAuthCallback();
connectSfBtn.addEventListener("click", startSalesforceAuth);
loadSchemaBtn.addEventListener("click", loadOrgSchemaFromSalesforce);
logoutSfBtn.addEventListener("click", logoutSalesforce);

function loadSfSession() {
  const raw = sessionStorage.getItem(SF_TOKEN_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveSfSession(session) {
  sfSession = session;
  sessionStorage.setItem(SF_TOKEN_KEY, JSON.stringify(session));
  setAuthStatus();
}

function clearSfSession() {
  sfSession = null;
  sessionStorage.removeItem(SF_TOKEN_KEY);
  setAuthStatus();
}

function setAuthStatus(msg) {
  if (msg) {
    authStatus.textContent = msg;
    return;
  }
  authStatus.textContent = sfSession ? `Connected to ${sfSession.instance_url}` : "Not connected.";
}

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(hash);
}

function randomString(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const array = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(array, (x) => chars[x % chars.length]).join("");
}

async function startSalesforceAuth() {
  const loginUrl = loginUrlInput.value.trim().replace(/\/$/, "");
  const clientId = clientIdInput.value.trim();
  if (!loginUrl || !clientId) {
    setAuthStatus("Login URL and Client ID are required.");
    return;
  }

  const state = randomString(32);
  const verifier = randomString(96);
  const challenge = await sha256(verifier);
  sessionStorage.setItem(SF_STATE_KEY, state);
  sessionStorage.setItem(SF_VERIFIER_KEY, verifier);

  const redirectUri = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "api refresh_token",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  window.location.href = `${loginUrl}/services/oauth2/authorize?${params}`;
}

async function hydrateAuthCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (!code && !error) return;

  if (error) {
    setAuthStatus(`OAuth error: ${error}`);
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  const expected = sessionStorage.getItem(SF_STATE_KEY);
  const verifier = sessionStorage.getItem(SF_VERIFIER_KEY);
  if (!expected || state !== expected || !verifier) {
    setAuthStatus("OAuth state mismatch.");
    return;
  }

  try {
    const loginUrl = loginUrlInput.value.trim().replace(/\/$/, "");
    const redirectUri = window.location.origin + window.location.pathname;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientIdInput.value.trim(),
      redirect_uri: redirectUri,
      code_verifier: verifier
    });

    const tokenResp = await fetch(`${loginUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    if (!tokenResp.ok) throw new Error(`Token exchange failed: ${tokenResp.status}`);
    const tokenData = await tokenResp.json();
    saveSfSession({
      access_token: tokenData.access_token,
      instance_url: tokenData.instance_url,
      refresh_token: tokenData.refresh_token,
      issued_at: tokenData.issued_at,
      id: tokenData.id
    });
    setAuthStatus("Connected. Ready to load schema.");
  } catch (err) {
    setAuthStatus(err.message);
  } finally {
    sessionStorage.removeItem(SF_STATE_KEY);
    sessionStorage.removeItem(SF_VERIFIER_KEY);
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

async function sfRequest(path) {
  if (!sfSession?.access_token || !sfSession?.instance_url) throw new Error("Connect Salesforce first.");
  const resp = await fetch(`${sfSession.instance_url}${path}`, {
    headers: { Authorization: `Bearer ${sfSession.access_token}` }
  });
  if (!resp.ok) {
    if (resp.status === 401) clearSfSession();
    throw new Error(`Salesforce API failed (${resp.status})`);
  }
  return resp.json();
}

async function loadOrgSchemaFromSalesforce() {
  try {
    setAuthStatus("Loading schema from Salesforce...");
    const apiVersion = apiVersionInput.value.trim() || "v62.0";
    const objectLimit = Math.max(1, Math.min(200, Number(objectLimitInput.value) || 30));
    const globalDescribe = await sfRequest(`/services/data/${apiVersion}/sobjects`);
    const objects = (globalDescribe.sobjects || []).filter((s) => s.queryable && s.createable).slice(0, objectLimit);

    const described = [];
    for (const obj of objects) {
      const detail = await sfRequest(`/services/data/${apiVersion}/sobjects/${obj.name}/describe`);
      described.push({
        name: detail.name,
        fields: (detail.fields || [])
          .filter((f) => (f.type === "reference") && Array.isArray(f.referenceTo) && f.referenceTo.length)
          .map((f) => ({ name: f.name, type: f.type, referenceTo: f.referenceTo[0] }))
      });
    }
    const schema = { objects: described };
    schemaInput.value = JSON.stringify(schema, null, 2);
    buildCloud(schema);
    currentSchema = schema;
    renderSalesforceBrowser(currentSchema);
    setAuthStatus(`Loaded ${described.length} objects from org.`);
  } catch (err) {
    setAuthStatus(`Schema load failed: ${err.message}`);
  }
}

function logoutSalesforce() {
  clearSfSession();
  setAuthStatus("Disconnected.");
}


function setupMovableWindow() {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  sfWindowHeader.addEventListener("pointerdown", (event) => {
    dragging = true;
    const rect = sfWindow.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    sfWindowHeader.setPointerCapture(event.pointerId);
  });

  sfWindowHeader.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - sfWindow.offsetWidth, event.clientX - offsetX));
    const y = Math.max(0, Math.min(window.innerHeight - sfWindow.offsetHeight, event.clientY - offsetY));
    sfWindow.style.left = `${x}px`;
    sfWindow.style.top = `${y}px`;
    sfWindow.style.right = "auto";
  });

  sfWindowHeader.addEventListener("pointerup", () => {
    dragging = false;
  });
}

function renderSalesforceBrowser(schema) {
  const term = (sfSearchInput.value || "").trim().toLowerCase();
  const objects = Array.isArray(schema?.objects) ? schema.objects : [];
  const filtered = objects
    .map((obj) => {
      const fields = Array.isArray(obj.fields) ? obj.fields : [];
      const matchingFields = fields.filter((f) => {
        const ref = f.referenceTo || "";
        return `${f.name} ${f.type} ${ref}`.toLowerCase().includes(term);
      });
      const objectMatches = (obj.name || "").toLowerCase().includes(term);
      if (!term || objectMatches || matchingFields.length) {
        return { ...obj, fields: objectMatches || !term ? fields : matchingFields };
      }
      return null;
    })
    .filter(Boolean);

  if (!filtered.length) {
    sfWindowContent.innerHTML = '<p class="hint">No matching Salesforce objects.</p>';
    return;
  }

  sfWindowContent.innerHTML = filtered.map((obj) => {
    const fieldsHtml = (obj.fields || []).map((f) => `<li><strong>${f.name}</strong> <span class="hint">(${f.type}${f.referenceTo ? ` → ${f.referenceTo}` : ""})</span></li>`).join("");
    return `<details class="sf-object"><summary>${obj.name} <span class="hint">(${(obj.fields || []).length} fields)</span></summary><ul class="sf-fields">${fieldsHtml || '<li class="hint">No fields</li>'}</ul></details>`;
  }).join("");
}





function applyThemeColors() {
  nodeBaseColor = nodeColorInput.value || "#5aa9ff";
  linkBaseColor = linkColorInput.value || "#5bb8ff";

  let idx = 0;
  const nodeCount = Math.max(objectToNode.size, 1);
  for (const node of objectToNode.values()) {
    if (node.material?.color) {
      node.material.color.set(new THREE.Color(nodeBaseColor).offsetHSL((idx / nodeCount) * 0.15, 0.08, 0.02));
      node.material.needsUpdate = true;
    }
    idx += 1;
  }

  for (const line of links) {
    if (line.material?.color) {
      line.material.color.set(linkBaseColor);
      line.material.needsUpdate = true;
    }
  }
}



function setMinigameStatus(msg) {
  minigameStatus.textContent = msg;
}

function startMinigame() {
  if (minigameActive) return;
  minigameActive = true;
  score = 0;
  lostLinks = 0;
  setMinigameStatus("Spiders incoming! Shoot them before they cut links.");
}

function stopMinigame() {
  minigameActive = false;
  clearSpiders();
  setMinigameStatus("Spiders inactive.");
}

function clearSpiders() {
  for (const s of spiders) {
    scene.remove(s.mesh);
    s.mesh.geometry.dispose();
    s.mesh.material.dispose();
  }
  spiders = [];
}

function spawnSpider() {
  if (!links.length) return;
  const target = links[Math.floor(Math.random() * links.length)];
  const start = new THREE.Vector3((Math.random()-0.5)*8, Math.random()*4+0.5, (Math.random()-0.5)*8);
  const spider = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff5533, emissive: 0x440000 })
  );
  spider.position.copy(start);
  scene.add(spider);
  spiders.push({ mesh: spider, target, speed: 0.006 + Math.random()*0.006 });
}

function removeLink(link) {
  cloud.remove(link);
  link.geometry.dispose();
  link.material.dispose();
  links = links.filter((l) => l !== link);
  lostLinks += 1;
}

function tryShootFromController(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  const hits = raycaster.intersectObjects(spiders.map((s) => s.mesh), false);
  if (hits[0]) {
    const hitMesh = hits[0].object;
    const i = spiders.findIndex((s) => s.mesh === hitMesh);
    if (i >= 0) {
      scene.remove(spiders[i].mesh);
      spiders[i].mesh.geometry.dispose();
      spiders[i].mesh.material.dispose();
      spiders.splice(i, 1);
      score += 1;
    }
  }
}

function updateMinigame() {
  if (!minigameActive) return;
  spiderCooldown -= 1;
  if (spiderCooldown <= 0) {
    spawnSpider();
    spiderCooldown = Math.max(15, 60 - score * 2);
  }

  for (const s of [...spiders]) {
    if (!s.target || !links.includes(s.target)) {
      scene.remove(s.mesh);
      spiders.splice(spiders.indexOf(s), 1);
      continue;
    }
    const a = s.target.userData.from.position.clone();
    const b = s.target.userData.to.position.clone();
    const targetPoint = a.lerp(b, 0.5).applyMatrix4(cloud.matrixWorld);
    const dir = targetPoint.clone().sub(s.mesh.position);
    const dist = dir.length();
    if (dist < 0.12) {
      removeLink(s.target);
      scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
      spiders.splice(spiders.indexOf(s), 1);
      continue;
    }
    s.mesh.position.add(dir.normalize().multiplyScalar(s.speed));
  }

  for (const cs of controllerState) {
    if (cs.selected) continue;
    tryShootFromController(cs.controller);
  }

  if (!links.length) {
    setMinigameStatus(`Game over. Score ${score}. All links were cut.`);
    minigameActive = false;
    clearSpiders();
  } else {
    setMinigameStatus(`Score ${score} | Links lost ${lostLinks} | Spiders ${spiders.length}`);
  }
}

function initAccessibilityMenu() {
  const saved = readUiPrefs();
  toggleTranslucency.checked = saved.translucent;
  toggleMenus.checked = saved.showMenus;
  applyUiPrefs(saved);

  toggleTranslucency.addEventListener("change", () => {
    const next = { translucent: toggleTranslucency.checked, showMenus: toggleMenus.checked };
    applyUiPrefs(next);
    saveUiPrefs(next);
  });

  toggleMenus.addEventListener("change", () => {
    const next = { translucent: toggleTranslucency.checked, showMenus: toggleMenus.checked };
    applyUiPrefs(next);
    saveUiPrefs(next);
  });
}

function readUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (!raw) return { translucent: true, showMenus: true };
    const parsed = JSON.parse(raw);
    return {
      translucent: parsed.translucent !== false,
      showMenus: parsed.showMenus !== false
    };
  } catch {
    return { translucent: true, showMenus: true };
  }
}

function saveUiPrefs(prefs) {
  localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
}

function applyUiPrefs(prefs) {
  document.body.classList.toggle("menus-opaque", !prefs.translucent);
  document.body.classList.toggle("menus-hidden", !prefs.showMenus);
}


function updateRoomStatus(message) {
  roomStatus.textContent = `Room scaling: ${message}`;
}

function computeRoomBounds(referenceSpace) {
  if (!referenceSpace || !referenceSpace.boundsGeometry || !referenceSpace.boundsGeometry.length) {
    return null;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of referenceSpace.boundsGeometry) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { width: Math.max(0.5, maxX - minX), depth: Math.max(0.5, maxZ - minZ) };
}

function applyRoomScale(bounds) {
  if (!bounds) {
    roomScaleFactor = 1;
    cloud.scale.setScalar(1);
    updateRoomStatus("fallback scale 1.0 (no boundary data)");
    return;
  }
  const targetDiameter = Math.max(1.2, Math.min(bounds.width, bounds.depth) * 0.68);
  roomScaleFactor = targetDiameter / (2.4 * 2);
  cloud.scale.setScalar(roomScaleFactor);
  const msg = `fit to ${bounds.width.toFixed(2)}m × ${bounds.depth.toFixed(2)}m, scale ${roomScaleFactor.toFixed(2)}`;
  updateRoomStatus(msg);
}

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x02050a, 0.03);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 120);
camera.position.set(0, 2, 7);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
canvasRoot.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 1.2, 0);
orbit.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xa8d8ff, 0x111827, 1.2));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(5, 9, 4);
scene.add(key);

const cloud = new THREE.Group();
scene.add(cloud);

const nodeGeometry = new THREE.IcosahedronGeometry(0.23, 2);
const objectToNode = new Map();
let links = [];

const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();
const controllerState = [];

function createLink(from, to) {
  const points = [from.position, to.position];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: new THREE.Color(linkBaseColor), transparent: true, opacity: 0.55 });
  const line = new THREE.Line(geometry, material);
  line.userData = { from, to };
  cloud.add(line);
  links.push(line);
}

function updateLinks() {
  for (const line of links) {
    line.geometry.setFromPoints([line.userData.from.position, line.userData.to.position]);
  }
}

function clearCloud() {
  for (const child of [...cloud.children]) {
    cloud.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  }
  objectToNode.clear();
  links = [];
  clearSpiders();
}

function buildCloud(schema) {
  clearCloud();
  const objects = schema.objects ?? [];
  const count = Math.max(objects.length, 1);
  const sphereRadius = 2.4;

  objects.forEach((obj, i) => {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(nodeBaseColor).offsetHSL((i / Math.max(count,1)) * 0.15, 0.08, 0.02),
      metalness: 0.24,
      roughness: 0.28,
      emissive: 0x071126
    });

    const node = new THREE.Mesh(nodeGeometry, material);
    node.position.setFromSphericalCoords(sphereRadius, phi, theta);
    node.userData = { objectName: obj.name };
    cloud.add(node);
    objectToNode.set(obj.name, node);

    const sprite = makeLabel(obj.name);
    sprite.position.set(0, 0.36, 0);
    node.add(sprite);
  });

  for (const obj of objects) {
    const fromNode = objectToNode.get(obj.name);
    for (const field of obj.fields ?? []) {
      if (field.referenceTo && objectToNode.has(field.referenceTo)) {
        createLink(fromNode, objectToNode.get(field.referenceTo));
      }
    }
  }
}

function makeLabel(text) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 512;
  canvas.height = 128;
  ctx.fillStyle = "rgba(2, 8, 22, 0.78)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#74c0ff";
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  ctx.font = "bold 44px sans-serif";
  ctx.fillStyle = "#e5f2ff";
  ctx.fillText(text, 16, 76);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.3, 0.33, 1);
  return sprite;
}

function parseAndBuild() {
  try {
    const parsed = JSON.parse(schemaInput.value);
    buildCloud(parsed);
    currentSchema = parsed;
    renderSalesforceBrowser(currentSchema);
  } catch (err) {
    alert(`Invalid JSON: ${err.message}`);
  }
}

rebuildButton.addEventListener("click", parseAndBuild);
parseAndBuild();

const controllerGripFactory = new XRControllerModelFactory();
for (let i = 0; i < 2; i += 1) {
  const controller = renderer.xr.getController(i);
  controller.userData.index = i;
  scene.add(controller);

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerGripFactory.createControllerModel(grip));
  scene.add(grip);

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0x88ccff })
  );
  line.name = "ray";
  line.scale.z = 6;
  controller.add(line);

  controllerState.push({
    controller,
    selected: null,
    rotating: false,
    lastWorld: new THREE.Vector3()
  });

  controller.addEventListener("selectstart", () => onSelectStart(i));
  controller.addEventListener("selectend", () => onSelectEnd(i));
  controller.addEventListener("squeezestart", () => onSqueezeStart(i));
  controller.addEventListener("squeezeend", () => onSqueezeEnd(i));
}

function intersectNodes(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  return raycaster.intersectObjects([...objectToNode.values()], false);
}

function onSelectStart(idx) {
  const state = controllerState[idx];
  const hit = intersectNodes(state.controller)[0];
  if (!hit) return;
  state.selected = hit.object;
  state.controller.attach(state.selected);
}

function onSelectEnd(idx) {
  const state = controllerState[idx];
  if (!state.selected) return;
  cloud.attach(state.selected);
  state.selected = null;
}

function onSqueezeStart(idx) {
  const state = controllerState[idx];
  state.rotating = true;
  state.lastWorld.setFromMatrixPosition(state.controller.matrixWorld);
}

function onSqueezeEnd(idx) {
  controllerState[idx].rotating = false;
}

function tickVrGestures() {
  for (const state of controllerState) {
    if (state.rotating) {
      const curr = new THREE.Vector3().setFromMatrixPosition(state.controller.matrixWorld);
      const delta = curr.clone().sub(state.lastWorld);
      cloud.rotation.y += delta.x * 1.9;
      cloud.rotation.x += delta.y * 1.3;
      state.lastWorld.copy(curr);
    }
  }
}

let floorMesh;

function addEnvironment() {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(20, 80),
    new THREE.MeshStandardMaterial({ color: 0x0a1424, metalness: 0.3, roughness: 0.86 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.5;
  scene.add(floor);
  floorMesh = floor;

  const stars = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ color: 0x74b8ff, size: 0.05, transparent: true, opacity: 0.9 })
  );
  const points = [];
  for (let i = 0; i < 1000; i += 1) {
    points.push((Math.random() - 0.5) * 40, Math.random() * 20 - 3, (Math.random() - 0.5) * 40);
  }
  stars.geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  scene.add(stars);
}
addEnvironment();
updateRoomStatus("desktop mode scale 1.0");

vrButtonEl.addEventListener("click", async () => {
  if (!navigator.xr) {
    alert("WebXR is not supported in this browser.");
    return;
  }
  try {
    await navigator.xr.isSessionSupported("immersive-vr");
    const button = VRButton.createButton(renderer);
    button.click();
  } catch {
    alert("VR session failed to start.");
  }
});


renderer.xr.addEventListener("sessionstart", () => {
  const ref = renderer.xr.getReferenceSpace();
  roomBounds = computeRoomBounds(ref);
  applyRoomScale(roomBounds);
  if (roomBounds && floorMesh) {
    const radius = Math.max(roomBounds.width, roomBounds.depth) * 0.8;
    floorMesh.scale.set(radius / 20, radius / 20, 1);
  }
});

renderer.xr.addEventListener("sessionend", () => {
  updateRoomStatus("session ended; keeping last scale");
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  orbit.update();
  tickVrGestures();
  updateLinks();
  updateMinigame();
  renderer.render(scene, camera);
});
