import * as THREE from 'three';
import {loadGLTF} from "./loader.js";
import {createOneShotTracker} from "./oneshottracker.js";

document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-button');
  const status = document.getElementById('status');
  const targetWidthInMeters = 0.168;
  const qrWidthWithoutBorderInMeters = 0.068; // measured from black pixel to black pixel
  const targetOffsetInMeters = -0.04;
  const qrOffsetInMeters = 0.09;
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const anchorObject = new THREE.Group();
  const modelOrientation = new THREE.Group();
  const oneShotTracker = createOneShotTracker(renderer, qrWidthWithoutBorderInMeters);
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
  modelOrientation.rotation.set(-Math.PI / 2, 0, 0)
  anchorObject.add(modelOrientation);

  const axesHelper = new THREE.AxesHelper(1.0);
  anchorObject.add(axesHelper); 

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
              // Force upright: keep yaw, force +90° pitch for wall, and zero out Z
              const _pos = new THREE.Vector3();
              const _quat = new THREE.Quaternion();
              const _scale = new THREE.Vector3();
              const _euler = new THREE.Euler();
              anchorMatrix.decompose(_pos, _quat, _scale);
              const _normal = (new THREE.Vector3(0, 1, 0)).applyQuaternion(_quat);
              const yaw = Math.atan2(_normal.x, _normal.z); // use atan2 to avoid gimbal lock
              _quat.setFromEuler(_euler.set(Math.PI / 2, yaw, 0, 'YXZ'));
              const _right = new THREE.Vector3(1, 0, 0).applyQuaternion(_quat);
              const rightShift = imageTrackingEnabled ? -targetOffsetInMeters : -qrOffsetInMeters;
              _pos.add(_right.multiplyScalar(rightShift)); // shift anchor to center of poster
              anchorMatrix.compose(_pos, _quat, _scale);              

              anchorObject.matrix.copy(anchorMatrix);
              anchorObject.matrixWorldNeedsUpdate = true;
              anchorSet = true;
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
      image.src = './QR-For-Tracking.png';
      await image.decode();
      return createImageBitmap(image);
    })(),
  ]).then(([gltf, bitmap]) => {
    imageBitmap = bitmap;
    gltf.scene.scale.set(1, 1, 1); // gltf snowman is 1.6083m or about 5'3" tall, origin at center of base
    gltf.scene.position.set(0, -0.2, 0);
    //modelOrientation.add(gltf.scene);
    startButton.disabled = false;
    status.textContent = 'Ready to start AR.';
  }).catch(error => {
    console.error('Unable to prepare the AR scene:', error);
    status.textContent = `Unable to prepare AR: ${error.message}`;
  });
});
