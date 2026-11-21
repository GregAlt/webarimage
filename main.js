import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three'; 
import {loadGLTF} from "./loader.js";

document.addEventListener('DOMContentLoaded', () => {
  const start = async() => {
    // initialize MindAR 
    const mindarThree = new window.MINDAR.IMAGE.MindARThree({
      container: document.body,
      imageTargetSrc: 'qr.mind', // './course-banner.mind',
    });
    const {renderer, scene, camera} = mindarThree;

    const light = new THREE.HemisphereLight( 0xffffff, 0xbbbbff, 1 );
    scene.add(light);
    const snowman = await loadGLTF('./snowman.glb');
    snowman.scene.position.set(0, -0.4, 0);

    // create anchor
    const anchor = mindarThree.addAnchor(0);
    anchor.group.add(snowman.scene);

    // start AR
    await mindarThree.start();
    renderer.setAnimationLoop(() => {
      renderer.render(scene, camera);
    });
  }
  start();
});
