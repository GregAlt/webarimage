import * as THREE from 'three';
import {loadGLTF} from "./loader.js";
import {createOneShotTracker} from "./oneshottracker.js";

document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-button');
  const status = document.getElementById('status');
  const targetWidthInMeters = 0.2032;
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const anchorObject = new THREE.Group();
  const imageContent = new THREE.Group();
  const modelOrientation = new THREE.Group();
  const oneShotTracker = createOneShotTracker(renderer, targetWidthInMeters);
  let imageBitmap;
  let session;
  let anchorSet = false;

  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1));
  anchorObject.visible = false;
  anchorObject.matrixAutoUpdate = false;
  scene.add(anchorObject);
  modelOrientation.rotation.x = -Math.PI / 2;
  modelOrientation.position.set(0, 0, targetWidthInMeters * 0.4);
  anchorObject.add(imageContent);
  imageContent.add(modelOrientation);

  const start = async () => {
    startButton.disabled = true;
    status.textContent = 'Starting AR...';

    try {
      if (!navigator.xr) {
        throw new Error('WebXR is not available in this browser.');
      }

      session = await navigator.xr.requestSession('immersive-ar', {
        optionalFeatures: ['image-tracking', 'camera-access'],
        trackedImages: [{image: imageBitmap, widthInMeters: targetWidthInMeters}],
      });
      const imageTrackingEnabled = session.enabledFeatures?.includes('image-tracking') ?? false;
      const cameraAccessEnabled = session.enabledFeatures?.includes('camera-access') ?? false;
      if (!imageTrackingEnabled && !cameraAccessEnabled) {
        await session.end();
        throw new Error('This browser must enable WebXR image-tracking or camera-access to track the QR poster.');
      }

      session.addEventListener('end', () => {
        anchorSet = false;
        imageContent.rotation.y = 0;
        oneShotTracker.reset();
        anchorObject.visible = false;
        startButton.disabled = false;
        status.textContent = 'AR session ended.';
      });
      await renderer.xr.setSession(session);
      if (!imageTrackingEnabled) {
        oneShotTracker.init(session);
      }
      status.textContent = imageTrackingEnabled
        ? 'Point the camera at the poster to place the snowman.'
        : 'Point the camera at the poster to scan it once.';

      renderer.setAnimationLoop((time, frame) => {
        if (frame && !anchorSet) {
          const referenceSpace = renderer.xr.getReferenceSpace();
          if (referenceSpace) {
            let anchorMatrix = null;
            if (imageTrackingEnabled) {
              const imageResult = frame.getImageTrackingResults().find(
                result => result.index === 0 && result.trackingState === 'tracked'
              );
              const pose = imageResult && frame.getPose(imageResult.imageSpace, referenceSpace);
              if (pose) {
                anchorMatrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
              }
            } else {
              anchorMatrix = oneShotTracker.detect(time, frame, referenceSpace);
            }

            if (anchorMatrix) {
              anchorObject.matrix.copy(anchorMatrix);
              anchorObject.matrixWorldNeedsUpdate = true;
              anchorSet = true;
              if (!imageTrackingEnabled) imageContent.rotation.y = -Math.PI / 2;
              anchorObject.visible = true;
              status.textContent = imageTrackingEnabled ? 'Poster anchored.' : 'QR detected; fallback anchor set.';
            }
          }
        }

        renderer.render(scene, camera);
      });
    } catch (error) {
      console.error('Unable to start WebXR AR:', error);
      status.textContent = `Unable to start AR: ${error.message}`;
      startButton.disabled = false;
    }
  };

  startButton.addEventListener('click', start);

  Promise.all([
    loadGLTF('./snowman.glb'),
    (async () => {
      const image = new Image();
      image.src = './QR-For-Tracking.jpg';
      await image.decode();
      return createImageBitmap(image);
    })(),
  ]).then(([gltf, bitmap]) => {
    imageBitmap = bitmap;
    gltf.scene.scale.set(0.2, 0.2, 0.2);
    modelOrientation.add(gltf.scene);
    startButton.disabled = false;
    status.textContent = 'Ready to start AR.';
  }).catch(error => {
    console.error('Unable to prepare the AR scene:', error);
    status.textContent = `Unable to prepare AR: ${error.message}`;
  });
});
