import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { useStudio, notify } from './store';
import { buildScene, disposeScene } from './scene';
import { isLocked, selectionRoots, transformFromMatrix } from './model';
import type { Project, Vec3 } from './model';
import { download, modelNodes, textures } from './assets';
export const viewportActions: {
  exportGLB?: () => Promise<void>;
  focus?: () => void;
  alignCamera?: (id: string) => void;
} = {};
export function Viewport({ onFiles }: { onFiles: (files: File[]) => void }) {
  const host = useRef<HTMLDivElement>(null),
    [error, setError] = useState('');
  const preview = useStudio((s) => s.preview),
    ortho = useStudio((s) => s.orthographic);
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setError(
        'WebGL is unavailable. Enable hardware acceleration in your browser to use the 3D viewport.',
      );
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      perspective = new THREE.PerspectiveCamera(45, 1, 0.05, 10000),
      orthographic = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.05, 10000);
    perspective.position.set(11, 8, 12);
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspective;
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0.5, 0);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.1;
    orbit.maxDistance = 2000;
    orbit.update();
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.85);
    const gizmo = transform.getHelper();
    scene.add(gizmo);
    const pivot = new THREE.Object3D();
    scene.add(pivot);
    const grid = new THREE.GridHelper(100, 100, '#5c6471', '#383e49');
    grid.position.y = -0.012;
    scene.add(grid);
    const axes = new THREE.AxesHelper(1.25);
    axes.position.set(0, 0.01, 0);
    scene.add(axes);
    let content = new THREE.Group(),
      objects = new Map<string, THREE.Object3D>(),
      helpers: THREE.Object3D[] = [],
      selections: THREE.BoxHelper[] = [];
    let previousProject: Project | null = null,
      previousSelection = '',
      previousFocus = -1,
      previousOrtho = false,
      drag = false,
      dragMoved = false,
      invalidTransform = false,
      disposed = false,
      dirty = true,
      frame = 0;
    // Wheel zoom updates OrbitControls immediately, before the animation loop's
    // update() can detect it. Invalidate on every control change as well.
    const invalidate = () => {
      dirty = true;
    };
    orbit.addEventListener('change', invalidate);
    const ray = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    const down = new THREE.Vector2();
    let startPivot = new THREE.Matrix4();
    let roots: string[] = [];
    const startMatrices = new Map<string, THREE.Matrix4>();
    function activeCamera() {
      const state = useStudio.getState();
      if (state.preview && state.project.previewCamera) {
        const c = objects.get(state.project.previewCamera);
        if (c instanceof THREE.PerspectiveCamera) {
          c.aspect = el.clientWidth / Math.max(1, el.clientHeight);
          c.updateProjectionMatrix();
          return c;
        }
      }
      return camera;
    }
    function clearHelpers() {
      helpers.forEach((h) => {
        scene.remove(h);
        (h as THREE.CameraHelper).dispose?.();
      });
      helpers = [];
    }
    function rebuild() {
      transform.detach();
      scene.remove(content);
      disposeScene(content);
      clearHelpers();
      const built = buildScene(useStudio.getState().project);
      content = built.root;
      objects = built.objects;
      scene.add(content);
      objects.forEach((o) => {
        let h: THREE.Object3D | undefined;
        if (o instanceof THREE.PerspectiveCamera) {
          const marker = o.clone();
          marker.near = 0.15;
          marker.far = 1.5;
          marker.updateProjectionMatrix();
          marker.matrixWorld.copy(o.matrixWorld);
          h = new THREE.CameraHelper(marker);
        } else if (o instanceof THREE.DirectionalLight)
          h = new THREE.DirectionalLightHelper(o, 0.5, '#e9c891');
        else if (o instanceof THREE.PointLight) h = new THREE.PointLightHelper(o, 0.2, '#e9c891');
        else if (o instanceof THREE.SpotLight) h = new THREE.SpotLightHelper(o, '#e9c891');
        if (h) {
          h.userData.pickId = o.userData.nodeId;
          h.traverse((c) => {
            c.userData.pickId = o.userData.nodeId;
          });
          scene.add(h);
          helpers.push(h);
        }
      });
      previousSelection = '';
    }
    function syncSelection() {
      selections.forEach((h) => {
        scene.remove(h);
        h.dispose();
      });
      selections = [];
      transform.detach();
      const state = useStudio.getState();
      const selected = state.selected
        .map((id) => objects.get(id))
        .filter((o): o is THREE.Object3D => !!o);
      selected.forEach((o) => {
        const box = new THREE.Box3().setFromObject(o);
        if (!box.isEmpty()) {
          const helper = new THREE.BoxHelper(o, '#c6e8a4');
          scene.add(helper);
          selections.push(helper);
        }
      });
      roots = selectionRoots(state.project.nodes, state.selected).filter(
        (id) => objects.has(id) && !isLocked(state.project.nodes, id),
      );
      if (roots.length && !state.preview) {
        const center = new THREE.Vector3();
        roots.forEach((id) => center.add(objects.get(id)!.getWorldPosition(new THREE.Vector3())));
        center.divideScalar(roots.length);
        pivot.position.copy(center);
        pivot.quaternion.identity();
        pivot.scale.set(1, 1, 1);
        if (roots.length === 1 && state.space === 'local')
          objects.get(roots[0])!.getWorldQuaternion(pivot.quaternion);
        pivot.updateMatrixWorld(true);
        transform.attach(pivot);
      }
    }
    function focus() {
      const s = useStudio.getState();
      const box = new THREE.Box3();
      const targets = s.selected.length
        ? (s.selected.map((id) => objects.get(id)).filter(Boolean) as THREE.Object3D[])
        : [content];
      targets.forEach((o) => box.expandByObject(o));
      if (box.isEmpty()) {
        orbit.target.set(0, 0, 0);
        return;
      }
      const center = box.getCenter(new THREE.Vector3()),
        size = Math.max(box.getSize(new THREE.Vector3()).length(), 2);
      const direction = camera.position.clone().sub(orbit.target).normalize();
      orbit.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, size * 1.2);
      if (camera === orthographic) {
        orthographic.zoom = Math.max(0.05, 12 / size);
        orthographic.updateProjectionMatrix();
      }
      orbit.update();
    }
    viewportActions.focus = focus;
    viewportActions.alignCamera = (id) => {
      const state = useStudio.getState(),
        target = objects.get(id);
      if (!target) return;
      camera.updateMatrixWorld(true);
      const local = target.parent!.matrixWorld.clone().invert().multiply(camera.matrixWorld);
      state.patch([id], { ...transformFromMatrix(local), fov: perspective.fov });
    };
    viewportActions.exportGLB = async () => {
      const exportRoot = buildScene(useStudio.getState().project).root;
      const unsupported: THREE.Object3D[] = [];
      exportRoot.traverse((o) => {
        if (o instanceof THREE.AmbientLight || o instanceof THREE.HemisphereLight)
          unsupported.push(o);
      });
      unsupported.forEach((o) => o.removeFromParent());
      try {
        const result = await new GLTFExporter().parseAsync(exportRoot, {
          binary: true,
          onlyVisible: true,
        });
        download(
          new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }),
          `${useStudio.getState().project.name}.glb`,
        );
        notify(
          'GLB exported. Background, HDR environment, fog, ambient lighting, and editor settings remain in the studio project.',
        );
      } finally {
        disposeScene(exportRoot);
      }
    };
    function sync() {
      dirty = true;
      if (disposed || drag) return;
      const s = useStudio.getState();
      if (previousProject !== s.project) {
        rebuild();
        previousProject = s.project;
      }
      scene.background = new THREE.Color(s.project.environment.background);
      scene.fog = s.project.environment.fog
        ? new THREE.FogExp2(s.project.environment.background, s.project.environment.fogDensity)
        : null;
      scene.environment = textures.get(s.project.environment.environmentId || '') || null;
      renderer.toneMappingExposure = s.project.environment.exposure;
      if (previousOrtho !== s.orthographic) {
        const old = camera;
        camera = s.orthographic ? orthographic : perspective;
        camera.position.copy(old.position);
        camera.quaternion.copy(old.quaternion);
        orbit.object = camera;
        transform.camera = camera;
        previousOrtho = s.orthographic;
        resize();
      }
      const key = JSON.stringify([s.selected, s.preview, s.space]);
      if (key !== previousSelection) {
        syncSelection();
        previousSelection = key;
      }
      transform.setMode(s.tool);
      transform.setSpace(s.space);
      transform.setTranslationSnap(s.snap ? s.snapMove : null);
      transform.setRotationSnap(s.snap ? THREE.MathUtils.degToRad(s.snapAngle) : null);
      transform.setScaleSnap(s.snap ? s.snapScale : null);
      grid.visible = s.grid && !s.preview;
      axes.visible = s.grid && !s.preview;
      helpers.forEach((h) => {
        const o = objects.get(h.userData.pickId);
        h.visible = !s.preview && s.selected.includes(h.userData.pickId) && !!o && visible(o);
      });
      selections.forEach((h) => (h.visible = !s.preview));
      gizmo.visible = !s.preview;
      orbit.enabled = !s.preview;
      if (s.focus !== previousFocus) {
        if (previousFocus !== -1) focus();
        previousFocus = s.focus;
      }
    }
    transform.addEventListener('change', () => {
      dirty = true;
    });
    transform.addEventListener('mouseDown', () => {
      drag = true;
      dragMoved = false;
      invalidTransform = false;
      orbit.enabled = false;
      pivot.updateMatrixWorld(true);
      startPivot.copy(pivot.matrixWorld);
      startMatrices.clear();
      roots.forEach((id) => startMatrices.set(id, objects.get(id)!.matrixWorld.clone()));
    });
    transform.addEventListener('objectChange', () => {
      if (!drag) return;
      dragMoved = true;
      invalidTransform = false;
      pivot.updateMatrixWorld(true);
      const delta = pivot.matrixWorld.clone().multiply(startPivot.clone().invert());
      roots.forEach((id) => {
        const o = objects.get(id)!;
        const world = delta.clone().multiply(startMatrices.get(id)!);
        const local = o.parent!.matrixWorld.clone().invert().multiply(world);
        local.decompose(o.position, o.quaternion, o.scale);
        const check = new THREE.Matrix4().compose(o.position, o.quaternion, o.scale);
        if (local.elements.some((v, i) => Math.abs(v - check.elements[i]) > 1e-5))
          invalidTransform = true;
        for (const axis of ['x', 'y', 'z'] as const)
          if (Math.abs(o.scale[axis]) < 0.0001) o.scale[axis] = 0.0001;
        o.updateMatrixWorld(true);
      });
      selections.forEach((h) => h.update());
      helpers.forEach((h) => {
        if (h instanceof THREE.CameraHelper) {
          h.camera.matrixWorld.copy(objects.get(h.userData.pickId)!.matrixWorld);
          h.update();
        } else (h as THREE.DirectionalLightHelper).update?.();
      });
    });
    transform.addEventListener('mouseUp', () => {
      if (!drag) return;
      if (!dragMoved || invalidTransform) {
        drag = false;
        orbit.enabled = true;
        if (invalidTransform) {
          previousProject = null;
          notify(
            'This transform would shear an object. Use local axes or a parent with uniform scale.',
          );
        }
        sync();
        return;
      }
      const changes = new Map(
        roots.map((id) => {
          const o = objects.get(id)!;
          o.updateMatrix();
          return [id, transformFromMatrix(o.matrix)];
        }),
      );
      drag = false;
      orbit.enabled = true;
      useStudio.getState().commit((p) =>
        p.nodes.forEach((n) => {
          const patch = changes.get(n.id);
          if (patch) Object.assign(n, patch);
        }),
      );
      sync();
    });
    function resize() {
      dirty = true;
      const w = Math.max(1, el.clientWidth),
        h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h);
      perspective.aspect = w / h;
      perspective.updateProjectionMatrix();
      orthographic.left = (-8 * w) / h;
      orthographic.right = (8 * w) / h;
      orthographic.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    function cast(x: number, y: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((x - rect.left) / rect.width) * 2 - 1, (-(y - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, activeCamera());
    }
    function visible(o: THREE.Object3D): boolean {
      return o.visible && (!o.parent || visible(o.parent));
    }
    function pointerDown(e: PointerEvent) {
      down.set(e.clientX, e.clientY);
    }
    function pointerUp(e: PointerEvent) {
      const s = useStudio.getState();
      if (
        s.preview ||
        e.button !== 0 ||
        drag ||
        transform.axis ||
        down.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 4
      )
        return;
      cast(e.clientX, e.clientY);
      const hits = ray
        .intersectObjects([content, ...helpers], true)
        .filter((hit) => visible(hit.object));
      const hit = hits.find((hit) => hit.object.userData.nodeId || hit.object.userData.pickId);
      const id = hit?.object.userData.nodeId || hit?.object.userData.pickId;
      if (id && isLocked(s.project.nodes, id)) return;
      s.select(id || null, e.shiftKey || e.metaKey || e.ctrlKey);
    }
    function drop(e: DragEvent) {
      e.preventDefault();
      if (useStudio.getState().preview) return;
      if (e.dataTransfer?.files.length) {
        onFiles(Array.from(e.dataTransfer.files));
        return;
      }
      const data = e.dataTransfer?.getData('application/forma');
      if (!data) return;
      cast(e.clientX, e.clientY);
      const hit = ray.intersectObject(content, true).find((h) => visible(h.object));
      const point =
        hit?.point.clone() ||
        ray.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
          new THREE.Vector3(),
        ) ||
        new THREE.Vector3();
      const s = useStudio.getState();
      if (s.snap) point.divideScalar(s.snapMove).round().multiplyScalar(s.snapMove);
      const value = JSON.parse(data);
      if (value.kind) {
        if (value.kind !== 'plane') point.y += 0.5;
        s.add(value.kind, point.toArray() as Vec3);
      } else if (value.asset) {
        const a = s.project.assets.find((a) => a.id === value.asset);
        if (a?.type === 'model') {
          const nodes = modelNodes(a, point.toArray() as Vec3);
          s.commit((p) => p.nodes.push(...nodes));
          s.select(nodes[0].id);
        } else if (a?.type === 'texture' && hit?.object.userData.nodeId) {
          const id = hit.object.userData.nodeId;
          s.commit((p) => {
            const n = p.nodes.find((n) => n.id === id)!;
            n.material = {
              color: '#ffffff',
              roughness: 0.55,
              metalness: 0,
              opacity: 1,
              ...n.material,
              texture: a.id,
            };
          });
        }
      }
    }
    const dragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    el.addEventListener('dragover', dragOver);
    el.addEventListener('drop', drop);
    const unsubscribe = useStudio.subscribe(sync);
    sync();
    resize();
    function animate() {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const moved = orbit.update();
      if (moved || dirty || drag) {
        renderer.render(scene, activeCamera());
        dirty = false;
      }
    }
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
      orbit.removeEventListener('change', invalidate);
      orbit.dispose();
      transform.dispose();
      clearHelpers();
      selections.forEach((h) => h.dispose());
      disposeScene(content);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      el.removeEventListener('dragover', dragOver);
      el.removeEventListener('drop', drop);
      viewportActions.exportGLB = undefined;
      viewportActions.focus = undefined;
      viewportActions.alignCamera = undefined;
    };
  }, [onFiles]);
  return (
    <div className="viewport" ref={host} aria-label="3D scene viewport">
      {error && <div className="viewport-error">{error}</div>}
      <div className="viewport-label">
        <span className="live-dot" />
        <span>{preview ? 'CAMERA PREVIEW' : 'SCENE VIEW'}</span>
        <span>{ortho ? 'Orthographic' : 'Perspective'}</span>
      </div>
      <div className="viewport-hint">
        {preview
          ? 'Press Esc to return to editing'
          : 'Orbit: drag · Pan: right-drag · Zoom: scroll · Focus: F'}
      </div>
      <div className="axis-widget">
        <span className="axis-y">Y</span>
        <span className="axis-z">Z</span>
        <span className="axis-x">X</span>
        <i />
      </div>
    </div>
  );
}
