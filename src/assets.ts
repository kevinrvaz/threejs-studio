import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import dracoWrapper from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { get, set, del, keys } from 'idb-keyval';
import { zip, unzip, strToU8, strFromU8 } from 'fflate';
import { node, uid, validateProject } from './model';
import type { Asset, Project, SceneNode, Vec3 } from './model';
export const blobs = new Map<string, Blob>();
export const models = new Map<string, THREE.Object3D>();
export const textures = new Map<string, THREE.Texture>();
export const thumbnails = new Map<string, string>();
const retiredModels: THREE.Object3D[] = [],
  retiredTextures: THREE.Texture[] = [];
function disposeModel(root: THREE.Object3D) {
  const resources = new Set<{ dispose: () => void }>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      resources.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        resources.add(m);
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) resources.add(v);
      }
    }
  });
  resources.forEach((r) => r.dispose());
}
export function pruneAssets(retained: Set<string>) {
  retiredModels.splice(0).forEach(disposeModel);
  retiredTextures.splice(0).forEach((t) => t.dispose());
  for (const id of blobs.keys())
    if (!retained.has(id)) {
      const m = models.get(id);
      if (m) disposeModel(m);
      textures.get(id)?.dispose();
      const url = urls.get(id);
      if (url) URL.revokeObjectURL(url);
      blobs.delete(id);
      models.delete(id);
      textures.delete(id);
      urls.delete(id);
      thumbnails.delete(id);
    }
}
function thumbnail(root: THREE.Object3D) {
  if (typeof document === 'undefined') return undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(180, 150);
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(),
      object = root.clone(true);
    scene.add(object);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 5, 4);
    scene.add(light);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return undefined;
    const center = box.getCenter(new THREE.Vector3()),
      size = Math.max(box.getSize(new THREE.Vector3()).length(), 0.1);
    const camera = new THREE.PerspectiveCamera(40, 180 / 150, size / 100, size * 100);
    camera.position
      .copy(center)
      .add(new THREE.Vector3(1, 0.65, 1).normalize().multiplyScalar(size * 1.3));
    camera.lookAt(center);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } catch {
    return undefined;
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
async function stageAssets(project: Project, sources: Map<string, Blob>) {
  const stagedModels = new Map<string, THREE.Object3D>(),
    stagedTextures = new Map<string, THREE.Texture>(),
    stagedUrls = new Map<string, string>();
  try {
    for (const a of project.assets) {
      const blob = sources.get(a.id);
      if (!blob) throw new Error(`Missing asset: ${a.name}`);
      if (a.type === 'model') {
        const json = JSON.parse(await blob.text());
        // Portable models contain embedded image data, never external network URLs.
        for (const image of json.images || []) {
          const values = Array.isArray(image.url) ? image.url : [image.url];
          for (const value of values)
            if (typeof value === 'string' && !value.startsWith('data:'))
              throw new Error(
                `Model ${a.name} contains an external image. Reimport the original glTF with its textures.`,
              );
        }
        stagedModels.set(a.id, await new THREE.ObjectLoader().parseAsync(json));
      } else {
        const url = URL.createObjectURL(blob);
        stagedUrls.set(a.id, url);
        const t =
          a.type === 'environment'
            ? await new RGBELoader().loadAsync(url)
            : await new THREE.TextureLoader().loadAsync(url);
        if (a.type === 'environment') t.mapping = THREE.EquirectangularReflectionMapping;
        else {
          t.colorSpace = THREE.SRGBColorSpace;
          t.flipY = false;
        }
        stagedTextures.set(a.id, t);
      }
    }
    for (const n of project.nodes)
      if (n.kind === 'model') {
        let source = stagedModels.get(n.assetId!);
        if (n.sourcePath)
          for (const i of n.sourcePath.split('/')) source = source?.children[Number(i)];
        if (!source)
          throw new Error(`Missing model object: ${n.name}. The project has not been opened.`);
      }
  } catch (error) {
    stagedModels.forEach(disposeModel);
    stagedTextures.forEach((t) => t.dispose());
    stagedUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
  // Publish resources only after every asset has decoded successfully.
  for (const a of project.assets) {
    const oldModel = models.get(a.id),
      oldTexture = textures.get(a.id),
      oldUrl = urls.get(a.id);
    if (oldModel) retiredModels.push(oldModel);
    if (oldTexture) retiredTextures.push(oldTexture);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    blobs.set(a.id, sources.get(a.id)!);
    models.delete(a.id);
    textures.delete(a.id);
    urls.delete(a.id);
    thumbnails.delete(a.id);
    const model = stagedModels.get(a.id);
    if (model) {
      models.set(a.id, model);
      const image = thumbnail(model);
      if (image) thumbnails.set(a.id, image);
    }
    const texture = stagedTextures.get(a.id);
    if (texture) textures.set(a.id, texture);
    const url = stagedUrls.get(a.id);
    if (url) urls.set(a.id, url);
  }
}

const urls = new Map<string, string>();
export function assetUrl(id: string) {
  if (!urls.has(id) && blobs.has(id)) urls.set(id, URL.createObjectURL(blobs.get(id)!));
  return urls.get(id);
}
export async function prepareAssets(project: Project) {
  for (const a of project.assets) {
    const blob = blobs.get(a.id);
    if (!blob) throw new Error(`Missing asset: ${a.name}`);
    if (a.type === 'model' && !models.has(a.id))
      models.set(a.id, await new THREE.ObjectLoader().parseAsync(JSON.parse(await blob.text())));
    if (a.type !== 'model' && !textures.has(a.id)) {
      const texture =
        a.type === 'environment'
          ? await new RGBELoader().loadAsync(assetUrl(a.id)!)
          : await new THREE.TextureLoader().loadAsync(assetUrl(a.id)!);
      if (a.type === 'environment') texture.mapping = THREE.EquirectangularReflectionMapping;
      else {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
      }
      textures.set(a.id, texture);
    }
  }
}
export function modelPart(assetId: string, path = '') {
  let object = models.get(assetId);
  if (path) for (const index of path.split('/')) object = object?.children[Number(index)];
  return object;
}
export function modelNodes(asset: Asset, position: Vec3 = [0, 0, 0]): SceneNode[] {
  const root = models.get(asset.id)!;
  const nodes: SceneNode[] = [];
  const walk = (obj: THREE.Object3D, parent: string | null, path: string) => {
    const n = node('model', {
      name: parent
        ? (typeof obj.userData.name === 'string' ? obj.userData.name : obj.name) || obj.type
        : asset.name.replace(/\.[^.]+$/, ''),
      parent,
      assetId: asset.id,
      sourcePath: path,
      position: obj.position.toArray() as Vec3,
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z].map(
        (v) => (v * 180) / Math.PI,
      ) as Vec3,
      scale: obj.scale.toArray() as Vec3,
      visible: obj.visible,
    });
    if (!parent) n.position = n.position.map((v, i) => v + position[i]) as Vec3;
    nodes.push(n);
    obj.children.forEach((child, i) => walk(child, n.id, path ? `${path}/${i}` : `${i}`));
  };
  walk(root, null, '');
  return nodes;
}
function normalizeStaticModel(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const replacements: [THREE.SkinnedMesh, THREE.Mesh][] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.SkinnedMesh)) return;
    const geometry = obj.geometry.clone(),
      positions = geometry.getAttribute('position');
    const v = new THREE.Vector3();
    obj.skeleton.update();
    for (let i = 0; i < positions.count; i++) {
      v.fromBufferAttribute(positions, i);
      obj.applyBoneTransform(i, v);
      positions.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.deleteAttribute('skinIndex');
    geometry.deleteAttribute('skinWeight');
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, obj.material);
    mesh.name = obj.name;
    mesh.position.copy(obj.position);
    mesh.quaternion.copy(obj.quaternion);
    mesh.scale.copy(obj.scale);
    replacements.push([obj, mesh]);
  });
  for (const [old, mesh] of replacements) {
    while (old.children.length) mesh.add(old.children[0]);
    old.parent?.add(mesh);
    old.removeFromParent();
  }
}
export async function importFiles(files: File[]): Promise<Asset[]> {
  const result: Asset[] = [];
  const localUrls: string[] = [];
  try {
    const sources = files.filter((f) => /\.(glb|gltf|png|jpe?g|webp|hdr)$/i.test(f.name));
    if (!sources.length)
      throw new Error(
        'Choose GLB/glTF models, PNG/JPEG/WebP textures, or an HDR environment. Include all glTF companion files together.',
      );
    for (const file of sources) {
      const id = uid();
      let blob: Blob = file;
      let type: Asset['type'] = /\.hdr$/i.test(file.name) ? 'environment' : 'texture';
      if (/\.(glb|gltf)$/i.test(file.name)) {
        type = 'model';
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
          if (url.startsWith('data:') || url.startsWith('blob:')) return url;
          const path = decodeURIComponent(url).replace(/^\.\//, '');
          const exact = files.find((f) => (f.webkitRelativePath || f.name) === path);
          const candidates = files.filter((f) => f.name === path.split('/').at(-1));
          const companion = exact || (candidates.length === 1 ? candidates[0] : undefined);
          if (!companion)
            throw new Error(
              `Missing or ambiguous glTF dependency: ${path}. Drop the model and all companion files together.`,
            );
          const objectUrl = URL.createObjectURL(companion);
          localUrls.push(objectUrl);
          return objectUrl;
        });
        const decoderManager = new THREE.LoadingManager();
        decoderManager.setURLModifier((url) => (url.endsWith('.wasm') ? dracoWasm : dracoWrapper));
        const draco = new DRACOLoader(decoderManager).setDecoderConfig({ type: 'wasm' });
        let gltf;
        try {
          gltf = await new GLTFLoader(manager)
            .setDRACOLoader(draco)
            .setMeshoptDecoder(MeshoptDecoder)
            .parseAsync(await file.arrayBuffer(), '');
        } catch (error) {
          const message = (error as Error).message;
          if (message.includes('KTX2'))
            throw new Error(
              'This model uses KTX2 compressed textures. Export it with PNG or JPEG textures, then import it again.',
            );
          throw error;
        } finally {
          draco.dispose();
        }
        normalizeStaticModel(gltf.scene);
        const json = gltf.scene.toJSON();
        blob = new Blob([JSON.stringify(json)], { type: 'application/json' });
        models.set(id, await new THREE.ObjectLoader().parseAsync(json));
        const image = thumbnail(models.get(id)!);
        if (image) thumbnails.set(id, image);
      }
      blobs.set(id, blob);
      result.push({
        id,
        name: file.name,
        type,
        file: `assets/${id}.${type === 'model' ? 'json' : file.name.split('.').at(-1)}`,
      });
    }
    await prepareAssets({ assets: result } as Project);
    return result;
  } finally {
    localUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}
export interface SavedProject {
  project: Project;
  assets: [string, Blob][];
  updated: number;
}
export async function saveProject(project: Project) {
  const assets = project.assets.map((a) => {
    const blob = blobs.get(a.id);
    if (!blob) throw new Error(`Missing asset: ${a.name}`);
    return [a.id, blob] as [string, Blob];
  });
  await set(`project:${project.id}`, {
    project,
    assets,
    updated: Date.now(),
  } satisfies SavedProject);
  await set('lastProject', project.id);
}
export async function listProjects() {
  const ids = (await keys()).filter((k) => typeof k === 'string' && k.startsWith('project:'));
  const values = await Promise.all(ids.map((id) => get<SavedProject>(id)));
  return values.filter((v): v is SavedProject => !!v).sort((a, b) => b.updated - a.updated);
}
export async function loadProject(id: string) {
  const saved = await get<SavedProject>(`project:${id}`);
  if (!saved) throw new Error('Project not found in this browser.');
  const p = validateProject(saved.project);
  await stageAssets(p, new Map(saved.assets));
  return p;
}
export async function lastProject() {
  const id = await get<string>('lastProject');
  return id ? loadProject(id) : null;
}
export async function deleteProject(id: string) {
  await del(`project:${id}`);
  if ((await get('lastProject')) === id) await del('lastProject');
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function exportProject(project: Project) {
  const entries: Record<string, Uint8Array> = {
    'project.json': strToU8(JSON.stringify(project, null, 2)),
  };
  for (const asset of project.assets) {
    const blob = blobs.get(asset.id);
    if (!blob) throw new Error(`Missing asset: ${asset.name}`);
    entries[asset.file] = new Uint8Array(await blob.arrayBuffer());
  }
  const archive = await new Promise<Uint8Array>((resolve, reject) =>
    zip(entries, { level: 3 }, (error, result) => (error ? reject(error) : resolve(result))),
  );
  download(new Blob([archive as Uint8Array<ArrayBuffer>]), `${project.name}.threejsstudio`);
}
export async function openProject(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(bytes, (error, result) => (error ? reject(error) : resolve(result))),
  );
  if (!entries['project.json']) throw new Error('This file is not a studio project.');
  const project = validateProject(JSON.parse(strFromU8(entries['project.json'])));
  for (const asset of project.assets)
    if (!entries[asset.file]) throw new Error(`Project is missing ${asset.name}.`);
  const sources = new Map<string, Blob>();
  for (const asset of project.assets)
    sources.set(
      asset.id,
      new Blob([entries[asset.file] as Uint8Array<ArrayBuffer>], {
        type:
          asset.type === 'model'
            ? 'application/json'
            : /\.png$/i.test(asset.file)
              ? 'image/png'
              : /\.webp$/i.test(asset.file)
                ? 'image/webp'
                : 'image/jpeg',
      }),
    );
  await stageAssets(project, sources);
  return project;
}
