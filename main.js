import * as THREE from 'three';
import {loadGLTF} from "./loader.js";

document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-button');
  const status = document.getElementById('status');
  const testWithoutImageTracking = false;
  const targetWidthInMeters = 0.2032;
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const anchorObject = new THREE.Group();
  const imageContent = new THREE.Group();
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
  imageContent.rotation.x = -Math.PI / 2;
  imageContent.position.set(0, 0, targetWidthInMeters * 0.4);
  anchorObject.add(imageContent);

  const start = async () => {
    startButton.disabled = true;
    status.textContent = 'Starting AR...';

    try {
      if (!navigator.xr) {
        throw new Error('WebXR is not available in this browser.');
      }

      const sessionInit = testWithoutImageTracking ? {} : {
        requiredFeatures: ['image-tracking'],
        trackedImages: [{image: imageBitmap, widthInMeters: targetWidthInMeters}],
      };
      session = await navigator.xr.requestSession('immersive-ar', sessionInit);
      session.addEventListener('end', () => {
        anchorSet = false;
        anchorObject.visible = false;
        startButton.disabled = false;
        status.textContent = 'AR session ended.';
      });
      await renderer.xr.setSession(session);
      if (testWithoutImageTracking) {
        anchorObject.matrix.makeTranslation(0, 0, -1);
        anchorObject.matrixWorldNeedsUpdate = true;
        anchorSet = true;
        anchorObject.visible = true;
        status.textContent = 'AR session active; model placed 1 m ahead. Image tracking is disabled.';
      } else {
        status.textContent = 'Point the camera at the poster to place the snowman.';
      }

      renderer.setAnimationLoop((time, frame) => {
        if (frame && !testWithoutImageTracking) {
          const referenceSpace = renderer.xr.getReferenceSpace();
          if (referenceSpace && !anchorSet) {
            const imageResult = frame.getImageTrackingResults().find(
              result => result.index === 0 && result.trackingState === 'tracked'
            );
            const pose = imageResult && frame.getPose(imageResult.imageSpace, referenceSpace);

            if (pose) {
              anchorObject.matrix.fromArray(pose.transform.matrix);
              anchorObject.matrixWorldNeedsUpdate = true;
              anchorSet = true;
              anchorObject.visible = true;
              status.textContent = 'Poster anchored.';
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
    testWithoutImageTracking ? Promise.resolve(null) : (async () => {
      const image = new Image();
      image.src = './QR-For-Tracking.jpg';
      await image.decode();
      return createImageBitmap(image);
    })(),
  ]).then(([gltf, bitmap]) => {
    imageBitmap = bitmap;
    gltf.scene.scale.set(0.2, 0.2, 0.2);
    imageContent.add(gltf.scene);
    startButton.disabled = false;
    status.textContent = 'Ready to start AR.';
  }).catch(error => {
    console.error('Unable to prepare the AR scene:', error);
    status.textContent = `Unable to prepare AR: ${error.message}`;
  });
});
