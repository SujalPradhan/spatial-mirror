import * as T from 'three';
import type {AtpComponent, AtpState, AtpStructureAsset} from './contracts';
import {chapters} from './content';

const palette: Record<AtpComponent, string> = {
  rotor: '#c64c37', stator: '#287d84', head: '#756b99', membrane: '#aabbb1',
};
const names: Record<AtpComponent, [string, string]> = {
  rotor: ['Rotor', 'Ring + central shaft'], stator: ['Stator', 'Stationary support'],
  head: ['Catalytic head', 'Three working pairs'], membrane: ['Cell membrane', 'Illustrated context'],
};
type Painted = {part: AtpComponent; material: T.MeshStandardMaterial; opacity: number};
const Y = new T.Vector3(0, 1, 0);

/** Deposited coordinates and the illustrative mechanism deliberately have separate geometry. */
export class AtpView {
  readonly ready: Promise<void>;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(37, 1, .1, 100);
  readonly renderer: T.WebGLRenderer;
  private readonly root = new T.Group();
  private readonly structure = new T.Group();
  private readonly mechanism = new T.Group();
  private readonly rotor = new T.Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly abort = new AbortController();
  private readonly materials: Painted[] = [];
  private readonly pickables: T.Object3D[] = [];
  private readonly labels = new Map<AtpComponent, HTMLElement>();
  private readonly structureAnchors = new Map<AtpComponent, T.Vector3>();
  private readonly mechanismAnchors: Record<AtpComponent, T.Vector3> = {
    rotor: new T.Vector3(-.88, -1.65, .25), stator: new T.Vector3(1.28, -.05, .1),
    head: new T.Vector3(.65, 1.75, .35), membrane: new T.Vector3(-1.9, -1.18, 1.1),
  };
  private readonly proton = new T.Group();
  private readonly sideLabels: HTMLElement[] = [];
  private state: AtpState | null = null;
  private loaded = false;
  private disposed = false;
  private contextLost = false;
  private width = 1;
  private height = 1;
  private phase = -1;

  constructor(readonly host: HTMLElement) {
    this.renderer = new T.WebGLRenderer({antialias: true, alpha: true, powerPreference: 'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.setClearColor(0xe7edeb, 0);
    this.renderer.domElement.className = 'atp-canvas';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.prepend(this.renderer.domElement);
    this.camera.position.set(0, 0, 13);
    this.scene.add(this.root);
    this.root.add(this.structure, this.mechanism);
    this.scene.add(new T.HemisphereLight(0xffffff, 0x8d9c9b, 2.5));
    const key = new T.DirectionalLight(0xfff4e3, 3.1);
    key.position.set(-5, 8, 9);
    const rim = new T.DirectionalLight(0xe4f2ff, 2.5);
    rim.position.set(6, 3, -5);
    this.scene.add(key, rim);
    this.buildMechanism();
    this.createLabels();
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.ready = this.loadStructure();
  }

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.host.dispatchEvent(new CustomEvent('atp-render-error', {bubbles: true, detail: 'The 3D view paused. Reload if it does not recover.'}));
  };
  private readonly onContextRestored = () => {this.contextLost = false; this.render();};

  private material(part: AtpComponent, opacity = 1, color = palette[part]) {
    const material = new T.MeshStandardMaterial({
      color, roughness: .52, metalness: .03, transparent: opacity < 1, opacity,
      depthWrite: opacity > .7,
    });
    this.materials.push({part, material, opacity});
    return material;
  }

  private mark(object: T.Object3D, part: AtpComponent) {
    object.userData.atpPart = part;
    this.pickables.push(object);
  }

  private mesh(geometry: T.BufferGeometry, part: AtpComponent, parent: T.Object3D, position: [number, number, number], scale?: [number, number, number], opacity = 1, color?: string) {
    const mesh = new T.Mesh(geometry, this.material(part, opacity, color));
    mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    parent.add(mesh);
    this.mark(mesh, part);
    return mesh;
  }

  private segment(a: T.Vector3, b: T.Vector3, radius: number, part: AtpComponent, parent: T.Object3D, color?: string) {
    const delta = b.clone().sub(a);
    const mesh = this.mesh(new T.CylinderGeometry(radius, radius, delta.length(), 12), part, parent, a.clone().add(b).multiplyScalar(.5).toArray() as [number,number,number], undefined, 1, color);
    mesh.quaternion.setFromUnitVectors(Y, delta.normalize());
    return mesh;
  }

  private membrane(parent: T.Object3D, y: number, width: number, depth: number) {
    const slab = this.mesh(new T.BoxGeometry(width, .4, depth), 'membrane', parent, [0, y, 0], undefined, .21);
    slab.renderOrder = 2;
    // A sparse double layer gives spatial context without hiding the molecular ring.
    const beads = new T.InstancedMesh(new T.SphereGeometry(.055, 7, 5), this.material('membrane', .62, '#8faaa0'), 176);
    const dummy = new T.Object3D();
    let n = 0;
    for (const side of [-1, 1]) {
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 11; col++) {
          for (const edge of [-1, 1]) {
            dummy.position.set((col - 5) * width / 11, y + side * .23, edge * (depth / 2 - .1 - row * .19));
            dummy.updateMatrix();
            beads.setMatrixAt(n++, dummy.matrix);
          }
        }
      }
    }
    beads.instanceMatrix.needsUpdate = true;
    parent.add(beads);
    this.mark(beads, 'membrane');
    const edges = new T.LineSegments(new T.EdgesGeometry(slab.geometry), new T.LineBasicMaterial({color: '#98ada5', transparent: true, opacity: .38}));
    edges.position.copy(slab.position);
    parent.add(edges);
  }

  private buildMechanism() {
    this.mechanism.add(this.rotor);
    this.membrane(this.mechanism, -1.18, 5.2, 3.2);
    // This stylised ring uses ten lobes to match the E. coli c10 ring; not an atomic model.
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI / 5;
      const lobe = this.mesh(new T.CapsuleGeometry(.18, .68, 5, 10), 'rotor', this.rotor,
        [Math.cos(angle) * .67, -1.15, Math.sin(angle) * .67], undefined, 1, i % 2 ? '#cb6146' : '#b94734');
      lobe.rotation.z = .07;
    }
    const ring = this.mesh(new T.TorusGeometry(.63, .12, 10, 48), 'rotor', this.rotor, [0, -1.6, 0]);
    ring.rotation.x = Math.PI / 2;
    this.segment(new T.Vector3(0, -1.4, 0), new T.Vector3(0, 1.83, 0), .15, 'rotor', this.rotor, '#c34631');
    this.segment(new T.Vector3(0, .15, 0), new T.Vector3(.34, 1.4, .13), .13, 'rotor', this.rotor, '#e17550');
    this.mesh(new T.SphereGeometry(.3, 16, 12), 'rotor', this.rotor, [0, -.23, 0], [1, 1.5, .85]);
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      const lobe = this.mesh(new T.SphereGeometry(.64, 24, 16), 'head', this.mechanism,
        [Math.cos(angle) * .72, 1.62, Math.sin(angle) * .72], [.8, 1.2, .8], 1, i % 2 ? '#8578a8' : '#aca0bf');
      lobe.rotation.z = Math.cos(angle) * -.12;
    }
    // Peripheral support remains in the stationary group when the shaft rotates.
    this.segment(new T.Vector3(1.12, -1.15, 0), new T.Vector3(1.32, 1.65, 0), .11, 'stator', this.mechanism);
    this.segment(new T.Vector3(1.32, 1.65, 0), new T.Vector3(.7, 2.3, 0), .12, 'stator', this.mechanism);
    this.mesh(new T.SphereGeometry(.32, 16, 12), 'stator', this.mechanism, [.57, 2.3, 0], [1.5, .55, 1]);
    this.mesh(new T.CapsuleGeometry(.26, .65, 5, 12), 'stator', this.mechanism, [1.05, -1.15, .15], [.9, 1, 1]);
    // An explanatory proton path; its timing is diagrammatic, not a measured transport rate.
    const path = new T.CatmullRomCurve3([
      new T.Vector3(1.65, -2.03, .2), new T.Vector3(1.35, -1.7, .27),
      new T.Vector3(1.05, -1.2, .3), new T.Vector3(1.3, -.65, .2), new T.Vector3(1.66, -.35, .2),
    ]);
    const pathLine = new T.Line(new T.BufferGeometry().setFromPoints(path.getPoints(32)), new T.LineDashedMaterial({color: '#bda662', dashSize: .09, gapSize: .09, transparent: true, opacity: .8}));
    pathLine.computeLineDistances();
    this.proton.add(pathLine);
    const arrow = new T.Mesh(new T.ConeGeometry(.11, .24, 12), new T.MeshStandardMaterial({color: '#b6963e', roughness: .6}));
    arrow.position.copy(path.getPoint(.92));
    arrow.quaternion.setFromUnitVectors(Y, path.getTangent(.92).normalize());
    this.proton.add(arrow);
    for (let i = 0; i < 3; i++) {
      const bead = new T.Mesh(new T.SphereGeometry(.065, 10, 8), new T.MeshStandardMaterial({color: '#b6963e', roughness: .45}));
      bead.position.copy(path.getPoint(i / 3));
      bead.userData.proton = i;
      this.proton.add(bead);
    }
    this.proton.userData.path = path;
    this.mechanism.add(this.proton);
    this.mechanism.visible = false;
  }

  private async loadStructure() {
    const response = await fetch('/models/atp-6oqr.json', {signal: this.abort.signal});
    if (!response.ok) throw new Error(`Molecular structure could not load (${response.status}).`);
    const asset = await response.json() as AtpStructureAsset;
    if (this.disposed) return;
    if (asset.schema !== 'atp-structure-v1' || asset.pdb !== '6OQR' || !Array.isArray(asset.chains) || !asset.chains.length || asset.chains.length > 100 || !asset.anchors) throw new Error('The ATP molecular asset has an unsupported format.');
    const bounds = new T.Box3();
    const components: Record<string, T.Vector3[][]> = {rotor: [], stator: [], head: []};
    let pointCount = 0;
    for (const chain of asset.chains) {
      if (!(chain.component in components) || !Array.isArray(chain.points) || chain.points.length % 3) throw new Error('Invalid molecular chain data.');
      if (pointCount + chain.points.length / 3 > 20000) throw new Error('The molecular asset exceeds the supported size.');
      const points: T.Vector3[] = [];
      for (let i = 0; i < chain.points.length; i += 3) {
        const xyz = chain.points.slice(i, i + 3);
        if (!xyz.every(Number.isFinite)) throw new Error('Invalid molecular coordinates.');
        const p = new T.Vector3(xyz[0], xyz[1], xyz[2]);
        bounds.expandByPoint(p);
        points.push(p);
      }
      pointCount += points.length;
      components[chain.component].push(points);
    }
    const height = bounds.max.y - bounds.min.y;
    if (!pointCount || !Number.isFinite(height) || height < 1) throw new Error('Molecular coordinates are empty.');
    const scale = 5.8 / height;
    const center = bounds.getCenter(new T.Vector3());
    const convert = (p: T.Vector3) => p.clone().sub(center).multiplyScalar(scale);
    for (const [part, chains] of Object.entries(components)) {
      const points = chains.flat();
      const bonds: [T.Vector3, T.Vector3][] = [];
      for (const chain of chains) {
        for (let i = 1; i < chain.length; i++) {
          // Omitted residues are genuine gaps: do not bridge them with invented backbone.
          const d = chain[i - 1].distanceTo(chain[i]);
          if (d > .1 && d < 5.2) bonds.push([chain[i - 1], chain[i]]);
        }
      }
      // Instance colours multiply the material colour, so use white as their base.
      const beads = new T.InstancedMesh(new T.SphereGeometry(1.52 * scale, 8, 6), this.material(part as AtpComponent, 1, '#ffffff'), points.length);
      const sticks = new T.InstancedMesh(new T.CylinderGeometry(1.15 * scale, 1.15 * scale, 1, 7), this.material(part as AtpComponent), bonds.length);
      const dummy = new T.Object3D();
      points.forEach((p, i) => {
        dummy.position.copy(convert(p)); dummy.scale.set(1, 1, 1); dummy.quaternion.identity(); dummy.updateMatrix();
        beads.setMatrixAt(i, dummy.matrix);
        // Small residue-level variation makes the backbone readable without false atom colours.
        const color = new T.Color(palette[part as AtpComponent]);
        color.offsetHSL(0, -.025, ((i % 7) - 3) * .009);
        beads.setColorAt(i, color);
      });
      bonds.forEach(([a, b], i) => {
        const aa = convert(a), bb = convert(b), delta = bb.clone().sub(aa);
        dummy.position.copy(aa).add(bb).multiplyScalar(.5);
        dummy.quaternion.setFromUnitVectors(Y, delta.clone().normalize());
        dummy.scale.set(1, delta.length(), 1); dummy.updateMatrix();
        sticks.setMatrixAt(i, dummy.matrix);
      });
      beads.instanceMatrix.needsUpdate = sticks.instanceMatrix.needsUpdate = true;
      if (beads.instanceColor) beads.instanceColor.needsUpdate = true;
      beads.computeBoundingSphere(); sticks.computeBoundingSphere();
      this.structure.add(beads, sticks);
      this.mark(beads, part as AtpComponent); this.mark(sticks, part as AtpComponent);
    }
    this.membrane(this.structure, -center.y * scale, 5.2, 3.2);
    for (const part of Object.keys(names) as AtpComponent[]) {
      const xyz = asset.anchors[part];
      if (!Array.isArray(xyz) || xyz.length !== 3 || !xyz.every(Number.isFinite)) throw new Error('Invalid molecular label anchors.');
      this.structureAnchors.set(part, convert(new T.Vector3(...xyz)));
    }
    this.loaded = true;
    if (this.state) this.update(this.state);
    this.render();
  }

  private createLabels() {
    for (const part of Object.keys(names) as AtpComponent[]) {
      const label = document.createElement('div');
      label.className = `atp-anchor atp-anchor-${part}`;
      label.style.setProperty('--part-color', palette[part]);
      const dot = document.createElement('i');
      const line = document.createElement('span'); line.className = 'atp-leader';
      const text = document.createElement('span'); text.className = 'atp-anchor-text';
      const title = document.createElement('b'); title.textContent = names[part][0];
      const caption = document.createElement('small'); caption.textContent = names[part][1];
      text.append(title, caption); label.append(dot, line, text);
      this.labels.set(part, label); this.host.append(label);
    }
    for (const text of ['Periplasm · higher H⁺', 'Cytoplasm · lower H⁺']) {
      const label = document.createElement('span'); label.className = 'atp-side-label'; label.textContent = text;
      this.host.append(label); this.sideLabels.push(label);
    }
  }

  private resize() {
    if (this.disposed) return;
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (this.state) this.update(this.state);
    this.render();
  }

  update(state: AtpState) {
    if (this.disposed) return;
    this.state = state;
    this.root.quaternion.fromArray(state.view.q).normalize();
    this.root.position.set(state.view.x + (this.width > 1000 ? .65 : 0), state.view.y + (this.width < 700 ? .28 : 0), 0);
    this.camera.zoom = Math.min(3, Math.max(.4, state.view.zoom));
    this.camera.updateProjectionMatrix();
    this.structure.visible = state.representation === 'structure';
    this.mechanism.visible = state.representation === 'mechanism';
    if (state.phase !== this.phase) {
      this.phase = state.phase;
      this.rotor.rotation.y = state.phase * Math.PI / 180;
      const path = this.proton.userData.path as T.CatmullRomCurve3;
      for (const child of this.proton.children) {
        if (typeof child.userData.proton === 'number') child.position.copy(path.getPoint(((state.phase / 360 + child.userData.proton / 3) % 1 + 1) % 1));
      }
    }
    this.proton.visible = state.representation === 'mechanism' && (!state.guided || state.chapter === 1);
    const focus = state.guided ? chapters[state.chapter]?.focus : null;
    for (const entry of this.materials) {
      const active = state.selected ? state.selected === entry.part : !focus || focus.includes(entry.part);
      entry.material.opacity = entry.opacity * (active ? 1 : state.selected ? .21 : .38);
      entry.material.transparent = entry.material.opacity < 1;
      entry.material.depthWrite = entry.material.opacity > .7;
      entry.material.emissive.set(active && state.selected ? palette[entry.part] : '#000000');
      entry.material.emissiveIntensity = active && state.selected ? .075 : 0;
    }
    this.root.updateMatrixWorld(true);
    this.updateLabels();
  }

  project(part: AtpComponent) {
    if (!this.state) return {x: 0, y: 0, visible: false};
    const p = this.state.representation === 'structure' ? this.structureAnchors.get(part) : this.mechanismAnchors[part];
    if (!p) return {x: 0, y: 0, visible: false};
    const ndc = p.clone().applyMatrix4(this.root.matrixWorld).project(this.camera);
    return {x: (ndc.x + 1) * this.width / 2, y: (1 - ndc.y) * this.height / 2, visible: ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) < 1.12 && Math.abs(ndc.y) < 1.12};
  }

  private updateLabels() {
    for (const [part, label] of this.labels) {
      const p = this.project(part);
      label.hidden = !p.visible || (!this.loaded && this.state?.representation !== 'mechanism') || (this.width < 620 && !!this.state?.selected && this.state.selected !== part);
      label.style.left = `${p.x}px`; label.style.top = `${p.y}px`;
      label.classList.toggle('atp-anchor-left', part === 'rotor' || part === 'membrane');
      const focus = this.state?.guided ? chapters[this.state.chapter]?.focus : null;
      label.classList.toggle('is-muted', this.state?.selected ? this.state.selected !== part : !!focus && !focus.includes(part));
    }
    this.sideLabels.forEach((label, i) => {
      label.hidden = !this.state || this.state.representation !== 'mechanism' || this.width < 720 || (this.state.guided && this.state.chapter !== 1);
      const p = new T.Vector3(-1.8, i ? -.55 : -1.95, .4).applyMatrix4(this.root.matrixWorld).project(this.camera);
      label.style.left = `${(p.x + 1) * this.width / 2}px`; label.style.top = `${(1 - p.y) * this.height / 2}px`;
    });
  }

  pick(clientX: number, clientY: number): AtpComponent | null {
    if (this.disposed || this.contextLost) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    this.root.updateMatrixWorld(true);
    const ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2), this.camera);
    const visible = this.pickables.filter(object => {
      let node: T.Object3D | null = object;
      while (node) {if (!node.visible) return false; node = node.parent;}
      return true;
    });
    const hits = ray.intersectObjects(visible, false);
    // Membrane is contextual and transparent: select a protein behind it in preference.
    const protein = hits.find(hit => hit.object.userData.atpPart !== 'membrane');
    return (protein || hits[0])?.object.userData.atpPart ?? null;
  }

  render() {
    if (this.disposed || this.contextLost) return;
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    this.scene.traverse(object => {
      if (object instanceof T.Mesh || object instanceof T.LineSegments || object instanceof T.Line) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    this.renderer.dispose(); this.renderer.domElement.remove();
    this.labels.forEach(label => label.remove()); this.sideLabels.forEach(label => label.remove());
    this.scene.clear();
  }
}
