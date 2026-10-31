import * as THREE from 'three';
import { modelPart, textures } from './assets';
import type { Project, SceneNode } from './model';
const radians = THREE.MathUtils.degToRad;
export function createObject(n: SceneNode): THREE.Object3D {
  let o: THREE.Object3D;
  const geometries: Record<string, () => THREE.BufferGeometry> = {
    box: () => new THREE.BoxGeometry(),
    sphere: () => new THREE.SphereGeometry(0.5, 40, 24),
    plane: () => new THREE.PlaneGeometry(),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 40),
    cone: () => new THREE.ConeGeometry(0.5, 1, 40),
    torus: () => new THREE.TorusGeometry(0.6, 0.18, 20, 64),
  };
  if (geometries[n.kind])
    o = new THREE.Mesh(geometries[n.kind](), new THREE.MeshStandardMaterial());
  else if (n.kind === 'model') {
    const template = modelPart(n.assetId!, n.sourcePath);
    o = template ? template.clone(false) : new THREE.Group();
    if (o instanceof THREE.Mesh)
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => m.clone())
        : o.material.clone();
  } else if (n.kind === 'camera') o = new THREE.PerspectiveCamera(n.fov || 50, 1, 0.05, 10000);
  else if (n.kind === 'ambient') o = new THREE.AmbientLight();
  else if (n.kind === 'hemisphere') o = new THREE.HemisphereLight('#dbe7ff', '#45413a');
  else if (n.kind === 'directional') o = new THREE.DirectionalLight();
  else if (n.kind === 'point') o = new THREE.PointLight();
  else if (n.kind === 'spot') o = new THREE.SpotLight();
  else o = new THREE.Group();
  o.name = n.name;
  o.userData = { nodeId: n.id, ownedGeometry: n.kind !== 'model' };
  o.position.fromArray(n.position);
  o.rotation.set(...(n.rotation.map(radians) as [number, number, number]));
  o.scale.fromArray(n.scale);
  o.visible = n.visible;
  o.castShadow = n.castShadow && (!(o instanceof THREE.Light) || 'shadow' in o);
  o.receiveShadow = n.receiveShadow;
  if (o instanceof THREE.Mesh && n.material) {
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.color.set(n.material.color);
        m.roughness = n.material.roughness;
        m.metalness = n.material.metalness;
        m.opacity = n.material.opacity;
        m.transparent = n.material.opacity < 1;
        m.side = n.kind === 'plane' ? THREE.DoubleSide : m.side;
        if (n.material.texture !== undefined) m.map = textures.get(n.material.texture) || null;
      }
    }
  }
  if (o instanceof THREE.Light && n.light) {
    o.color.set(n.light.color);
    o.intensity = n.light.intensity;
  }
  if (
    o instanceof THREE.DirectionalLight ||
    o instanceof THREE.SpotLight ||
    o instanceof THREE.PointLight
  ) {
    o.shadow.mapSize.set(1024, 1024);
    o.shadow.bias = -0.0003;
    o.shadow.normalBias = 0.03;
    if (o instanceof THREE.DirectionalLight) {
      Object.assign(o.shadow.camera, {
        left: -20,
        right: 20,
        top: 20,
        bottom: -20,
        near: 0.1,
        far: 100,
      });
      o.shadow.camera.updateProjectionMatrix();
    }
  }
  return o;
}
export function buildScene(project: Project) {
  const root = new THREE.Group();
  root.name = project.name;
  const objects = new Map<string, THREE.Object3D>();
  project.nodes.forEach((n) => objects.set(n.id, createObject(n)));
  project.nodes.forEach((n) => {
    const o = objects.get(n.id)!;
    (n.parent ? objects.get(n.parent) || root : root).add(o);
  });
  root.updateMatrixWorld(true);
  return { root, objects };
}
export function disposeScene(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (o.userData.ownedGeometry) o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
    if (
      o instanceof THREE.DirectionalLight ||
      o instanceof THREE.PointLight ||
      o instanceof THREE.SpotLight
    )
      o.dispose();
  });
}
